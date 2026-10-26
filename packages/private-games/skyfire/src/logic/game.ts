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
import { skyfireAwards } from './awards.ts';
import { skyfireBot } from './bot.ts';
import {
  type Card,
  type DeckOptions,
  RANKS,
  type Rank,
  SUIT_LETTER,
  type Suit,
  copiesOf,
  deckFor,
  handSize,
  maxScore,
  nextRank,
  played,
  scoreOf,
  suitsFor,
} from './cards.ts';
import { type Clue, clued, colourChoices, learn, noKnowledge, touches } from './clues.ts';
import { guide } from './guide.ts';
import { insights } from './insights.ts';
import {
  type Auto,
  CLUE_TOKENS,
  DEFAULT_SECONDS,
  type EndHow,
  FUSES,
  type Game,
  type GameView,
  LEFT_BEAT_MS,
  type LogEntry,
  MAX_LOG,
  MAX_PLAYERS,
  MAX_REACTIONS,
  MAX_REPLAY,
  MIN_PLAYERS,
  type Result,
  type Seat,
  type SeatView,
  type SkyfireAction,
  type SkyfireState,
  type SkyfireView,
  type Snapshot,
  type TurnRecord,
  actionSchema,
} from './types.ts';

type Ctx = ActionCtx;
type ResultOf = SkyfireState | GameError;

const err = (code: string, message: string) => new GameError(code, message);
const draft = (s: SkyfireState): SkyfireState => structuredClone(s);
const hiddenRng = (state: SkyfireState, now: number) => createRng((state.seed ^ now) >>> 0);
const newSeed = (rng: Rng) => rng.int(2 ** 32);

// ---- Test rig ----

/**
 * Browser tests only: these cards go on top of the deck in this order (the rest follow suit by
 * suit), hands are dealt from the top in seat order, a hand at a time, and the first seat starts.
 */
let testDeck: Card[] | null = null;
export function setTestDeck(cards: Card[] | null) {
  testDeck = cards;
}

/** "r1 y1 g5 m3 k5": a suit letter (r y g b w, m multicolour, k black) and a number, top first. */
export function parseTestDeck(raw: string): Card[] {
  return raw
    .split(/[\s,]+/)
    .filter(Boolean)
    .flatMap((part) => {
      const suit = SUIT_LETTER[part[0]!.toLowerCase()];
      const rank = Number(part.slice(1));
      return suit && RANKS.includes(rank as Rank) ? [{ suit, rank: rank as Rank }] : [];
    });
}

// ---- Reading the table ----

export function players(state: SkyfireState): PlayerId[] {
  return Object.entries(state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));
}

export const optionsOf = (s: { settings: SkyfireState['settings'] }): DeckOptions => ({
  multi: s.settings.multi,
  black: s.settings.black,
});

const nextOf = (g: Game, id: PlayerId) => g.order[(g.order.indexOf(id) + 1) % g.order.length]!;

/** Who still has a turn in the last round, in order (null before the deck runs out). */
export function lastTurns(g: Game): PlayerId[] | null {
  if (g.finalTurns === null) return null;
  const at = g.order.indexOf(g.current);
  return Array.from({ length: g.finalTurns }, (_, i) => g.order[(at + i) % g.order.length]!);
}

/** Every firework finished. */
const perfect = (g: Game) => Object.values(g.fireworks).every((h) => h === 5);

/**
 * The last copy of a card still needed for a perfect show is gone: a card not yet on its
 * firework whose every copy is in the discards.
 */
export function lostForGood(g: Game, card: Card, o: DeckOptions): boolean {
  if (played(card.suit, card.rank, g.fireworks[card.suit] ?? 0)) return false;
  const gone = g.discards.filter((id) => {
    const c = g.cards[id]!;
    return c.suit === card.suit && c.rank === card.rank;
  }).length;
  return gone >= copiesOf(card.suit, card.rank, o);
}

/** Whether a card may be discarded now: never with all 8 clue tokens. */
export const canDiscard = (g: Game) => g.clues < CLUE_TOKENS;

// ---- Log ----

