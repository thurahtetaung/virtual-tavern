import {
  type ActionCtx,
  type CreateCtx,
  type GameDefinition,
  GameError,
  type PlayerId,
  type PlayerInfo,
  type Rng,
  createRng,
} from '@vt/game-sdk';
import { conveyorAwards } from './awards.ts';
import { conveyorBot } from './bot.ts';
import {
  HAND_SIZE,
  TYPES,
  type TypeId,
  URAMAKI_GOAL,
  URAMAKI_PLACES,
  cardsOf,
  dessertsFor,
  isVariant,
  menuProblem,
  presetOf,
  randomMenu,
  typeOf,
  variantOf,
} from './cards.ts';
import { guide } from './guide.ts';
import { insights } from './insights.ts';
import { dessertRows, iconsOf, keptDesserts, personalPoints, roundRows } from './score.ts';
import {
  type Auto,
  type Card,
  type ConveyorAction,
  type ConveyorState,
  type ConveyorView,
  DEFAULT_SECONDS,
  GIVE_SECONDS,
  type Game,
  type GameView,
  LEFT_BEAT_MS,
  type LogEntry,
  MAX_LOG,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PILE_HAND,
  type Played,
  type Queued,
  ROUNDS,
  type Request,
  SCORES_SECONDS,
  type Seat,
  type SeatView,
  type Step,
  type StepView,
  actionSchema,
} from './types.ts';

type Ctx = ActionCtx;
type Result = ConveyorState | GameError;

const err = (code: string, message: string) => new GameError(code, message);
const draft = (s: ConveyorState): ConveyorState => structuredClone(s);
const hiddenRng = (state: ConveyorState, now: number) => createRng((state.seed ^ now) >>> 0);
const newSeed = (rng: Rng) => rng.int(2 ** 32);

// ---- Test rig ----

/**
 * Browser tests only: each round's deck for a table size starts with these cards in this order
 * (dealt in seat order, a hand each, then the rest of the deck), so a spec knows every hand.
 */
let testDeck: Record<number, string[]> | null = null;
export function setTestDeck(decks: Record<number, string[]> | null) {
  testDeck = decks;
}

/** "3:nigiri-squid wasabi …;2:…": a deck top per table size. */
export function parseTestDeck(raw: string): Record<number, string[]> {
  return Object.fromEntries(
    raw.split(';').flatMap((part) => {
      const [n, cards] = part.split(':');
      if (!n || !cards) return [];
      return [[Number(n), cards.split(/[\s,]+/).filter((k) => k && isVariant(k))]];
    }),
  );
}

// ---- Reading the table ----

export function players(state: ConveyorState): PlayerId[] {
  return Object.entries(state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));
}

/** The card as it physically is: a special order stays one whatever it copies. */
const physical = (c: Played): Card => ({ id: c.id, k: c.copy ? 'order' : c.k });

/** The cards a special order could copy now: anything in front of you but menus and boxes. */
export function copyTargets(tray: readonly Played[], self?: string): Played[] {
  return tray.filter((c) => c.id !== self && typeOf(c.k) !== 'menu' && typeOf(c.k) !== 'takeout');
}

/** Whether a card in front of you is a bonus you can call (chopsticks or a spoon, face up). */
export const isBonus = (c: Played) =>
  !c.flipped && (typeOf(c.k) === 'chopsticks' || typeOf(c.k) === 'spoon');

/** The types a spoon can ask for: the menu's (nigiri included). */
export const askable = (g: { menu: readonly TypeId[] }): TypeId[] => ['nigiri', ...g.menu];

const passDir = (s: ConveyorState, round: number): 1 | -1 =>
  s.settings.passBoth && round === 2 ? -1 : 1;

// ---- Log ----

type NewLog = LogEntry extends infer E
  ? E extends LogEntry
    ? Omit<E, 'id' | 'round' | 'turn'>
    : never
  : never;

function log(s: ConveyorState, entry: NewLog) {
  s.seq += 1;
  s.log.push({ ...entry, id: s.seq, round: s.game?.round ?? 0, turn: s.game?.turn ?? 0 });
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}

const autoOf = (auto?: Auto) => (auto ? { auto } : {});

// ---- Setting up ----

/** The menu for a new game, or why there is none. */
function chooseMenu(
  s: ConveyorState,
  n: number,
  rng: Rng,
): { types: TypeId[]; preset: string | null } | string {
  const choice = s.settings.menu;
  if (choice === 'random') return { types: randomMenu(n, (k) => rng.int(k)), preset: null };
  const types = choice === 'custom' ? s.settings.custom : (presetOf(choice)?.types ?? null);
  if (!types) return 'Pick a menu.';
  const problem = menuProblem(types, n);
  return problem ?? { types: [...types], preset: choice === 'custom' ? null : choice };
}

/** A fresh id for every card in a game: says nothing about the card. */
function ids(rng: Rng, count: number): string[] {
  const out = new Set<string>();
  while (out.size < count)
    out.add(
      rng
        .int(36 ** 6)
        .toString(36)
        .padStart(6, '0'),
    );
  return [...out];
}

function cardsFor(types: readonly TypeId[], rng: Rng): { main: Card[]; desserts: Card[] } {
  const { main, desserts } = cardsOf(types);
  const fresh = ids(rng, main.length + desserts.length);
  return {
    main: main.map((k, i) => ({ id: fresh[i]!, k })),
    desserts: rng.shuffle(desserts.map((k, i) => ({ id: fresh[main.length + i]!, k }))),
  };
}

/** The deck in the test rig's order: its cards first (as far as the deck has them), then the rest. */
function rigged(deck: Card[], n: number): Card[] {
  const rig = testDeck?.[n];
  if (!rig) return deck;
  const rest = [...deck];
  const top: Card[] = [];
  for (const k of rig) {
    const i = rest.findIndex((c) => c.k === k);
    if (i >= 0) top.push(...rest.splice(i, 1));
  }
  return [...top, ...rest];
}

