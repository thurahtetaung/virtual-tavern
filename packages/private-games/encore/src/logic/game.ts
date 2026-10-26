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
import { encoreAwards } from './awards.ts';
import { encoreBot } from './bot.ts';
import { HAND_SIZE, START_CARD, cardOf, deckFor, isCard } from './cards.ts';
import { guide } from './guide.ts';
import { insights } from './insights.ts';
import { totalsOf } from './score.ts';
import {
  type HandCard,
  flipHand,
  insertAt,
  legalShows,
  showProblem,
  strengthOf,
  turned,
} from './rules.ts';
import {
  type Auto,
  DEFAULT_SECONDS,
  type EncoreAction,
  type EncoreState,
  type EncoreView,
  type EndHow,
  type Game,
  type GameView,
  LEFT_BEAT_MS,
  type LogEntry,
  MAX_LOG,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type ScoreRow,
  type Seat,
  type SeatView,
  TWO_PLAYER_CHIPS,
  actionSchema,
} from './types.ts';

type Ctx = ActionCtx;
type Result = EncoreState | GameError;

const err = (code: string, message: string) => new GameError(code, message);
const draft = (s: EncoreState): EncoreState => structuredClone(s);
const hiddenRng = (state: EncoreState, now: number) => createRng((state.seed ^ now) >>> 0);
const newSeed = (rng: Rng) => rng.int(2 ** 32);

// ---- Test rig ----

/**
 * Browser tests only: the deck for a table size in this order (each card which way up), dealt in
 * seat order in blocks of a hand each, every round (with 2 players, the next 22 cards are the
 * second round's); cards it leaves out follow, low number up. The first seat starts when nobody
 * holds the 1/2 card.
 */
let testDeck: Record<number, HandCard[]> | null = null;
export function setTestDeck(decks: Record<number, HandCard[]> | null) {
  testDeck = decks;
}

/** "1/2 3/8 10/4": cards written up-number first. */
export function parseCards(raw: string): HandCard[] {
  return raw
    .split(/[\s,]+/)
    .filter(Boolean)
    .flatMap((part) => {
      const [up, down] = part.split('/').map(Number);
      if (!up || !down) return [];
      const id = `${Math.min(up, down)}-${Math.max(up, down)}`;
      return isCard(id) ? [{ id, up }] : [];
    });
}

/** "3:1/2 4/1 …;2:…": a deck per table size. */
export function parseTestDeck(raw: string): Record<number, HandCard[]> {
  return Object.fromEntries(
    raw.split(';').flatMap((part) => {
      const [n, cards] = part.split(':');
      return n && cards ? [[Number(n), parseCards(cards)]] : [];
    }),
  );
}

// ---- Reading the table ----

export function players(state: EncoreState): PlayerId[] {
  return Object.entries(state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));
}

const nextOf = (g: Game, id: PlayerId) => g.order[(g.order.indexOf(id) + 1) % g.order.length]!;
const twoPlayer = (g: Game) => g.order.length === 2;
const tableStrength = (g: Game) => (g.table?.cards.length ? strengthOf(g.table.cards) : null);

// ---- Log ----

type NewLog = LogEntry extends infer E
  ? E extends LogEntry
    ? Omit<E, 'id' | 'round'>
    : never
  : never;

function log(s: EncoreState, entry: NewLog) {
  s.seq += 1;
  s.log.push({ ...entry, id: s.seq, round: s.game?.round ?? 0 });
  if (s.log.length > MAX_LOG) s.log.splice(0, s.log.length - MAX_LOG);
}

const autoOf = (auto?: Auto) => (auto ? { auto } : {});

// ---- Rounds ----

/** The cards for a new deal: shuffled, each card a random way up (or the test rig's order). */
function shuffledDeck(n: number, rng: Rng): HandCard[] {
  const ids = deckFor(n);
  const rig = testDeck?.[n];
  if (rig) {
    const rigged = rig.filter((c) => ids.includes(c.id));
    const rest = ids
      .filter((id) => !rigged.some((c) => c.id === id))
      .map((id) => ({ id, up: cardOf(id).a }));
    return [...rigged, ...rest];
  }
  return rng.shuffle(ids).map((id) => {
    const c = cardOf(id);
    return { id, up: rng.next() < 0.5 ? c.a : c.b };
  });
}