type NewLog = LogEntry extends infer E
  ? E extends LogEntry
    ? Omit<E, 'id' | 'turn'>
    : never
  : never;

function log(s: SkyfireState, entry: NewLog) {
  s.seq += 1;
  s.log.push({ ...entry, id: s.seq, turn: s.game?.turn ?? 0 });
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}

const autoOf = (auto?: Auto) => (auto ? { auto } : {});

// ---- Turns ----

function snapshot(g: Game): Snapshot {
  return {
    hands: Object.fromEntries(g.order.map((id) => [id, [...g.hands[id]!]])),
    clues: g.clues,
    fuses: g.fuses,
    fireworks: { ...g.fireworks },
    deck: g.deck.length,
    discards: g.discards.length,
  };
}

function record(g: Game, turn: Omit<TurnRecord, 'turn' | 'after'>) {
  if (g.turns.length >= MAX_REPLAY) return;
  g.turns.push({ ...turn, turn: g.turn + 1, after: snapshot(g) });
}

function finish(s: SkyfireState, how: EndHow, extra: Partial<Result> = {}) {
  const g = s.game!;
  const o = optionsOf(s);
  const reached = scoreOf(g.fireworks);
  const max = maxScore(o);
  const lost = how === 'fuses' || how === 'lost-card' || how === 'no-cards';
  g.result = {
    how,
    score: how === 'perfect' ? max : lost ? 0 : reached,
    reached,
    max,
    win: how === 'perfect',
    ...extra,
  };
  s.phase = 'over';
  g.clock = null;
  log(s, { kind: 'end', how, score: g.result.score, reached });
}

/** Draws the replacement card onto the left of the hand. Returns whether the deck ran out. */
function draw(g: Game, by: PlayerId): boolean {
  const id = g.deck.shift();
  if (id === undefined) return false;
  g.hands[by]!.unshift(id);
  g.know[id] = noKnowledge();
  return g.deck.length === 0;
}

/**
 * The turn is over: in the last round one fewer turn is left (the show ends after the drawer's
 * last one); the deck running out now starts that round. With the expert ending a player who
 * starts a turn with no cards ends the show.
 */
function endTurn(s: SkyfireState, by: PlayerId, emptied: boolean) {
  const g = s.game!;
  g.turn += 1;
  if (s.phase !== 'playing') return;
  if (g.finalTurns !== null) {
    g.finalTurns -= 1;
    if (g.finalTurns <= 0) {
      finish(s, 'deck');
      return;
    }
  }
  if (emptied && !s.settings.expert) {
    g.finalTurns = g.order.length;
    log(s, { kind: 'last-round', by });
  }
  g.current = nextOf(g, by);
  if (s.settings.expert && g.hands[g.current]!.length === 0)
    finish(s, 'no-cards', { player: g.current });
}

function myTurn(s: SkyfireState, by: PlayerId): GameError | null {
  const g = s.game!;
  if (!g.hands[by]) return err('not-playing', 'You are not in this game.');
  if (g.current !== by) return err('not-your-turn', 'It’s not your turn.');
  return null;
}

function inHand(g: Game, by: PlayerId, card: string): GameError | null {
  return g.hands[by]!.includes(card) ? null : err('not-in-hand', 'That card isn’t in your hand.');
}

/** The cards a clue would touch in a hand, left to right. */
export function touchedBy(g: Game, to: PlayerId, clue: Clue, o: DeckOptions): string[] {
  return (g.hands[to] ?? []).filter((id) => touches(clue, g.cards[id]!, o.multi));
}

function clueProblem(s: SkyfireState, by: PlayerId, to: PlayerId, clue: Clue): GameError | null {
  const g = s.game!;
  if (g.clues <= 0) return err('no-clues', 'No clue tokens left: play or discard a card.');
  if (to === by) return err('self', 'You can’t give yourself a clue.');
  if (!g.hands[to]) return err('bad-player', 'Clue a player in the game.');
  if (clue.colour !== undefined && !colourChoices(s.settings.multi).includes(clue.colour))
    return err(
      'bad-colour',
      s.settings.multi === 'wild' && clue.colour === 'multi'
        ? 'Multicolour can’t be named: every colour clue touches it.'
        : 'That colour isn’t in this game.',
    );
  if (!s.settings.zeroClues && !touchedBy(g, to, clue, optionsOf(s)).length)
    return err('zero-clue', 'Clues must touch at least one card in this game.');
  return null;
}

