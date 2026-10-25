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
import { jewellerAwards } from './awards.ts';
import { jewellerBot } from './bot.ts';
import { CARDS, NOBLES, cardOf } from './cards.ts';
import { guide } from './guide.ts';
import { insights } from './insights.ts';
import {
  bonusesOf,
  canAfford,
  canReserve,
  canTake,
  colorsIn,
  differentToTake,
  noPieces,
  noblesFor,
  payment,
  pointsOf,
  takeProblem,
  totalOf,
} from './rules.ts';
import {
  type Auto,
  DEFAULT_TARGET,
  GEMS,
  GEMS_FOR,
  GOLD_PIECES,
  type Game,
  type GameView,
  type Gem,
  type JewellerAction,
  type JewellerState,
  type JewellerView,
  LEFT_BEAT_MS,
  LEVELS,
  type Level,
  type LogEntry,
  MARKET_SIZE,
  MAX_LOG,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type Pieces,
  type PlayerState,
  type Seat,
  type SeatView,
  TOKENS,
  TOKEN_LIMIT,
  type Token,
  actionSchema,
} from './types.ts';

type Ctx = ActionCtx;
type Result = JewellerState | GameError;

const err = (code: string, message: string) => new GameError(code, message);
const draft = (s: JewellerState): JewellerState => structuredClone(s);
const hiddenRng = (state: JewellerState, now: number) => createRng((state.seed ^ now) >>> 0);
const newSeed = (rng: Rng) => rng.int(2 ** 32);

// ---- Test rig ----

/**
 * Browser tests only: cards and nobles put on top when a game is dealt, the first seat starting,
 * and cards the first seat already owns (a head start, so a spec reaches a noble and the end).
 */
export interface TestDeck {
  decks?: Partial<Record<Level, string[]>>;
  nobles?: string[];
  firstSeat?: boolean;
  owned?: string[];
}
let testDeck: TestDeck | null = null;
export function setTestDeck(rig: TestDeck | null) {
  testDeck = rig;
}

/** Moves the listed ids to the front, in order. */
const stack = (ids: string[], top: readonly string[] | undefined) =>
  top?.length
    ? [...top.filter((id) => ids.includes(id)), ...ids.filter((id) => !top.includes(id))]
    : ids;

// ---- Reading the table ----

export function players(state: JewellerState): PlayerId[] {
  return Object.entries(state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));
}

export const bonusesFor = (p: PlayerState) => bonusesOf(p.cards);
export const pointsFor = (p: PlayerState) => pointsOf(p.cards, p.nobles);

const deckCounts = (g: Game): Record<Level, number> => ({
  1: g.decks[1].length,
  2: g.decks[2].length,
  3: g.decks[3].length,
});

/** Whether the player can buy any face-up or reserved card. */
function canBuyAny(g: Game, p: PlayerState): boolean {
  const b = bonusesFor(p);
  const ids = [
    ...LEVELS.flatMap((l) => g.market[l].filter((c): c is string => c !== null)),
    ...p.reserved.map((r) => r.card),
  ];
  return ids.some((id) => canAfford(cardOf(id), b, p.tokens));
}

/** Whether the player has any action but passing. */
export function hasAction(g: Game, id: PlayerId): boolean {
  const p = g.players[id]!;
  return (
    canTake(g.bank) || canReserve(p.reserved.length, g.market, deckCounts(g)) || canBuyAny(g, p)
  );
}

const nextPlayer = (g: Game, from: PlayerId) =>
  g.order[(g.order.indexOf(from) + 1) % g.order.length]!;

// ---- Log ----

type NewLog = LogEntry extends infer E
  ? E extends LogEntry
    ? Omit<E, 'id' | 'turn'>
    : never
  : never;

function log(s: JewellerState, entry: NewLog) {
  s.seq += 1;
  s.log.push({ ...entry, id: s.seq, turn: s.game?.turns ?? 0 });
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}

const autoOf = (auto?: Auto) => (auto ? { auto } : {});

// ---- Turn flow ----

/** The decision clock restarts whenever the table waits on something new. */
function settle(s: JewellerState, now: number) {
  const g = s.game;
  if (!g) return;
  if (s.phase !== 'playing') {
    g.clock = null;
    return;
  }
  const key = `${g.turns}:${g.stage}`;
  if (g.clock?.key !== key) g.clock = { key, since: now, reminded: false };
}