/** A round: desserts in, shuffle, deal. */
function startRound(s: ConveyorState, rng: Rng) {
  const g = s.game!;
  const n = g.order.length;
  const add = g.dessertPile.splice(0, dessertsFor(n, g.round));
  g.deck = rigged(rng.shuffle([...g.deck, ...add]), n);
  const size = HAND_SIZE[n]!;
  const piles = n === 2 && s.settings.drawPile;
  for (const id of g.order) {
    const p = g.players[id]!;
    const cards = g.deck.splice(0, size);
    p.hand = piles ? cards.slice(0, PILE_HAND) : cards;
    p.pile = piles ? cards.slice(PILE_HAND) : [];
    p.tray = [];
    p.ura = 0;
    p.pick = null;
    p.from = null;
    p.ready = false;
  }
  g.turn = 1;
  g.turns = size;
  g.stage = 'pick';
  g.step = null;
  g.queue = [];
  g.claimed = 0;
  log(s, { kind: 'round' });
}

function deal(state: ConveyorState, ctx: Ctx): Result {
  const s = draft(state);
  dropLeft(s);
  seatWaiting(s);
  const order = players(s);
  if (order.length < MIN_PLAYERS) return err('too-few', `${MIN_PLAYERS} players are needed.`);
  if (order.length > MAX_PLAYERS) return err('too-many', `At most ${MAX_PLAYERS} can play.`);
  const menu = chooseMenu(s, order.length, ctx.rng);
  if (typeof menu === 'string') return err('bad-menu', menu);
  const cards = cardsFor(menu.types, ctx.rng);
  s.phase = 'playing';
  s.gamesPlayed += 1;
  s.log = [];
  s.game = {
    order,
    players: Object.fromEntries(
      order.map((id) => [
        id,
        {
          hand: [],
          pile: [],
          tray: [],
          desserts: [],
          ura: 0,
          score: 0,
          pick: null,
          from: null,
          ready: false,
        },
      ]),
    ),
    names: Object.fromEntries(order.map((id) => [id, s.seats[id]!.name])),
    menu: menu.types,
    preset: menu.preset,
    round: 1,
    turn: 1,
    turns: HAND_SIZE[order.length]!,
    stage: 'pick',
    step: null,
    queue: [],
    deck: cards.main,
    dessertPile: cards.desserts,
    claimed: 0,
    results: [],
    dessertRows: null,
    left: {},
    clock: null,
    winners: [],
  };
  startRound(s, ctx.rng);
  s.seed = newSeed(ctx.rng);
  settle(s, ctx.now);
  return s;
}

// ---- Playing cards ----

/**
 * Puts a card in front of its player: a special order becomes a copy of its target (or is
 * discarded with nothing to copy), a nigiri goes on the first empty wasabi, and a menu or a
 * takeout box waits for its number (or acts at once when it came by spoon or from a menu).
 */
function place(
  s: ConveyorState,
  by: PlayerId,
  card: Card,
  opts: { target?: string; now: boolean; auto?: Auto },
): Played | null {
  const g = s.game!;
  const p = g.players[by]!;
  let played: Played = { id: card.id, k: card.k, turn: g.turn };
  if (card.k === 'order') {
    const targets = copyTargets(p.tray);
    const target =
      targets.find((c) => c.id === opts.target) ?? (targets.length === 1 ? targets[0] : undefined);
    if (!target) {
      if (targets.length > 1 && opts.now) {
        // It came by spoon: its player chooses what it copies.
        p.tray.push(played);
        g.queue.unshift({ kind: 'copy', by, id: card.id, no: 0 });
        return played;
      }
      log(s, { kind: 'copy', by, k: null, ...autoOf(opts.auto) });
      g.deck.push(card);
      return null;
    }
    played = {
      ...played,
      k: target.k,
      copy: target.id,
      ...(target.flipped && { flipped: true }),
    };
  }
  p.tray.push(played);
  if (played.flipped) return played;
  const type = typeOf(played.k);
  if (type === 'nigiri') {
    const wasabi = p.tray.find((w) => typeOf(w.k) === 'wasabi' && !w.flipped && !w.filled);
    if (wasabi) {
      played.on = wasabi.id;
      wasabi.filled = true;
      log(s, { kind: 'wasabi', by, k: played.k });
    }
  }
  if (type === 'menu' || type === 'takeout') {
    const q: Queued = { kind: type, by, id: played.id, no: variantOf(played.k).no ?? 0 };
    if (opts.now) g.queue.unshift(q);
    else {
      const at = g.queue.findIndex((x) => x.no > q.no);
      g.queue.splice(at < 0 ? g.queue.length : at, 0, q);
    }
  }
  return played;
}

/** Takes a card out of play for the rest of the round. */
function discard(s: ConveyorState, by: PlayerId, id: string) {
  const g = s.game!;
  const p = g.players[by]!;
  const i = p.tray.findIndex((c) => c.id === id);
  if (i < 0) return;
  const [c] = p.tray.splice(i, 1);
  g.deck.push(physical(c!));
}

const fromHand = (hand: Card[], id: string): Card | null => {
  const i = hand.findIndex((c) => c.id === id);
  return i < 0 ? null : hand.splice(i, 1)[0]!;
};

// ---- The turn ----

function pickProblem(
  g: Game,
  by: PlayerId,
  a: { card: string; target?: string; bonus?: string },
): GameError | null {
  const p = g.players[by];
  if (!p) return err('not-playing', 'You are not in this game.');
  if (g.stage !== 'pick') return err('not-now', 'Wait for the next turn.');
  const card = p.hand.find((c) => c.id === a.card);
  if (!card) return err('not-in-hand', 'Pick a card from your hand.');
  if (card.k === 'order') {
    const targets = copyTargets(p.tray);
    if (a.target !== undefined && !targets.some((c) => c.id === a.target))
      return err('bad-target', 'Copy a card in front of you.');
    if (a.target === undefined && targets.length > 1)
      return err('pick-target', 'Choose which of your cards it copies.');
  } else if (a.target !== undefined) return err('bad-target', 'Only a special order copies.');
  if (a.bonus !== undefined) {
    const bonus = p.tray.find((c) => c.id === a.bonus);
    if (!bonus || !isBonus(bonus))
      return err('bad-bonus', 'Call chopsticks or a spoon in front of you.');
    if (typeOf(bonus.k) === 'chopsticks' && p.hand.length < 2)
      return err('no-second', 'Chopsticks need a second card in your hand.');
  }
  return null;
}

