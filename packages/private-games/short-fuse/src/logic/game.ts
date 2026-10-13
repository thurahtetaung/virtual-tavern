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
import { shortFuseAwards } from './awards.ts';
import { shortFuseBot, shortFuseBotInfo } from './bot.ts';
import { CARDS, type CardType, NAMEABLE, PEEK_SIZE, isCat, isBombCard } from './cards.ts';
import { deal, readout } from './deck.ts';
import { guide } from './guide.ts';
import { insights } from './insights.ts';
import {
  BEAT_MS,
  type CardId,
  type CardView,
  DEFAULT_DECISION_SECONDS,
  type Game,
  type GameView,
  type LogEntry,
  MAX_LOG,
  MAX_MEMORY,
  MAX_SEATS,
  MAX_TRUTH,
  MIN_PLAYERS,
  type Memory,
  NOPE_COOLDOWN_MS,
  NOPE_SECONDS,
  NUDGE_MS,
  PILE_EDGES,
  type Pending,
  type PileView,
  type PlayKind,
  type Preset,
  type Prompt,
  type SeatView,
  type Settings,
  type ShortFuseAction,
  type ShortFuseState,
  type ShortFuseView,
  type Stage,
  actionSchema,
} from './types.ts';

type Ctx = ActionCtx;
type S = ShortFuseState;
type Result = S | GameError;

const err = (code: string, message: string) => new GameError(code, message);

// ---- Test rig (browser tests only) ----

let rigEnabled = false;
/**
 * Test servers only: accept the host's `rig` action, which fixes the hands and the top of the
 * pile for the next game so a browser test can reach a given card. Never enabled in production.
 */
export function enableTestRig(on = true) {
  rigEnabled = on;
}

// ---- Pure helpers (also used by the UI, bots and tests) ----

/** Seated players, in seat order. */
export function seated(state: Pick<S, 'seats'>): PlayerId[] {
  return Object.entries(state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));
}

export const isOut = (g: Pick<Game, 'dead' | 'left'>, p: PlayerId) =>
  g.left.includes(p) || g.dead.some((d) => d.id === p);

/** Players still in the game, in seat order. */
export const alive = (g: Pick<Game, 'players' | 'dead' | 'left'>) =>
  g.players.filter((p) => !isOut(g, p));

/** The next player still in, from `from` in the direction of play (or `from` if nobody else is). */
export function nextAlive(g: Pick<Game, 'players' | 'dead' | 'left'>, from: PlayerId, dir: 1 | -1) {
  const n = g.players.length;
  const i = g.players.indexOf(from);
  for (let k = 1; k <= n; k++) {
    const p = g.players[(((i + dir * k) % n) + n) % n]!;
    if (!isOut(g, p)) return p;
  }
  return from;
}

/** The cat group a card belongs to for combos: the wild card matches any cat. */
const title = (t: CardType) => (t === 'wild' ? 'wild' : t);

/**
 * What a set of cards makes when played together, or why it makes nothing. Pairs and triples are
 * cards with the same name; the wild card stands in for any cat (and two wilds pair up).
 */
export function comboOf(
  types: CardType[],
  fiveCombo: boolean,
): { kind: PlayKind; t: CardType | null } | { error: string } {
  if (types.length === 1) return { kind: 'card', t: types[0]! };
  if (types.length === 2 || types.length === 3) {
    const plain = types.filter((t) => t !== 'wild');
    const kinds = new Set(plain.map(title));
    const kind = types.length === 2 ? 'pair' : 'triple';
    if (plain.length === 0) return { kind, t: 'wild' };
    if (kinds.size === 1) {
      const t = plain[0]!;
      if (plain.length === types.length || isCat(t)) return { kind, t };
      return { error: 'The wild card only stands in for a cat.' };
    }
    return { error: `Those cards don’t match: a combo needs ${types.length} with the same name.` };
  }
  if (types.length === 5) {
    if (!fiveCombo) return { error: 'The five-card combo is off in this game.' };
    if (new Set(types).size !== 5) return { error: 'Five different cards: no two the same.' };
    return { kind: 'five', t: null };
  }
  return { error: 'Play one card, a pair, three of a kind or five different cards.' };
}

/** Who the table is waiting on right now. */
export function awaited(state: S): PlayerId[] {
  const g = state.game;
  if (state.phase !== 'playing' || !g) return [];
  switch (state.stage) {
    case 'turn':
    case 'salvage':
      return [g.turn.player];
    case 'favor':
      return g.favor ? [g.favor.from] : [];
    case 'alter':
      return g.alter ? [g.alter.by] : [];
    case 'bomb':
      return g.drawn ? [g.drawn.by] : [];
    case 'place':
      return g.placing ? [g.placing.by] : [];
    default:
      return [];
  }
}

/** Players who can be asked for a card (Favor, pairs, triples): still in, with cards in hand. */
export function targetable(g: Game, by: PlayerId): PlayerId[] {
  return alive(g).filter((p) => p !== by && (g.hands[p]?.length ?? 0) > 0);
}

export const DEFAULT_SETTINGS: Settings = {
  core: 'classic',
  art: 'classic',
  x1: false,
  faster: false,
  fiveCombo: false,
  nonStacking: false,
  nopeSeconds: NOPE_SECONDS.default,
  decisionSeconds: DEFAULT_DECISION_SECONDS,
  strict: false,
};

export function presetOf(s: Pick<Settings, 'core' | 'art'>): Preset {
  if (s.core === 'party') return s.art === 'classic' ? 'party' : 'custom';
  return s.art === 'adult' ? 'adult' : 'classic';
}

/** Card types in a game with these settings (for the Three of a Kind picker and the glossary). */
export function typesIn(s: Pick<Settings, 'core' | 'x1'>): CardType[] {
  return (Object.keys(CARDS) as CardType[]).filter((t) => {
    if (CARDS[t].set === 'x1') {
      if (s.x1) return true;
      return s.core === 'party' && t !== 'void' && t !== 'reverse';
    }
    return true;
  });
}

// ---- State plumbing ----

/**
 * A copy to change: everything is cloned except the card table, which never changes once a game
 * is dealt (and is by far the biggest part of the state).
 */
