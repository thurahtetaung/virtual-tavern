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
import {
  CARDS,
  type CardType,
  NAMEABLE,
  PEEK_SIZE,
  isBombCard,
  isCat,
  isExplosive,
} from './cards.ts';
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
  type Resume,
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

/** Expansion 4's ghosts: dead, but still at the table with their hand. */
export const isGhost = (g: Pick<Game, 'ghosts'>, p: PlayerId) => (g.ghosts ?? []).includes(p);

/** Still at the table: alive, or a ghost (who may play Nope and NOW cards). */
export const atTable = (g: Pick<Game, 'players' | 'dead' | 'left' | 'ghosts'>, p: PlayerId) =>
  g.players.includes(p) && !g.left.includes(p) && (!isOut(g, p) || isGhost(g, p));

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

/** A Second Life's window (not a pair of Second Life cards played as a combo). */
export const isRevival = (p: Pick<Pending, 'kind' | 't'> | null | undefined) =>
  p?.kind === 'card' && p.t === 'revive';

/** The next seat at the table (alive or a ghost), from `from` in the direction of play. */
function nextSeat(g: Game, from: PlayerId, dir: 1 | -1) {
  const n = g.players.length;
  const i = g.players.indexOf(from);
  for (let k = 1; k <= n; k++) {
    const p = g.players[(((i + dir * k) % n) + n) % n]!;
    if (atTable(g, p)) return p;
  }
  return from;
}

/** The cat group a card belongs to for combos: the wild card matches any cat. */
const title = (t: CardType) => (t === 'wild' ? 'wild' : t);

/**
 * What a set of cards makes when played together, or why it makes nothing. Pairs and triples are
 * cards with the same name; the wild card stands in for any cat (and two wilds pair up). Two Twin
 * Bombs played together bark at a player of your choice instead.
 */
export function comboOf(
  types: CardType[],
  fiveCombo: boolean,
): { kind: PlayKind; t: CardType | null } | { error: string } {
  if (types.length === 1) return { kind: 'card', t: types[0]! };
  if (types.some((t) => t === 'bomb' || t === 'void'))
    return { error: 'A {c:bomb} can’t go into a combo.' };
  if (types.length === 2 && types.every((t) => t === 'twin')) return { kind: 'card', t: 'twin' };
  if (types.length === 2 || types.length === 3) {
    const plain = types.filter((t) => t !== 'wild');
    const kinds = new Set(plain.map(title));
    const kind = types.length === 2 ? 'pair' : 'triple';
    if (plain.length === 0) return { kind, t: 'wild' };
    if (kinds.size === 1) {
      const t = plain[0]!;
      if (plain.length === types.length || isCat(t)) return { kind, t };
      return { error: 'The {c:wild} only stands in for a cat.' };
    }
    return { error: `Those cards don’t match: a combo needs ${types.length} with the same name.` };
  }
  if (types.length === 5) {
    if (!fiveCombo) return { error: 'The five-card combo is off in this game.' };
    if (types.includes('shelter') || types.includes('twin'))
      return { error: 'Five different cards can’t include that card.' };
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
    case 'each':
      return g.each ? g.each.order.filter((p) => !(p in g.each!.chosen)) : [];
    case 'target':
      return g.blindPlay ? [g.blindPlay.by] : [];
    case 'dig':
      return g.dig ? [g.dig.by] : [];
    case 'bomb':
    case 'search':
      return g.drawn ? [g.drawn.by] : [];
    case 'place':
      return g.placing ? [g.placing.by] : [];
    default:
      return [];
  }
}

/** The Stash cards a player can be robbed of (they wear the Vault). */
const stashOf = (g: Game, p: PlayerId) => (g.vaultBy === p ? g.stash.length : 0);

/** Players who can be asked for a card (Favor, pairs, triples): still in, with cards to take. */
export function targetable(g: Game, by: PlayerId): PlayerId[] {
  return alive(g).filter((p) => p !== by && ((g.hands[p]?.length ?? 0) > 0 || stashOf(g, p) > 0));
}

/** Who a single targeted card may be played on. */
export function targetsFor(g: Game, by: PlayerId, t: CardType): PlayerId[] {
  const others = alive(g).filter((p) => p !== by);
  if (t === 'favor') return targetable(g, by);
  if (t === 'mark') return others.filter((p) => (g.hands[p]?.length ?? 0) > 0);
  if (t === 'mine') return others.filter((p) => !g.mine[p]);
  // Feed the Ghosts goes to a ghost (a ghost may feed themself).
  if (t === 'feed') return g.ghosts.filter((p) => atTable(g, p));
  return others;
}

/**
 * What a Copy played by `by` right now becomes: the card on top of the discard pile. Not another
 * Copy, not a card that can't be played on its own, and a cat only if `by` played it this turn
 * (so it can make a pair). A Second Life is copied only to answer a bomb.
 */
export function copyTarget(g: Game, by: PlayerId): { t: CardType } | { error: string } {
  const top = g.discard.at(-1);
  if (!top)
    return { error: 'A {c:copy} becomes the top card of the discard pile, and it’s empty.' };
  const t = g.cards[top]!.t;
  if (t === 'copy') return { error: 'A {c:copy} can’t copy another {c:copy}.' };
  if (isCat(t) || t === 'wild') {
    const lp = g.lastPlay;
    if (lp?.by === by && lp.turn === g.turn.n && lp.cards.includes(top)) return { t };
    return { error: 'A {c:copy} only pairs with a cat you played yourself this turn.' };
  }
  if (t === 'revive')
    return { error: 'A {c:copy} of a {c:revive} only saves you when you draw a {c:bomb}.' };
  if (!CARDS[t].playable || t === 'twin' || t === 'vault')
    return { error: 'The top of the discard pile can’t be copied as a play.' };
  return { t };
}

export const DEFAULT_SETTINGS: Settings = {
  core: 'classic',
  art: 'classic',
  x1: false,
  x2: false,
  x3: false,
  x4: false,
  faster: false,
  fiveCombo: false,
  nonStacking: false,
  nopeSeconds: NOPE_SECONDS.default,
  decisionSeconds: DEFAULT_DECISION_SECONDS,
  strict: false,
};

export function presetOf(
  s: Pick<Settings, 'core' | 'art'> & Partial<Pick<Settings, 'x1' | 'x2' | 'x3' | 'x4'>>,
): Preset {
  if (s.core === 'classic' && s.x1 && s.x2 && s.x3 && s.x4) return 'chaos';
  if (s.core === 'classic' && s.x4 && !s.x1 && !s.x2 && !s.x3) return 'zombie';
  if (s.core === 'party') return s.art === 'classic' ? 'party' : 'custom';
  return s.art === 'adult' ? 'adult' : 'classic';
}