/** Deals a round: hands, chips, markers, and the flip step. */
function dealRound(s: EncoreState, rng: Rng) {
  const g = s.game!;
  const n = g.order.length;
  const size = HAND_SIZE[n]!;
  let cards: HandCard[];
  if (n === 2 && g.round % 2 === 0 && g.reserve.length) {
    // The second round of a pair deals the cards set aside in the first.
    const rig = testDeck?.[2];
    cards = g.reserve.map((id) => {
      const c = cardOf(id);
      return rig
        ? (rig.find((t) => t.id === id) ?? { id, up: c.a })
        : { id, up: rng.next() < 0.5 ? c.a : c.b };
    });
    if (!rig) cards = rng.shuffle(cards);
    g.reserve = [];
  } else {
    cards = shuffledDeck(n, rng);
    if (n === 2) g.reserve = cards.slice(size * 2).map((c) => c.id);
  }
  g.order.forEach((id, i) => {
    g.players[id] = {
      hand: cards.slice(i * size, (i + 1) * size),
      captured: 0,
      chips: n === 2 ? TWO_PLAYER_CHIPS : 0,
      marker: n > 2,
      flip: null,
      ready: false,
      recruited: [],
    };
  });
  g.table = null;
  g.stage = 'flip';
  g.moves = 0;
  g.current = g.starter;
}

function startRound(s: EncoreState, rng: Rng) {
  const g = s.game!;
  dealRound(s, rng);
  let startCard = false;
  if (g.round === 1) {
    // The holder of the 1/2 card starts the first round; nobody holds it: a random player.
    const holder = g.order.find((id) => g.players[id]!.hand.some((c) => c.id === START_CARD));
    startCard = !!holder;
    g.starter = holder ?? g.order[testDeck?.[g.order.length] ? 0 : rng.int(g.order.length)]!;
    g.current = g.starter;
  }
  log(s, { kind: 'round', starter: g.starter, startCard });
  // Players who left decide at once; with everyone gone the round goes straight on.
  for (const id of g.order) if (g.left[id] !== undefined) g.players[id]!.flip = autoFlip(s, id);
  maybeStartPlay(s);
}

/** Once every flip choice is in, the hands turn and play begins with the starter. */
function maybeStartPlay(s: EncoreState) {
  const g = s.game!;
  if (g.stage !== 'flip' || g.order.some((id) => g.players[id]!.flip === null)) return;
  for (const id of g.order) {
    const p = g.players[id]!;
    if (p.flip) p.hand = flipHand(p.hand);
    p.flip = null;
  }
  g.stage = 'play';
  g.current = g.starter;
  g.moves = 0;
  checkStuck(s);
}

function endGame(s: EncoreState) {
  const g = s.game!;
  const totals = totalsOf(g);
  const best = Math.max(...g.order.map((id) => totals[id]!));
  g.winners = g.order.filter((id) => totals[id] === best);
  s.phase = 'over';
  g.clock = null;
  log(s, { kind: 'over', winners: [...g.winners] });
}

/**
 * The round ends: captured cards and chips score 1 each, cards in hand lose 1 each, except for
 * the player whose Show went unbeaten (or whose opponent couldn't answer). The cards left on the
 * table score for nobody.
 */
function endRound(s: EncoreState, ender: PlayerId, how: EndHow) {
  const g = s.game!;
  const rows: ScoreRow[] = g.order.map((id) => {
    const p = g.players[id]!;
    const penalty = !(how !== 'out' && id === ender) && p.hand.length > 0;
    return {
      id,
      captured: p.captured,
      chips: p.chips,
      hand: p.hand.length,
      penalty,
      points: p.captured + p.chips - (penalty ? p.hand.length : 0),
    };
  });
  // The Show that ended it, as it was played (the table may have been recruited down since).
  const shown = [...s.log]
    .reverse()
    .find((e): e is Extract<LogEntry, { kind: 'show' }> => e.kind === 'show' && e.by === ender);
  const last = shown && shown.round === g.round ? shown.cards : (g.table?.cards ?? []);
  g.results.push({ round: g.round, ender, how, last: structuredClone(last), rows });
  g.finalHands = Object.fromEntries(g.order.map((id) => [id, [...g.players[id]!.hand]]));
  log(s, {
    kind: 'end',
    ender,
    how,
    points: Object.fromEntries(rows.map((r) => [r.id, r.points])),
  });
  if (g.round >= g.rounds) {
    endGame(s);
    return;
  }
  g.stage = 'scores';
  for (const id of g.order) g.players[id]!.ready = g.left[id] !== undefined;
}