function draftOf(state: S): S {
  const g = state.game;
  if (!g) return structuredClone(state);
  const copy = structuredClone({ ...state, game: { ...g, cards: {} } });
  copy.game.cards = g.cards;
  return copy;
}

const newSeed = (rng: Rng) => rng.int(2 ** 32);

/** Randomness for deadlines, from the hidden seed (which then moves on, so nothing replays). */
function hiddenRng(g: Game, now: number): Rng {
  const rng = createRng((g.seed ^ now ^ Math.imul(g.seq + 1, 2654435761)) >>> 0);
  g.seed = rng.int(2 ** 32);
  return rng;
}

const nameOf = (g: Game, id: PlayerId | null | undefined) => (id && g.names[id]) || 'Someone';

function log(g: Game, now: number, e: Omit<LogEntry, 'id' | 'at' | 'turn'>) {
  g.seq += 1;
  g.log.push({ id: g.seq, at: now, turn: g.turn.n, ...e });
  if (g.log.length > MAX_LOG) g.log.splice(0, g.log.length - MAX_LOG);
}

type MemoryInput = Memory extends infer M ? (M extends Memory ? Omit<M, 'id'> : never) : never;

function remember(g: Game, who: PlayerId, m: MemoryInput) {
  g.seq += 1;
  const list = (g.memory[who] ??= []);
  list.push({ ...m, id: g.seq });
  if (list.length > MAX_MEMORY) list.splice(0, list.length - MAX_MEMORY);
}

const card = (g: Game, id: CardId) => ({ ...g.cards[id]! });
const typeOf = (g: Game, id: CardId) => g.cards[id]!.t;

function setStage(state: S, stage: Stage, now: number) {
  state.stage = stage;
  state.game!.decisionAt = now;
}

function takeFromHand(g: Game, who: PlayerId, id: CardId) {
  const hand = g.hands[who]!;
  const i = hand.indexOf(id);
  if (i >= 0) hand.splice(i, 1);
}

function moveCard(g: Game, from: PlayerId, to: PlayerId, id: CardId) {
  takeFromHand(g, from, id);
  g.hands[to]!.push(id);
}

// ---- Turns ----

/** A fresh turn for `player`. */
function startTurn(state: S, player: PlayerId, owed: number, chained: boolean, now: number) {
  const g = state.game!;
  g.turn = { player, owed, chained, dir: g.turn.dir, n: g.turn.n + 1, plays: 0 };
  if (owed > g.stats.maxOwed) {
    g.stats.maxOwed = owed;
    g.stats.maxOwedBy = player;
  }
  setStage(state, 'turn', now);
}

/** Ends one of the current player's owed turns; the last one passes play on. */
function endOneTurn(state: S, now: number) {
  const g = state.game!;
  const t = g.turn;
  if (t.owed > 1) startTurn(state, t.player, t.owed - 1, t.chained, now);
  else startTurn(state, nextAlive(g, t.player, t.dir), 1, false, now);
}

function backToTurn(state: S, now: number) {
  setStage(state, 'turn', now);
}

function finish(state: S, now: number) {
  const g = state.game!;
  const left = alive(g);
  g.winner = left.length === 1 ? left[0]! : null;
  g.pending = null;
  g.window = null;
  g.favor = null;
  g.alter = null;
  g.placing = null;
  g.drawn = null;
  g.beat = null;
  if (g.limbo) {
    g.pile.unshift(g.limbo);
    g.limbo = null;
  }
  if (g.winner) log(g, now, { kind: 'win', by: g.winner });
  state.phase = 'over';
  state.stage = null;
  state.gamesPlayed += 1;
}

/** `who` explodes: the Bomb goes face up in front of them, their hand out of the game. */
function explode(state: S, who: PlayerId, bomb: CardId, now: number) {
  const g = state.game!;
  if (g.limbo === bomb) g.limbo = null;
  (g.front[who] ??= []).push(bomb);
  if (typeOf(g, bomb) === 'bomb') g.bombsOut = Math.max(0, g.bombsOut - 1);
  g.out.push(...(g.hands[who] ?? []));
  g.hands[who] = [];
  g.dead.push({ id: who, turn: g.turn.n });
  g.drawn = null;
  g.placing = null;
  log(g, now, { kind: 'explode', by: who, cards: [typeOf(g, bomb)] });
  if (alive(g).length <= 1) return finish(state, now);
  // Any turns they still owed vanish; the next player takes a normal turn after the moment.
  if (g.turn.player === who) {
    startTurn(state, nextAlive(g, who, g.turn.dir), 1, false, now);
  }
  g.beat = { kind: 'explode', who, until: now + BEAT_MS };
  state.stage = 'beat';
}

/** Draws for the current player (from the top or the bottom) and deals with what comes up. */
function drawCard(state: S, from: 'top' | 'bottom', now: number) {
  const g = state.game!;
  const who = g.turn.player;
  if (g.pile.length === 0) {
    log(g, now, { kind: 'empty', by: who });
    return endOneTurn(state, now);
  }
  const id = from === 'top' ? g.pile.shift()! : g.pile.pop()!;
  g.stats.draws += 1;
  const truth = g.truth.find((t) => t.card === id && !t.drawnBy);
  if (truth) truth.drawnBy = who;
  const t = typeOf(g, id);
  if (t === 'bomb') {
    g.limbo = id;
    g.drawn = { by: who, card: id, ownTurn: true };
    log(g, now, { kind: 'drew-bomb', by: who, cards: ['bomb'], from });
    const hasDefuse = g.hands[who]!.some((c) => typeOf(g, c) === 'defuse');
    if (hasDefuse) return setStage(state, 'bomb', now);
    return explode(state, who, id, now);
  }
  if (t === 'void') {
    if (g.voidUp) {
      g.limbo = id;
      log(g, now, { kind: 'drew-bomb', by: who, cards: ['void'], from });
      return explode(state, who, id, now);
    }
    g.voidUp = true;
    g.limbo = id;
    g.placing = { by: who, card: id, kind: 'void', ownTurn: true };
    log(g, now, { kind: 'void-up', by: who, from });
    return setStage(state, 'place', now);
  }
  g.hands[who]!.push(id);
  log(g, now, { kind: 'draw', by: who, from });
  endOneTurn(state, now);
}