function pick(
  s: ConveyorState,
  by: PlayerId,
  a: { card: string; target?: string; bonus?: string },
  rng: Rng,
  auto?: Auto,
): GameError | null {
  const g = s.game!;
  const e = pickProblem(g, by, a);
  if (e) return e;
  g.players[by]!.pick = {
    card: a.card,
    ...(a.target !== undefined && { target: a.target }),
    ...(a.bonus !== undefined && { bonus: a.bonus }),
    ...autoOf(auto),
  };
  if (g.order.every((id) => g.players[id]!.pick)) reveal(s, rng);
  return null;
}

/**
 * Everyone's card turns over at once and goes in front of them; then the called chopsticks, the
 * spoons, menus and takeout boxes resolve, lowest number first.
 */
function reveal(s: ConveyorState, rng: Rng) {
  const g = s.game!;
  const plays: Extract<LogEntry, { kind: 'reveal' }>['plays'] = [];
  const calls: Extract<Step, { kind: 'chop' }>['calls'] = {};
  const spoons: Queued[] = [];
  const steals: NewLog[] = [];
  const cards: { id: PlayerId; card: Card; target?: string }[] = [];
  for (const id of g.order) {
    const p = g.players[id]!;
    const pk = p.pick!;
    const card = fromHand(p.hand, pk.card)!;
    // A card the passer needed: worth 5 or more to their own sets.
    const passer = p.from;
    if (passer && passer !== id && card.k !== 'order') {
      const tray = g.players[passer]!.tray;
      const worth =
        personalPoints([...tray, { id: '-', k: card.k, turn: g.turn }]) - personalPoints(tray);
      if (worth >= 5) steals.push({ kind: 'steal', by: id, from: passer, k: card.k, worth });
    }
    const targets = card.k === 'order' ? copyTargets(p.tray) : [];
    const copied =
      targets.find((c) => c.id === pk.target) ?? (targets.length === 1 ? targets[0] : undefined);
    const bonus = pk.bonus ? p.tray.find((c) => c.id === pk.bonus) : undefined;
    plays.push({
      by: id,
      k: card.k,
      ...(copied && { copy: copied.k }),
      ...(bonus && { bonus: bonus.k }),
      ...autoOf(pk.auto),
    });
    if (bonus && typeOf(bonus.k) === 'chopsticks')
      calls[id] = { id: bonus.id, no: variantOf(bonus.k).no ?? 0 };
    if (bonus && typeOf(bonus.k) === 'spoon')
      spoons.push({ kind: 'spoon', by: id, id: bonus.id, no: variantOf(bonus.k).no ?? 0 });
    cards.push({ id, card, ...(pk.target && { target: pk.target }) });
    p.pick = null;
  }
  log(s, { kind: 'reveal', plays });
  for (const e of steals) log(s, e);
  for (const c of cards)
    place(s, c.id, c.card, { ...(c.target && { target: c.target }), now: false });
  for (const q of spoons) {
    const i = g.queue.findIndex((x) => x.no > q.no);
    g.queue.splice(i < 0 ? g.queue.length : i, 0, q);
  }
  g.stage = 'resolve';
  g.step = Object.keys(calls).length ? { kind: 'chop', calls, choices: {}, auto: {} } : null;
  advance(s, rng);
}

/** Works through the turn's queue until it needs someone's choice, or the turn is over. */
function advance(s: ConveyorState, _rng: Rng) {
  const g = s.game!;
  for (let guard = 0; guard < 100; guard++) {
    if (g.step) return;
    const q = g.queue.shift();
    if (!q) {
      finishTurn(s);
      return;
    }
    const p = g.players[q.by]!;
    if (!p.tray.some((c) => c.id === q.id)) continue;
    if (q.kind === 'spoon') {
      g.step = { kind: 'spoon', by: q.by, id: q.id, no: q.no };
    } else if (q.kind === 'menu') {
      const drawn = g.deck.splice(0, 4);
      if (!drawn.some((c) => typeOf(c.k) !== 'menu')) {
        g.deck.push(...drawn);
        discard(s, q.by, q.id);
        log(s, { kind: 'menu', by: q.by, k: null });
        continue;
      }
      g.step = { kind: 'menu', by: q.by, id: q.id, no: q.no, drawn };
    } else if (q.kind === 'takeout') {
      if (!takeoutTargets(g, q.by, q.id).length) {
        discard(s, q.by, q.id);
        log(s, { kind: 'takeout', by: q.by, ks: [] });
        continue;
      }
      g.step = { kind: 'takeout', by: q.by, id: q.id, no: q.no };
    } else {
      g.step = { kind: 'copy', by: q.by, id: q.id };
    }
  }
}

/** The cards a takeout box may turn face down: its player's, from earlier turns, face up. */
export function takeoutTargets(
  g: { turn: number; players: Record<PlayerId, { tray: Played[] }> },
  by: PlayerId,
  box: string,
): Played[] {
  return g.players[by]!.tray.filter((c) => c.id !== box && c.turn < g.turn && !c.flipped);
}

/** Uramaki: whoever reached 10 icons this turn scores the next place and discards them. */
function uramakiRace(s: ConveyorState) {
  const g = s.game!;
  if (g.claimed >= URAMAKI_PLACES.length) return;
  const reached = g.order
    .map((id) => ({ id, icons: iconsOf(g.players[id]!.tray, 'uramaki') }))
    .filter((x) => x.icons >= URAMAKI_GOAL)
    .sort((a, b) => b.icons - a.icons);
  if (!reached.length) return;
  const claims: { by: PlayerId; icons: number; points: number }[] = [];
  let place = g.claimed;
  while (reached.length && place < URAMAKI_PLACES.length) {
    const icons = reached[0]!.icons;
    const tied = reached.filter((x) => x.icons === icons);
    reached.splice(0, tied.length);
    for (const x of tied) {
      const points = URAMAKI_PLACES[place]!;
      const p = g.players[x.id]!;
      p.ura += points;
      for (const c of p.tray.filter((c) => !c.flipped && typeOf(c.k) === 'uramaki'))
        discard(s, x.id, c.id);
      claims.push({ by: x.id, icons, points });
    }
    // Same-turn ties all take the place; the places after it are skipped.
    place += tied.length;
  }
  g.claimed = Math.min(URAMAKI_PLACES.length, place);
  log(s, { kind: 'uramaki', claims });
}