function giveClue(s: SkyfireState, by: PlayerId, to: PlayerId, clue: Clue, auto?: Auto) {
  const g = s.game!;
  const e = myTurn(s, by) ?? clueProblem(s, by, to, clue);
  if (e) return e;
  const touched = touchedBy(g, to, clue, optionsOf(s));
  g.clues -= 1;
  for (const id of g.hands[to]!) {
    learn((g.know[id] ??= noKnowledge()), clue, touched.includes(id));
    if (touched.includes(id)) g.cluedBy[id] = { by, turn: g.turn + 1 };
  }
  const what = clue.rank !== undefined ? { rank: clue.rank } : { colour: clue.colour };
  log(s, { kind: 'clue', by, to, ...what, touched, ...autoOf(auto) });
  record(g, { kind: 'clue', by, to, ...what, touched, ...autoOf(auto) });
  endTurn(s, by, false);
  return null;
}

function discard(s: SkyfireState, by: PlayerId, card: string, auto?: Auto): GameError | null {
  const g = s.game!;
  const e = myTurn(s, by) ?? inHand(g, by, card);
  if (e) return e;
  if (!canDiscard(g)) return err('full-clues', 'All 8 clue tokens are back: give a clue or play.');
  const c = g.cards[card]!;
  g.hands[by] = g.hands[by]!.filter((id) => id !== card);
  delete g.know[card];
  g.discards.push(card);
  g.clues += 1;
  log(s, { kind: 'discard', by, card, suit: c.suit, rank: c.rank, ...autoOf(auto) });
  if (s.settings.expert && lostForGood(g, c, optionsOf(s))) {
    record(g, { kind: 'discard', by, card, ...autoOf(auto) });
    finish(s, 'lost-card', { card: { ...c } });
    return null;
  }
  const emptied = draw(g, by);
  record(g, { kind: 'discard', by, card, ...autoOf(auto) });
  endTurn(s, by, emptied);
  return null;
}

function play(s: SkyfireState, by: PlayerId, card: string, auto?: Auto): GameError | null {
  const g = s.game!;
  const e = myTurn(s, by) ?? inHand(g, by, card);
  if (e) return e;
  const c = g.cards[card]!;
  g.hands[by] = g.hands[by]!.filter((id) => id !== card);
  delete g.know[card];
  const h = g.fireworks[c.suit] ?? 0;
  const ok = nextRank(c.suit, h) === c.rank;
  let completed = false;
  let bonus = false;
  if (ok) {
    g.fireworks[c.suit] = h + 1;
    completed = h + 1 === 5;
    if (completed && g.clues < CLUE_TOKENS) {
      g.clues += 1;
      bonus = true;
    }
  } else {
    g.fuses += 1;
    g.discards.push(card);
  }
  log(s, {
    kind: 'play',
    by,
    card,
    suit: c.suit,
    rank: c.rank,
    ok,
    ...(completed && { completed }),
    ...(bonus && { bonus }),
    ...autoOf(auto),
  });
  const end = (how: EndHow, extra?: Partial<Result>) => {
    record(g, { kind: 'play', by, card, ok, ...autoOf(auto) });
    finish(s, how, extra);
    return null;
  };
  if (!ok && g.fuses >= FUSES) return end('fuses');
  if (!ok && s.settings.expert && lostForGood(g, c, optionsOf(s)))
    return end('lost-card', { card: { ...c } });
  if (ok && perfect(g)) return end('perfect');
  const emptied = draw(g, by);
  record(g, { kind: 'play', by, card, ok, ...autoOf(auto) });
  endTurn(s, by, emptied);
  return null;
}