// ---- Lobby ----

function requireHost(ctx: Ctx): GameError | null {
  return ctx.isHost ? null : err('not-host', 'Only the host can do that.');
}

function fillSeats(state: S): S {
  if (state.phase === 'playing') return state;
  let free = MAX_SEATS - seated(state).length;
  if (free <= 0) return state;
  const seats = { ...state.seats };
  for (const [id, s] of Object.entries(seats)) {
    if (free <= 0) break;
    if (!s.playing) {
      seats[id] = { ...s, playing: true };
      free -= 1;
    }
  }
  return { ...state, seats };
}

function updateSettings(
  state: S,
  action: Extract<ShortFuseAction, { type: 'update-settings' }>,
  ctx: Ctx,
): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'playing')
    return err('in-progress', 'Settings can only change between games.');
  const s: Settings = { ...state.settings };
  if (action.preset === 'classic') Object.assign(s, { core: 'classic', art: 'classic' });
  if (action.preset === 'adult') Object.assign(s, { core: 'classic', art: 'adult' });
  if (action.preset === 'party') Object.assign(s, { core: 'party', art: 'classic' });
  for (const k of [
    'core',
    'art',
    'x1',
    'faster',
    'fiveCombo',
    'nonStacking',
    'nopeSeconds',
    'decisionSeconds',
    'strict',
  ] as const) {
    if (action[k] !== undefined) (s as unknown as Record<string, unknown>)[k] = action[k];
  }
  return { ...state, settings: s };
}

function sit(state: S, playing: boolean, ctx: Ctx): Result {
  if (state.phase === 'playing') return err('in-progress', 'Seats change between games.');
  const me = state.seats[ctx.by];
  if (!me) return err('no-seat', 'Join the room first.');
  if (playing && !me.playing && seated(state).length >= MAX_SEATS)
    return err('full', `The table is full (${MAX_SEATS} players).`);
  return { ...state, seats: { ...state.seats, [ctx.by]: { ...me, playing } } };
}

function rigAction(state: S, action: Extract<ShortFuseAction, { type: 'rig' }>, ctx: Ctx): Result {
  if (!rigEnabled) return err('no-rig', 'Not available here.');
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'playing') return err('in-progress', 'Between games only.');
  return { ...state, rig: { hands: action.hands, top: action.top, first: action.first } };
}

function newGame(state: S, ctx: CreateCtx): S {
  const players = seated(state);
  const n = players.length;
  const s = state.settings;
  const dealt = deal(s, n, ctx.rng);
  const g: Game = {
    players,
    names: Object.fromEntries(players.map((p) => [p, state.seats[p]!.name])),
    core: s.core,
    art: s.art,
    x1: s.x1,
    fiveCombo: s.fiveCombo,
    nonStacking: s.nonStacking,
    cards: dealt.cards,
    pile: dealt.pile,
    discard: [],
    hands: Object.fromEntries(players.map((p, i) => [p, dealt.hands[i]!])),
    front: Object.fromEntries(players.map((p) => [p, []])),
    out: dealt.out,
    limbo: null,
    voidUp: false,
    bombsOut: dealt.bombs,
    dead: [],
    left: [],
    turn: { player: players[0]!, owed: 1, chained: false, dir: 1, n: 0, plays: 0 },
    pending: null,
    window: null,
    drawn: null,
    placing: null,
    favor: null,
    alter: null,
    beat: null,
    decisionAt: ctx.now,
    pileVersion: 0,
    seq: 0,
    memory: {},
    log: [],
    truth: [],
    nudges: {},
    winner: null,
    seed: newSeed(ctx.rng),
    stats: { maxOwed: 1, maxOwedBy: null, longestChain: 0, draws: 0 },
  };
  let first = ctx.rng.int(n);
  if (state.rig) {
    applyRig(g, state.rig, ctx.rng);
    first = Math.min(state.rig.first, n - 1);
  }
  const next: S = { ...state, phase: 'playing', game: g, rig: null };
  log(g, ctx.now, { kind: 'start', n });
  startTurn(next, players[first]!, 1, false, ctx.now);
  g.stats.maxOwed = 1;
  g.stats.maxOwedBy = null;
  return next;
}

/** Rebuilds the deal to the rig: rigged seats get exactly their cards, the pile its top cards. */
function applyRig(g: Game, rig: S['rig'] & object, rng: Rng) {
  const pool = [...g.players.flatMap((p) => g.hands[p]!), ...g.pile];
  const take = (t: CardType): CardId => {
    const i = pool.findIndex((id) => g.cards[id]!.t === t);
    if (i >= 0) return pool.splice(i, 1)[0]!;
    let id = `rig${Object.keys(g.cards).length}`;
    while (g.cards[id]) id += 'x';
    g.cards[id] = { t, face: 0 };
    return id;
  };
  const hands: CardId[][] = g.players.map((_, i) => (rig.hands[i] ? rig.hands[i].map(take) : []));
  const top = rig.top.map(take);
  g.players.forEach((p, i) => {
    if (!rig.hands[i]) {
      const mine: CardId[] = [];
      const pick = (want: (t: CardType) => boolean) => {
        const j = pool.findIndex((id) => want(g.cards[id]!.t));
        if (j >= 0) mine.push(pool.splice(j, 1)[0]!);
      };
      pick((t) => t === 'defuse');
      for (let k = 0; k < 7; k++) pick((t) => !isBombCard(t));
      hands[i] = mine;
    }
    g.hands[p] = hands[i]!;
  });
  g.pile = [...top, ...rng.shuffle(pool)];
  g.bombsOut = g.pile.filter((id) => g.cards[id]!.t === 'bomb').length;
}

function start(state: S, ctx: Ctx): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'playing') return err('in-progress', 'A game is already going.');
  const n = seated(state).length;
  if (n < MIN_PLAYERS) return err('too-few', `Short Fuse needs at least ${MIN_PLAYERS} players.`);
  return newGame(state, ctx);
}

// ---- Playing cards ----