/** Two or more miso soups in one turn: every one of them is discarded. */
function misoClash(s: ConveyorState) {
  const g = s.game!;
  const misos = g.order.flatMap((id) =>
    g.players[id]!.tray.filter(
      (c) => !c.flipped && c.turn === g.turn && typeOf(c.k) === 'miso',
    ).map((c) => ({ id, card: c.id })),
  );
  if (misos.length < 2) return;
  for (const m of misos) discard(s, m.id, m.card);
  log(s, { kind: 'miso', by: misos.map((m) => m.id) });
}

/** The turn's end: uramaki, miso, then hands move on (or the round ends). */
function finishTurn(s: ConveyorState) {
  const g = s.game!;
  g.step = null;
  uramakiRace(s);
  misoClash(s);
  if (g.order.every((id) => !g.players[id]!.hand.length && !g.players[id]!.pile.length)) {
    endRound(s);
    return;
  }
  const dir = passDir(s, g.round);
  const n = g.order.length;
  const hands = g.order.map((id) => g.players[id]!.hand);
  g.order.forEach((id, i) => {
    const giver = g.order[(i - dir + n) % n]!;
    const p = g.players[id]!;
    p.hand = hands[(i - dir + n) % n]!;
    p.from = giver;
  });
  g.turn += 1;
  for (const id of g.order) {
    const p = g.players[id]!;
    if (p.pile.length) p.hand.push(p.pile.shift()!);
  }
  g.stage = 'pick';
}

function endRound(s: ConveyorState) {
  const g = s.game!;
  const trays = Object.fromEntries(g.order.map((id) => [id, g.players[id]!.tray]));
  const rows = roundRows({
    order: g.order,
    trays,
    ura: Object.fromEntries(g.order.map((id) => [id, g.players[id]!.ura])),
    claimed: g.claimed,
  });
  for (const r of rows) g.players[r.id]!.score += r.points;
  g.results.push({ round: g.round, rows });
  for (const id of g.order) {
    const p = g.players[id]!;
    const kept = keptDesserts(p.tray);
    p.desserts.push(...kept.map((c) => ({ ...c, turn: 0 })));
    for (const c of p.tray) if (!kept.includes(c)) g.deck.push(physical(c));
    p.tray = [];
    p.ura = 0;
  }
  log(s, { kind: 'end', points: Object.fromEntries(rows.map((r) => [r.id, r.points])) });
  if (g.round >= ROUNDS) {
    endGame(s);
    return;
  }
  g.stage = 'scores';
  g.step = null;
  for (const id of g.order) g.players[id]!.ready = g.left[id] !== undefined;
}

function endGame(s: ConveyorState) {
  const g = s.game!;
  const dessert = g.menu.find((t) => TYPES[t].group === 'desserts')!;
  const rows = dessertRows(
    g.order,
    Object.fromEntries(g.order.map((id) => [id, g.players[id]!.desserts])),
    dessert,
  );
  for (const r of rows) g.players[r.id]!.score += r.points;
  g.dessertRows = rows;
  g.winners = winnersOf(g, s.settings.golf);
  s.phase = 'over';
  g.stage = 'scores';
  g.clock = null;
  log(s, { kind: 'over', winners: [...g.winners] });
}

/** The best score wins (the lowest with golf); a tie goes to most desserts (fewest with golf). */
export function winnersOf(g: Game, golf: boolean): PlayerId[] {
  const sign = golf ? -1 : 1;
  const key = (id: PlayerId) => [
    sign * g.players[id]!.score,
    sign * g.players[id]!.desserts.length,
  ];
  const best = g.order.reduce((a, b) => {
    const [x1, y1] = key(a);
    const [x2, y2] = key(b);
    return x2! > x1! || (x2 === x1 && y2! > y1!) ? b : a;
  });
  const [bx, by] = key(best);
  return g.order.filter((id) => {
    const [x, y] = key(id);
    return x === bx && y === by;
  });
}

function nextRound(s: ConveyorState, rng: Rng) {
  const g = s.game!;
  g.round += 1;
  startRound(s, rng);
}

const allReady = (g: Game) =>
  g.order.every((id) => g.players[id]!.ready || g.left[id] !== undefined);

// ---- Choices after the reveal ----

function stepOf<K extends Step['kind']>(g: Game, kind: K): Extract<Step, { kind: K }> | null {
  return g.step?.kind === kind ? (g.step as Extract<Step, { kind: K }>) : null;
}

function chop(
  s: ConveyorState,
  by: PlayerId,
  a: { card: string; target?: string },
  rng: Rng,
  auto?: Auto,
): GameError | null {
  const g = s.game!;
  const step = stepOf(g, 'chop');
  if (!step || !step.calls[by]) return err('not-now', 'You have no chopsticks to use now.');
  if (step.choices[by]) return err('done', 'You have chosen your second card.');
  const p = g.players[by]!;
  const card = p.hand.find((c) => c.id === a.card);
  if (!card) return err('not-in-hand', 'Pick a card from your hand.');
  if (card.k === 'order') {
    const targets = copyTargets(p.tray);
    if (a.target !== undefined && !targets.some((c) => c.id === a.target))
      return err('bad-target', 'Copy a card in front of you.');
    if (a.target === undefined && targets.length > 1)
      return err('pick-target', 'Choose which of your cards it copies.');
  }
  step.choices[by] = { card: a.card, ...(a.target !== undefined && { target: a.target }) };
  if (auto) step.auto[by] = auto;
  if (Object.keys(step.calls).every((id) => step.choices[id])) {
    // Every second card goes down, chopsticks first by number; each pair goes back in the hand.
    const users = Object.keys(step.calls).sort((x, y) => step.calls[x]!.no - step.calls[y]!.no);
    g.step = null;
    for (const id of users) {
      const q = g.players[id]!;
      const choice = step.choices[id]!;
      const second = fromHand(q.hand, choice.card)!;
      const sticks = q.tray.find((c) => c.id === step.calls[id]!.id)!;
      q.tray.splice(q.tray.indexOf(sticks), 1);
      q.hand.push(physical(sticks));
      const played = place(s, id, second, {
        ...(choice.target !== undefined && { target: choice.target }),
        now: false,
      });
      log(s, {
        kind: 'chop',
        by: id,
        k: played ? played.k : second.k,
        ...autoOf(step.auto[id]),
      });
    }
    advance(s, rng);
  }
  return null;
}