function reorder(s: SkyfireState, by: PlayerId, order: readonly string[]): GameError | null {
  const g = s.game!;
  const hand = g.hands[by];
  if (!hand) return err('not-playing', 'You are not in this game.');
  if (order.length !== hand.length || new Set(order).size !== order.length)
    return err('bad-order', 'Move your own cards only.');
  if (!order.every((id) => hand.includes(id))) return err('bad-order', 'Move your own cards only.');
  g.hands[by] = [...order];
  return null;
}

function react(
  s: SkyfireState,
  by: PlayerId,
  emoji: SkyfireState['reactions'][number]['emoji'],
  now: number,
) {
  const g = s.game;
  if (!g?.hands[by]) return err('not-playing', 'Only players can react.');
  const last = [...s.log]
    .reverse()
    .find(
      (e) => e.kind === 'clue' || e.kind === 'play' || e.kind === 'discard' || e.kind === 'end',
    );
  if (!last) return err('nothing-yet', 'React once someone has taken a turn.');
  s.reactions = [
    ...s.reactions.filter((r) => !(r.by === by && r.to === last.id)),
    { by, emoji, to: last.id, at: now },
  ].slice(-MAX_REACTIONS);
  return null;
}

// ---- Moves made for a player ----

/**
 * The safe move made for a player who ran out of time, left, or when the host acts for them:
 * discard their oldest unclued card when discarding is allowed; otherwise a random clue that
 * touches a card (any legal clue when only empty ones are left); with no clue token, discard the
 * oldest card. Never a play. With 8 tokens and no legal clue (only possible in the expert ending),
 * nothing is done.
 */
function autoMove(s: SkyfireState, who: PlayerId, why: Auto, rng: Rng): boolean {
  const g = s.game!;
  if (s.phase !== 'playing' || g.current !== who) return false;
  const hand = g.hands[who]!;
  const oldestUnclued = [...hand].reverse().find((id) => !clued(g.know[id] ?? noKnowledge()));
  if (canDiscard(g) && oldestUnclued) return !discard(s, who, oldestUnclued, why);
  if (g.clues > 0) {
    const o = optionsOf(s);
    const clues: { to: PlayerId; clue: Clue; hits: number }[] = g.order
      .filter((id) => id !== who)
      .flatMap((to) =>
        [
          ...colourChoices(s.settings.multi).map((colour): Clue => ({ colour })),
          ...RANKS.map((rank): Clue => ({ rank })),
        ].map((clue) => ({ to, clue, hits: touchedBy(g, to, clue, o).length })),
      )
      .filter((c) => c.hits > 0 || s.settings.zeroClues);
    const useful = clues.filter((c) => c.hits > 0);
    const pool = useful.length ? useful : clues;
    if (pool.length) {
      const pick = pool[rng.int(pool.length)]!;
      return !giveClue(s, who, pick.to, pick.clue, why);
    }
  }
  if (canDiscard(g) && hand.length) return !discard(s, who, hand[hand.length - 1]!, why);
  return false;
}

// ---- Lobby ----

function requireHost(ctx: Ctx) {
  return ctx.isHost ? null : err('not-host', 'Only the host can do that.');
}

function seatWaiting(s: SkyfireState) {
  let free = MAX_PLAYERS - players(s).length;
  for (const seat of Object.values(s.seats)) {
    if (free <= 0) break;
    if (!seat.waiting || seat.playing) continue;
    delete seat.waiting;
    seat.playing = true;
    free -= 1;
  }
}