function nextRound(s: EncoreState, rng: Rng) {
  const g = s.game!;
  g.round += 1;
  g.starter = nextOf(g, g.starter);
  startRound(s, rng);
}

/** Everyone still here is ready (players who left always are). */
const allReady = (g: Game) =>
  g.order.every((id) => g.players[id]!.ready || g.left[id] !== undefined);

// ---- Turns ----

/**
 * 2 players: a player facing a set they can't beat must recruit, paying a chip; with no chip left
 * the round ends, and the set's owner keeps their hand free of penalties.
 */
function checkStuck(s: EncoreState) {
  const g = s.game!;
  if (s.phase !== 'playing' || g.stage !== 'play' || !twoPlayer(g)) return;
  const t = g.table;
  if (!t?.cards.length) return;
  const p = g.players[g.current]!;
  if (p.chips > 0 || legalShows(p.hand, tableStrength(g)).length) return;
  endRound(s, t.owner, 'stuck');
}

/** The turn passes on; a Show that comes back round to its owner unbeaten ends the round. */
function passTurn(s: EncoreState, by: PlayerId) {
  const g = s.game!;
  const next = nextOf(g, by);
  if (!twoPlayer(g) && g.table && next === g.table.owner) {
    endRound(s, g.table.owner, 'unbeaten');
    return;
  }
  g.current = next;
  checkStuck(s);
}

function myTurn(g: Game, by: PlayerId): GameError | null {
  if (!g.players[by]) return err('not-playing', 'You are not in this game.');
  if (g.stage === 'flip') return err('flip-first', 'Everyone keeps or flips their hand first.');
  if (g.stage !== 'play') return err('round-over', 'The round is over.');
  if (g.current !== by) return err('not-your-turn', 'It’s not your turn.');
  return null;
}

function rangeProblem(hand: readonly HandCard[], from: number, to: number): GameError | null {
  if (from > to || to >= hand.length) return err('bad-range', 'Pick cards that are in your hand.');
  return null;
}

/** Plays the cards from `from` to `to`: they must beat the table. */
function doShow(
  s: EncoreState,
  by: PlayerId,
  from: number,
  to: number,
  auto?: Auto,
  double?: boolean,
): GameError | null {
  const g = s.game!;
  const p = g.players[by]!;
  const e = rangeProblem(p.hand, from, to);
  if (e) return e;
  const cards = p.hand.slice(from, to + 1);
  const problem = showProblem(cards, tableStrength(g));
  if (problem) return err('too-weak', problem);
  const beat = [...(g.table?.cards ?? [])];
  p.captured += beat.length;
  p.hand.splice(from, to - from + 1);
  g.table = { cards, owner: by };
  g.moves += 1;
  // The log keeps its own copy: recruits shrink the table's.
  log(s, {
    kind: 'show',
    by,
    cards: cards.map((c) => ({ ...c })),
    beat,
    ...(double && { double }),
    ...autoOf(auto),
  });
  if (!p.hand.length) {
    endRound(s, by, 'out');
    return null;
  }
  passTurn(s, by);
  return null;
}

/** Takes an end card of the table into the hand. The turn goes on only for Recruit & Show. */
function doRecruit(
  s: EncoreState,
  by: PlayerId,
  end: 'left' | 'right',
  flip: boolean,
  at: number,
  auto?: Auto,
  double?: boolean,
): GameError | null {
  const g = s.game!;
  const p = g.players[by]!;
  const t = g.table;
  if (!t?.cards.length) return err('nothing-to-recruit', 'The table is empty: show something.');
  if (at > p.hand.length) return err('bad-gap', 'Put the card in a gap in your hand.');
  const two = twoPlayer(g);
  if (two && p.chips <= 0) return err('no-chips', 'You have no chips left.');
  const card = end === 'left' ? t.cards.shift()! : t.cards.pop()!;
  p.hand = insertAt(p.hand, flip ? turned(card) : card, at);
  p.recruited.push(card.id);
  if (two) p.chips -= 1;
  else g.players[t.owner]!.chips += 1;
  g.moves += 1;
  log(s, {
    kind: 'recruit',
    by,
    card: { ...card },
    end,
    owner: t.owner,
    ...(two && { paid: true }),
    ...(double && { double }),
    ...autoOf(auto),
  });
  return null;
}