function requireGame(state: S): GameError | null {
  return state.phase === 'playing' && state.game ? null : err('not-playing', 'No game in play.');
}

function inGame(g: Game, by: PlayerId): GameError | null {
  if (!g.players.includes(by)) return err('not-seated', 'You’re watching this game.');
  if (isOut(g, by)) return err('out', 'You’re out of this game: you can only watch.');
  return null;
}

function waitWindow(state: S): GameError | null {
  if (state.stage === 'window') return err('window', 'Wait: the table can still Nope that play.');
  if (state.stage === 'beat') return err('beat', 'Wait a moment…');
  return null;
}

function playAction(
  state: S,
  action: Extract<ShortFuseAction, { type: 'play' }>,
  ctx: Ctx,
): Result {
  const e = requireGame(state);
  if (e) return e;
  const g = state.game!;
  const e2 = inGame(g, ctx.by) ?? waitWindow(state);
  if (e2) return e2;
  if (g.turn.player !== ctx.by)
    return err('not-your-turn', `It’s ${nameOf(g, g.turn.player)}’s turn.`);
  if (state.stage !== 'turn') return err('busy', 'Finish what you’re doing first.');
  const hand = g.hands[ctx.by]!;
  const ids = action.cards;
  if (new Set(ids).size !== ids.length || !ids.every((id) => hand.includes(id)))
    return err('not-in-hand', 'You don’t have those cards.');
  const types = ids.map((id) => typeOf(g, id));
  const combo = comboOf(types, g.fiveCombo);
  if ('error' in combo) return err('no-combo', combo.error);
  const t = combo.t;
  let target: PlayerId | null = null;
  let named: CardType | null = null;
  if (combo.kind === 'card') {
    const info = CARDS[t!];
    if (!info.playable) {
      if (t === 'nope') return err('nothing-to-nope', 'Nope answers someone’s play: wait for one.');
      if (t === 'defuse') return err('no-bomb', 'Defuse is only for when you draw a Bomb.');
      return err('cat-alone', 'A cat does nothing on its own: play two matching cats to steal.');
    }
    if (info.targeted) {
      if (!action.target) return err('need-target', 'Choose who to play it on.');
      target = action.target;
      if (target === ctx.by) return err('self', 'Choose another player.');
      if (!alive(g).includes(target)) return err('bad-target', 'They’re not in the game.');
      if (t === 'favor' && !g.hands[target]?.length)
        return err('empty-hand', `${nameOf(g, target)} has no cards to give.`);
    }
  } else if (combo.kind === 'pair' || combo.kind === 'triple') {
    if (!action.target) return err('need-target', 'Choose who to steal from.');
    target = action.target;
    if (target === ctx.by) return err('self', 'Choose another player.');
    if (!targetable(g, ctx.by).includes(target))
      return err('empty-hand', `${nameOf(g, target)} has no cards to take.`);
    if (combo.kind === 'triple') {
      if (!action.named) return err('need-name', 'Name the card you want.');
      if (!NAMEABLE.includes(action.named))
        return err('bad-name', 'Name a card someone could hold.');
      named = action.named;
    }
  }
  for (const id of ids) takeFromHand(g, ctx.by, id);
  g.discard.push(...ids);
  g.seq += 1;
  const pending: Pending = {
    id: g.seq,
    by: ctx.by,
    kind: combo.kind,
    t,
    cards: ids,
    target,
    named,
  };
  g.pending = pending;
  g.window = {
    id: pending.id,
    endsAt: ctx.now + state.settings.nopeSeconds * 1000,
    lastAt: ctx.now,
    chain: [],
  };
  g.turn.plays += 1;
  log(g, ctx.now, {
    kind: 'play',
    by: ctx.by,
    cards: types,
    play: combo.kind,
    ...(target ? { target } : {}),
    ...(named ? { named } : {}),
  });
  state.stage = 'window';
  return state;
}

function nopeAction(state: S, windowId: number, ctx: Ctx): Result {
  const e = requireGame(state);
  if (e) return e;
  const g = state.game!;
  const e2 = inGame(g, ctx.by);
  if (e2) return e2;
  const nope = g.hands[ctx.by]!.find((id) => typeOf(g, id) === 'nope');
  if (!nope) return err('no-nope', 'You don’t have a Nope.');
  const w = g.window;
  if (state.stage !== 'window' || !w || w.id !== windowId || ctx.now >= w.endsAt)
    return err('too-late', 'Too late: that already happened. Your Nope is still in your hand.');
  if (w.chain.length > 0 && ctx.now - w.lastAt < NOPE_COOLDOWN_MS)
    return err(
      'too-soon',
      'Someone Noped a split second before you; your Nope is still in your hand.',
    );
  const last = w.chain.at(-1)?.by ?? g.pending!.by;
  if (last === ctx.by)
    return err('own', w.chain.length ? 'That’s your own Nope.' : 'You can’t Nope your own play.');
  takeFromHand(g, ctx.by, nope);
  g.discard.push(nope);
  w.chain.push({ by: ctx.by, card: nope });
  w.lastAt = ctx.now;
  w.endsAt = ctx.now + state.settings.nopeSeconds * 1000;
  g.stats.longestChain = Math.max(g.stats.longestChain, w.chain.length);
  log(g, ctx.now, { kind: 'nope', by: ctx.by, n: w.chain.length });
  return state;
}

/** The window ran out: the play goes ahead (even Nopes) or is cancelled (odd). */
function resolveWindow(state: S, now: number, rng: Rng) {
  const g = state.game!;
  const p = g.pending!;
  const w = g.window!;
  g.pending = null;
  g.window = null;
  if (w.chain.length % 2 === 1) {
    log(g, now, {
      kind: 'cancelled',
      by: p.by,
      play: p.kind,
      ...(p.t ? { cards: [p.t] } : {}),
      n: w.chain.length,
    });
    return backToTurn(state, now);
  }
  if (w.chain.length > 0) log(g, now, { kind: 'resolved', by: p.by, n: w.chain.length });
  if (isOut(g, p.by)) return backToTurn(state, now);
  resolvePlay(state, p, now, rng);
}