/** Who a spoon's request reaches: the first player to the left holding a card that fits. */
function giverFor(g: Game, by: PlayerId, request: Request): PlayerId | null {
  const n = g.order.length;
  const at = g.order.indexOf(by);
  for (let i = 1; i < n; i++) {
    const id = g.order[(at + i) % n]!;
    if (fits(g.players[id]!.hand, request).length) return id;
  }
  return null;
}

/** The cards in a hand a request fits. */
export const fits = (hand: readonly Card[], request: Request): Card[] =>
  hand.filter((c) => typeOf(c.k) === request.type && (!request.variant || c.k === request.variant));

function spoon(
  s: ConveyorState,
  by: PlayerId,
  request: Request,
  rng: Rng,
  auto?: Auto,
): GameError | null {
  const g = s.game!;
  const step = stepOf(g, 'spoon');
  if (!step || step.by !== by) return err('not-now', 'You have no spoon to use now.');
  if (!askable(g).includes(request.type)) return err('bad-request', 'Ask for a dish on the menu.');
  if (request.variant && (!isVariant(request.variant) || typeOf(request.variant) !== request.type))
    return err('bad-request', 'Ask for a dish on the menu.');
  const giver = giverFor(g, by, request);
  if (!giver) {
    discard(s, by, step.id);
    log(s, { kind: 'spoon', by, from: null, k: null, ...autoOf(auto) });
    g.step = null;
    advance(s, rng);
    return null;
  }
  const options = fits(g.players[giver]!.hand, request);
  if (new Set(options.map((c) => c.k)).size > 1) {
    g.step = { kind: 'give', by, id: step.id, no: step.no, from: giver, request };
    return null;
  }
  handOver(s, by, step.id, giver, options[0]!.id, rng, auto);
  return null;
}

/** The giver hands the card over, it's played at once, and the spoon goes into their hand. */
function handOver(
  s: ConveyorState,
  by: PlayerId,
  spoonId: string,
  giver: PlayerId,
  cardId: string,
  rng: Rng,
  auto?: Auto,
) {
  const g = s.game!;
  const card = fromHand(g.players[giver]!.hand, cardId)!;
  const p = g.players[by]!;
  const sp = p.tray.find((c) => c.id === spoonId)!;
  p.tray.splice(p.tray.indexOf(sp), 1);
  g.players[giver]!.hand.push(physical(sp));
  g.step = null;
  log(s, { kind: 'spoon', by, from: giver, k: card.k, ...autoOf(auto) });
  place(s, by, card, { now: true });
  advance(s, rng);
}

function give(s: ConveyorState, by: PlayerId, cardId: string, rng: Rng, auto?: Auto) {
  const g = s.game!;
  const step = stepOf(g, 'give');
  if (!step || step.from !== by) return err('not-now', 'Nobody is asking you for a card.');
  if (!fits(g.players[by]!.hand, step.request).some((c) => c.id === cardId))
    return err('bad-card', 'Give a card that fits the request.');
  handOver(s, step.by, step.id, by, cardId, rng, auto);
  return null;
}

function menu(
  s: ConveyorState,
  by: PlayerId,
  a: { card: string; target?: string },
  rng: Rng,
  auto?: Auto,
): GameError | null {
  const g = s.game!;
  const step = stepOf(g, 'menu');
  if (!step || step.by !== by) return err('not-now', 'You have no menu to order from now.');
  const card = step.drawn.find((c) => c.id === a.card);
  if (!card || typeOf(card.k) === 'menu')
    return err('bad-card', 'Pick one of the drawn cards (not another menu).');
  const p = g.players[by]!;
  if (card.k === 'order') {
    const targets = copyTargets(p.tray, step.id);
    if (a.target !== undefined && !targets.some((c) => c.id === a.target))
      return err('bad-target', 'Copy a card in front of you.');
    if (a.target === undefined && targets.length > 1)
      return err('pick-target', 'Choose which of your cards it copies.');
  }
  g.deck = rng.shuffle([...g.deck, ...step.drawn.filter((c) => c.id !== card.id)]);
  discard(s, by, step.id);
  g.step = null;
  const played = place(s, by, card, {
    ...(a.target !== undefined && { target: a.target }),
    now: true,
  });
  log(s, { kind: 'menu', by, k: played ? played.k : card.k, ...autoOf(auto) });
  advance(s, rng);
  return null;
}

function copy(s: ConveyorState, by: PlayerId, target: string, rng: Rng, auto?: Auto) {
  const g = s.game!;
  const step = stepOf(g, 'copy');
  if (!step || step.by !== by) return err('not-now', 'You have nothing to copy now.');
  const p = g.players[by]!;
  const t = copyTargets(p.tray, step.id).find((c) => c.id === target);
  if (!t) return err('bad-target', 'Copy a card in front of you.');
  const i = p.tray.findIndex((c) => c.id === step.id);
  const [order] = p.tray.splice(i, 1);
  g.step = null;
  const played = place(s, by, { id: order!.id, k: 'order' }, { target, now: true });
  log(s, { kind: 'copy', by, k: played?.k ?? null, ...autoOf(auto) });
  advance(s, rng);
  return null;
}