/** Refills a market space from its deck (left empty when the deck is). */
function refill(g: Game, level: Level, space: number) {
  g.market[level][space] = g.decks[level].shift() ?? null;
}

function endGame(s: JewellerState) {
  const g = s.game!;
  const scored = g.order.map((id) => ({
    id,
    points: pointsFor(g.players[id]!),
    cards: g.players[id]!.cards.length,
  }));
  const best = Math.max(...scored.map((x) => x.points));
  const top = scored.filter((x) => x.points === best);
  // A tie goes to fewest bought cards; still tied, they share the win.
  const fewest = Math.min(...top.map((x) => x.cards));
  g.winners = top.filter((x) => x.cards === fewest).map((x) => x.id);
  s.phase = 'over';
  g.clock = null;
  g.nobleChoice = [];
  log(s, { kind: 'end', winners: [...g.winners] });
}

/** The end of a turn: the target check, then the next player or, after the round, the end. */
function endTurn(s: JewellerState, by: PlayerId) {
  const g = s.game!;
  const points = pointsFor(g.players[by]!);
  if (!g.finalBy && points >= s.settings.target) {
    g.finalBy = by;
    log(s, { kind: 'final', by, points });
  }
  g.turns += 1;
  g.nobleChoice = [];
  if (g.finalBy && by === g.order.at(-1)) {
    endGame(s);
    return;
  }
  g.current = nextPlayer(g, by);
  g.stage = 'action';
}

function takeNoble(s: JewellerState, by: PlayerId, noble: string, auto?: Auto) {
  const g = s.game!;
  g.nobles = g.nobles.filter((n) => n !== noble);
  g.players[by]!.nobles.push(noble);
  log(s, { kind: 'noble', by, noble, ...autoOf(auto) });
}

/** After the pieces are down to 10: a noble visits (one, the player's pick if several). */
function nobleCheck(s: JewellerState, by: PlayerId, auto?: Auto) {
  const g = s.game!;
  const can = noblesFor(g.nobles, bonusesFor(g.players[by]!));
  if (can.length === 1) takeNoble(s, by, can[0]!, auto);
  if (can.length <= 1) {
    endTurn(s, by);
    return;
  }
  g.stage = 'noble';
  g.nobleChoice = can;
}

/** After an action: hand back pieces over 10, then the noble check. */
function afterAction(s: JewellerState, by: PlayerId, auto?: Auto) {
  const g = s.game!;
  if (totalOf(g.players[by]!.tokens) > TOKEN_LIMIT) {
    g.stage = 'return';
    return;
  }
  nobleCheck(s, by, auto);
}

function myTurn(g: Game, by: PlayerId, stage: Game['stage']): GameError | null {
  if (!g.players[by]) return err('not-playing', 'You are not in this game.');
  if (g.current !== by) return err('not-your-turn', 'It’s not your turn.');
  if (g.stage !== stage)
    return g.stage === 'return'
      ? err('return-first', 'Hand back pieces down to 10 first.')
      : g.stage === 'noble'
        ? err('noble-first', 'Pick the noble who visits first.')
        : err('wrong-stage', 'Your action is done.');
  return null;
}

function take(s: JewellerState, by: PlayerId, gems: Gem[], auto?: Auto): GameError | null {
  const g = s.game!;
  const e = myTurn(g, by, 'action');
  if (e) return e;
  const problem = takeProblem(g.bank, gems);
  if (problem) return err('bad-take', problem);
  const p = g.players[by]!;
  for (const gem of gems) {
    g.bank[gem] -= 1;
    p.tokens[gem] += 1;
  }
  log(s, { kind: 'take', by, gems: [...gems], ...autoOf(auto) });
  afterAction(s, by, auto);
  return null;
}