function attack(state: S, by: PlayerId, victim: PlayerId, now: number) {
  const g = state.game!;
  const t = g.turn;
  const owed = g.nonStacking ? 2 : (t.chained ? t.owed : 0) + 2;
  log(g, now, { kind: 'attacked', by, target: victim, n: owed });
  startTurn(state, victim, owed, true, now);
}

function resolvePlay(state: S, p: Pending, now: number, rng: Rng) {
  const g = state.game!;
  const targetIn = p.target !== null && alive(g).includes(p.target);
  if (p.kind === 'card') {
    switch (p.t) {
      case 'attack':
        return attack(state, p.by, nextAlive(g, p.by, g.turn.dir), now);
      case 'aim':
        return attack(state, p.by, targetIn ? p.target! : nextAlive(g, p.by, g.turn.dir), now);
      case 'skip':
        return endOneTurn(state, now);
      case 'reverse':
        if (alive(g).length > 2) g.turn.dir = g.turn.dir === 1 ? -1 : 1;
        log(g, now, { kind: 'reverse', by: p.by });
        return endOneTurn(state, now);
      case 'favor':
        if (!targetIn || !g.hands[p.target!]!.length) {
          log(g, now, { kind: 'favor', by: p.target!, target: p.by, n: 0 });
          return backToTurn(state, now);
        }
        g.favor = { from: p.target!, to: p.by };
        return setStage(state, 'favor', now);
      case 'shuffle':
        g.pile = rng.shuffle(g.pile);
        g.pileVersion += 1;
        log(g, now, { kind: 'shuffle', by: p.by });
        return backToTurn(state, now);
      case 'peek3': {
        const k = PEEK_SIZE[p.t] ?? 3;
        remember(g, p.by, {
          kind: 'peek',
          cards: g.pile.slice(0, k).map((id) => card(g, id)),
          version: g.pileVersion,
          turn: g.turn.n,
          at: now,
        });
        return backToTurn(state, now);
      }
      case 'alter3': {
        const k = Math.min(PEEK_SIZE[p.t] ?? 3, g.pile.length);
        if (k === 0) return backToTurn(state, now);
        g.alter = { by: p.by, cards: g.pile.slice(0, k) };
        return setStage(state, 'alter', now);
      }
      case 'bottom':
        return drawCard(state, 'bottom', now);
      default:
        return backToTurn(state, now);
    }
  }
  if (p.kind === 'pair') {
    const hand = targetIn ? g.hands[p.target!]! : [];
    if (!hand.length) {
      log(g, now, { kind: 'steal', by: p.by, target: p.target!, n: 0 });
      return backToTurn(state, now);
    }
    const id = hand[rng.int(hand.length)]!;
    moveCard(g, p.target!, p.by, id);
    remember(g, p.by, {
      kind: 'got',
      card: card(g, id),
      other: p.target!,
      how: 'pair',
      turn: g.turn.n,
      at: now,
    });
    remember(g, p.target!, {
      kind: 'gave',
      card: card(g, id),
      other: p.by,
      how: 'pair',
      turn: g.turn.n,
      at: now,
    });
    log(g, now, { kind: 'steal', by: p.by, target: p.target!, n: 1 });
    return backToTurn(state, now);
  }
  if (p.kind === 'triple') {
    const hand = targetIn ? g.hands[p.target!]! : [];
    const id = hand.find((c) => typeOf(g, c) === p.named);
    if (id) {
      moveCard(g, p.target!, p.by, id);
      remember(g, p.by, {
        kind: 'got',
        card: card(g, id),
        other: p.target!,
        how: 'triple',
        turn: g.turn.n,
        at: now,
      });
      remember(g, p.target!, {
        kind: 'gave',
        card: card(g, id),
        other: p.by,
        how: 'triple',
        turn: g.turn.n,
        at: now,
      });
    }
    log(g, now, { kind: 'ask', by: p.by, target: p.target!, named: p.named!, hit: !!id });
    return backToTurn(state, now);
  }
  // Five different: take any card from the discard pile.
  if (!salvageable(g).length) return backToTurn(state, now);
  return setStage(state, 'salvage', now);
}

const salvageable = (g: Game) => g.discard.filter((id) => !isBombCard(typeOf(g, id)));

function drawAction(state: S, ctx: Ctx): Result {
  const e = requireGame(state);
  if (e) return e;
  const g = state.game!;
  const e2 = inGame(g, ctx.by) ?? waitWindow(state);
  if (e2) return e2;
  if (g.turn.player !== ctx.by)
    return err('not-your-turn', `It’s ${nameOf(g, g.turn.player)}’s turn.`);
  if (state.stage !== 'turn') return err('busy', 'Finish what you’re doing first.');
  drawCard(state, 'top', ctx.now);
  return state;
}

function give(state: S, from: PlayerId, id: CardId, now: number) {
  const g = state.game!;
  const f = g.favor!;
  moveCard(g, from, f.to, id);
  remember(g, f.to, {
    kind: 'got',
    card: card(g, id),
    other: from,
    how: 'favor',
    turn: g.turn.n,
    at: now,
  });
  remember(g, from, {
    kind: 'gave',
    card: card(g, id),
    other: f.to,
    how: 'favor',
    turn: g.turn.n,
    at: now,
  });
  log(g, now, { kind: 'favor', by: from, target: f.to, n: 1 });
  g.favor = null;
  backToTurn(state, now);
}

function giveAction(state: S, id: CardId, ctx: Ctx): Result {
  const e = requireGame(state);
  if (e) return e;
  const g = state.game!;
  if (state.stage !== 'favor' || g.favor?.from !== ctx.by)
    return err('not-asked', 'Nobody is asking you for a card.');
  if (!g.hands[ctx.by]!.includes(id)) return err('not-in-hand', 'You don’t have that card.');
  give(state, ctx.by, id, ctx.now);
  return state;
}

function reorder(state: S, order: number[], now: number) {
  const g = state.game!;
  const a = g.alter!;
  const cards = order.map((i) => a.cards[i]!);
  g.pile.splice(0, cards.length, ...cards);
  g.pileVersion += 1;
  remember(g, a.by, {
    kind: 'altered',
    cards: cards.map((id) => card(g, id)),
    version: g.pileVersion,
    turn: g.turn.n,
    at: now,
  });
  g.alter = null;
  backToTurn(state, now);
}