function takeout(s: ConveyorState, by: PlayerId, cards: string[], rng: Rng, auto?: Auto) {
  const g = s.game!;
  const step = stepOf(g, 'takeout');
  if (!step || step.by !== by) return err('not-now', 'You have no takeout box to fill now.');
  const targets = takeoutTargets(g, by, step.id);
  const chosen = [...new Set(cards)];
  if (chosen.some((id) => !targets.some((c) => c.id === id)))
    return err('bad-card', 'Turn over cards you played on earlier turns this round.');
  const p = g.players[by]!;
  const ks: string[] = [];
  for (const id of chosen) {
    const c = p.tray.find((x) => x.id === id)!;
    ks.push(c.k);
    c.flipped = true;
    // A face-down wasabi lets its nigiri go back to face value.
    if (typeOf(c.k) === 'wasabi') for (const x of p.tray) if (x.on === c.id) delete x.on;
  }
  discard(s, by, step.id);
  g.step = null;
  log(s, { kind: 'takeout', by, ks, ...autoOf(auto) });
  advance(s, rng);
  return null;
}

// ---- Moves made for a player ----

/** The players the table waits on now. */
export function waitingOn(g: Game): PlayerId[] {
  if (g.stage === 'pick') return g.order.filter((id) => !g.players[id]!.pick);
  if (g.stage === 'scores') return g.order.filter((id) => !g.players[id]!.ready);
  const step = g.step;
  if (!step) return [];
  if (step.kind === 'chop') return Object.keys(step.calls).filter((id) => !step.choices[id]);
  if (step.kind === 'give') return [step.from];
  return [step.by];
}

const pickOne = <T>(rng: Rng, xs: readonly T[]): T | undefined =>
  xs.length ? xs[rng.int(xs.length)] : undefined;

/**
 * The move made for a player out of time, away, or when the host acts for them: a random legal
 * card (and target), a random dish asked for, a random card given, nothing turned face down.
 */
function autoMove(s: ConveyorState, who: PlayerId, why: Auto, rng: Rng): boolean {
  const g = s.game!;
  if (g.stage === 'scores' || !waitingOn(g).includes(who)) return false;
  const p = g.players[who]!;
  const target = (self?: string) => pickOne(rng, copyTargets(p.tray, self))?.id;
  const run = (fn: () => GameError | null) => fn() === null;
  if (g.stage === 'pick') {
    const card = pickOne(rng, p.hand)!;
    const t = card.k === 'order' ? target() : undefined;
    return run(() => pick(s, who, { card: card.id, ...(t && { target: t }) }, rng, why));
  }
  const step = g.step;
  if (!step) return false;
  switch (step.kind) {
    case 'chop': {
      const card = pickOne(rng, p.hand)!;
      const t = card.k === 'order' ? target() : undefined;
      return run(() => chop(s, who, { card: card.id, ...(t && { target: t }) }, rng, why));
    }
    case 'spoon':
      return run(() => spoon(s, who, { type: pickOne(rng, askable(g))! }, rng, why));
    case 'give':
      return run(() => give(s, who, pickOne(rng, fits(p.hand, step.request))!.id, rng, why));
    case 'menu': {
      const card = pickOne(
        rng,
        step.drawn.filter((c) => typeOf(c.k) !== 'menu'),
      )!;
      const t = card.k === 'order' ? target(step.id) : undefined;
      return run(() => menu(s, who, { card: card.id, ...(t && { target: t }) }, rng, why));
    }
    case 'copy':
      return run(() => copy(s, who, target(step.id)!, rng, why));
    case 'takeout':
      return run(() => takeout(s, who, [], rng, why));
  }
}

// ---- Lobby ----

function requireHost(ctx: Ctx) {
  return ctx.isHost ? null : err('not-host', 'Only the host can do that.');
}

function seatWaiting(s: ConveyorState) {
  let free = MAX_PLAYERS - players(s).length;
  for (const seat of Object.values(s.seats)) {
    if (free <= 0) break;
    if (!seat.waiting || seat.playing) continue;
    delete seat.waiting;
    seat.playing = true;
    free -= 1;
  }
}

function sit(state: ConveyorState, playing: boolean, ctx: Ctx): Result {
  const seat = state.seats[ctx.by];
  if (!seat) return err('not-seated', 'You are not in this room.');
  if (state.phase === 'playing' && state.game?.players[ctx.by])
    return err('in-progress', 'You can sit down or stand up between games.');
  if (seat.playing === playing && !seat.waiting) return state;
  if (playing && !seat.playing && players(state).length >= MAX_PLAYERS)
    return err('full', `Only ${MAX_PLAYERS} can play.`);
  const s = draft(state);
  const mine = s.seats[ctx.by]!;
  delete mine.waiting;
  if (s.phase === 'playing' && playing) mine.waiting = true;
  else mine.playing = playing;
  return s;
}

function dropLeft(s: ConveyorState) {
  for (const id of Object.keys(s.game?.left ?? {})) delete s.seats[id];
}

function updateSettings(
  state: ConveyorState,
  a: Extract<ConveyorAction, { type: 'update-settings' }>,
  ctx: Ctx,
): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'playing') return err('in-progress', 'Settings change between games.');
  if (a.menu !== undefined && a.menu !== 'random' && a.menu !== 'custom' && !presetOf(a.menu))
    return err('bad-menu', 'Pick a menu.');
  if (a.custom !== undefined && new Set(a.custom).has('nigiri'))
    return err('bad-menu', 'Nigiri is always on the menu.');
  const s = draft(state);
  if (a.menu !== undefined) s.settings.menu = a.menu;
  if (a.custom !== undefined) s.settings.custom = [...new Set(a.custom)];
  if (a.passBoth !== undefined) s.settings.passBoth = a.passBoth;
  if (a.golf !== undefined) s.settings.golf = a.golf;
  if (a.drawPile !== undefined) s.settings.drawPile = a.drawPile;
  if (a.seconds !== undefined) s.settings.seconds = a.seconds;
  if (a.timerMode !== undefined) s.settings.timerMode = a.timerMode;
  return s;
}

function backToLobby(state: ConveyorState, ctx: Ctx): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'lobby') return err('wrong-phase', 'No game to leave.');
  const s = draft(state);
  dropLeft(s);
  s.phase = 'lobby';
  s.game = null;
  s.log = [];
  seatWaiting(s);
  return s;
}

// ---- Clock ----

function clockKey(g: Game): string {
  const step = g.step;
  const sub = step
    ? `${step.kind}:${'by' in step ? step.by : ''}:${'id' in step ? step.id : ''}`
    : '';
  return `${g.round}:${g.turn}:${g.stage}:${sub}`;
}