function reserve(
  s: JewellerState,
  by: PlayerId,
  target: { card?: string; level?: Level },
  auto?: Auto,
): GameError | null {
  const g = s.game!;
  const e = myTurn(g, by, 'action');
  if (e) return e;
  const p = g.players[by]!;
  if (p.reserved.length >= 3) return err('reserve-full', 'You already hold 3 reserved cards.');
  let card: string;
  let level: Level;
  let blind: boolean;
  if (target.card) {
    const at = LEVELS.flatMap((l) =>
      g.market[l].flatMap((c, i) => (c === target.card ? [{ l, i }] : [])),
    )[0];
    if (!at) return err('not-in-market', 'That card isn’t face up on the table.');
    card = target.card;
    level = at.l;
    blind = false;
    refill(g, at.l, at.i);
  } else if (target.level) {
    const top = g.decks[target.level].shift();
    if (!top) return err('deck-empty', 'That deck is empty.');
    card = top;
    level = target.level;
    blind = true;
  } else return err('bad-reserve', 'Pick a card or a deck to reserve.');
  p.reserved.push({ card, blind });
  // No gold left: the reserve still happens, without gold.
  const gold = g.bank.gold > 0;
  if (gold) {
    g.bank.gold -= 1;
    p.tokens.gold += 1;
  }
  log(s, { kind: 'reserve', by, level, card, blind, gold, ...autoOf(auto) });
  afterAction(s, by, auto);
  return null;
}

function buy(
  s: JewellerState,
  by: PlayerId,
  card: string,
  gold: Partial<Record<Gem, number>> | undefined,
  auto?: Auto,
): GameError | null {
  const g = s.game!;
  const e = myTurn(g, by, 'action');
  if (e) return e;
  const p = g.players[by]!;
  const fromReserve = p.reserved.some((r) => r.card === card);
  const at = fromReserve
    ? null
    : LEVELS.flatMap((l) => g.market[l].flatMap((c, i) => (c === card ? [{ l, i }] : [])))[0];
  if (!fromReserve && !at)
    return err('not-buyable', 'Buy a face-up card or one of your reserved cards.');
  const paid = payment(cardOf(card), bonusesFor(p), p.tokens, gold);
  if (typeof paid === 'string') return err('cant-afford', paid);
  for (const t of TOKENS) {
    p.tokens[t] -= paid[t];
    g.bank[t] += paid[t];
  }
  if (fromReserve) p.reserved = p.reserved.filter((r) => r.card !== card);
  else refill(g, at!.l, at!.i);
  p.cards.push(card);
  log(s, { kind: 'buy', by, card, fromReserve, paid, ...autoOf(auto) });
  afterAction(s, by, auto);
  return null;
}

function giveBack(
  s: JewellerState,
  by: PlayerId,
  tokens: Partial<Record<Token, number>>,
  auto?: Auto,
): GameError | null {
  const g = s.game!;
  const e = myTurn(g, by, 'return');
  if (e) return e;
  const p = g.players[by]!;
  const over = totalOf(p.tokens) - TOKEN_LIMIT;
  const back = noPieces();
  for (const t of TOKENS) back[t] = tokens[t] ?? 0;
  if (totalOf(back) !== over)
    return err('return-count', `Hand back exactly ${over} ${over === 1 ? 'piece' : 'pieces'}.`);
  if (TOKENS.some((t) => back[t] > p.tokens[t]))
    return err('return-missing', 'You don’t have those pieces.');
  for (const t of TOKENS) {
    p.tokens[t] -= back[t];
    g.bank[t] += back[t];
  }
  log(s, { kind: 'return', by, tokens: back, ...autoOf(auto) });
  nobleCheck(s, by, auto);
  return null;
}

function chooseNoble(s: JewellerState, by: PlayerId, noble: string, auto?: Auto) {
  const g = s.game!;
  const e = myTurn(g, by, 'noble');
  if (e) return e;
  if (!g.nobleChoice.includes(noble)) return err('bad-noble', 'That noble can’t visit you.');
  takeNoble(s, by, noble, auto);
  endTurn(s, by);
  return null;
}

function pass(s: JewellerState, by: PlayerId, auto?: Auto): GameError | null {
  const g = s.game!;
  const e = myTurn(g, by, 'action');
  if (e) return e;
  if (hasAction(g, by))
    return err('can-act', 'You can still take gems, reserve or buy: passing is only for no move.');
  log(s, { kind: 'pass', by, ...autoOf(auto) });
  nobleCheck(s, by, auto);
  return null;
}

// ---- Moves made for a player ----