function sit(state: SkyfireState, playing: boolean, ctx: Ctx): ResultOf {
  const seat = state.seats[ctx.by];
  if (!seat) return err('not-seated', 'You are not in this room.');
  if (state.phase === 'playing' && state.game?.hands[ctx.by])
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

function dropLeft(s: SkyfireState) {
  for (const id of Object.keys(s.game?.left ?? {})) delete s.seats[id];
}

/** The shuffled deck (or the test rig's), as card faces top first. */
function shuffled(o: DeckOptions, rng: Rng): Card[] {
  const all = deckFor(o);
  if (!testDeck) return rng.shuffle(all);
  const rest = [...all];
  const top: Card[] = [];
  for (const c of testDeck) {
    const at = rest.findIndex((x) => x.suit === c.suit && x.rank === c.rank);
    if (at >= 0) top.push(...rest.splice(at, 1));
  }
  return [...top, ...rest];
}

function deal(state: SkyfireState, ctx: Ctx): ResultOf {
  const s = draft(state);
  dropLeft(s);
  seatWaiting(s);
  const order = players(s);
  if (order.length < MIN_PLAYERS) return err('too-few', `${MIN_PLAYERS} players are needed.`);
  if (order.length > MAX_PLAYERS) return err('too-many', `At most ${MAX_PLAYERS} can play.`);
  const o = optionsOf(s);
  const faces = shuffled(o, ctx.rng);
  // Ids are positions in the shuffled deck: they say nothing about the card.
  const ids = faces.map((_, i) => `c${i + 1}`);
  const size = handSize(order.length);
  const hands = Object.fromEntries(order.map((id, i) => [id, ids.slice(i * size, (i + 1) * size)]));
  const at = s.lastStarter ? order.indexOf(s.lastStarter) : -1;
  const first = testDeck
    ? order[0]!
    : at >= 0
      ? order[(at + 1) % order.length]!
      : order[ctx.rng.int(order.length)]!;
  s.lastStarter = first;
  s.phase = 'playing';
  s.gamesPlayed += 1;
  s.log = [];
  s.reactions = [];
  const g: Game = {
    order,
    names: Object.fromEntries(order.map((id) => [id, s.seats[id]!.name])),
    cards: Object.fromEntries(ids.map((id, i) => [id, { ...faces[i]! }])),
    deck: ids.slice(order.length * size),
    hands,
    know: Object.fromEntries(ids.slice(0, order.length * size).map((id) => [id, noKnowledge()])),
    cluedBy: {},
    discards: [],
    fireworks: Object.fromEntries(suitsFor(o).map((suit) => [suit, 0])),
    clues: CLUE_TOKENS,
    fuses: 0,
    current: first,
    turn: 0,
    finalTurns: null,
    left: {},
    clock: null,
    result: null,
    start: { hands: {}, clues: 0, fuses: 0, fireworks: {}, deck: 0, discards: 0 },
    turns: [],
  };
  g.start = snapshot(g);
  s.game = g;
  log(s, { kind: 'start', first });
  s.seed = newSeed(ctx.rng);
  settle(s, ctx.now);
  return s;
}

function updateSettings(
  state: SkyfireState,
  action: Extract<SkyfireAction, { type: 'update-settings' }>,
  ctx: Ctx,
): ResultOf {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'playing') return err('in-progress', 'Settings change between games.');
  const s = draft(state);
  const { type: _type, ...patch } = action;
  for (const [k, v] of Object.entries(patch))
    if (v !== undefined) (s.settings as unknown as Record<string, unknown>)[k] = v;
  return s;
}

function backToLobby(state: SkyfireState, ctx: Ctx): ResultOf {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'lobby') return err('wrong-phase', 'No game to leave.');
  const s = draft(state);
  dropLeft(s);
  s.phase = 'lobby';
  s.game = null;
  s.log = [];
  s.reactions = [];
  seatWaiting(s);
  return s;
}

// ---- Clock ----

/** The turn clock restarts with every turn. */
function settle(s: SkyfireState, now: number) {
  const g = s.game;
  if (!g) return;
  if (s.phase !== 'playing') {
    g.clock = null;
    return;
  }
  const key = `${g.turn}:${g.current}`;
  if (g.clock?.key !== key) g.clock = { key, since: now, reminded: false };
}

// ---- In play ----

function inPlay(
  state: SkyfireState,
  ctx: Ctx,
  fn: (s: SkyfireState) => GameError | null,
): ResultOf {
  if (state.phase !== 'playing' || !state.game) return err('not-playing', 'No game in play.');
  const s = draft(state);
  const e = fn(s);
  if (e) return e;
  settle(s, ctx.now);
  return s;
}

function clueOf(action: Extract<SkyfireAction, { type: 'clue' }>): Clue | GameError {
  if ((action.colour === undefined) === (action.rank === undefined))
    return err('bad-clue', 'A clue is one colour or one number.');
  return action.colour !== undefined ? { colour: action.colour } : { rank: action.rank as Rank };
}