function orderAction(state: S, order: number[], ctx: Ctx): Result {
  const e = requireGame(state);
  if (e) return e;
  const g = state.game!;
  if (state.stage !== 'alter' || g.alter?.by !== ctx.by)
    return err('not-altering', 'You’re not rearranging the pile.');
  const k = g.alter.cards.length;
  if (order.length !== k || new Set(order).size !== k || order.some((i) => i >= k))
    return err('bad-order', 'Put every card back exactly once.');
  reorder(state, order, ctx.now);
  return state;
}

function salvage(state: S, id: CardId, now: number) {
  const g = state.game!;
  g.discard.splice(g.discard.indexOf(id), 1);
  g.hands[g.turn.player]!.push(id);
  log(g, now, { kind: 'salvage', by: g.turn.player, cards: [typeOf(g, id)] });
  backToTurn(state, now);
}

function salvageAction(state: S, id: CardId, ctx: Ctx): Result {
  const e = requireGame(state);
  if (e) return e;
  const g = state.game!;
  if (state.stage !== 'salvage' || g.turn.player !== ctx.by)
    return err('not-salvaging', 'You’re not picking from the discard pile.');
  if (!salvageable(g).includes(id)) return err('bad-card', 'Pick a card from the discard pile.');
  salvage(state, id, ctx.now);
  return state;
}

function defuse(state: S, now: number) {
  const g = state.game!;
  const d = g.drawn!;
  const def = g.hands[d.by]!.find((id) => typeOf(g, id) === 'defuse')!;
  takeFromHand(g, d.by, def);
  g.discard.push(def);
  g.placing = { by: d.by, card: d.card, kind: 'bomb', ownTurn: d.ownTurn };
  g.drawn = null;
  log(g, now, { kind: 'defuse', by: d.by });
  setStage(state, 'place', now);
}

function defuseAction(state: S, ctx: Ctx): Result {
  const e = requireGame(state);
  if (e) return e;
  const g = state.game!;
  if (state.stage !== 'bomb' || g.drawn?.by !== ctx.by)
    return err('no-bomb', 'There’s no Bomb for you to defuse.');
  if (!g.hands[ctx.by]!.some((id) => typeOf(g, id) === 'defuse'))
    return err('no-defuse', 'You have no Defuse.');
  defuse(state, ctx.now);
  return state;
}

function place(state: S, position: number, now: number) {
  const g = state.game!;
  const p = g.placing!;
  const at = Math.max(0, Math.min(position, g.pile.length));
  g.pile.splice(at, 0, p.card);
  g.limbo = null;
  g.pileVersion += 1;
  g.placing = null;
  remember(g, p.by, {
    kind: 'placed',
    t: typeOf(g, p.card),
    position: at,
    of: g.pile.length,
    version: g.pileVersion,
    turn: g.turn.n,
    at: now,
  });
  g.truth.push({
    turn: g.turn.n,
    by: p.by,
    kind: p.kind,
    position: at,
    of: g.pile.length,
    card: p.card,
  });
  if (g.truth.length > MAX_TRUTH) g.truth.splice(0, g.truth.length - MAX_TRUTH);
  log(g, now, { kind: 'placed', by: p.by, cards: [typeOf(g, p.card)] });
  if (p.ownTurn) endOneTurn(state, now);
  else backToTurn(state, now);
}

function placeAction(state: S, position: number, ctx: Ctx): Result {
  const e = requireGame(state);
  if (e) return e;
  const g = state.game!;
  if (state.stage !== 'place' || g.placing?.by !== ctx.by)
    return err('not-placing', 'You’re not hiding anything.');
  if (position > g.pile.length) return err('bad-position', 'Pick a spot in the pile.');
  place(state, position, ctx.now);
  return state;
}

// ---- Defaults: strict timers, the host's Act for and players who leave ----

/** The safe default move for whoever the table waits on. Returns what it did, for the log. */
function actDefault(state: S, who: PlayerId, now: number, rng: Rng): string | null {
  const g = state.game!;
  switch (state.stage) {
    case 'turn':
      if (g.turn.player !== who) return null;
      drawCard(state, 'top', now);
      return 'drew a card';
    case 'favor': {
      if (g.favor?.from !== who) return null;
      const hand = g.hands[who]!;
      give(state, who, hand[rng.int(hand.length)]!, now);
      return 'gave a random card';
    }
    case 'alter':
      if (g.alter?.by !== who) return null;
      reorder(
        state,
        g.alter.cards.map((_, i) => i),
        now,
      );
      return 'kept the order';
    case 'salvage': {
      const options = salvageable(g);
      salvage(state, options[rng.int(options.length)]!, now);
      return 'took a random card';
    }
    case 'bomb':
      if (g.drawn?.by !== who) return null;
      defuse(state, now);
      return 'used a Defuse';
    case 'place':
      if (g.placing?.by !== who) return null;
      place(state, rng.int(g.pile.length + 1), now);
      return 'hid it at random';
    default:
      return null;
  }
}

function actForAction(state: S, player: PlayerId, ctx: Ctx): Result {
  const e = requireHost(ctx) ?? requireGame(state);
  if (e) return e;
  if (!awaited(state).includes(player))
    return err('not-waiting', 'The table isn’t waiting on that player.');
  const g = state.game!;
  const did = actDefault(state, player, ctx.now, ctx.rng);
  if (!did) return err('not-waiting', 'The table isn’t waiting on that player.');
  log(g, ctx.now, { kind: 'act-for', by: ctx.by, target: player, did });
  return state;
}

function nudgeAction(state: S, player: PlayerId, ctx: Ctx): Result {
  const e = requireGame(state);
  if (e) return e;
  const g = state.game!;
  if (player === ctx.by) return err('self', 'You can’t nudge yourself.');
  if (!awaited(state).includes(player))
    return err('not-waiting', 'The table isn’t waiting on that player.');
  const last = g.nudges[player];
  if (last !== undefined && ctx.now - last < NUDGE_MS)
    return err('too-soon', `${nameOf(g, player)} was just nudged.`);
  g.nudges[player] = ctx.now;
  return state;
}