/** Pieces handed back for a player: the ones they hold most of, gold last. */
export function safeReturn(tokens: Pieces, over: number): Pieces {
  const left = { ...tokens };
  const back = noPieces();
  for (let i = 0; i < over; i++) {
    const gem = [...GEMS].sort((a, b) => left[b] - left[a])[0]!;
    const t: Token = left[gem] > 0 ? gem : 'gold';
    left[t] -= 1;
    back[t] += 1;
  }
  return back;
}

/**
 * The safe move made for a player who ran out of time, has left, or when the host acts for them:
 * take gems (the fullest piles, as many different colours as allowed), else reserve (the top of
 * the lowest deck, else a face-up card), else buy (the cheapest card they can afford), else pass.
 * Pieces over 10 go back from what they hold most of, gold last; a choice of noble takes the
 * first.
 */
function autoStep(s: JewellerState, who: PlayerId, why: Auto): boolean {
  const g = s.game!;
  if (g.current !== who) return false;
  const p = g.players[who]!;
  let e: GameError | null = null;
  switch (g.stage) {
    case 'action': {
      const fullest = colorsIn(g.bank).sort((a, b) => g.bank[b] - g.bank[a]);
      const n = differentToTake(g.bank);
      if (n > 0) {
        e = take(s, who, fullest.slice(0, n), why);
        break;
      }
      if (canReserve(p.reserved.length, g.market, deckCounts(g))) {
        const level = LEVELS.find((l) => g.decks[l].length > 0);
        const card = LEVELS.flatMap((l) => g.market[l]).find((c): c is string => c !== null);
        e = reserve(s, who, level ? { level } : { card: card! }, why);
        break;
      }
      const b = bonusesFor(p);
      const buyable = [
        ...LEVELS.flatMap((l) => g.market[l].filter((c): c is string => c !== null)),
        ...p.reserved.map((r) => r.card),
      ]
        .filter((id) => canAfford(cardOf(id), b, p.tokens))
        .sort((x, y) => totalOf(cardOf(x).cost) - totalOf(cardOf(y).cost));
      e = buyable[0] ? buy(s, who, buyable[0], undefined, why) : pass(s, who, why);
      break;
    }
    case 'return':
      e = giveBack(s, who, safeReturn(p.tokens, totalOf(p.tokens) - TOKEN_LIMIT), why);
      break;
    case 'noble':
      e = chooseNoble(s, who, g.nobleChoice[0]!, why);
      break;
  }
  return !e;
}

/** Plays the rest of a player's turn for them. */
function autoTurn(s: JewellerState, who: PlayerId, why: Auto): boolean {
  let moved = false;
  for (let i = 0; i < 4 && s.phase === 'playing' && s.game!.current === who; i++) {
    const turns = s.game!.turns;
    if (!autoStep(s, who, why)) break;
    moved = true;
    if (s.game!.turns !== turns) break;
  }
  return moved;
}

// ---- Lobby ----

function requireHost(ctx: Ctx) {
  return ctx.isHost ? null : err('not-host', 'Only the host can do that.');
}

function seatWaiting(s: JewellerState) {
  let free = MAX_PLAYERS - players(s).length;
  for (const seat of Object.values(s.seats)) {
    if (free <= 0) break;
    if (!seat.waiting || seat.playing) continue;
    delete seat.waiting;
    seat.playing = true;
    free -= 1;
  }
}

function sit(state: JewellerState, playing: boolean, ctx: Ctx): Result {
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
  // Mid-game, a newcomer who wants to play waits for the next game.
  if (s.phase === 'playing' && playing) mine.waiting = true;
  else mine.playing = playing;
  return s;
}

/** Seats of players who left during the last game go once it's over. */
function dropLeft(s: JewellerState) {
  for (const id of Object.keys(s.game?.left ?? {})) delete s.seats[id];
}