function show(s: EncoreState, by: PlayerId, from: number, to: number, auto?: Auto) {
  return myTurn(s.game!, by) ?? doShow(s, by, from, to, auto);
}

function recruit(
  s: EncoreState,
  by: PlayerId,
  end: 'left' | 'right',
  flip: boolean,
  at: number,
  auto?: Auto,
): GameError | null {
  const g = s.game!;
  const e = myTurn(g, by) ?? doRecruit(s, by, end, flip, at, auto);
  if (e) return e;
  // 2 players: recruiting keeps the turn (and may leave the player stuck).
  if (twoPlayer(g)) checkStuck(s);
  else passTurn(s, by);
  return null;
}

/** Recruit & Show: once a round, recruit and then show at once; refused whole if the Show fails. */
function marker(
  s: EncoreState,
  by: PlayerId,
  a: { end: 'left' | 'right'; flip: boolean; at: number; from: number; to: number },
  auto?: Auto,
): GameError | null {
  const g = s.game!;
  const e = myTurn(g, by);
  if (e) return e;
  if (twoPlayer(g)) return err('no-double', 'There is no Recruit & Show with 2 players.');
  const p = g.players[by]!;
  if (!p.marker) return err('marker-used', 'You have used your Recruit & Show this round.');
  const recruited = doRecruit(s, by, a.end, a.flip, a.at, auto, true);
  if (recruited) return recruited;
  p.marker = false;
  return doShow(s, by, a.from, a.to, auto, true);
}

function chooseFlip(s: EncoreState, by: PlayerId, flip: boolean): GameError | null {
  const g = s.game!;
  if (!g.players[by]) return err('not-playing', 'You are not in this game.');
  if (g.stage !== 'flip') return err('not-now', 'The hands are already set for this round.');
  g.players[by].flip = flip;
  maybeStartPlay(s);
  return null;
}

// ---- Moves made for a player ----

/** The bot's flip choice for a player (the safe move). */
function autoFlip(s: EncoreState, id: PlayerId): boolean {
  const move = encoreBot(view(s, id), {
    me: id,
    now: 0,
    rng: hiddenRng(s, s.seq),
    words: () => [],
  });
  return move?.type === 'flip' ? move.flip : false;
}

/** The safe move made for a player out of time, away, or when the host acts for them: the bot's. */
function autoMove(s: EncoreState, who: PlayerId, why: Auto): boolean {
  const g = s.game!;
  if (g.stage === 'flip') {
    if (g.players[who]?.flip !== null) return false;
    return !chooseFlip(s, who, autoFlip(s, who));
  }
  if (g.stage !== 'play' || g.current !== who) return false;
  const move = encoreBot(view(s, who), {
    me: who,
    now: 0,
    rng: hiddenRng(s, s.seq),
    words: () => [],
  });
  const tryMove = (m: EncoreAction | null): boolean => {
    if (!m) return false;
    const attempt = draft(s);
    let e: GameError | null = err('bad', 'bad');
    if (m.type === 'show') e = show(attempt, who, m.from, m.to, why);
    else if (m.type === 'recruit') e = recruit(attempt, who, m.end, m.flip, m.at, why);
    else if (m.type === 'recruit-show') e = marker(attempt, who, m, why);
    if (e) return false;
    Object.assign(s, attempt);
    return true;
  };
  if (tryMove(move)) return true;
  // Never stuck: recruit the left end into the front, or show the first card on an empty table.
  return g.table?.cards.length
    ? tryMove({ type: 'recruit', end: 'left', flip: false, at: 0 })
    : tryMove({ type: 'show', from: 0, to: 0 });
}

// ---- Lobby ----

function requireHost(ctx: Ctx) {
  return ctx.isHost ? null : err('not-host', 'Only the host can do that.');
}

function seatWaiting(s: EncoreState) {
  let free = MAX_PLAYERS - players(s).length;
  for (const seat of Object.values(s.seats)) {
    if (free <= 0) break;
    if (!seat.waiting || seat.playing) continue;
    delete seat.waiting;
    seat.playing = true;
    free -= 1;
  }
}