// ---- The definition's entry points ----

function reduce(state: S, action: ShortFuseAction, ctx: Ctx): Result {
  const draft = draftOf(state);
  switch (action.type) {
    case 'update-settings':
      return updateSettings(state, action, ctx);
    case 'sit':
      return sit(state, action.playing, ctx);
    case 'rig':
      return rigAction(state, action, ctx);
    case 'start':
      return start(state, ctx);
    case 'play':
      return playAction(draft, action, ctx);
    case 'draw':
      return drawAction(draft, ctx);
    case 'nope':
      return nopeAction(draft, action.window, ctx);
    case 'give':
      return giveAction(draft, action.card, ctx);
    case 'order':
      return orderAction(draft, action.order, ctx);
    case 'salvage':
      return salvageAction(draft, action.card, ctx);
    case 'defuse':
      return defuseAction(draft, ctx);
    case 'place':
      return placeAction(draft, action.position, ctx);
    case 'nudge':
      return nudgeAction(draft, action.player, ctx);
    case 'act-for':
      return actForAction(draft, action.player, ctx);
    case 'play-again': {
      const e = requireHost(ctx);
      if (e) return e;
      if (state.phase !== 'over') return err('not-over', 'The game isn’t over yet.');
      const n = seated(state).length;
      if (n < MIN_PLAYERS)
        return err('too-few', `Short Fuse needs at least ${MIN_PLAYERS} players.`);
      return newGame(fillSeats(state), ctx);
    }
    case 'back-to-lobby': {
      const e = requireHost(ctx);
      if (e) return e;
      return fillSeats({ ...state, phase: 'lobby', stage: null, game: null });
    }
  }
}

function create(ctx: CreateCtx, players: readonly PlayerInfo[]): S {
  let state: S = {
    phase: 'lobby',
    stage: null,
    settings: { ...DEFAULT_SETTINGS },
    seats: {},
    game: null,
    gamesPlayed: 0,
    rig: null,
    seed: newSeed(ctx.rng),
  };
  for (const p of players) state = playerJoined(state, p);
  return state;
}

function playerJoined(state: S, player: PlayerInfo): S {
  const existing = state.seats[player.id];
  const g = state.game;
  const inGame = !!g?.players.includes(player.id);
  const next: S = {
    ...state,
    seats: {
      ...state.seats,
      [player.id]: existing
        ? { ...existing, name: player.name }
        : {
            name: player.name,
            playing: inGame || (state.phase !== 'playing' && seated(state).length < MAX_SEATS),
          },
    },
  };
  if (g && inGame) next.game = { ...g, names: { ...g.names, [player.id]: player.name } };
  return next;
}

/**
 * Someone left for good. Mid-game they're out as if they had exploded without a Bomb: their hand
 * leaves the game, and whatever the table waited on them for moves on.
 */
function playerLeft(state: S, playerId: PlayerId, now: number): S {
  if (!state.seats[playerId]) return state;
  const seats = { ...state.seats };
  delete seats[playerId];
  let next = fillSeats({ ...state, seats });
  const g0 = next.game;
  if (next.phase !== 'playing' || !g0?.players.includes(playerId) || isOut(g0, playerId))
    return next;
  next = draftOf(next);
  const g = next.game!;
  const rng = hiddenRng(g, now);
  g.left.push(playerId);
  g.out.push(...g.hands[playerId]!);
  g.hands[playerId] = [];
  log(g, now, { kind: 'left', by: playerId });
  if (alive(g).length <= 1) {
    finish(next, now);
    return next;
  }
  if (g.favor?.from === playerId) {
    g.favor = null;
    backToTurn(next, now);
  }
  if (g.turn.player === playerId) {
    if (g.limbo) {
      g.pile.splice(rng.int(g.pile.length + 1), 0, g.limbo);
      g.limbo = null;
    }
    g.pending = null;
    g.window = null;
    g.favor = null;
    g.alter = null;
    g.drawn = null;
    g.placing = null;
    const beat = next.stage === 'beat';
    startTurn(next, nextAlive(g, playerId, g.turn.dir), 1, false, now);
    if (beat) next.stage = 'beat';
  }
  return next;
}

function nextDeadline(state: S): number | null {
  const g = state.game;
  if (state.phase !== 'playing' || !g) return null;
  if (state.stage === 'window') return g.window?.endsAt ?? null;
  if (state.stage === 'beat') return g.beat?.until ?? null;
  const secs = state.settings.decisionSeconds;
  if (!state.settings.strict || !secs || !awaited(state).length) return null;
  return g.decisionAt + secs * 1000;
}

function onDeadline(state: S, now: number): S {
  const due = nextDeadline(state);
  if (due === null || now < due) return state;
  const next = draftOf(state);
  const g = next.game!;
  const rng = hiddenRng(g, now);
  if (next.stage === 'window') {
    resolveWindow(next, now, rng);
    return next;
  }
  if (next.stage === 'beat') {
    g.beat = null;
    setStage(next, 'turn', now);
    return next;
  }
  const who = awaited(next)[0];
  const did = who ? actDefault(next, who, now, rng) : null;
  if (who && did) log(g, now, { kind: 'timeout', by: who, did });
  else g.decisionAt = now;
  return next;
}

// ---- Views ----

const cv = (g: Game, id: CardId): CardView => ({ id, ...g.cards[id]! });

function pileView(g: Game): PileView {
  const voidAt = g.pile.findIndex((id) => g.cards[id]!.t === 'void');
  const count = g.pile.length;
  let voidState: PileView['void'] = 'none';
  if (g.x1) voidState = voidAt < 0 ? 'gone' : g.voidUp ? 'up' : 'hidden';
  let voidEdge: number | null = null;
  const edges = Math.min(count, PILE_EDGES);
  if (voidState === 'up')
    voidEdge = count <= PILE_EDGES ? voidAt : Math.floor((voidAt * PILE_EDGES) / count);
  return {
    count,
    bombsOut: g.bombsOut,
    void: voidState,
    voidEdge,
    voidTop: voidState === 'up' && voidAt === 0,
    edges,
    version: g.pileVersion,
  };
}