function deal(state: JewellerState, ctx: Ctx): Result {
  const s = draft(state);
  dropLeft(s);
  seatWaiting(s);
  const seated = players(s);
  if (seated.length < MIN_PLAYERS) return err('too-few', `${MIN_PLAYERS} players are needed.`);
  if (seated.length > MAX_PLAYERS) return err('too-many', `At most ${MAX_PLAYERS} can play.`);
  const rng = ctx.rng;
  // The first player is picked at random; play goes round in seat order from them.
  const first = testDeck?.firstSeat ? 0 : rng.int(seated.length);
  const order = [...seated.slice(first), ...seated.slice(0, first)];
  const decks = {} as Record<Level, string[]>;
  const market = {} as Record<Level, (string | null)[]>;
  const owned = (testDeck?.owned ?? []).filter((id) => CARDS.some((c) => c.id === id));
  for (const l of LEVELS) {
    const ids = rng.shuffle(
      CARDS.filter((c) => c.level === l && !owned.includes(c.id)).map((c) => c.id),
    );
    decks[l] = stack(ids, testDeck?.decks?.[l]);
    market[l] = decks[l].splice(0, MARKET_SIZE);
  }
  const nobles = stack(rng.shuffle(NOBLES.map((n) => n.id)), testDeck?.nobles).slice(
    0,
    order.length + 1,
  );
  const gems = GEMS_FOR[order.length]!;
  const bank: Pieces = { ...noPieces(), gold: GOLD_PIECES };
  for (const gem of GEMS) bank[gem] = gems;
  const pl: Record<PlayerId, PlayerState> = {};
  for (const id of order) pl[id] = { tokens: noPieces(), cards: [], reserved: [], nobles: [] };
  pl[order[0]!]!.cards = owned;
  s.phase = 'playing';
  s.gamesPlayed += 1;
  s.log = [];
  s.game = {
    order,
    players: pl,
    names: Object.fromEntries(order.map((id) => [id, s.seats[id]!.name])),
    decks,
    market,
    nobles,
    bank,
    current: order[0]!,
    stage: 'action',
    turns: 0,
    nobleChoice: [],
    finalBy: null,
    left: {},
    clock: null,
    winners: [],
  };
  log(s, { kind: 'start', first: order[0]! });
  s.seed = newSeed(rng);
  settle(s, ctx.now);
  return s;
}

function updateSettings(
  state: JewellerState,
  action: Extract<JewellerAction, { type: 'update-settings' }>,
  ctx: Ctx,
): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'playing') return err('in-progress', 'Settings change between games.');
  const s = draft(state);
  if (action.target !== undefined) s.settings.target = action.target;
  if (action.showReserved !== undefined) s.settings.showReserved = action.showReserved;
  if (action.seconds !== undefined) s.settings.seconds = action.seconds;
  if (action.timerMode !== undefined) s.settings.timerMode = action.timerMode;
  return s;
}

function backToLobby(state: JewellerState, ctx: Ctx): Result {
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

// ---- In play ----

function inPlay(
  state: JewellerState,
  ctx: Ctx,
  fn: (s: JewellerState) => GameError | null,
): Result {
  if (state.phase !== 'playing' || !state.game) return err('not-playing', 'No game in play.');
  const s = draft(state);
  const e = fn(s);
  if (e) return e;
  settle(s, ctx.now);
  return s;
}

function reduce(state: JewellerState, action: JewellerAction, ctx: Ctx): Result {
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
    case 'take':
      return inPlay(state, ctx, (s) => take(s, by, action.gems));
    case 'reserve':
      return inPlay(state, ctx, (s) =>
        reserve(s, by, {
          ...(action.card !== undefined && { card: action.card }),
          ...(action.level !== undefined && { level: action.level }),
        }),
      );
    case 'buy':
      return inPlay(state, ctx, (s) => buy(s, by, action.card, action.gold));
    case 'return':
      return inPlay(state, ctx, (s) => giveBack(s, by, action.tokens));
    case 'noble':
      return inPlay(state, ctx, (s) => chooseNoble(s, by, action.noble));
    case 'pass':
      return inPlay(state, ctx, (s) => pass(s, by));
    case 'act-for': {
      const e = requireHost(ctx);
      if (e) return e;
      return inPlay(state, ctx, (s) => {
        if (s.game!.current !== action.player)
          return err('not-waiting', 'The table isn’t waiting on that player.');
        return autoTurn(s, action.player, 'host') ? null : err('stuck', 'Nothing to do for them.');
      });
    }
  }
}

// ---- Players coming and going ----