function reduce(state: SkyfireState, action: SkyfireAction, ctx: Ctx): ResultOf {
  const by = ctx.by;
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
    case 'clue': {
      const clue = clueOf(action);
      if (clue instanceof GameError) return clue;
      return inPlay(state, ctx, (s) => giveClue(s, by, action.to, clue));
    }
    case 'play':
      return inPlay(state, ctx, (s) => play(s, by, action.card));
    case 'discard':
      return inPlay(state, ctx, (s) => discard(s, by, action.card));
    case 'reorder':
      return inPlay(state, ctx, (s) => reorder(s, by, action.order));
    case 'react': {
      if (state.phase === 'lobby' || !state.game) return err('not-playing', 'No game to react to.');
      const s = draft(state);
      const e = react(s, by, action.emoji, ctx.now);
      return e ?? s;
    }
    case 'act-for': {
      const e = requireHost(ctx);
      if (e) return e;
      return inPlay(state, ctx, (s) =>
        autoMove(s, action.player, 'host', ctx.rng)
          ? null
          : err('not-waiting', 'The table isn’t waiting on that player.'),
      );
    }
    case 'end-game': {
      const e = requireHost(ctx);
      if (e) return e;
      return inPlay(state, ctx, (s) => {
        finish(s, 'ended');
        return null;
      });
    }
  }
}

// ---- Players coming and going ----

function create(ctx: CreateCtx, playersIn: readonly PlayerInfo[]): SkyfireState {
  let state: SkyfireState = {
    phase: 'lobby',
    settings: {
      multi: 'off',
      black: false,
      expert: false,
      zeroClues: true,
      memory: 'marks',
      seconds: DEFAULT_SECONDS,
      timerMode: 'soft',
    },
    seed: newSeed(ctx.rng),
    seats: {},
    game: null,
    log: [],
    seq: 0,
    reactions: [],
    gamesPlayed: 0,
    lastStarter: null,
  };
  for (const p of playersIn) state = playerJoined(state, p);
  return state;
}

function playerJoined(state: SkyfireState, player: PlayerInfo): SkyfireState {
  const s = draft(state);
  const existing = s.seats[player.id];
  if (existing) {
    existing.name = player.name;
    const g = s.game;
    if (g?.names[player.id]) g.names[player.id] = player.name;
    if (g && g.left[player.id] !== undefined) {
      delete g.left[player.id];
      if (s.phase === 'playing') log(s, { kind: 'back', player: player.id });
    }
    return s;
  }
  const playing = s.phase !== 'playing' && players(s).length < MAX_PLAYERS;
  const seat: Seat = { name: player.name, playing, ...(!playing && { waiting: true }) };
  s.seats[player.id] = seat;
  return s;
}

/**
 * Someone left for good. Between games their seat goes; mid-game they keep their hand and the
 * table makes the safe move for them (after a short beat) until they come back or the game ends.
 */