function promptFor(state: S, g: Game, viewer: PlayerId): Prompt | null {
  switch (state.stage) {
    case 'turn':
      return g.turn.player === viewer ? { kind: 'turn' } : null;
    case 'favor':
      return g.favor?.from === viewer ? { kind: 'give', to: g.favor.to } : null;
    case 'alter':
      return g.alter?.by === viewer
        ? { kind: 'alter', cards: g.alter.cards.map((id) => cv(g, id)) }
        : null;
    case 'salvage':
      return g.turn.player === viewer
        ? { kind: 'salvage', options: salvageable(g).map((id) => cv(g, id)) }
        : null;
    case 'bomb':
      return g.drawn?.by === viewer
        ? {
            kind: 'bomb',
            card: cv(g, g.drawn.card),
            canDefuse: g.hands[viewer]!.some((id) => g.cards[id]!.t === 'defuse'),
          }
        : null;
    case 'place':
      return g.placing?.by === viewer
        ? {
            kind: 'place',
            card: cv(g, g.placing.card),
            count: g.pile.length,
            void: g.placing.kind === 'void',
          }
        : null;
    default:
      return null;
  }
}

function busyOf(state: S, g: Game): GameView['busy'] {
  switch (state.stage) {
    case 'favor':
      return g.favor ? { who: g.favor.from, what: 'give' } : null;
    case 'alter':
      return g.alter ? { who: g.alter.by, what: 'alter' } : null;
    case 'salvage':
      return { who: g.turn.player, what: 'salvage' };
    case 'bomb':
      return g.drawn ? { who: g.drawn.by, what: 'bomb' } : null;
    case 'place':
      return g.placing ? { who: g.placing.by, what: 'place' } : null;
    default:
      return null;
  }
}

function canNope(state: S, g: Game, viewer: PlayerId | null): boolean {
  const w = g.window;
  if (state.stage !== 'window' || !w || !g.pending || viewer === null) return false;
  if (!g.players.includes(viewer) || isOut(g, viewer)) return false;
  if (!g.hands[viewer]!.some((id) => g.cards[id]!.t === 'nope')) return false;
  return (w.chain.at(-1)?.by ?? g.pending.by) !== viewer;
}

function gameView(state: S, g: Game, viewer: PlayerId | null): GameView {
  const over = state.phase === 'over';
  const mine = viewer !== null && g.players.includes(viewer) && !isOut(g, viewer);
  const secs = state.settings.decisionSeconds;
  const waiting = awaited(state);
  return {
    players: g.players.map((id) => {
      const dead = g.dead.find((d) => d.id === id);
      return {
        id,
        name: state.seats[id]?.name ?? g.names[id] ?? 'Someone',
        hand: g.hands[id]?.length ?? 0,
        dead: !!dead,
        deadTurn: dead?.turn ?? null,
        left: g.left.includes(id),
        front: (g.front[id] ?? []).map((c) => cv(g, c)),
      };
    }),
    core: g.core,
    art: g.art,
    x1: g.x1,
    fiveCombo: g.fiveCombo,
    nonStacking: g.nonStacking,
    types: typesIn(g),
    turn: { ...g.turn },
    pile: pileView(g),
    discard: g.discard.map((id) => cv(g, id)),
    hand: mine ? g.hands[viewer]!.map((id) => cv(g, id)) : null,
    pending: g.pending
      ? {
          by: g.pending.by,
          kind: g.pending.kind,
          t: g.pending.t,
          cards: g.pending.cards.map((id) => cv(g, id)),
          target: g.pending.target,
          named: g.pending.named,
        }
      : null,
    window: g.window
      ? {
          id: g.window.id,
          endsAt: g.window.endsAt,
          seconds: state.settings.nopeSeconds,
          chain: g.window.chain.map((c) => c.by),
          cancelled: g.window.chain.length % 2 === 1,
        }
      : null,
    canNope: canNope(state, g, viewer),
    prompt: viewer !== null && mine && !over ? promptFor(state, g, viewer) : null,
    waiting,
    busy: busyOf(state, g),
    drawnKind:
      state.stage === 'bomb'
        ? 'bomb'
        : state.stage === 'place' && g.placing
          ? g.placing.kind
          : null,
    decisionAt: g.decisionAt,
    decisionEnds: secs && waiting.length ? g.decisionAt + secs * 1000 : null,
    beat: g.beat ? { ...g.beat } : null,
    memory: viewer !== null ? (g.memory[viewer] ?? []).map((m) => ({ ...m })) : [],
    log: g.log.map((e) => ({ ...e })),
    nudges: { ...g.nudges },
    winner: g.winner,
    end: over
      ? {
          winner: g.winner,
          hands: Object.fromEntries(g.players.map((p) => [p, g.hands[p]!.map((id) => cv(g, id))])),
          pile: g.pile.map((id) => cv(g, id)),
          truth: g.truth.map((t) => ({ ...t })),
        }
      : null,
  };
}

function view(state: S, viewer: PlayerId | null): ShortFuseView {
  const seats: SeatView[] = Object.entries(state.seats).map(([id, s]) => ({
    id,
    name: s.name,
    playing: s.playing,
  }));
  const g = state.game;
  return {
    phase: state.phase,
    stage: state.stage,
    settings: { ...state.settings },
    preset: presetOf(state.settings),
    seats,
    me: viewer === null ? null : (seats.find((s) => s.id === viewer) ?? null),
    readout: readout(state.settings, g ? g.players.length : seated(state).length),
    game: g ? gameView(state, g, viewer) : null,
    gamesPlayed: state.gamesPlayed,
    rigged: state.rig !== null,
    rigAllowed: rigEnabled,
  };
}

export const shortFuse: GameDefinition<ShortFuseState, ShortFuseAction, ShortFuseView> = {
  id: 'short-fuse',
  name: 'Short Fuse',
  description:
    'A fast card game of nerve: play cards, then draw one, and hope it isn’t a bomb. Last one standing wins.',
  minPlayers: MIN_PLAYERS,
  maxPlayers: 30,
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
  awards: shortFuseAwards,
  bot: shortFuseBot,
  botInfo: shortFuseBotInfo,
};