function create(ctx: CreateCtx, playersIn: readonly PlayerInfo[]): JewellerState {
  let state: JewellerState = {
    phase: 'lobby',
    settings: { target: DEFAULT_TARGET, showReserved: false, seconds: null, timerMode: 'soft' },
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

function playerJoined(state: JewellerState, player: PlayerInfo): JewellerState {
  const s = draft(state);
  const existing = s.seats[player.id];
  if (existing) {
    existing.name = player.name;
    const g = s.game;
    if (g?.names[player.id]) g.names[player.id] = player.name;
    // Back after leaving: they play their own turns again.
    if (g && g.left[player.id] !== undefined) {
      delete g.left[player.id];
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
 * Someone left for good. Between games their seat goes; mid-game they keep it, and the table
 * plays their turns with the safe move (after a short beat) until they come back or the game ends.
 */
function playerLeft(state: JewellerState, playerId: PlayerId, now: number): JewellerState {
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

type Due = { at: number; why: 'left' | 'timer' | 'remind' };

function deadlines(state: JewellerState): Due[] {
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

function nextDeadline(state: JewellerState): number | null {
  return deadlines(state)[0]?.at ?? null;
}

function onDeadline(state: JewellerState, now: number): JewellerState {
  const due = deadlines(state)[0];
  if (!due || now < due.at) return state;
  const s = draft(state);
  const g = s.game!;
  const rng = hiddenRng(state, now);
  if (due.why === 'remind') g.clock!.reminded = true;
  else autoTurn(s, g.current, due.why);
  settle(s, now);
  s.seed = newSeed(rng);
  return s;
}

// ---- Views ----

function gameView(state: JewellerState, g: Game, viewer: PlayerId | null): GameView {
  const secs = state.settings.seconds;
  const over = state.phase === 'over';
  return {
    order: [...g.order],
    players: g.order.map((id) => {
      const p = g.players[id]!;
      const open = over || id === viewer || state.settings.showReserved;
      return {
        id,
        name: state.seats[id]?.name ?? g.names[id] ?? 'Gone',
        tokens: { ...p.tokens },
        cards: [...p.cards],
        reserved: p.reserved.map((r) => ({
          level: cardOf(r.card).level,
          // A blind reserve stays hidden even with reserved cards shown: nobody ever saw it.
          card: open && (!r.blind || over || id === viewer) ? r.card : null,
          blind: r.blind,
        })),
        nobles: [...p.nobles],
        points: pointsFor(p),
        bonuses: bonusesFor(p),
        left: g.left[id] !== undefined || !state.seats[id],
      };
    }),
    decks: deckCounts(g),
    market: { 1: [...g.market[1]], 2: [...g.market[2]], 3: [...g.market[3]] },
    nobles: [...g.nobles],
    bank: { ...g.bank },
    current: g.current,
    stage: g.stage,
    turns: g.turns,
    round: Math.floor(g.turns / g.order.length) + 1,
    nobleChoice: [...g.nobleChoice],
    finalBy: g.finalBy,
    clock:
      g.clock && state.phase === 'playing'
        ? {
            who: g.current,
            since: g.clock.since,
            deadline: secs === null ? null : g.clock.since + secs * 1000,
            reminded: g.clock.reminded,
          }
        : null,
    winners: [...g.winners],
  };
}

/** Whether `viewer` may see the card in a reserve log entry. */
function seesReserve(
  state: JewellerState,
  e: Extract<LogEntry, { kind: 'reserve' }>,
  viewer: PlayerId | null,
) {
  if (state.phase === 'over' || e.by === viewer) return true;
  return !e.blind && state.settings.showReserved;
}

function view(state: JewellerState, viewer: PlayerId | null): JewellerView {
  const seats: SeatView[] = Object.entries(state.seats).map(([id, s]) => ({
    id,
    name: s.name,
    playing: s.playing,
    ...(s.waiting && { waiting: true }),
  }));
  const g = state.game;
  return {
    phase: state.phase,
    settings: { ...state.settings },
    seats,
    me: seats.find((s) => s.id === viewer) ?? null,
    game: g ? gameView(state, g, viewer) : null,
    log: state.log.map((e) =>
      e.kind === 'reserve' && !seesReserve(state, e, viewer) ? { ...e, card: null } : { ...e },
    ),
  };
}

export const jeweller: GameDefinition<JewellerState, JewellerAction, JewellerView> = {
  id: 'jeweller',
  name: 'Jeweller',
  description: 'Collect gems, buy cards for lasting discounts and points, and win the nobles over.',
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
  awards: jewellerAwards,
  bot: jewellerBot,
  botInfo: {},
};