/** The decision clock restarts whenever the table waits on something new. */
function settle(s: ConveyorState, now: number) {
  const g = s.game;
  if (!g) return;
  if (s.phase !== 'playing') {
    g.clock = null;
    return;
  }
  const key = clockKey(g);
  if (g.clock?.key !== key) g.clock = { key, since: now, reminded: false };
}

// ---- In play ----

function inPlay(
  state: ConveyorState,
  ctx: Ctx,
  fn: (s: ConveyorState) => GameError | null,
): Result {
  if (state.phase !== 'playing' || !state.game) return err('not-playing', 'No game in play.');
  const s = draft(state);
  const e = fn(s);
  if (e) return e;
  settle(s, ctx.now);
  return s;
}

function reduce(state: ConveyorState, action: ConveyorAction, ctx: Ctx): Result {
  const by = ctx.by;
  const rng = ctx.rng;
  switch (action.type) {
    case 'update-settings':
      return updateSettings(state, action, ctx);
    case 'sit':
      return sit(state, action.playing, ctx);
    case 'start': {
      const e = requireHost(ctx);
      if (e) return e;
      if (state.phase === 'playing') return err('in-progress', 'A game is already running.');
      return deal(state, ctx);
    }
    case 'play-again': {
      const e = requireHost(ctx);
      if (e) return e;
      if (state.phase !== 'over') return err('wrong-phase', 'Finish the game first.');
      return deal(state, ctx);
    }
    case 'back-to-lobby':
      return backToLobby(state, ctx);
    case 'pick':
      return inPlay(state, ctx, (s) => pick(s, by, action, rng));
    case 'unpick':
      return inPlay(state, ctx, (s) => {
        const g = s.game!;
        if (g.stage !== 'pick' || !g.players[by]?.pick)
          return err('not-now', 'You have nothing to take back.');
        g.players[by].pick = null;
        return null;
      });
    case 'chop':
      return inPlay(state, ctx, (s) => chop(s, by, action, rng));
    case 'spoon':
      return inPlay(state, ctx, (s) =>
        spoon(
          s,
          by,
          { type: action.want, ...(action.variant && { variant: action.variant }) },
          rng,
        ),
      );
    case 'give':
      return inPlay(state, ctx, (s) => give(s, by, action.card, rng));
    case 'menu':
      return inPlay(state, ctx, (s) => menu(s, by, action, rng));
    case 'copy':
      return inPlay(state, ctx, (s) => copy(s, by, action.target, rng));
    case 'takeout':
      return inPlay(state, ctx, (s) => takeout(s, by, action.cards, rng));
    case 'ready':
      return inPlay(state, ctx, (s) => {
        const g = s.game!;
        if (!g.players[by]) return err('not-playing', 'You are not in this game.');
        if (g.stage !== 'scores') return err('not-now', 'The round is still being played.');
        g.players[by].ready = true;
        if (allReady(g)) nextRound(s, rng);
        return null;
      });
    case 'next-round': {
      const e = requireHost(ctx);
      if (e) return e;
      return inPlay(state, ctx, (s) => {
        if (s.game!.stage !== 'scores') return err('not-now', 'The round is still being played.');
        nextRound(s, rng);
        return null;
      });
    }
    case 'act-for': {
      const e = requireHost(ctx);
      if (e) return e;
      return inPlay(state, ctx, (s) =>
        autoMove(s, action.player, 'host', rng)
          ? null
          : err('not-waiting', 'The table isn’t waiting on that player.'),
      );
    }
  }
}

// ---- Players coming and going ----

function create(ctx: CreateCtx, playersIn: readonly PlayerInfo[]): ConveyorState {
  let state: ConveyorState = {
    phase: 'lobby',
    settings: {
      menu: 'first',
      custom: [...presetOf('first')!.types],
      passBoth: false,
      golf: false,
      drawPile: false,
      seconds: DEFAULT_SECONDS,
      timerMode: 'soft',
    },
    seed: newSeed(ctx.rng),
    seats: {},
    game: null,
    log: [],
    seq: 0,
    gamesPlayed: 0,
  };
  for (const p of playersIn) state = playerJoined(state, p);
  return state;
}

function playerJoined(state: ConveyorState, player: PlayerInfo): ConveyorState {
  const s = draft(state);
  const existing = s.seats[player.id];
  if (existing) {
    existing.name = player.name;
    const g = s.game;
    if (g?.names[player.id]) g.names[player.id] = player.name;
    if (g && g.left[player.id] !== undefined) {
      delete g.left[player.id];
      if (g.stage === 'scores' && s.phase === 'playing') g.players[player.id]!.ready = false;
      log(s, { kind: 'back', player: player.id });
    }
    return s;
  }
  const playing = s.phase !== 'playing' && players(s).length < MAX_PLAYERS;
  const seat: Seat = { name: player.name, playing, ...(!playing && { waiting: true }) };
  s.seats[player.id] = seat;
  return s;
}

/**
 * Someone left for good. Between games their seat goes; mid-game they keep it (a hand must keep
 * moving round the table), and the table plays for them after a short beat until they come back.
 */
function playerLeft(state: ConveyorState, playerId: PlayerId, now: number): ConveyorState {
  if (!state.seats[playerId]) return state;
  const s = draft(state);
  const g = s.game;
  if (s.phase === 'playing' && g?.players[playerId]) {
    if (g.left[playerId] === undefined) {
      g.left[playerId] = now;
      log(s, { kind: 'left', player: playerId });
    }
    return s;
  }
  delete s.seats[playerId];
  if (s.phase !== 'playing') seatWaiting(s);
  return s;
}

// ---- Timers ----

type Due = { at: number; why: Auto | 'remind' | 'deal'; who: PlayerId[] };