/** Card types in a game with these settings (for the Three of a Kind picker and the glossary). */
export function typesIn(
  s: Pick<Settings, 'core' | 'x1' | 'x2' | 'x3'> & { x4?: boolean },
): CardType[] {
  return (Object.keys(CARDS) as CardType[]).filter((t) => {
    const set = CARDS[t].set;
    if (t === 'superskip') return s.x2 || s.x3 || !!s.x4;
    if (set === 'x1') return s.x1 || (s.core === 'party' && t !== 'void' && t !== 'reverse');
    if (set === 'x2') return s.x2;
    if (set === 'x3') return s.x3;
    if (set === 'x4') return !!s.x4;
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
  normalize(copy.game);
  return copy;
}

/** Games saved before the later expansions lack their fields. */
function normalize(g: Game) {
  g.x2 ??= false;
  g.x3 ??= false;
  g.x4 ??= false;
  g.ghosts ??= [];
  g.revival ??= null;
  g.dig ??= null;
  g.toPlace ??= [];
  g.watchers ??= [];
  g.lastPlay ??= null;
  g.each ??= null;
  g.blindPlay ??= null;
  g.resume ??= 'turn';
  g.held ??= {};
  g.marked ??= {};
  g.blind ??= {};
  g.stash ??= [];
  g.vaultBy ??= null;
  g.mine ??= {};
  g.knownTop ??= 0;
}

const newSeed = (rng: Rng) => rng.int(2 ** 32);

/** Randomness for deadlines, from the hidden seed (which then moves on, so nothing replays). */
function hiddenRng(g: Game, now: number): Rng {
  const rng = createRng((g.seed ^ now ^ Math.imul(g.seq + 1, 2654435761)) >>> 0);
  g.seed = rng.int(2 ** 32);
  return rng;
}

/** The randomness of the move being made (the action's own, or the hidden one for deadlines). */
let rand: Rng = createRng(1);

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
const has = (g: Game, who: PlayerId, t: CardType) =>
  (g.hands[who] ?? []).some((c) => typeOf(g, c) === t);

function setStage(state: S, stage: Stage, now: number) {
  state.stage = stage;
  state.game!.decisionAt = now;
}

/** A card leaves a hand: it's no longer marked or held, and a Shelter takes its protection with it. */
function leaveHand(g: Game, who: PlayerId, id: CardId) {
  const hand = g.hands[who]!;
  const i = hand.indexOf(id);
  if (i >= 0) hand.splice(i, 1);
  if (g.marked[who] === id) g.marked[who] = null;
  if (g.held[who] === id) g.held[who] = null;
  if (typeOf(g, id) === 'shelter' && !has(g, who, 'shelter')) g.held[who] = null;
}

/** A card joins a hand; a blindfolded hand is shuffled, so its owner can't track it. */
function enterHand(g: Game, who: PlayerId, id: CardId) {
  g.hands[who]!.push(id);
  if (g.blind[who]) g.hands[who] = rand.shuffle(g.hands[who]!);
}

function moveCard(g: Game, from: PlayerId, to: PlayerId, id: CardId) {
  leaveHand(g, from, id);
  enterHand(g, to, id);
}

/** Anything that reorders the pile: old peeks go stale and nothing is known about its top. */
function pileChanged(g: Game) {
  g.pileVersion += 1;
  g.knownTop = 0;
}

// ---- Turns ----

/** A fresh turn for `player`. */
function startTurn(state: S, player: PlayerId, owed: number, chained: boolean, now: number) {
  const g = state.game!;
  g.turn = { player, owed, chained, dir: g.turn.dir, n: g.turn.n + 1, plays: 0 };
  noteOwed(g);
  setStage(state, 'turn', now);
}

function noteOwed(g: Game) {
  if (g.turn.owed > g.stats.maxOwed) {
    g.stats.maxOwed = g.turn.owed;
    g.stats.maxOwedBy = g.turn.player;
  }
}

/** Ends one of the current player's owed turns; the last one passes play on. */
function endOneTurn(state: S, now: number) {
  const g = state.game!;
  const t = g.turn;
  if (t.owed > 1) startTurn(state, t.player, t.owed - 1, t.chained, now);
  else startTurn(state, nextAlive(g, t.player, t.dir), 1, false, now);
}

/**
 * Carries on after a move. First any Bomb that ended up in someone's hand unprotected (stolen,
 * given, or left behind by a Bomb Shelter) goes off on them; once nobody's is, play resumes:
 * back to the turn, or one turn ends.
 */
function settle(state: S, now: number, resume?: Resume) {
  const g = state.game!;
  if (resume) g.resume = resume;
  if (state.phase !== 'playing') return;
  const order = [g.turn.player, ...alive(g).filter((p) => p !== g.turn.player)];
  for (const p of order) {
    if (isOut(g, p)) continue;
    const loose = g.hands[p]!.find((c) => isExplosive(typeOf(g, c)) && g.held[p] !== c);
    if (loose) return bombGoesOff(state, p, loose, now);
  }
  if (g.resume === 'endturn') {
    g.resume = 'turn';
    return endOneTurn(state, now);
  }
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
  g.each = null;
  g.blindPlay = null;
  g.placing = null;
  g.drawn = null;
  g.beat = null;
  g.revival = null;
  g.dig = null;
  g.watchers = [];
  if (g.limbo) {
    g.pile.unshift(g.limbo);
    g.limbo = null;
  }
  for (const pl of g.toPlace.splice(0)) g.pile.unshift(pl.card);
  if (g.winner) log(g, now, { kind: 'win', by: g.winner });
  state.phase = 'over';
  state.stage = null;
  state.gamesPlayed += 1;
}

/** Leaves the game: hand, Stash and anything in front of them go out of play. */
function clearPlayer(g: Game, who: PlayerId) {
  g.out.push(...(g.hands[who] ?? []));
  g.hands[who] = [];
  if (g.vaultBy === who) {
    g.out.push(...g.stash);
    g.stash = [];
  }
  const mine = g.mine[who];
  if (mine) {
    g.discard.push(mine.card);
    g.mine[who] = null;
  }
  g.held[who] = null;
  g.marked[who] = null;
  g.blind[who] = false;
}

/**
 * `who` explodes: the Bomb goes face up in front of them, their hand out of the game. With the
 * fourth expansion they stay as a ghost instead: they keep their hand (and any Vault), take no
 * more turns, and anything else face up in front of them is discarded. A Twin Bomb's death keeps
 * both twins in front of them, to go back in if they're brought back.
 */
function explode(state: S, who: PlayerId, bomb: CardId, now: number) {
  const g = state.game!;
  if (g.limbo === bomb) g.limbo = null;
  const t = typeOf(g, bomb);
  if (g.x4) {
    g.discard.push(...(g.front[who] ?? []));
    g.front[who] = [bomb];
    if (t === 'twin') {
      const i = g.discard.findLastIndex((c) => c !== bomb && typeOf(g, c) === 'twin');
      if (i >= 0) g.front[who].push(...g.discard.splice(i, 1));
    }
    const mine = g.mine[who];
    if (mine) {
      g.discard.push(mine.card);
      g.mine[who] = null;
    }
    g.ghosts.push(who);
  } else {
    (g.front[who] ??= []).push(bomb);
    clearPlayer(g, who);
  }
  if (t === 'bomb') g.bombsOut = Math.max(0, g.bombsOut - 1);
  g.dead.push({ id: who, turn: g.turn.n });
  g.drawn = null;
  g.placing = null;
  log(g, now, { kind: 'explode', by: who, cards: [t], ...(g.x4 ? { ghost: true } : {}) });
  if (alive(g).length <= 1) return finish(state, now);
  // Any turns they still owed vanish; the next player takes a normal turn after the moment.
  if (g.turn.player === who) {
    startTurn(state, nextAlive(g, who, g.turn.dir), 1, false, now);
    g.resume = 'turn';
  }
  g.beat = { kind: 'explode', who, until: now + BEAT_MS };
  state.stage = 'beat';
}

/**
 * A Bomb someone must answer: they've drawn it, received it, lost their Shelter, or a Twin Bomb
 * barked at them. With a Defuse (or, blindfolded, by turning cards over looking for one) they
 * survive; otherwise they explode.
 */
function confront(state: S, who: PlayerId, id: CardId, now: number, twin = false) {
  const g = state.game!;
  g.drawn = { by: who, card: id, twin };
  if (g.blind[who]) {
    if (!g.hands[who]!.length) return explode(state, who, id, now);
    return setStage(state, 'search', now);
  }
  if (has(g, who, 'defuse') || reviveOptions(g, who)) return setStage(state, 'bomb', now);
  return explode(state, who, id, now);
}

/**
 * The Second Life that could answer the bomb `who` faces: one in hand (blindfolded, only the one
 * their search turned over), or a Copy of the Second Life on top of the discard pile (on their
 * own turn, eyes open). Never against a face-up Black Hole.
 */
function reviveOptions(
  g: Game,
  who: PlayerId,
): { card: CardId | null; copy: CardId | null } | null {
  const d = g.drawn;
  if (!d || d.by !== who || (typeOf(g, d.card) === 'void' && g.voidUp)) return null;
  const hand = g.hands[who]!;
  const blind = !!g.blind[who];
  const card = blind ? (d.found ?? null) : (hand.find((c) => typeOf(g, c) === 'revive') ?? null);
  const top = g.discard.at(-1);
  const copy =
    !blind && g.turn.player === who && top && typeOf(g, top) === 'revive'
      ? (hand.find((c) => typeOf(g, c) === 'copy') ?? null)
      : null;
  return card || copy ? { card, copy } : null;
}

/** A Bomb in someone's hand they aren't allowed to keep goes off, shown to everyone. */
function bombGoesOff(state: S, who: PlayerId, id: CardId, now: number) {
  const g = state.game!;
  leaveHand(g, who, id);
  g.limbo = id;
  // Taken (a pair) or given (a Favor) just now: it came from someone else's hand.
  const last = g.log.at(-1);
  const received =
    (last?.kind === 'steal' && last.by === who) || (last?.kind === 'favor' && last.target === who);
  log(g, now, {
    kind: received ? 'received-bomb' : 'unprotected',
    by: who,
    cards: [typeOf(g, id)],
  });
  confront(state, who, id, now);
}

/** A safe draw cures a blindfold. */
function cure(g: Game, who: PlayerId, now: number) {
  if (!g.blind[who]) return;
  g.blind[who] = false;
  log(g, now, { kind: 'cured', by: who });
}

/**
 * Draws for the current player (top, bottom, to bury, or the second card for Look Twice) and
 * deals with what comes up.
 */
function drawCard(state: S, from: 'top' | 'bottom' | 'bury' | 'second', now: number) {
  const g = state.game!;
  const who = g.turn.player;
  g.resume = 'endturn';
  if (g.pile.length === 0) {
    log(g, now, { kind: 'empty', by: who });
    return settle(state, now);
  }
  const second = from === 'second' && g.pile.length > 1;
  const id = from === 'bottom' ? g.pile.pop()! : second ? g.pile.splice(1, 1)[0]! : g.pile.shift()!;
  if (from !== 'bottom' && g.knownTop > (second ? 1 : 0)) g.knownTop -= 1;
  g.stats.draws += 1;
  const truth = g.truth.find((t) => t.card === id && !t.drawnBy);
  if (truth) truth.drawnBy = who;
  const t = typeOf(g, id);
  const side = from === 'bottom' ? 'bottom' : 'top';
  // Bury: look at it and put it back anywhere; a Bomb drawn this way just goes back.
  if (from === 'bury') {
    g.limbo = id;
    g.placing = { by: who, card: id, kind: 'bury' };
    log(g, now, { kind: 'bury', by: who });
    cure(g, who, now);
    return setStage(state, 'place', now);
  }
  // A Mine! in front of the drawer: the card goes to whoever placed it.
  const mine = g.mine[who];
  if (mine) {
    g.mine[who] = null;
    g.discard.push(mine.card);
    cure(g, who, now);
    return mineTakes(state, mine.by, who, id, side, now);
  }
  if (t === 'bomb') {
    // A Bomb Shelter keeps one Bomb safely (and secretly) in hand.
    if (!g.blind[who] && has(g, who, 'shelter') && !g.held[who]) {
      g.hands[who]!.push(id);
      g.held[who] = id;
      remember(g, who, { kind: 'held', card: card(g, id), turn: g.turn.n, at: now });
      log(g, now, { kind: 'draw', by: who, from: side });
      return settle(state, now);
    }
    g.limbo = id;
    log(g, now, { kind: 'drew-bomb', by: who, cards: ['bomb'], from: side });
    return confront(state, who, id, now);
  }
  if (t === 'void') return drawVoid(state, who, id, side, now);
  enterHand(g, who, id);
  log(g, now, { kind: 'draw', by: who, from: side });
  cure(g, who, now);
  settle(state, now);
}

/** The Black Hole: face down, it goes back face up; face up, nothing can save you. */
function drawVoid(state: S, who: PlayerId, id: CardId, from: 'top' | 'bottom', now: number) {
  const g = state.game!;
  g.limbo = id;
  if (g.voidUp) {
    log(g, now, { kind: 'drew-bomb', by: who, cards: ['void'], from });
    return explode(state, who, id, now);
  }
  g.voidUp = true;
  g.placing = { by: who, card: id, kind: 'void' };
  log(g, now, { kind: 'void-up', by: who, from });
  setStage(state, 'place', now);
}

/** Mine!: the drawer's card goes to the player who placed it (who deals with any Bomb). */
function mineTakes(
  state: S,
  by: PlayerId,
  drawer: PlayerId,
  id: CardId,
  from: 'top' | 'bottom',
  now: number,
) {
  const g = state.game!;
  const t = typeOf(g, id);
  if (isOut(g, by)) {
    // The placer is gone: the drawer simply keeps what they drew.
    if (t === 'bomb') {
      g.limbo = id;
      log(g, now, { kind: 'drew-bomb', by: drawer, cards: ['bomb'], from });
      return confront(state, drawer, id, now);
    }
    if (t === 'void') return drawVoid(state, drawer, id, from, now);
    enterHand(g, drawer, id);
    log(g, now, { kind: 'draw', by: drawer, from });
    return settle(state, now);
  }
  log(g, now, {
    kind: 'mine-took',
    by,
    target: drawer,
    ...(isExplosive(t) ? { cards: [t] } : {}),
  });
  if (t === 'bomb') {
    g.limbo = id;
    return confront(state, by, id, now);
  }
  if (t === 'void') return drawVoid(state, by, id, from, now);
  enterHand(g, by, id);
  remember(g, by, {
    kind: 'got',
    card: card(g, id),
    other: drawer,
    how: 'mine',
    turn: g.turn.n,
    at: now,
  });
  settle(state, now);
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
  const s: Settings = { ...DEFAULT_SETTINGS, ...state.settings };
  const none = { x1: false, x2: false, x3: false, x4: false };
  // Leaving the Chaos or Zombie deck for a plain one takes their expansions with it.
  const was = presetOf(s);
  const plain = was === 'chaos' || was === 'zombie' ? none : {};
  if (action.preset === 'classic') Object.assign(s, { core: 'classic', art: 'classic' }, plain);
  if (action.preset === 'adult') Object.assign(s, { core: 'classic', art: 'adult' }, plain);
  if (action.preset === 'party') Object.assign(s, { core: 'party', art: 'classic' }, plain);
  // Chaos and Zombie keep the deck's art (classic or adult).
  if (action.preset === 'chaos')
    Object.assign(s, { core: 'classic', x1: true, x2: true, x3: true, x4: true });
  if (action.preset === 'zombie') Object.assign(s, { core: 'classic' }, none, { x4: true });
  for (const k of [
    'core',
    'art',
    'x1',
    'x2',
    'x3',
    'x4',
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
  const s: Settings = { ...DEFAULT_SETTINGS, ...state.settings };
  const dealt = deal(s, n, ctx.rng);
  const empty = <T>(v: T) => Object.fromEntries(players.map((p) => [p, v])) as Record<string, T>;
  const g: Game = {
    players,
    names: Object.fromEntries(players.map((p) => [p, state.seats[p]!.name])),
    core: s.core,
    art: s.art,
    x1: s.x1,
    x2: s.x2,
    x3: s.x3,
    x4: s.x4,
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
    ghosts: [],
    left: [],
    turn: { player: players[0]!, owed: 1, chained: false, dir: 1, n: 0, plays: 0 },
    pending: null,
    window: null,
    drawn: null,
    placing: null,
    favor: null,
    alter: null,
    each: null,
    blindPlay: null,
    beat: null,
    revival: null,
    dig: null,
    toPlace: [],
    watchers: [],
    lastPlay: null,
    resume: 'turn',
    held: empty(null),
    marked: empty(null),
    blind: empty(false),
    stash: dealt.stash,
    vaultBy: null,
    mine: empty(null),
    knownTop: 0,
    decisionAt: ctx.now,
    pileVersion: 0,
    seq: 0,
    memory: {},
    log: [],
    truth: [],
    nudges: {},
    winner: null,
    seed: newSeed(ctx.rng),
    stats: { maxOwed: 1, maxOwedBy: null, longestChain: 0, draws: 0, revives: 0 },
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
  // The Stash goes back in too, so a rigged card is never stuck in it; it's dealt again below.
  const pool = [...g.players.flatMap((p) => g.hands[p]!), ...g.pile, ...g.stash];
  const stashSize = g.stash.length;
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
      pick((t) => t === 'defuse' || t === 'revive');
      for (let k = 0; k < 7; k++) pick((t) => !isBombCard(t) && t !== 'shelter' && t !== 'revive');
      hands[i] = mine;
    }
    g.hands[p] = hands[i]!;
  });
  const rest = rng.shuffle(pool);
  g.stash = [];
  for (let i = 0; i < rest.length && g.stash.length < stashSize;) {
    const t = g.cards[rest[i]!]!.t;
    if (isBombCard(t) || t === 'vault') i++;
    else g.stash.push(rest.splice(i, 1)[0]!);
  }
  g.pile = [...top, ...rest];
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

/** Whether `by` may act in the game; ghosts only where `ghostOk` (Nope, NOW cards, Foresight). */
function inGame(g: Game, by: PlayerId, ghostOk = false): GameError | null {
  if (!g.players.includes(by)) return err('not-seated', 'You’re watching this game.');
  if (isGhost(g, by) && !g.left.includes(by)) {
    if (ghostOk) return null;
    return err(
      'ghost',
      'You’re a ghost: no turns, but you can still play {c:nope} and NOW cards (⚡) from your hand.',
    );
  }
  if (isOut(g, by)) return err('out', 'You’re out of this game: you can only watch.');
  return null;
}

function waitWindow(state: S): GameError | null {
  if (state.stage === 'window')
    return err('window', 'Wait: the table can still {c:nope} that play.');
  if (state.stage === 'beat') return err('beat', 'Wait a moment…');
  return null;
}

/** Puts a play on the table and opens the Nope window. */
function commit(
  state: S,
  by: PlayerId,
  ids: CardId[],
  kind: PlayKind,
  t: CardType | null,
  target: PlayerId | null,
  named: CardType | null,
  now: number,
  copied = false,
) {
  const g = state.game!;
  for (const id of ids) leaveHand(g, by, id);
  g.discard.push(...ids);
  g.lastPlay = { by, turn: g.turn.n, cards: ids };
  g.seq += 1;
  const pending: Pending = {
    id: g.seq,
    by,
    kind,
    t,
    cards: ids,
    target,
    named,
    ...(copied ? { copied } : {}),
  };
  g.pending = pending;
  g.window = {
    id: pending.id,
    endsAt: now + state.settings.nopeSeconds * 1000,
    lastAt: now,
    chain: [],
  };
  if (by === g.turn.player) g.turn.plays += 1;
  log(g, now, {
    kind: 'play',
    by,
    cards: ids.map((id) => typeOf(g, id)),
    play: kind,
    ...(target ? { target } : {}),
    ...(named ? { named } : {}),
    ...(copied && t ? { as: t } : {}),
  });
  state.stage = 'window';
}

function playAction(
  state: S,
  action: Extract<ShortFuseAction, { type: 'play' }>,
  ctx: Ctx,
): Result {
  const e = requireGame(state);
  if (e) return e;
  const g = state.game!;
  const e1 = waitWindow(state);
  if (e1) return e1;
  const hand = g.hands[ctx.by] ?? [];
  const ids = action.cards;
  if (new Set(ids).size !== ids.length || !ids.every((id) => hand.includes(id)))
    return err('not-in-hand', 'You don’t have those cards.');
  let types = ids.map((id) => typeOf(g, id));
  const mine = g.turn.player === ctx.by;
  // NOW cards: anyone may play one between actions, even off their turn (ghosts too).
  const now = ids.length === 1 && CARDS[types[0]!].now === true;
  const e2 = inGame(g, ctx.by, now);
  if (e2) return e2;
  if (!mine && !now) return err('not-your-turn', `It’s ${nameOf(g, g.turn.player)}’s turn.`);
  if (state.stage !== 'turn')
    return err('busy', mine ? 'Finish what you’re doing first.' : 'Wait: something is under way.');
  if (g.blind[ctx.by])
    return err('blind', 'You’re blindfolded: tap a face-down card to play it blind.');
  // A Copy becomes the top card of the discard pile: on its own, or as one of a pair of cats.
  const copied = types.includes('copy');
  if (copied) {
    if (types.length > 2 || types.filter((t) => t === 'copy').length > 1)
      return err('copy-combo', 'A {c:copy} pairs with one cat at most.');
    const as = copyTarget(g, ctx.by);
    if ('error' in as) return err('copy', as.error);
    if (types.length === 1 && (isCat(as.t) || as.t === 'wild'))
      return err(
        'cat-alone',
        'A cat does nothing on its own: pair the {c:copy} with the same cat.',
      );
    if (types.length === 2 && !(isCat(as.t) || as.t === 'wild'))
      return err('copy-combo', 'A {c:copy} only makes a pair with a cat.');
    types = types.map((t) => (t === 'copy' ? as.t : t));
  }
  const combo = comboOf(types, g.fiveCombo);
  if ('error' in combo) return err('no-combo', combo.error);
  const t = combo.t;
  let target: PlayerId | null = null;
  let named: CardType | null = null;
  if (combo.kind === 'card') {
    const info = CARDS[t!];
    if (t === 'twin') return twinAction(state, ids, action.target ?? null, ctx);
    if (!info.playable) {
      if (t === 'nope')
        return err('nothing-to-nope', '{c:nope} answers someone’s play: wait for one.');
      if (t === 'defuse') return err('no-bomb', '{c:defuse} is only for when you draw a {c:bomb}.');
      if (t === 'revive')
        return err('no-bomb', '{c:revive} is only for when you draw a {c:bomb}: keep it.');
      if (t === 'seer')
        return err('no-revive', 'Play {c:seer} in the countdown after someone’s {c:revive}.');
      if (t === 'bomb') return err('bomb', 'You can’t play a {c:bomb} you’re holding.');
      if (t === 'shelter')
        return err('shelter', 'The {c:shelter} works from your hand: just keep it.');
      return err('cat-alone', 'A cat does nothing on its own: play two matching cats to steal.');
    }
    if (t === 'bury' && g.mine[ctx.by])
      return err('mine', 'You can’t bury a card while a {c:mine} is in front of you.');
    if (info.ghosts && !g.ghosts.length)
      return err('no-ghosts', 'Nobody is a ghost yet: this card needs one at the table.');
    if (t === 'feed') {
      if (!action.target) return err('need-target', 'Choose the ghost to feed.');
      target = action.target;
      if (!targetsFor(g, ctx.by, t).includes(target))
        return err('not-ghost', `${nameOf(g, target)} isn’t a ghost.`);
    } else if (info.targeted) {
      if (!action.target) return err('need-target', 'Choose who to play it on.');
      target = action.target;
      if (target === ctx.by) return err('self', 'Choose another player.');
      if (!alive(g).includes(target)) return err('bad-target', 'They’re not in the game.');
      if (!targetsFor(g, ctx.by, t!).includes(target)) {
        if (t === 'mine')
          return err('has-mine', `${nameOf(g, target)} already has a {c:mine} in front of them.`);
        return err('empty-hand', `${nameOf(g, target)} has no cards to take.`);
      }
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
  commit(state, ctx.by, ids, combo.kind, t, target, named, ctx.now, copied);
  return state;
}

/**
 * The Twin Bombs (never Noped, and still your turn after). Played together they bark at anyone;
 * one alone barks at whoever holds or shows the other, or waits face up in front of you.
 */
function twinAction(state: S, ids: CardId[], target: PlayerId | null, ctx: Ctx): Result {
  const g = state.game!;
  const by = ctx.by;
  if (ids.length === 2) {
    if (!target) return err('need-target', 'Choose who the {c:twin} cards bark at.');
    if (target === by || !alive(g).includes(target))
      return err('bad-target', 'Choose another player still in the game.');
    for (const id of ids) leaveHand(g, by, id);
    g.discard.push(ids[0]!);
    g.limbo = ids[1]!;
    g.turn.plays += 1;
    log(g, ctx.now, { kind: 'bark', by, target, cards: ['twin', 'twin'] });
    g.resume = 'turn';
    confront(state, target, ids[1]!, ctx.now, true);
    return state;
  }
  barkOne(state, by, ids[0]!, ctx.now);
  return state;
}

function barkOne(state: S, by: PlayerId, id: CardId, now: number) {
  const g = state.game!;
  leaveHand(g, by, id);
  if (by === g.turn.player) g.turn.plays += 1;
  const other = Object.keys(g.cards).find((c) => c !== id && typeOf(g, c) === 'twin')!;
  const holder = alive(g).find((p) => p !== by && g.hands[p]!.includes(other));
  const shower = alive(g).find((p) => p !== by && g.front[p]!.includes(other));
  const target = holder ?? shower;
  if (!target) {
    g.front[by]!.push(id);
    log(g, now, { kind: 'twin-wait', by, cards: ['twin'] });
    return settle(state, now, 'turn');
  }
  g.discard.push(id);
  if (holder) leaveHand(g, holder, other);
  else g.front[shower!] = g.front[shower!]!.filter((c) => c !== other);
  g.limbo = other;
  log(g, now, { kind: 'bark', by, target, cards: ['twin'] });
  g.resume = 'turn';
  confront(state, target, other, now, true);
}

/** Blind: turn over the card in a slot and play it, whatever it is. */
function playBlindAction(state: S, slot: number, ctx: Ctx): Result {
  const e = requireGame(state);
  if (e) return e;
  const g = state.game!;
  const e2 = inGame(g, ctx.by) ?? waitWindow(state);
  if (e2) return e2;
  if (g.turn.player !== ctx.by)
    return err('not-your-turn', `It’s ${nameOf(g, g.turn.player)}’s turn.`);
  if (state.stage !== 'turn') return err('busy', 'Finish what you’re doing first.');
  if (!g.blind[ctx.by]) return err('not-blind', 'You can see your cards: pick one to play.');
  const hand = g.hands[ctx.by]!;
  const id = hand[slot];
  if (!id) return err('bad-slot', 'That card isn’t there any more.');
  playBlind(state, ctx.by, id, ctx.now);
  return state;
}

function playBlind(state: S, by: PlayerId, id: CardId, now: number) {
  const g = state.game!;
  const t = typeOf(g, id);
  const info = CARDS[t];
  if (t === 'bomb' || t === 'void') {
    // Playing a Bomb while blindfolded sets it off.
    leaveHand(g, by, id);
    g.limbo = id;
    g.resume = 'turn';
    log(g, now, { kind: 'unprotected', by, cards: [t] });
    return confront(state, by, id, now);
  }
  if (t === 'twin') return barkOne(state, by, id, now);
  const lost = () => {
    leaveHand(g, by, id);
    g.discard.push(id);
    remember(g, by, { kind: 'lost', card: card(g, id), turn: g.turn.n, at: now });
    log(g, now, { kind: 'lost', by, cards: [t] });
    settle(state, now, 'turn');
  };
  if (!info.playable || (t === 'bury' && g.mine[by])) return lost();
  if (info.ghosts && !g.ghosts.length) return lost();
  if (t === 'copy') {
    // A blind Copy becomes the top card when that can be played without a target.
    const as = copyTarget(g, by);
    if ('error' in as || isCat(as.t) || as.t === 'wild' || CARDS[as.t].targeted) return lost();
    if (CARDS[as.t].ghosts && !g.ghosts.length) return lost();
    return commit(state, by, [id], 'card', as.t, null, null, now, true);
  }
  if (info.targeted) {
    if (!targetsFor(g, by, t).length) return lost();
    leaveHand(g, by, id);
    g.limbo = id;
    g.blindPlay = { by, card: id };
    log(g, now, { kind: 'play', by, cards: [t], play: 'card' });
    return setStage(state, 'target', now);
  }
  commit(state, by, [id], 'card', t, null, null, now);
}

function targetAction(state: S, player: PlayerId, ctx: Ctx): Result {
  const e = requireGame(state);
  if (e) return e;
  const g = state.game!;
  const bp = g.blindPlay;
  if (state.stage !== 'target' || bp?.by !== ctx.by)
    return err('not-targeting', 'You’re not choosing a target.');
  const t = typeOf(g, bp.card);
  if (!targetsFor(g, ctx.by, t).includes(player))
    return err('bad-target', `${nameOf(g, player)} can’t be picked for that.`);
  aimBlind(state, player, ctx.now);
  return state;
}

function aimBlind(state: S, player: PlayerId, now: number) {
  const g = state.game!;
  const bp = g.blindPlay!;
  g.blindPlay = null;
  g.limbo = null;
  g.hands[bp.by]!.push(bp.card);
  commit(state, bp.by, [bp.card], 'card', typeOf(g, bp.card), player, null, now);
}

function nopeAction(state: S, windowId: number, ctx: Ctx, seerBy?: PlayerId): Result {
  const e = requireGame(state);
  if (e) return e;
  const g = state.game!;
  const e2 = inGame(g, ctx.by, true);
  if (e2) return e2;
  if (g.blind[ctx.by]) return err('blind', 'You’re blindfolded: you can’t pick out a {c:nope}.');
  const nope = g.hands[ctx.by]!.find((id) => typeOf(g, id) === 'nope');
  if (!nope) return err('no-nope', 'You don’t have a {c:nope}.');
  const w = g.window;
  if (state.stage !== 'window' || !w || w.id !== windowId || ctx.now >= w.endsAt)
    return err('too-late', 'Too late: that already happened. Your {c:nope} is still in your hand.');
  // A Second Life can't be Noped; in its window a Nope answers a Foresight (the one named, or
  // the latest).
  const seer = isRevival(g.pending)
    ? seerBy
      ? w.seers?.find((x) => x.by === seerBy)
      : w.seers?.at(-1)
    : undefined;
  if (seerBy && isRevival(g.pending) && !seer)
    return err('no-seer', 'Nobody by that name played {c:seer}. Your {c:nope} is still yours.');
  if (isRevival(g.pending) && !seer)
    return err('not-nopeable', '{c:revive} can’t be Noped. Your {c:nope} is still in your hand.');
  const chain = seer ? seer.chain : w.chain;
  if (linked(w) && ctx.now - w.lastAt < NOPE_COOLDOWN_MS)
    return err(
      'too-soon',
      'Someone played {c:nope} a split second before you; your {c:nope} is still in your hand.',
    );
  const last = chain.at(-1)?.by ?? (seer ? seer.by : g.pending!.by);
  if (last === ctx.by)
    return err(
      'own',
      chain.length ? 'That’s your own {c:nope}.' : 'You can’t play {c:nope} on your own play.',
    );
  leaveHand(g, ctx.by, nope);
  g.discard.push(nope);
  chain.push({ by: ctx.by, card: nope });
  w.lastAt = ctx.now;
  w.endsAt = ctx.now + state.settings.nopeSeconds * 1000;
  g.stats.longestChain = Math.max(g.stats.longestChain, chain.length);
  log(g, ctx.now, { kind: 'nope', by: ctx.by, n: chain.length });
  return state;
}

/** Whether anything has been played into the window yet (the anti-double-tap applies then). */
const linked = (w: NonNullable<Game['window']>) => w.chain.length > 0 || (w.seers?.length ?? 0) > 0;

/**
 * Foresight, in a Second Life's window: watch where the bombs go back. It can be Noped (each
 * Foresight has its own chain), and it restarts the countdown like a Nope does.
 */
function seerAction(state: S, windowId: number, ctx: Ctx): Result {
  const e = requireGame(state);
  if (e) return e;
  const g = state.game!;
  const e2 = inGame(g, ctx.by, true);
  if (e2) return e2;
  if (g.blind[ctx.by]) return err('blind', 'You’re blindfolded: you can’t pick out a card.');
  const card = g.hands[ctx.by]!.find((id) => typeOf(g, id) === 'seer');
  if (!card) return err('no-seer', 'You don’t have Foresight.');
  const w = g.window;
  if (state.stage !== 'window' || !w || w.id !== windowId || ctx.now >= w.endsAt)
    return err('too-late', 'Too late: that already happened. Your card is still in your hand.');
  if (!isRevival(g.pending))
    return err('no-revive', '{c:seer} is played when someone uses a {c:revive}.');
  if (g.pending!.by === ctx.by) return err('own', 'You’re the one hiding them: you’ll know.');
  if (w.seers?.some((x) => x.by === ctx.by)) return err('twice', 'You’re already watching.');
  if (linked(w) && ctx.now - w.lastAt < NOPE_COOLDOWN_MS)
    return err('too-soon', 'Someone played a split second before you; your card is still yours.');
  leaveHand(g, ctx.by, card);
  g.discard.push(card);
  (w.seers ??= []).push({ by: ctx.by, card, chain: [] });
  w.lastAt = ctx.now;
  w.endsAt = ctx.now + state.settings.nopeSeconds * 1000;
  log(g, ctx.now, { kind: 'seer', by: ctx.by });
  return state;
}

/** The window ran out: the play goes ahead (even Nopes) or is cancelled (odd). */
function resolveWindow(state: S, now: number) {
  const g = state.game!;
  const p = g.pending!;
  const w = g.window!;
  g.pending = null;
  g.window = null;
  if (isRevival(p)) return revive(state, w, now);
  if (w.chain.length % 2 === 1) {
    log(g, now, {
      kind: 'cancelled',
      by: p.by,
      play: p.kind,
      ...(p.t ? { cards: [p.t] } : {}),
      n: w.chain.length,
    });
    return settle(state, now, 'turn');
  }
  if (w.chain.length > 0) log(g, now, { kind: 'resolved', by: p.by, n: w.chain.length });
  // A ghost's play (a NOW card) still counts; one by a player who left doesn't.
  if (!atTable(g, p.by)) return settle(state, now, 'turn');
  resolvePlay(state, p, now);
}

/** An attack sends `k` turns on (2, or 3 a ghost for Ghost Attack), stacking with any owed. */
function attack(state: S, by: PlayerId, victim: PlayerId, now: number, k = 2) {
  const g = state.game!;
  const t = g.turn;
  const owed = g.nonStacking ? k : (t.chained ? t.owed : 0) + k;
  log(g, now, { kind: 'attacked', by, target: victim, n: owed });
  startTurn(state, victim, owed, true, now);
}

/** Steals one card from `from` for `to`: from the Stash first, if they wear the Vault. */
function steal(
  state: S,
  to: PlayerId,
  from: PlayerId,
  how: 'favor' | 'pair' | 'triple',
  pick: (hand: CardId[]) => CardId | undefined,
  now: number,
): { id: CardId; stash: boolean } | null {
  const g = state.game!;
  if (stashOf(g, from) > 0) {
    const id = g.stash.splice(rand.int(g.stash.length), 1)[0]!;
    enterHand(g, to, id);
    remember(g, to, {
      kind: 'got',
      card: card(g, id),
      other: from,
      how: 'stash',
      turn: g.turn.n,
      at: now,
    });
    return { id, stash: true };
  }
  const id = pick(g.hands[from]!);
  if (!id) return null;
  moveCard(g, from, to, id);
  remember(g, to, { kind: 'got', card: card(g, id), other: from, how, turn: g.turn.n, at: now });
  remember(g, from, { kind: 'gave', card: card(g, id), other: to, how, turn: g.turn.n, at: now });
  return { id, stash: false };
}

/** Every seat in turn order from `by` (who comes first), in or out. */
function seatsFrom(g: Game, by: PlayerId): PlayerId[] {
  const i = Math.max(0, g.players.indexOf(by));
  const dir = g.turn.dir;
  const n = g.players.length;
  return Array.from({ length: n }, (_, k) => g.players[(((i + dir * k) % n) + n) % n]!);
}

/** The cards a player may give a ghost: anything but a bomb. */
const feedable = (g: Game, p: PlayerId) =>
  (g.hands[p] ?? []).filter((c) => !isBombCard(typeOf(g, c)));

/** Every player still in with cards, in turn order from `by`. */
function inTurnOrder(g: Game, by: PlayerId): PlayerId[] {
  const out: PlayerId[] = [];
  let p = by;
  for (let i = 0; i < g.players.length; i++) {
    if (!isOut(g, p) && !out.includes(p)) out.push(p);
    p = nextAlive(g, p, g.turn.dir);
  }
  return out;
}

function resolvePlay(state: S, p: Pending, now: number) {
  const g = state.game!;
  const targetIn = p.target !== null && alive(g).includes(p.target);
  if (p.kind === 'card') {
    switch (p.t) {
      case 'attack':
        return attack(state, p.by, nextAlive(g, p.by, g.turn.dir), now);
      case 'aim':
        return attack(state, p.by, targetIn ? p.target! : nextAlive(g, p.by, g.turn.dir), now);
      case 'ghostattack':
        if (!g.ghosts.length) return settle(state, now, 'turn');
        return attack(state, p.by, nextAlive(g, p.by, g.turn.dir), now, 3 * g.ghosts.length);
      case 'self3':
        g.turn.owed = (g.turn.chained ? g.turn.owed : 1) + 2;
        g.turn.chained = true;
        noteOwed(g);
        log(g, now, { kind: 'self-attack', by: p.by, n: g.turn.owed });
        return settle(state, now, 'turn');
      case 'skip':
        return settle(state, now, 'endturn');
      case 'superskip':
        log(g, now, { kind: 'superskip', by: p.by });
        startTurn(state, nextAlive(g, g.turn.player, g.turn.dir), 1, false, now);
        return;
      case 'reverse':
        if (alive(g).length > 2) g.turn.dir = g.turn.dir === 1 ? -1 : 1;
        log(g, now, { kind: 'reverse', by: p.by });
        return settle(state, now, 'endturn');
      case 'favor':
        if (!targetIn || !targetable(g, p.by).includes(p.target!)) {
          log(g, now, { kind: 'favor', by: p.target!, target: p.by, n: 0 });
          return settle(state, now, 'turn');
        }
        // A Vault's Stash pays the Favor by itself, at random.
        if (stashOf(g, p.target!) > 0) {
          steal(state, p.by, p.target!, 'favor', () => undefined, now);
          log(g, now, { kind: 'favor', by: p.target!, target: p.by, n: 1, from: 'stash' });
          return settle(state, now, 'turn');
        }
        g.favor = { from: p.target!, to: p.by };
        return setStage(state, 'favor', now);
      case 'shuffle':
      case 'shufflenow':
        g.pile = rand.shuffle(g.pile);
        pileChanged(g);
        log(g, now, { kind: 'shuffle', by: p.by });
        return settle(state, now, 'turn');
      case 'peek3':
      case 'peek5': {
        const k = PEEK_SIZE[p.t] ?? 3;
        remember(g, p.by, {
          kind: 'peek',
          cards: g.pile.slice(0, k).map((id) => card(g, id)),
          version: g.pileVersion,
          turn: g.turn.n,
          at: now,
        });
        return settle(state, now, 'turn');
      }
      case 'alter3':
      case 'alter5':
      case 'alter3now':
      case 'share3': {
        const k = Math.min(PEEK_SIZE[p.t] ?? 3, g.pile.length);
        if (k === 0) return settle(state, now, 'turn');
        g.alter = {
          by: p.by,
          cards: g.pile.slice(0, k),
          // Shown to the next seat even if it's a ghost's.
          share: p.t === 'share3' ? nextSeat(g, p.by, g.turn.dir) : null,
        };
        return setStage(state, 'alter', now);
      }
      case 'bottom':
        return drawCard(state, 'bottom', now);
      case 'dig':
        // Look Twice: with one card left it's just a draw.
        if (g.pile.length <= 1) return drawCard(state, 'top', now);
        g.dig = { by: p.by, card: g.pile[0]! };
        remember(g, p.by, {
          kind: 'peek',
          cards: [card(g, g.pile[0]!)],
          version: g.pileVersion,
          turn: g.turn.n,
          at: now,
        });
        log(g, now, { kind: 'dig', by: p.by });
        return setStage(state, 'dig', now);
      case 'feed': {
        // Every living player but the feeder gives the ghost a card (never a bomb).
        const to = p.target;
        if (!to || !isGhost(g, to) || g.left.includes(to)) return settle(state, now, 'turn');
        const order = inTurnOrder(g, p.by).filter((q) => q !== p.by && feedable(g, q).length > 0);
        if (!order.length) return settle(state, now, 'turn');
        g.each = { kind: 'feed', by: p.by, to, order, chosen: {} };
        return setStage(state, 'each', now);
      }
      case 'robber': {
        // Every ghost with cards puts one into the pile; then it's shuffled.
        const order = seatsFrom(g, p.by).filter(
          (q) => isGhost(g, q) && atTable(g, q) && g.hands[q]!.length > 0,
        );
        if (!order.length) return settle(state, now, 'turn');
        g.each = { kind: 'robber', by: p.by, order, chosen: {} };
        return setStage(state, 'each', now);
      }
      case 'bury':
        if (g.mine[p.by]) return settle(state, now, 'turn');
        return drawCard(state, 'bury', now);
      case 'swap': {
        if (g.pile.length > 1) {
          const top = g.pile[0]!;
          g.pile[0] = g.pile.at(-1)!;
          g.pile[g.pile.length - 1] = top;
        }
        pileChanged(g);
        log(g, now, { kind: 'swap', by: p.by });
        return settle(state, now, 'turn');
      }
      case 'stack': {
        // Every Bomb (not the Black Hole) comes out openly and goes on top.
        const bombs = g.pile.filter((id) => typeOf(g, id) === 'bomb');
        const rest = g.pile.filter((id) => typeOf(g, id) !== 'bomb');
        g.pile = [...rand.shuffle(bombs), ...rest];
        pileChanged(g);
        g.knownTop = bombs.length;
        log(g, now, { kind: 'stack', by: p.by, n: bombs.length });
        return settle(state, now, 'endturn');
      }
      case 'mark': {
        const hand = targetIn ? g.hands[p.target!]! : [];
        if (hand.length) {
          const id = hand[rand.int(hand.length)]!;
          g.marked[p.target!] = id;
          log(g, now, { kind: 'mark', by: p.by, target: p.target!, cards: [typeOf(g, id)] });
        }
        return settle(state, now, 'turn');
      }
      case 'blind':
        if (targetIn) {
          g.blind[p.target!] = true;
          g.hands[p.target!] = rand.shuffle(g.hands[p.target!]!);
          log(g, now, { kind: 'blind', by: p.by, target: p.target! });
        }
        return settle(state, now, 'turn');
      case 'vault':
        if (!g.vaultBy) {
          g.vaultBy = p.by;
          log(g, now, { kind: 'vault', by: p.by, n: g.stash.length });
        }
        return settle(state, now, 'turn');
      case 'mine': {
        const id = p.cards[0]!;
        if (targetIn && !g.mine[p.target!]) {
          g.discard.splice(g.discard.lastIndexOf(id), 1);
          g.mine[p.target!] = { card: id, by: p.by };
          log(g, now, { kind: 'mine', by: p.by, target: p.target! });
        }
        return settle(state, now, 'turn');
      }
      case 'recycle':
      case 'potluck': {
        const order = inTurnOrder(g, p.by).filter((q) => g.hands[q]!.length > 0);
        if (!order.length) return settle(state, now, 'turn');
        g.each = { kind: p.t, by: p.by, order, chosen: {} };
        return setStage(state, 'each', now);
      }
      default:
        return settle(state, now, 'turn');
    }
  }
  if (p.kind === 'pair') {
    if (!targetIn) return settle(state, now, 'turn');
    const got = steal(state, p.by, p.target!, 'pair', (h) => h[rand.int(h.length)], now);
    log(g, now, {
      kind: 'steal',
      by: p.by,
      target: p.target!,
      n: got ? 1 : 0,
      ...(got?.stash ? { from: 'stash' as const } : {}),
    });
    return settle(state, now, 'turn');
  }
  if (p.kind === 'triple') {
    let got: ReturnType<typeof steal> = null;
    if (targetIn)
      got = steal(
        state,
        p.by,
        p.target!,
        'triple',
        (h) => h.find((c) => typeOf(g, c) === p.named),
        now,
      );
    if (got?.stash)
      log(g, now, { kind: 'steal', by: p.by, target: p.target!, n: 1, from: 'stash' });
    else log(g, now, { kind: 'ask', by: p.by, target: p.target!, named: p.named!, hit: !!got });
    return settle(state, now, 'turn');
  }
  // Five different: take any card from the discard pile.
  if (!salvageable(g).length) return settle(state, now, 'turn');
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
  settle(state, now, 'turn');
}

/** A card picked by id, or by slot from a blindfolded hand. */
function picked(g: Game, who: PlayerId, a: { card?: string; slot?: number }): CardId | null {
  const hand = g.hands[who]!;
  if (g.blind[who]) return a.slot === undefined ? null : (hand[a.slot] ?? null);
  return a.card && hand.includes(a.card) ? a.card : null;
}

function giveAction(state: S, a: { card?: string; slot?: number }, ctx: Ctx): Result {
  const e = requireGame(state);
  if (e) return e;
  const g = state.game!;
  if (state.stage !== 'favor' || g.favor?.from !== ctx.by)
    return err('not-asked', 'Nobody is asking you for a card.');
  const id = picked(g, ctx.by, a);
  if (!id) return err('not-in-hand', 'You don’t have that card.');
  give(state, ctx.by, id, ctx.now);
  return state;
}

function choose(state: S, who: PlayerId, id: CardId, now: number) {
  const g = state.game!;
  const each = g.each!;
  each.chosen[who] = id;
  if (each.kind !== 'feed')
    remember(g, who, {
      kind: 'pooled',
      card: card(g, id),
      how: each.kind,
      turn: g.turn.n,
      at: now,
    });
  if (each.order.every((p) => p in each.chosen)) finishEach(state, now);
}

/** Everyone has chosen: Recycle shuffles the cards in, Potluck stacks them on top in turn order. */
function finishEach(state: S, now: number) {
  const g = state.game!;
  const each = g.each!;
  g.each = null;
  const cards = each.order.flatMap((p) => (each.chosen[p] ? [[p, each.chosen[p]] as const] : []));
  if (each.kind === 'feed') {
    const to = each.to!;
    const there = atTable(g, to);
    if (there)
      for (const [p, id] of cards) {
        moveCard(g, p, to, id);
        const how = 'feed' as const;
        remember(g, p, {
          kind: 'gave',
          card: card(g, id),
          other: to,
          how,
          turn: g.turn.n,
          at: now,
        });
        remember(g, to, { kind: 'got', card: card(g, id), other: p, how, turn: g.turn.n, at: now });
      }
    log(g, now, { kind: 'fed', by: each.by, target: to, n: there ? cards.length : 0 });
    return settle(state, now, 'turn');
  }
  for (const [p, id] of cards) leaveHand(g, p, id);
  if (each.kind === 'recycle' || each.kind === 'robber') {
    g.pile = rand.shuffle([...g.pile, ...cards.map(([, id]) => id)]);
  } else {
    for (const [, id] of cards) g.pile.unshift(id);
  }
  pileChanged(g);
  log(g, now, { kind: 'pooled', by: each.by, n: cards.length, cards: [each.kind] });
  settle(state, now, 'turn');
}

function chooseAction(state: S, a: { card?: string; slot?: number }, ctx: Ctx): Result {
  const e = requireGame(state);
  if (e) return e;
  const g = state.game!;
  const each = g.each;
  if (state.stage !== 'each' || !each?.order.includes(ctx.by) || ctx.by in each.chosen)
    return err('not-asked', 'You have nothing to choose right now.');
  let id = picked(g, ctx.by, a);
  if (!id) return err('not-in-hand', 'You don’t have that card.');
  if (each.kind === 'feed' && isBombCard(typeOf(g, id))) {
    // Blindfolded you can't tell: a card you may give is taken instead, at random.
    if (!g.blind[ctx.by]) return err('no-bomb', 'A {c:bomb} can’t be given to a ghost.');
    const ok = feedable(g, ctx.by);
    id = ok[rand.int(ok.length)]!;
  }
  choose(state, ctx.by, id, ctx.now);
  return state;
}

function reorder(state: S, order: number[], now: number) {
  const g = state.game!;
  const a = g.alter!;
  const cards = order.map((i) => a.cards[i]!);
  g.pile.splice(0, cards.length, ...cards);
  pileChanged(g);
  remember(g, a.by, {
    kind: 'altered',
    cards: cards.map((id) => card(g, id)),
    version: g.pileVersion,
    turn: g.turn.n,
    at: now,
  });
  if (a.share && a.share !== a.by && atTable(g, a.share)) {
    remember(g, a.share, {
      kind: 'shared',
      cards: cards.map((id) => card(g, id)),
      other: a.by,
      version: g.pileVersion,
      turn: g.turn.n,
      at: now,
    });
    log(g, now, { kind: 'shared', by: a.by, target: a.share, n: cards.length });
  }
  g.alter = null;
  settle(state, now, 'turn');
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
  enterHand(g, g.turn.player, id);
  log(g, now, { kind: 'salvage', by: g.turn.player, cards: [typeOf(g, id)] });
  settle(state, now, 'turn');
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

/** A Defuse answers the Bomb: hide it back (a Twin Bombs' bark leaves nothing to hide). */
function defuseWith(state: S, def: CardId, now: number) {
  const g = state.game!;
  const d = g.drawn!;
  leaveHand(g, d.by, def);
  g.discard.push(def);
  g.drawn = null;
  log(g, now, { kind: 'defuse', by: d.by });
  if (d.twin) {
    g.limbo = null;
    g.discard.push(d.card);
    return settle(state, now);
  }
  g.placing = { by: d.by, card: d.card, kind: typeOf(g, d.card) === 'void' ? 'void' : 'bomb' };
  setStage(state, 'place', now);
}

function defuseAction(state: S, ctx: Ctx): Result {
  const e = requireGame(state);
  if (e) return e;
  const g = state.game!;
  if (state.stage !== 'bomb' || g.drawn?.by !== ctx.by)
    return err('no-bomb', 'There’s no {c:bomb} for you to defuse.');
  const def = g.blind[ctx.by]
    ? undefined
    : g.hands[ctx.by]!.find((id) => typeOf(g, id) === 'defuse');
  if (!def) return err('no-defuse', 'You have no {c:defuse}.');
  defuseWith(state, def, ctx.now);
  return state;
}

/**
 * A Second Life answers the bomb (or a Copy of one): it can't be Noped, but everyone gets the
 * usual countdown, in which Foresight lets its holders watch the hiding. With a ghost at the
 * table it must bring one back.
 */
function startRevival(state: S, by: PlayerId, id: CardId, ghost: PlayerId | null, now: number) {
  const g = state.game!;
  const d = g.drawn!;
  g.drawn = null;
  g.revival = {
    by,
    bomb: d.twin ? null : d.card,
    twin: d.twin ? d.card : null,
    ghost,
  };
  commit(state, by, [id], 'card', 'revive', ghost, null, now, typeOf(g, id) === 'copy');
  g.window!.seers = [];
}

function reviveAction(state: S, a: { ghost?: string; copy?: boolean }, ctx: Ctx): Result {
  const e = requireGame(state);
  if (e) return e;
  const g = state.game!;
  if (state.stage !== 'bomb' || g.drawn?.by !== ctx.by)
    return err('no-bomb', 'There’s no {c:bomb} for you to answer.');
  const opt = reviveOptions(g, ctx.by);
  const id = a.copy ? opt?.copy : opt?.card;
  if (!id)
    return err(
      'no-revive',
      a.copy ? 'You can’t copy a {c:revive} right now.' : 'You have no {c:revive}.',
    );
  const ghosts = g.ghosts.filter((p) => atTable(g, p));
  if (ghosts.length && (!a.ghost || !ghosts.includes(a.ghost)))
    return err('need-ghost', 'Choose a ghost to bring back: with a ghost at the table, you must.');
  if (!ghosts.length && a.ghost) return err('no-ghost', 'Nobody is a ghost to bring back.');
  startRevival(state, ctx.by, id, a.ghost ?? null, ctx.now);
  return state;
}

/** With only a Second Life to save you, you may explode instead (and become a ghost). */
function dieAction(state: S, ctx: Ctx): Result {
  const e = requireGame(state);
  if (e) return e;
  const g = state.game!;
  const d = g.drawn;
  if (state.stage !== 'bomb' || d?.by !== ctx.by)
    return err('no-bomb', 'There’s no {c:bomb} for you to answer.');
  if (!g.blind[ctx.by] && has(g, ctx.by, 'defuse'))
    return err('has-defuse', 'You have a {c:defuse}: use it.');
  explode(state, ctx.by, d.card, ctx.now);
  return state;
}

/** The Second Life's window is over: bring the ghost back, then hide the bombs one by one. */
function revive(state: S, w: NonNullable<Game['window']>, now: number) {
  const g = state.game!;
  const r = g.revival!;
  g.revival = null;
  if (g.left.includes(r.by)) {
    // The reviver left mid-countdown: their bomb goes back at random; nobody comes back.
    if (r.bomb) g.pile.splice(rand.int(g.pile.length + 1), 0, r.bomb);
    if (r.twin) g.discard.push(r.twin);
    g.limbo = null;
    pileChanged(g);
    return settle(state, now, 'turn');
  }
  g.watchers = (w.seers ?? [])
    .filter((x) => x.chain.length % 2 === 0 && atTable(g, x.by))
    .map((x) => x.by);
  g.limbo = null;
  const queue: Game['toPlace'] = [];
  const kind = (c: CardId) => (typeOf(g, c) === 'void' ? 'void' : 'bomb');
  if (r.bomb) queue.push({ by: r.by, card: r.bomb, kind: kind(r.bomb) });
  // A Twin Bomb's bark hides nothing.
  if (r.twin) g.discard.push(r.twin);
  // The ghost picked left mid-countdown: the Second Life still brings back one, if any is left.
  const still = g.ghosts.filter((p) => atTable(g, p));
  const ghost = r.ghost && still.includes(r.ghost) ? r.ghost : r.ghost ? (still[0] ?? null) : null;
  if (ghost && isGhost(g, ghost) && !g.left.includes(ghost)) {
    g.ghosts = g.ghosts.filter((p) => p !== ghost);
    g.dead = g.dead.filter((x) => x.id !== ghost);
    const front = g.front[ghost] ?? [];
    g.front[ghost] = [];
    // Twin Bombs that killed them go back into the pile, shuffled; any other bomb is hidden.
    const twins = front.filter((c) => typeOf(g, c) === 'twin');
    if (twins.length) {
      g.pile = rand.shuffle([...g.pile, ...twins]);
      pileChanged(g);
    }
    for (const c of front) {
      if (typeOf(g, c) === 'twin') continue;
      if (typeOf(g, c) === 'bomb') g.bombsOut += 1;
      queue.push({ by: r.by, card: c, kind: kind(c) });
    }
    g.stats.revives = (g.stats.revives ?? 0) + 1;
    log(g, now, {
      kind: 'revive',
      by: r.by,
      target: ghost,
      ...(twins.length ? { cards: twins.map((c) => typeOf(g, c)) } : {}),
    });
  }
  g.toPlace = queue;
  nextPlacement(state, now);
}

/** The next bomb waiting to be hidden, or on with the game once they're all back. */
function nextPlacement(state: S, now: number) {
  const g = state.game!;
  const next = g.toPlace.shift();
  if (!next) {
    g.watchers = [];
    return settle(state, now);
  }
  g.limbo = next.card;
  g.placing = next;
  setStage(state, 'place', now);
}

function digAction(state: S, keep: boolean, ctx: Ctx): Result {
  const e = requireGame(state);
  if (e) return e;
  const g = state.game!;
  if (state.stage !== 'dig' || g.dig?.by !== ctx.by)
    return err('not-digging', 'You’re not looking at the top card.');
  g.dig = null;
  drawCard(state, keep ? 'top' : 'second', ctx.now);
  return state;
}

/** Blindfolded with a Bomb: each card turned over that isn't a way out is lost. */
function search(state: S, slot: number, now: number) {
  const g = state.game!;
  const d = g.drawn!;
  const hand = g.hands[d.by]!;
  const id = hand[Math.min(slot, hand.length - 1)]!;
  const t = typeOf(g, id);
  if (t === 'defuse') return defuseWith(state, id, now);
  // A Second Life turned over: it's theirs to use (or to explode anyway).
  if (t === 'revive' && !(typeOf(g, d.card) === 'void' && g.voidUp)) {
    d.found = id;
    return setStage(state, 'bomb', now);
  }
  if (t === 'shelter' && !d.twin && typeOf(g, d.card) === 'bomb' && !g.held[d.by]) {
    g.limbo = null;
    g.hands[d.by]!.push(d.card);
    g.held[d.by] = d.card;
    g.hands[d.by] = rand.shuffle(g.hands[d.by]!);
    g.drawn = null;
    return settle(state, now);
  }
  leaveHand(g, d.by, id);
  g.discard.push(id);
  log(g, now, { kind: 'lost', by: d.by, cards: [t] });
  if (!g.hands[d.by]!.length) return explode(state, d.by, d.card, now);
  g.decisionAt = now;
}

function searchAction(state: S, slot: number, ctx: Ctx): Result {
  const e = requireGame(state);
  if (e) return e;
  const g = state.game!;
  if (state.stage !== 'search' || g.drawn?.by !== ctx.by)
    return err('no-bomb', 'There’s no {c:bomb} for you to deal with.');
  if (slot >= g.hands[ctx.by]!.length) return err('bad-slot', 'That card isn’t there.');
  search(state, slot, ctx.now);
  return state;
}

function place(state: S, position: number, now: number) {
  const g = state.game!;
  const p = g.placing!;
  const at = Math.max(0, Math.min(position, g.pile.length));
  g.pile.splice(at, 0, p.card);
  g.limbo = null;
  pileChanged(g);
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
  if (p.kind !== 'bury') {
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
    for (const w of g.watchers)
      if (w !== p.by && atTable(g, w))
        remember(g, w, {
          kind: 'watched',
          t: typeOf(g, p.card),
          position: at,
          of: g.pile.length,
          other: p.by,
          version: g.pileVersion,
          turn: g.turn.n,
          at: now,
        });
  }
  nextPlacement(state, now);
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

/**
 * The safe default move for whoever the table waits on. Returns what it did, for the log, with
 * card names as tokens (`{c:defuse}`) the browser fills from the manifest.
 */
function actDefault(state: S, who: PlayerId, now: number): string | null {
  const g = state.game!;
  const any = (xs: CardId[]) => xs[rand.int(xs.length)]!;
  switch (state.stage) {
    case 'turn':
      if (g.turn.player !== who) return null;
      drawCard(state, 'top', now);
      return 'drew a card';
    case 'favor': {
      if (g.favor?.from !== who) return null;
      give(state, who, any(g.hands[who]!), now);
      return 'gave a random card';
    }
    case 'each': {
      if (!g.each?.order.includes(who) || who in g.each.chosen) return null;
      const hand = g.hands[who]!;
      if (g.each.kind === 'feed') {
        choose(state, who, any(feedable(g, who)), now);
        return 'gave a random card';
      }
      const safe = hand.filter((c) => !isExplosive(typeOf(g, c)) && typeOf(g, c) !== 'shelter');
      choose(state, who, any(safe.length ? safe : hand), now);
      return 'put in a random card';
    }
    case 'dig':
      if (g.dig?.by !== who) return null;
      g.dig = null;
      drawCard(state, 'top', now);
      return 'kept the card';
    case 'alter':
      if (g.alter?.by !== who) return null;
      reorder(
        state,
        g.alter.cards.map((_, i) => i),
        now,
      );
      return 'kept the order';
    case 'salvage':
      salvage(state, any(salvageable(g)), now);
      return 'took a random card';
    case 'target': {
      if (g.blindPlay?.by !== who) return null;
      const options = targetsFor(g, who, typeOf(g, g.blindPlay.card));
      aimBlind(state, options[rand.int(options.length)]!, now);
      return 'picked a random target';
    }
    case 'bomb': {
      if (g.drawn?.by !== who) return null;
      const def = g.blind[who] ? undefined : g.hands[who]!.find((id) => typeOf(g, id) === 'defuse');
      if (def) {
        defuseWith(state, def, now);
        return 'played {c:defuse}';
      }
      const opt = reviveOptions(g, who);
      const id = opt?.card ?? opt?.copy;
      if (!id) {
        explode(state, who, g.drawn.card, now);
        return 'exploded';
      }
      const ghosts = g.ghosts.filter((p) => atTable(g, p));
      startRevival(state, who, id, ghosts.length ? any(ghosts) : null, now);
      return 'played {c:revive}';
    }
    case 'search':
      if (g.drawn?.by !== who) return null;
      search(state, 0, now);
      return 'turned over a card';
    case 'place': {
      if (g.placing?.by !== who) return null;
      const kind = g.placing.kind;
      place(state, rand.int(g.pile.length + 1), now);
      return kind === 'bury'
        ? 'buried the card at random'
        : kind === 'void'
          ? 'put {c:void} back at random'
          : 'hid {c:bomb} at random';
    }
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
  const did = actDefault(state, player, ctx.now);
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
  rand = ctx.rng;
  switch (action.type) {
    case 'update-settings':
      return updateSettings(state, action, ctx);
    case 'sit':
      return sit(state, action.playing, ctx);
    case 'rig':
      return rigAction(state, action, ctx);
    case 'start':
      return start(state, ctx);
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
    default:
      break;
  }
  const draft = draftOf(state);
  switch (action.type) {
    case 'play':
      return playAction(draft, action, ctx);
    case 'play-blind':
      return playBlindAction(draft, action.slot, ctx);
    case 'target':
      return targetAction(draft, action.player, ctx);
    case 'draw':
      return drawAction(draft, ctx);
    case 'nope':
      return nopeAction(draft, action.window, ctx, action.seer);
    case 'give':
      return giveAction(draft, action, ctx);
    case 'choose':
      return chooseAction(draft, action, ctx);
    case 'order':
      return orderAction(draft, action.order, ctx);
    case 'salvage':
      return salvageAction(draft, action.card, ctx);
    case 'defuse':
      return defuseAction(draft, ctx);
    case 'revive':
      return reviveAction(draft, action, ctx);
    case 'die':
      return dieAction(draft, ctx);
    case 'dig':
      return digAction(draft, action.keep, ctx);
    case 'seer':
      return seerAction(draft, action.window, ctx);
    case 'search':
      return searchAction(draft, action.slot, ctx);
    case 'place':
      return placeAction(draft, action.position, ctx);
    case 'nudge':
      return nudgeAction(draft, action.player, ctx);
    case 'act-for':
      return actForAction(draft, action.player, ctx);
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
 * Someone left for good. Mid-game whatever the table waited on them for is done with the safe
 * default first; then they're out as if they had exploded without a Bomb: their hand, Stash and
 * Mine! leave the game, and play moves on.
 */
function playerLeft(state: S, playerId: PlayerId, now: number): S {
  if (!state.seats[playerId]) return state;
  const seats = { ...state.seats };
  delete seats[playerId];
  let next = fillSeats({ ...state, seats });
  const g0 = next.game;
  if (next.phase !== 'playing' || !g0?.players.includes(playerId) || !atTable(g0, playerId))
    return next;
  next = draftOf(next);
  const g = next.game!;
  rand = hiddenRng(g, now);
  if (isGhost(g, playerId)) return ghostLeft(next, playerId, now);
  for (let i = 0; i < 6 && next.phase === 'playing'; i++) {
    if (next.stage === 'turn' || !awaited(next).includes(playerId)) break;
    actDefault(next, playerId, now);
  }
  if (next.phase !== 'playing') return next;
  if (g.each) {
    g.each.order = g.each.order.filter((p) => p !== playerId);
    delete g.each.chosen[playerId];
  }
  g.left.push(playerId);
  g.ghosts = g.ghosts.filter((p) => p !== playerId);
  clearPlayer(g, playerId);
  log(g, now, { kind: 'left', by: playerId });
  if (alive(g).length <= 1) {
    finish(next, now);
    return next;
  }
  if (next.stage === 'each' && g.each && g.each.order.every((p) => p in g.each!.chosen))
    finishEach(next, now);
  if (g.turn.player === playerId) {
    if (g.limbo) {
      g.pile.splice(rand.int(g.pile.length + 1), 0, g.limbo);
      g.limbo = null;
    }
    for (const pl of g.toPlace.splice(0)) g.pile.splice(rand.int(g.pile.length + 1), 0, pl.card);
    if (g.revival?.twin) {
      // The bark's card was in limbo (back in the pile above): it goes to the discard pile.
      g.pile = g.pile.filter((c) => c !== g.revival!.twin);
      g.discard.push(g.revival.twin);
    }
    g.pending = null;
    g.window = null;
    g.favor = null;
    g.alter = null;
    g.each = null;
    g.blindPlay = null;
    g.drawn = null;
    g.placing = null;
    g.revival = null;
    g.dig = null;
    g.watchers = [];
    const beat = next.stage === 'beat';
    startTurn(next, nextAlive(g, playerId, g.turn.dir), 1, false, now);
    g.resume = 'turn';
    if (beat) next.stage = 'beat';
  }
  return next;
}

/** A ghost leaves for good: their hand and Vault go out of the game, and nobody waits on them. */
function ghostLeft(state: S, playerId: PlayerId, now: number): S {
  const g = state.game!;
  // Whatever the table waits on them for (a NOW card's rearrange…) is done with the safe default.
  for (let i = 0; i < 6 && state.phase === 'playing'; i++) {
    if (!awaited(state).includes(playerId)) break;
    actDefault(state, playerId, now);
  }
  g.ghosts = g.ghosts.filter((p) => p !== playerId);
  g.left.push(playerId);
  if (g.each) {
    g.each.order = g.each.order.filter((p) => p !== playerId);
    delete g.each.chosen[playerId];
  }
  clearPlayer(g, playerId);
  log(g, now, { kind: 'left', by: playerId });
  if (state.stage === 'each' && g.each) {
    if (g.each.kind === 'feed' && g.each.to === playerId) {
      // Nobody left to feed: the givers keep their cards.
      g.each = null;
      settle(state, now, 'turn');
    } else if (g.each.order.every((p) => p in g.each!.chosen)) finishEach(state, now);
  }
  return state;
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
  rand = hiddenRng(g, now);
  if (next.stage === 'window') {
    resolveWindow(next, now);
    return next;
  }
  if (next.stage === 'beat') {
    g.beat = null;
    settle(next, now);
    return next;
  }
  const who = awaited(next)[0];
  const did = who ? actDefault(next, who, now) : null;
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
    knownTop: Math.min(g.knownTop, count),
  };
}

function promptFor(state: S, g: Game, viewer: PlayerId): Prompt | null {
  const blind = !!g.blind[viewer];
  switch (state.stage) {
    case 'turn':
      return g.turn.player === viewer ? { kind: 'turn', blind } : null;
    case 'favor':
      return g.favor?.from === viewer ? { kind: 'give', to: g.favor.to, blind } : null;
    case 'alter':
      return g.alter?.by === viewer
        ? {
            kind: 'alter',
            cards: g.alter.cards.map((id) => cv(g, id)),
            share: g.alter.share ?? null,
          }
        : null;
    case 'salvage':
      return g.turn.player === viewer
        ? { kind: 'salvage', options: salvageable(g).map((id) => cv(g, id)) }
        : null;
    case 'each':
      return g.each?.order.includes(viewer)
        ? {
            kind: 'each',
            what: g.each.kind,
            blind,
            done: viewer in g.each.chosen,
            to: g.each.to ?? null,
          }
        : null;
    case 'dig':
      return g.dig?.by === viewer ? { kind: 'dig', card: cv(g, g.dig.card) } : null;
    case 'target':
      return g.blindPlay?.by === viewer
        ? {
            kind: 'target',
            card: cv(g, g.blindPlay.card),
            options: targetsFor(g, viewer, typeOf(g, g.blindPlay.card)),
          }
        : null;
    case 'bomb': {
      if (g.drawn?.by !== viewer) return null;
      const opt = reviveOptions(g, viewer);
      return {
        kind: 'bomb',
        card: cv(g, g.drawn.card),
        canDefuse: !blind && has(g, viewer, 'defuse'),
        twin: !!g.drawn.twin,
        revive: opt
          ? { card: !!opt.card, copy: !!opt.copy, ghosts: g.ghosts.filter((p) => atTable(g, p)) }
          : null,
      };
    }
    case 'search':
      return g.drawn?.by === viewer
        ? {
            kind: 'search',
            card: cv(g, g.drawn.card),
            slots: g.hands[viewer]!.length,
            twin: !!g.drawn.twin,
          }
        : null;
    case 'place':
      return g.placing?.by === viewer
        ? {
            kind: 'place',
            card: cv(g, g.placing.card),
            count: g.pile.length,
            void: g.placing.kind === 'void',
            bury: g.placing.kind === 'bury',
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
    case 'each':
      return g.each ? { who: g.each.by, what: 'each' } : null;
    case 'target':
      return g.blindPlay ? { who: g.blindPlay.by, what: 'target' } : null;
    case 'dig':
      return g.dig ? { who: g.dig.by, what: 'dig' } : null;
    case 'bomb':
      return g.drawn ? { who: g.drawn.by, what: 'bomb' } : null;
    case 'search':
      return g.drawn ? { who: g.drawn.by, what: 'search' } : null;
    case 'place':
      return g.placing ? { who: g.placing.by, what: 'place' } : null;
    default:
      return null;
  }
}

function canNope(state: S, g: Game, viewer: PlayerId | null): boolean {
  const w = g.window;
  if (state.stage !== 'window' || !w || !g.pending || viewer === null) return false;
  if (!atTable(g, viewer) || g.blind[viewer]) return false;
  if (!has(g, viewer, 'nope')) return false;
  // A Second Life can't be Noped; a Foresight played in its window can.
  if (isRevival(g.pending)) return nopeSeersFor(g, viewer).length > 0;
  return (w.chain.at(-1)?.by ?? g.pending.by) !== viewer;
}

/** The Foresights in a Second Life's window that `viewer` could Nope (not their own last link). */
function nopeSeersFor(g: Game, viewer: PlayerId): PlayerId[] {
  return (g.window?.seers ?? [])
    .filter((x) => (x.chain.at(-1)?.by ?? x.by) !== viewer)
    .map((x) => x.by);
}

function canSeer(state: S, g: Game, viewer: PlayerId | null): boolean {
  const w = g.window;
  if (state.stage !== 'window' || !w || !isRevival(g.pending) || viewer === null) return false;
  if (!atTable(g, viewer) || g.blind[viewer] || g.pending!.by === viewer) return false;
  return has(g, viewer, 'seer') && !w.seers?.some((x) => x.by === viewer);
}

function canNow(state: S, g: Game, viewer: PlayerId | null): boolean {
  if (state.stage !== 'turn' || viewer === null || !atTable(g, viewer)) return false;
  if (g.blind[viewer]) return false;
  return g.hands[viewer]!.some((id) => {
    const info = CARDS[typeOf(g, id)];
    return info.now === true && (!info.ghosts || g.ghosts.length > 0);
  });
}

/** What the viewer's Copy would become if they played it now (their own turn, eyes open). */
function copyAsFor(state: S, g: Game, viewer: PlayerId | null): CardType | null {
  if (state.stage !== 'turn' || viewer === null || g.turn.player !== viewer) return null;
  if (g.blind[viewer] || !has(g, viewer, 'copy')) return null;
  const as = copyTarget(g, viewer);
  return 'error' in as ? null : as.t;
}

function drawnKind(state: S, g: Game): GameView['drawnKind'] {
  if ((state.stage === 'bomb' || state.stage === 'search') && g.drawn)
    return g.drawn.twin ? 'twin' : typeOf(g, g.drawn.card) === 'void' ? 'void' : 'bomb';
  if (state.stage === 'place' && g.placing) return g.placing.kind;
  return null;
}

function gameView(state: S, g: Game, viewer: PlayerId | null): GameView {
  normalize(g);
  const over = state.phase === 'over';
  // Ghosts keep their hand, so they see it (and get the prompts that still involve them).
  const mine = viewer !== null && atTable(g, viewer);
  const blindMe = mine && !!g.blind[viewer];
  const secs = state.settings.decisionSeconds;
  const waiting = awaited(state);
  return {
    players: g.players.map((id) => {
      const dead = g.dead.find((d) => d.id === id);
      const marked = g.marked[id];
      return {
        id,
        name: state.seats[id]?.name ?? g.names[id] ?? 'Someone',
        hand: g.hands[id]?.length ?? 0,
        dead: !!dead,
        deadTurn: dead?.turn ?? null,
        left: g.left.includes(id),
        front: (g.front[id] ?? []).map((c) => cv(g, c)),
        marked: marked && !(id === viewer && g.blind[id]) ? card(g, marked) : null,
        blind: !!g.blind[id],
        mine: g.mine[id]?.by ?? null,
        stash: g.vaultBy === id ? g.stash.length : null,
        ghost: isGhost(g, id) && !g.left.includes(id),
      };
    }),
    core: g.core,
    art: g.art,
    x1: g.x1,
    x2: g.x2,
    x3: g.x3,
    x4: g.x4,
    fiveCombo: g.fiveCombo,
    nonStacking: g.nonStacking,
    types: typesIn(g),
    turn: { ...g.turn },
    pile: pileView(g),
    discard: g.discard.map((id) => cv(g, id)),
    hand: mine && !blindMe ? g.hands[viewer]!.map((id) => cv(g, id)) : null,
    blindCount: blindMe ? g.hands[viewer]!.length : null,
    canNow: !over && canNow(state, g, viewer),
    stash: g.stash.length,
    pending: g.pending
      ? {
          by: g.pending.by,
          kind: g.pending.kind,
          t: g.pending.t,
          cards: g.pending.cards.map((id) => cv(g, id)),
          target: g.pending.target,
          named: g.pending.named,
          copied: !!g.pending.copied,
        }
      : null,
    window: g.window
      ? {
          id: g.window.id,
          endsAt: g.window.endsAt,
          seconds: state.settings.nopeSeconds,
          chain: g.window.chain.map((c) => c.by),
          cancelled: g.window.chain.length % 2 === 1,
          seers: (g.window.seers ?? []).map((x) => ({
            by: x.by,
            chain: x.chain.map((c) => c.by),
            cancelled: x.chain.length % 2 === 1,
          })),
        }
      : null,
    canNope: canNope(state, g, viewer),
    canSeer: !over && canSeer(state, g, viewer),
    nopeSeers:
      viewer !== null && canNope(state, g, viewer) && isRevival(g.pending)
        ? nopeSeersFor(g, viewer)
        : [],
    copyAs: copyAsFor(state, g, viewer),
    prompt: viewer !== null && mine && !over ? promptFor(state, g, viewer) : null,
    waiting,
    busy: busyOf(state, g),
    drawnKind: drawnKind(state, g),
    each:
      state.stage === 'each' && g.each
        ? {
            what: g.each.kind,
            by: g.each.by,
            to: g.each.to ?? null,
            waiting: g.each.order.filter((p) => !(p in g.each!.chosen)),
          }
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
          stash: g.stash.map((id) => cv(g, id)),
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
  const settings = { ...DEFAULT_SETTINGS, ...state.settings };
  return {
    phase: state.phase,
    stage: state.stage,
    settings,
    preset: presetOf(settings),
    seats,
    me: viewer === null ? null : (seats.find((s) => s.id === viewer) ?? null),
    readout: readout(settings, g ? g.players.length : seated(state).length),
    game: g ? gameView(state, structuredGame(g), viewer) : null,
    gamesPlayed: state.gamesPlayed,
    rigged: state.rig !== null,
    rigAllowed: rigEnabled,
  };
}

/** A shallow copy for the view, so filling in missing fields never touches the stored state. */
const structuredGame = (g: Game): Game => ({ ...g });

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