function sit(state: EncoreState, playing: boolean, ctx: Ctx): Result {
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

function dropLeft(s: EncoreState) {
  for (const id of Object.keys(s.game?.left ?? {})) delete s.seats[id];
}

function deal(state: EncoreState, ctx: Ctx): Result {
  const s = draft(state);
  dropLeft(s);
  seatWaiting(s);
  const order = players(s);
  if (order.length < MIN_PLAYERS) return err('too-few', `${MIN_PLAYERS} players are needed.`);
  if (order.length > MAX_PLAYERS) return err('too-many', `At most ${MAX_PLAYERS} can play.`);
  s.phase = 'playing';
  s.gamesPlayed += 1;
  s.log = [];
  s.game = {
    order,
    players: {},
    names: Object.fromEntries(order.map((id) => [id, s.seats[id]!.name])),
    round: 1,
    rounds: order.length * (s.settings.twoEach ? 2 : 1),
    starter: order[0]!,
    stage: 'flip',
    current: order[0]!,
    moves: 0,
    table: null,
    reserve: [],
    results: [],
    left: {},
    clock: null,
    finalHands: null,
    winners: [],
  };
  startRound(s, ctx.rng);
  s.seed = newSeed(ctx.rng);
  settle(s, ctx.now);
  return s;
}

function updateSettings(
  state: EncoreState,
  action: Extract<EncoreAction, { type: 'update-settings' }>,
  ctx: Ctx,
): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'playing') return err('in-progress', 'Settings change between games.');
  const s = draft(state);
  if (action.twoEach !== undefined) s.settings.twoEach = action.twoEach;
  if (action.seconds !== undefined) s.settings.seconds = action.seconds;
  if (action.timerMode !== undefined) s.settings.timerMode = action.timerMode;
  return s;
}

function backToLobby(state: EncoreState, ctx: Ctx): Result {
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

/** The decision clock restarts whenever the table waits on something new. */
function settle(s: EncoreState, now: number) {
  const g = s.game;
  if (!g) return;
  if (s.phase !== 'playing') {
    g.clock = null;
    return;
  }
  const key = `${g.round}:${g.stage}:${g.stage === 'play' ? `${g.moves}:${g.current}` : ''}`;
  if (g.clock?.key !== key) g.clock = { key, since: now, reminded: false };
}

// ---- In play ----

function inPlay(state: EncoreState, ctx: Ctx, fn: (s: EncoreState) => GameError | null): Result {
  if (state.phase !== 'playing' || !state.game) return err('not-playing', 'No game in play.');
  const s = draft(state);
  const e = fn(s);
  if (e) return e;
  settle(s, ctx.now);
  return s;
}

function reduce(state: EncoreState, action: EncoreAction, ctx: Ctx): Result {
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
    case 'flip':
      return inPlay(state, ctx, (s) => chooseFlip(s, by, action.flip));
    case 'show':
      return inPlay(state, ctx, (s) => show(s, by, action.from, action.to));
    case 'recruit':
      return inPlay(state, ctx, (s) => recruit(s, by, action.end, action.flip, action.at));
    case 'recruit-show':
      return inPlay(state, ctx, (s) => marker(s, by, action));
    case 'ready':
      return inPlay(state, ctx, (s) => {
        const g = s.game!;
        if (!g.players[by]) return err('not-playing', 'You are not in this game.');
        if (g.stage !== 'scores') return err('not-now', 'The round is still being played.');
        g.players[by].ready = true;
        if (allReady(g)) nextRound(s, ctx.rng);
        return null;
      });
    case 'next-round': {
      const e = requireHost(ctx);
      if (e) return e;
      return inPlay(state, ctx, (s) => {
        if (s.game!.stage !== 'scores') return err('not-now', 'The round is still being played.');
        nextRound(s, ctx.rng);
        return null;
      });
    }
    case 'act-for': {
      const e = requireHost(ctx);
      if (e) return e;
      return inPlay(state, ctx, (s) =>
        autoMove(s, action.player, 'host')
          ? null
          : err('not-waiting', 'The table isn’t waiting on that player.'),
      );
    }
  }
}

// ---- Players coming and going ----