function playerLeft(state: SkyfireState, playerId: PlayerId, now: number): SkyfireState {
  if (!state.seats[playerId]) return state;
  const s = draft(state);
  const g = s.game;
  if (s.phase === 'playing' && g?.hands[playerId]) {
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

type Due = { at: number; why: Auto | 'remind' };

function deadlines(state: SkyfireState): Due[] {
  const g = state.game;
  if (state.phase !== 'playing' || !g?.clock) return [];
  const out: Due[] = [];
  const gone = g.left[g.current];
  if (gone !== undefined)
    out.push({ at: Math.max(g.clock.since, gone) + LEFT_BEAT_MS, why: 'left' });
  const secs = state.settings.seconds;
  if (secs !== null) {
    const at = g.clock.since + secs * 1000;
    if (state.settings.timerMode === 'strict') out.push({ at, why: 'timer' });
    else if (!g.clock.reminded) out.push({ at, why: 'remind' });
  }
  return out.sort((a, b) => a.at - b.at);
}

function nextDeadline(state: SkyfireState): number | null {
  return deadlines(state)[0]?.at ?? null;
}

function onDeadline(state: SkyfireState, now: number): SkyfireState {
  const due = deadlines(state)[0];
  if (!due || now < due.at) return state;
  const s = draft(state);
  const g = s.game!;
  const rng = hiddenRng(state, now);
  // With nothing safe to do (8 tokens, no clue possible) the reminder stays and the host decides.
  if (due.why === 'remind' || !autoMove(s, g.current, due.why, rng)) {
    g.clock!.reminded = true;
    if (due.why !== 'remind') g.clock!.since = now;
  }
  settle(s, now);
  s.seed = newSeed(rng);
  return s;
}

// ---- Views ----

/** The id of the viewer's own last turn in the log (0: none yet). */
function lastOwnTurn(state: SkyfireState, viewer: PlayerId): number {
  for (let i = state.log.length - 1; i >= 0; i--) {
    const e = state.log[i]!;
    if ((e.kind === 'clue' || e.kind === 'play' || e.kind === 'discard') && e.by === viewer)
      return e.id;
  }
  return 0;
}

function gameView(state: SkyfireState, g: Game, viewer: PlayerId | null): GameView {
  const over = state.phase === 'over';
  const memory = state.settings.memory === 'memory';
  const secs = state.settings.seconds;
  return {
    order: [...g.order],
    players: g.order.map((id) => ({
      id,
      name: state.seats[id]?.name ?? g.names[id] ?? 'Gone',
      left: g.left[id] !== undefined || !state.seats[id],
    })),
    hands: Object.fromEntries(
      g.order.map((pid) => [
        pid,
        g.hands[pid]!.map((id) => ({
          id,
          card: pid === viewer && !over ? null : { ...g.cards[id]! },
          know: memory ? null : structuredClone(g.know[id] ?? noKnowledge()),
        })),
      ]),
    ),
    suits: Object.keys(g.fireworks) as Suit[],
    fireworks: { ...g.fireworks },
    discards: g.discards.map((id) => ({ id, card: { ...g.cards[id]! } })),
    clues: g.clues,
    fuses: g.fuses,
    deck: g.deck.length,
    current: g.current,
    turn: g.turn,
    lastTurns: state.phase === 'playing' ? lastTurns(g) : null,
    max: maxScore(optionsOf(state)),
    clock:
      g.clock && state.phase === 'playing'
        ? {
            who: g.current,
            since: g.clock.since,
            deadline: secs === null ? null : g.clock.since + secs * 1000,
            reminded: g.clock.reminded,
          }
        : null,
    result: g.result ? structuredClone(g.result) : null,
    replay: over
      ? {
          cards: structuredClone(g.cards),
          start: structuredClone(g.start),
          turns: structuredClone(g.turns),
        }
      : null,
  };
}

function view(state: SkyfireState, viewer: PlayerId | null): SkyfireView {
  const seats: SeatView[] = Object.entries(state.seats).map(([id, s]) => ({
    id,
    name: s.name,
    playing: s.playing,
    ...(s.waiting && { waiting: true }),
  }));
  const g = state.game;
  // Playing from memory: a clue stays in the log only until the viewer's own next turn is over.
  const forget =
    state.settings.memory === 'memory' && state.phase === 'playing' && viewer && g?.hands[viewer]
      ? lastOwnTurn(state, viewer)
      : 0;
  return {
    phase: state.phase,
    settings: { ...state.settings },
    seats,
    me: seats.find((s) => s.id === viewer) ?? null,
    game: g ? gameView(state, g, viewer) : null,
    log: state.log
      .filter((e) => !(e.kind === 'clue' && e.id < forget))
      .map((e) => structuredClone(e)),
    reactions: state.reactions.map((r) => ({ ...r })),
  };
}

export const skyfire: GameDefinition<SkyfireState, SkyfireAction, SkyfireView> = {
  id: 'skyfire',
  name: 'Skyfire',
  description:
    'A cooperative fireworks show: see everyone’s cards but your own, and give careful clues.',
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
  awards: skyfireAwards,
  bot: skyfireBot,
  botInfo: {},
};