function deadlines(state: ConveyorState): Due[] {
  const g = state.game;
  if (state.phase !== 'playing' || !g?.clock) return [];
  const out: Due[] = [];
  const since = g.clock.since;
  if (g.stage === 'scores') {
    out.push({
      at: since + (allReady(g) ? LEFT_BEAT_MS : SCORES_SECONDS * 1000),
      why: 'deal',
      who: [],
    });
    return out;
  }
  const open = waitingOn(g);
  for (const id of open) {
    const gone = g.left[id];
    if (gone !== undefined)
      out.push({ at: Math.max(since, gone) + LEFT_BEAT_MS, why: 'left', who: [id] });
  }
  if (g.step?.kind === 'give') {
    out.push({ at: since + GIVE_SECONDS * 1000, why: 'timer', who: open });
  } else {
    const secs = state.settings.seconds;
    if (secs !== null && open.length) {
      const at = since + secs * 1000;
      if (state.settings.timerMode === 'strict') out.push({ at, why: 'timer', who: open });
      else if (!g.clock.reminded) out.push({ at, why: 'remind', who: [] });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

function nextDeadline(state: ConveyorState): number | null {
  return deadlines(state)[0]?.at ?? null;
}

function onDeadline(state: ConveyorState, now: number): ConveyorState {
  const due = deadlines(state)[0];
  if (!due || now < due.at) return state;
  const s = draft(state);
  const g = s.game!;
  const rng = hiddenRng(state, now);
  if (due.why === 'remind') g.clock!.reminded = true;
  else if (due.why === 'deal') nextRound(s, rng);
  else
    for (const id of due.who) {
      // Each move may have moved the table on; act only while it still waits on them.
      if (s.phase === 'playing') autoMove(s, id, due.why, rng);
    }
  settle(s, now);
  s.seed = newSeed(rng);
  return s;
}

// ---- Views ----

function stepView(g: Game, viewer: PlayerId | null): StepView | null {
  const step = g.step;
  if (!step) return null;
  switch (step.kind) {
    case 'chop':
      return { kind: 'chop', players: Object.keys(step.calls), done: Object.keys(step.choices) };
    case 'spoon':
      return { kind: 'spoon', by: step.by, no: step.no };
    case 'give': {
      const involved = viewer === step.by || viewer === step.from;
      return {
        kind: 'give',
        by: step.by,
        from: step.from,
        request: involved ? { ...step.request } : null,
        options:
          viewer === step.from
            ? fits(g.players[step.from]!.hand, step.request).map((c) => ({ ...c }))
            : null,
      };
    }
    case 'menu':
      return {
        kind: 'menu',
        by: step.by,
        no: step.no,
        drawn: viewer === step.by ? step.drawn.map((c) => ({ ...c })) : null,
        count: step.drawn.length,
      };
    case 'copy':
      return { kind: 'copy', by: step.by };
    case 'takeout':
      return { kind: 'takeout', by: step.by, no: step.no };
  }
}

function gameView(state: ConveyorState, g: Game, viewer: PlayerId | null): GameView {
  const secs = state.settings.seconds;
  const mine = viewer ? g.players[viewer] : undefined;
  const chopStep = stepOf(g, 'chop');
  const waiting = waitingOn(g);
  const give = g.step?.kind === 'give';
  return {
    order: [...g.order],
    players: g.order.map((id) => {
      const p = g.players[id]!;
      return {
        id,
        name: state.seats[id]?.name ?? g.names[id] ?? 'Gone',
        hand: p.hand.length,
        pile: p.pile.length,
        tray: structuredClone(p.tray),
        desserts: structuredClone(p.desserts),
        ura: p.ura,
        score: p.score,
        done: g.stage === 'pick' ? p.pick !== null : g.stage === 'scores' ? p.ready : false,
        left: g.left[id] !== undefined || !state.seats[id],
      };
    }),
    menu: [...g.menu],
    preset: g.preset,
    round: g.round,
    rounds: ROUNDS,
    turn: g.turn,
    turns: g.turns,
    dir: passDir(state, g.round),
    stage: g.stage,
    step: stepView(g, viewer),
    queue: g.queue.flatMap((q) =>
      q.kind === 'copy' ? [] : [{ kind: q.kind, by: q.by, no: q.no }],
    ),
    deck: g.deck.length,
    hand: mine ? mine.hand.map((c) => ({ ...c })) : null,
    myPick: mine?.pick ? { ...mine.pick } : null,
    myChop: viewer && chopStep?.choices[viewer] ? { ...chopStep.choices[viewer] } : null,
    claimed: g.claimed,
    results: structuredClone(g.results),
    dessertRows: g.dessertRows ? structuredClone(g.dessertRows) : null,
    clock:
      g.clock && state.phase === 'playing'
        ? {
            who: waiting.length === 1 && g.stage !== 'pick' ? waiting[0]! : null,
            since: g.clock.since,
            deadline: give
              ? g.clock.since + GIVE_SECONDS * 1000
              : g.stage === 'scores'
                ? g.clock.since + SCORES_SECONDS * 1000
                : secs === null
                  ? null
                  : g.clock.since + secs * 1000,
            fixed: give || g.stage === 'scores',
            reminded: g.clock.reminded,
          }
        : null,
    winners: [...g.winners],
    golf: state.settings.golf,
    drawPile: g.order.length === 2 && state.settings.drawPile,
  };
}

function view(state: ConveyorState, viewer: PlayerId | null): ConveyorView {
  const seats: SeatView[] = Object.entries(state.seats).map(([id, s]) => ({
    id,
    name: s.name,
    playing: s.playing,
    ...(s.waiting && { waiting: true }),
  }));
  const g = state.game;
  return {
    phase: state.phase,
    settings: structuredClone(state.settings),
    seats,
    me: seats.find((s) => s.id === viewer) ?? null,
    game: g ? gameView(state, g, viewer) : null,
    log: state.log.map((e) => structuredClone(e)),
  };
}

export const conveyor: GameDefinition<ConveyorState, ConveyorAction, ConveyorView> = {
  id: 'conveyor',
  name: 'Conveyor',
  description:
    'Pick a dish from your hand, pass the rest along, and build the tastiest tray over three rounds.',
  minPlayers: MIN_PLAYERS,
  maxPlayers: 30,
  maxSeated: MAX_PLAYERS,
  access: 'private',
  guide,
  actionSchema,
  create,
  reduce,
  playerJoined,
  playerLeft,
  view,
  nextDeadline,
  onDeadline,
  insights,
  awards: conveyorAwards,
  bot: conveyorBot,
  botInfo: {},
};