function create(ctx: CreateCtx, playersIn: readonly PlayerInfo[]): EncoreState {
  let state: EncoreState = {
    phase: 'lobby',
    settings: { twoEach: false, seconds: DEFAULT_SECONDS, timerMode: 'soft' },
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

function playerJoined(state: EncoreState, player: PlayerInfo): EncoreState {
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
 * Someone left for good. Between games their seat goes; mid-game they keep it, and the table
 * plays for them with the bot's move (after a short beat) until they come back or the game ends.
 */
function playerLeft(state: EncoreState, playerId: PlayerId, now: number): EncoreState {
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

type Due = { at: number; why: Auto | 'remind'; who: PlayerId[] };

function deadlines(state: EncoreState): Due[] {
  const g = state.game;
  if (state.phase !== 'playing' || !g?.clock) return [];
  const out: Due[] = [];
  const secs = state.settings.seconds;
  const strict = state.settings.timerMode === 'strict';
  if (g.stage === 'flip') {
    const open = g.order.filter((id) => g.players[id]!.flip === null);
    for (const id of open) {
      const gone = g.left[id];
      if (gone !== undefined)
        out.push({ at: Math.max(g.clock.since, gone) + LEFT_BEAT_MS, why: 'left', who: [id] });
    }
    if (secs !== null && open.length) {
      const at = g.clock.since + secs * 1000;
      if (strict) out.push({ at, why: 'timer', who: open });
      else if (!g.clock.reminded) out.push({ at, why: 'remind', who: [] });
    }
  } else if (g.stage === 'scores') {
    // Everyone still here is ready (or nobody is left to tap): deal on after a beat.
    if (allReady(g)) out.push({ at: g.clock.since + LEFT_BEAT_MS, why: 'left', who: [] });
  } else if (g.stage === 'play') {
    const gone = g.left[g.current];
    if (gone !== undefined)
      out.push({ at: Math.max(g.clock.since, gone) + LEFT_BEAT_MS, why: 'left', who: [g.current] });
    if (secs !== null) {
      const at = g.clock.since + secs * 1000;
      if (strict) out.push({ at, why: 'timer', who: [g.current] });
      else if (!g.clock.reminded) out.push({ at, why: 'remind', who: [] });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

function nextDeadline(state: EncoreState): number | null {
  return deadlines(state)[0]?.at ?? null;
}

function onDeadline(state: EncoreState, now: number): EncoreState {
  const due = deadlines(state)[0];
  if (!due || now < due.at) return state;
  const s = draft(state);
  const g = s.game!;
  if (due.why === 'remind') g.clock!.reminded = true;
  else if (g.stage === 'scores') nextRound(s, hiddenRng(state, now));
  else for (const id of due.who) autoMove(s, id, due.why);
  settle(s, now);
  s.seed = newSeed(hiddenRng(state, now));
  return s;
}

// ---- Views ----

function gameView(state: EncoreState, g: Game, viewer: PlayerId | null): GameView {
  const secs = state.settings.seconds;
  const over = state.phase === 'over';
  const totals = totalsOf(g);
  const mine = viewer ? g.players[viewer] : undefined;
  return {
    order: [...g.order],
    players: g.order.map((id) => {
      const p = g.players[id]!;
      return {
        id,
        name: state.seats[id]?.name ?? g.names[id] ?? 'Gone',
        hand: p.hand.length,
        captured: p.captured,
        chips: p.chips,
        marker: p.marker,
        done: g.stage === 'flip' ? p.flip !== null : g.stage === 'scores' ? p.ready : false,
        total: totals[id] ?? 0,
        left: g.left[id] !== undefined || !state.seats[id],
      };
    }),
    hand: mine ? mine.hand.map((c) => ({ ...c })) : null,
    myFlip: mine && g.stage === 'flip' ? mine.flip : null,
    twoPlayer: twoPlayer(g),
    round: g.round,
    rounds: g.rounds,
    starter: g.starter,
    stage: g.stage,
    current: g.current,
    table: g.table ? { cards: g.table.cards.map((c) => ({ ...c })), owner: g.table.owner } : null,
    reserve: g.reserve.length,
    results: structuredClone(g.results),
    clock:
      g.clock && state.phase === 'playing' && g.stage !== 'scores'
        ? {
            who: g.stage === 'play' ? g.current : null,
            since: g.clock.since,
            deadline: secs === null ? null : g.clock.since + secs * 1000,
            reminded: g.clock.reminded,
          }
        : null,
    finalHands: over && g.finalHands ? structuredClone(g.finalHands) : null,
    winners: [...g.winners],
  };
}

function view(state: EncoreState, viewer: PlayerId | null): EncoreView {
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
    log: state.log.map((e) => structuredClone(e)),
  };
}

export const encore: GameDefinition<EncoreState, EncoreAction, EncoreView> = {
  id: 'encore',
  name: 'Encore',
  description:
    'Play stronger sets and runs from a hand you can’t rearrange, or recruit a card from the table to build your next show.',
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
  awards: encoreAwards,
  bot: encoreBot,
  botInfo: {},
};
