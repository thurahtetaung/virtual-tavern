import {
  type ActionCtx,
  type BotCtx,
  type CreateCtx,
  type GameDefinition,
  GameError,
  type PlayerId,
  type PlayerInfo,
  type Rng,
  createRng,
} from '@vt/game-sdk';
import { guide } from './guide.ts';
import { royalPostAwards } from './awards.ts';
import { insights } from './insights.ts';
import {
  EDITIONS,
  type EditionConfig,
  type EndReason,
  type LogEntry,
  MAX_LOG,
  MAX_NOTES,
  MIN_PLAYERS,
  type Note,
  type OutCause,
  type Role,
  type Round,
  type RoundPlayer,
  type RoundEndReason,
  type RoundResult,
  type RoundStage,
  type RoyalPostAction,
  type RoyalPostState,
  type RoyalPostView,
  type Seat,
  type SeatView,
  actionSchema,
} from './types.ts';

type Ctx = ActionCtx;
type Result = RoyalPostState | GameError;

// ---- Cards ----

export const editionOf = (state: Pick<RoyalPostState, 'settings'>): EditionConfig =>
  EDITIONS[state.settings.edition];

/** A card's rank in an edition (-1 for a card the edition doesn't have). */
export function rankOf(edition: EditionConfig, role: Role | undefined): number {
  return edition.cards.find((c) => c.role === role)?.rank ?? -1;
}

/** Every card in an edition's deck, unshuffled. */
export function deckOf(edition: EditionConfig): Role[] {
  return edition.cards.flatMap((c) => Array<Role>(c.count).fill(c.role));
}

/** A short game's target: two tokens fewer than the full game, but never below 2. */
export const shortTarget = (full: number): number => Math.max(2, full - 2);

/** Tokens needed to win with `players` players, clamped to the edition's range. */
export function tokensToWin(edition: EditionConfig, players: number, short = false): number {
  const n = Math.min(edition.maxPlayers, Math.max(edition.minPlayers, players));
  const full = edition.tokens[n]!;
  return short ? shortTarget(full) : full;
}

/** Cards that need a target (the Prince may also target yourself). */
const TARGETED: ReadonlySet<Role> = new Set(['guard', 'priest', 'baron', 'prince', 'king']);
export const needsTarget = (role: Role) => TARGETED.has(role);

/** You must play the Countess when you also hold the King or a Prince. */
export const mustPlayCountess = (hand: readonly Role[]) =>
  hand.includes('countess') && (hand.includes('king') || hand.includes('prince'));

/** What a Guard may name: any card in the edition except the Guard. */
export const guardGuesses = (edition: EditionConfig): Role[] =>
  edition.cards.map((c) => c.role).filter((r) => r !== 'guard');

// ---- Helpers ----

const deadline = (seconds: number | null, now: number) =>
  seconds === null ? null : now + seconds * 1000;

export function players(state: RoyalPostState): PlayerId[] {
  return Object.entries(state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));
}

/** Players still in the round, in turn order. */
export const alive = (round: Round) => round.order.filter((id) => !round.players[id]!.out);

/**
 * Who `by` may target with `card`: everyone else still in and unprotected, plus yourself for the
 * Prince. Empty means the card is played with no effect.
 */
export function validTargets(round: Round, by: PlayerId, card: Role): PlayerId[] {
  if (!needsTarget(card)) return [];
  const others = alive(round).filter((id) => id !== by && !round.players[id]!.protected);
  return card === 'prince' ? [...others, by] : others;
}

const hiddenRng = (state: RoyalPostState, now: number) => createRng((state.seed ^ now) >>> 0);
const newSeed = (rng: Rng) => rng.int(2 ** 32);

function nextId(state: RoyalPostState): [number, RoyalPostState] {
  const id = state.seq + 1;
  return [id, { ...state, seq: id }];
}

type NewLog = LogEntry extends infer E
  ? E extends LogEntry
    ? Omit<E, 'id' | 'round'>
    : never
  : never;
type NewNote = Note extends infer E ? (E extends Note ? Omit<E, 'id' | 'round'> : never) : never;

function addLog(state: RoyalPostState, entry: NewLog): RoyalPostState {
  const [id, next] = nextId(state);
  const full = { ...entry, id, round: state.round?.number ?? 0 };
  return { ...next, log: [...next.log, full].slice(-MAX_LOG) };
}

function addNote(state: RoyalPostState, player: PlayerId, note: NewNote): RoyalPostState {
  const [id, next] = nextId(state);
  const full = { ...note, id, round: state.round?.number ?? 0 };
  return {
    ...next,
    notes: { ...next.notes, [player]: [...(next.notes[player] ?? []), full].slice(-MAX_NOTES) },
  };
}

function withRound(state: RoyalPostState, patch: Partial<Round>): RoyalPostState {
  return { ...state, round: { ...state.round!, ...patch } };
}

function withPlayer(
  state: RoyalPostState,
  id: PlayerId,
  patch: Partial<RoundPlayer>,
): RoyalPostState {
  const round = state.round!;
  return withRound(state, {
    players: { ...round.players, [id]: { ...round.players[id]!, ...patch } },
  });
}

/** Knocks a player out: their hand is discarded face up for everyone to see. */
function knockOut(
  state: RoyalPostState,
  id: PlayerId,
  cause: OutCause,
  by: PlayerId | null,
): RoyalPostState {
  const p = state.round!.players[id]!;
  if (p.out) return state;
  const next = withPlayer(state, id, {
    out: true,
    protected: false,
    hand: [],
    discards: [...p.discards, ...p.hand],
    left: p.left || cause === 'left',
  });
  return addLog(next, { kind: 'out', player: id, cause, by, cards: [...p.hand] });
}

// ---- Round flow ----

function beginRound(state: RoyalPostState, first: PlayerId, now: number, rng: Rng): RoyalPostState {
  const edition = editionOf(state);
  const seated = players(state);
  const start = Math.max(0, seated.indexOf(first));
  const order = [...seated.slice(start), ...seated.slice(0, start)];
  const deck = rng.shuffle(deckOf(edition));
  const setAside = deck.shift()!;
  const faceUp = order.length === 2 ? deck.splice(0, 3) : [];
  const roundPlayers: Record<PlayerId, RoundPlayer> = {};
  for (const id of order) {
    roundPlayers[id] = {
      name: state.seats[id]!.name,
      hand: [deck.shift()!],
      discards: [],
      out: false,
      protected: false,
      left: false,
    };
  }
  // The first player draws their second card straight away.
  roundPlayers[order[0]!]!.hand.push(deck.shift()!);
  const round: Round = {
    number: (state.round?.number ?? 0) + 1,
    order,
    players: roundPlayers,
    deck,
    setAside,
    faceUp,
    current: order[0]!,
    stage: 'play',
    deadline: deadline(state.settings.turnSeconds, now),
    result: null,
  };
  return { ...state, seed: newSeed(rng), round };
}

/**
 * Ends the round: the last player standing wins, or else the highest card. Classic ties go to
 * the highest total of discards; any tie left (and every 2019 tie) gives each tied player a token. A lone
 * surviving Spy player gains a bonus token. Reaching the target ends the game.
 */
function endRound(state: RoyalPostState, reason: RoundEndReason): RoyalPostState {
  const round = state.round!;
  const edition = editionOf(state);
  const survivors = alive(round);
  const hands: Record<PlayerId, Role> = {};
  for (const id of survivors) {
    const card = round.players[id]!.hand[0];
    if (card) hands[id] = card;
  }
  let winners: PlayerId[] = survivors;
  let discardTotals: Record<PlayerId, number> | null = null;
  if (survivors.length > 1) {
    const rank = (id: PlayerId) => rankOf(edition, hands[id]);
    const top = Math.max(...survivors.map(rank));
    winners = survivors.filter((id) => rank(id) === top);
    if (winners.length > 1 && edition.tiebreak === 'discards') {
      const total = (id: PlayerId) =>
        round.players[id]!.discards.reduce((n, r) => n + rankOf(edition, r), 0);
      discardTotals = Object.fromEntries(winners.map((id) => [id, total(id)]));
      const best = Math.max(...winners.map(total));
      winners = winners.filter((id) => total(id) === best);
    }
  }
  const spies = survivors.filter((id) => round.players[id]!.discards.includes('spy'));
  const spy = spies.length === 1 ? spies[0]! : null;
  const seats = { ...state.seats };
  const gain = (id: PlayerId) => {
    const seat = seats[id];
    if (seat) seats[id] = { ...seat, tokens: seat.tokens + 1 };
  };
  winners.forEach(gain);
  if (spy) gain(spy);
  const result: RoundResult = { reason, winners, hands, discardTotals, spy, spies };
  let next: RoyalPostState = {
    ...state,
    seats,
    round: { ...round, stage: 'over', deadline: null, result },
  };
  next = addLog(next, { kind: 'round-end', winners, reason, spy });
  const reached = players(next).filter((id) => next.seats[id]!.tokens >= next.target);
  if (reached.length > 0) return endGame(next, 'target', reached);
  return next;
}

/**
 * Ends the game. The winners are the players on the most tokens among `pool` (by default
 * everyone still seated, or everyone at the table if nobody is).
 */
function endGame(state: RoyalPostState, endReason: EndReason, pool?: PlayerId[]): RoyalPostState {
  const seated = players(state);
  const candidates = pool ?? (seated.length > 0 ? seated : Object.keys(state.seats));
  const top = Math.max(0, ...candidates.map((id) => state.seats[id]!.tokens));
  const round = state.round ? { ...state.round, deadline: null } : null;
  return {
    ...state,
    phase: 'over',
    round,
    winners: candidates.filter((id) => state.seats[id]!.tokens === top && top > 0),
    endReason,
  };
}

/**
 * After a turn: the round ends when one player is left or the deck is empty; otherwise the next
 * player still in loses their protection and draws.
 */
function finishTurn(state: RoyalPostState, now: number): RoyalPostState {
  const round = state.round!;
  const left = alive(round);
  if (left.length <= 1) return endRound(state, 'last-standing');
  if (round.deck.length === 0) return endRound(state, 'deck-empty');
  const at = round.order.indexOf(round.current);
  const after = [...round.order.slice(at + 1), ...round.order.slice(0, at + 1)];
  const nextId = after.find((id) => !round.players[id]!.out)!;
  const [card, ...deck] = round.deck;
  const p = round.players[nextId]!;
  return withRound(state, {
    current: nextId,
    stage: 'play',
    deck,
    topDrawn: (round.topDrawn ?? 0) + 1,
    deadline: deadline(state.settings.turnSeconds, now),
    players: {
      ...round.players,
      [nextId]: { ...p, protected: false, hand: [...p.hand, card!] },
    },
  });
}

// ---- Card effects ----

function play(
  state: RoyalPostState,
  action: Extract<RoyalPostAction, { type: 'play' }>,
  by: PlayerId,
  now: number,
  timedOut = false,
): Result {
  const round = state.round;
  if (state.phase !== 'playing' || !round) return new GameError('not-playing', 'No round in play.');
  if (round.stage === 'over') return new GameError('round-over', 'This round is over.');
  if (round.current !== by) return new GameError('not-your-turn', "It's not your turn.");
  if (round.stage !== 'play')
    return new GameError('wrong-stage', 'Choose which card to keep first.');
  const edition = editionOf(state);
  const me = round.players[by]!;
  const { card } = action;
  const at = me.hand.indexOf(card);
  if (at < 0) return new GameError('not-in-hand', "That card isn't in your hand.");
  if (card !== 'countess' && mustPlayCountess(me.hand)) {
    return new GameError(
      'countess',
      'You must play the Countess while you hold the King or a Prince.',
    );
  }
  const targets = validTargets(round, by, card);
  let target: PlayerId | null = null;
  if (needsTarget(card) && targets.length > 0) {
    if (!action.target) return new GameError('no-target', 'Choose a player.');
    if (!targets.includes(action.target)) {
      const p = round.players[action.target];
      return new GameError(
        'bad-target',
        p?.protected ? 'That player is protected.' : "You can't choose that player.",
      );
    }
    target = action.target;
  } else if (action.target && action.target !== by) {
    return new GameError('bad-target', "You can't choose that player.");
  }
  let guess: Role | null = null;
  if (card === 'guard' && target) {
    if (!action.guess) return new GameError('no-guess', 'Name a card.');
    if (!guardGuesses(edition).includes(action.guess))
      return new GameError('bad-guess', "You can't name that card.");
    guess = action.guess;
  }

  const rest = me.hand.filter((_, i) => i !== at);
  let next = withPlayer(state, by, { hand: rest, discards: [...me.discards, card] });
  const noEffect = needsTarget(card) && target === null;
  const entry: Extract<LogEntry, { kind: 'play' }> = {
    id: 0,
    round: round.number,
    kind: 'play',
    by,
    card,
    target,
    guess,
    noEffect,
    ...(timedOut ? { timedOut: true } : {}),
  };
  const outs: [PlayerId, OutCause, PlayerId | null][] = [];
  const notes: [PlayerId, NewNote][] = [];
  const cur = () => next.round!;

  switch (card) {
    case 'guard': {
      if (!target) break;
      entry.hit = cur().players[target]!.hand[0] === guess;
      if (entry.hit) outs.push([target, 'guard', by]);
      break;
    }
    case 'priest': {
      if (!target) break;
      const seen = cur().players[target]!.hand[0]!;
      notes.push([by, { kind: 'peek', target, card: seen }]);
      // The target is told too, so they know someone knows their card.
      notes.push([target, { kind: 'seen', by, card: seen }]);
      break;
    }
    case 'baron': {
      if (!target) break;
      const mine = rest[0]!;
      const theirs = cur().players[target]!.hand[0]!;
      const diff = rankOf(edition, mine) - rankOf(edition, theirs);
      const res = diff > 0 ? 'win' : diff < 0 ? 'lose' : 'tie';
      const flip = { win: 'lose', lose: 'win', tie: 'tie' } as const;
      notes.push([by, { kind: 'compare', other: target, mine, theirs, result: res }]);
      notes.push([
        target,
        { kind: 'compare', other: by, mine: theirs, theirs: mine, result: flip[res] },
      ]);
      if (res === 'tie') entry.tie = true;
      if (res === 'win') outs.push([target, 'baron', by]);
      if (res === 'lose') outs.push([by, 'baron', target]);
      break;
    }
    case 'handmaid':
      next = withPlayer(next, by, { protected: true });
      break;
    case 'prince': {
      if (!target) break;
      const p = cur().players[target]!;
      const discarded = p.hand[0]!;
      entry.discarded = discarded;
      if (discarded === 'princess') {
        // Discarding the Princess knocks them out; knockOut puts it on their pile.
        outs.push([target, 'prince', by]);
        break;
      }
      const deck = [...cur().deck];
      let drawn: Role | undefined = deck.shift();
      const topDrawn = (cur().topDrawn ?? 0) + (drawn === undefined ? 0 : 1);
      let setAside = cur().setAside;
      if (drawn === undefined && setAside !== null) {
        drawn = setAside;
        setAside = null;
      }
      next = withRound(next, { deck, setAside, topDrawn });
      next = withPlayer(next, target, {
        hand: drawn === undefined ? [] : [drawn],
        discards: [...p.discards, discarded],
      });
      break;
    }
    case 'chancellor': {
      const deck = [...cur().deck];
      const drawn = deck.splice(0, 2);
      entry.drew = drawn.length;
      if (drawn.length === 0) break;
      next = withRound(next, {
        deck,
        topDrawn: (cur().topDrawn ?? 0) + drawn.length,
        stage: 'chancellor',
        deadline: deadline(state.settings.turnSeconds, now),
      });
      next = withPlayer(next, by, { hand: [...rest, ...drawn] });
      break;
    }
    case 'king': {
      if (!target) break;
      const theirs = cur().players[target]!.hand;
      next = withPlayer(next, target, { hand: [...rest] });
      next = withPlayer(next, by, { hand: [...theirs] });
      notes.push([by, { kind: 'trade', other: target, gave: rest[0]!, got: theirs[0]! }]);
      notes.push([target, { kind: 'trade', other: by, gave: theirs[0]!, got: rest[0]! }]);
      break;
    }
    case 'princess':
      outs.push([by, 'princess', by]);
      break;
    case 'spy':
    case 'countess':
      break;
  }

  const { id: _id, round: _round, ...logged } = entry;
  next = addLog(next, logged);
  for (const [who, note] of notes)
    next = addNote(next, who, timedOut && who === by ? { ...note, timedOut: true } : note);
  for (const [who, cause, from] of outs) next = knockOut(next, who, cause, from);
  if (next.round!.stage === 'chancellor') return next;
  return finishTurn(next, now);
}

function chancellorKeep(
  state: RoyalPostState,
  action: Extract<RoyalPostAction, { type: 'chancellor-keep' }>,
  by: PlayerId,
  now: number,
  timedOut = false,
): Result {
  const round = state.round;
  if (state.phase !== 'playing' || !round) return new GameError('not-playing', 'No round in play.');
  if (round.current !== by) return new GameError('not-your-turn', "It's not your turn.");
  if (round.stage !== 'chancellor')
    return new GameError('wrong-stage', 'There is nothing to choose right now.');
  const hand = round.players[by]!.hand;
  const chosen = [action.keep, ...action.bottomOrder];
  const remaining = [...hand];
  for (const c of chosen) {
    const i = remaining.indexOf(c);
    if (i < 0) return new GameError('not-in-hand', 'Choose from the cards in your hand.');
    remaining.splice(i, 1);
  }
  if (remaining.length > 0)
    return new GameError('wrong-count', 'Keep one card and put the rest on the bottom.');
  let next = withRound(state, { deck: [...round.deck, ...action.bottomOrder], stage: 'play' });
  next = withPlayer(next, by, { hand: [action.keep] });
  if (action.bottomOrder.length > 0) {
    // Only the Chancellor knows what went under the deck: a private note, which the card count
    // uses while those cards are still in the deck.
    const note: NewNote = {
      kind: 'bottom',
      cards: [...action.bottomOrder],
      from: round.deck.length,
      at: round.topDrawn ?? 0,
      ...(timedOut ? { timedOut: true } : {}),
    };
    next = addNote(next, by, note);
  }
  if (timedOut) {
    // Say so on the Chancellor line, so nobody thinks the slow player chose.
    const at = next.log.findLastIndex((e) => e.kind === 'play' && e.by === by);
    const entry = next.log[at];
    if (entry?.kind === 'play' && entry.card === 'chancellor') {
      next = { ...next, log: next.log.with(at, { ...entry, autoKept: true }) };
    }
  }
  return finishTurn(next, now);
}

// ---- Lobby and between rounds ----

function requireHost(ctx: Ctx) {
  return ctx.isHost ? null : new GameError('not-host', 'Only the host can do that.');
}

function updateSettings(
  state: RoyalPostState,
  action: Extract<RoyalPostAction, { type: 'update-settings' }>,
  ctx: Ctx,
): Result {
  const err = requireHost(ctx);
  if (err) return err;
  if (state.phase === 'playing')
    return new GameError('in-progress', 'Settings can only change between games.');
  const settings = { ...state.settings };
  if (action.edition) settings.edition = action.edition;
  if (action.turnSeconds !== undefined) settings.turnSeconds = action.turnSeconds;
  if (action.timerMode !== undefined) settings.timerMode = action.timerMode;
  if (action.short !== undefined) settings.short = action.short;
  // An edition with more seats seats whoever was waiting for one, as the lobby does newcomers.
  return seatWaiting({ ...state, settings });
}

/**
 * Sits down, in join order, everyone who is watching only for want of a seat, while the
 * edition has room. Players who chose to watch stay watching.
 */
export function seatWaiting(state: RoyalPostState): RoyalPostState {
  let free = editionOf(state).maxPlayers - players(state).length;
  if (free <= 0 || !Object.values(state.seats).some((s) => s.waiting)) return state;
  const seats = { ...state.seats };
  for (const [id, seat] of Object.entries(seats)) {
    if (!seat.waiting || seat.playing) continue;
    if (free <= 0) break;
    const { waiting: _, ...rest } = seat;
    seats[id] = { ...rest, playing: true };
    free -= 1;
  }
  return { ...state, seats };
}

function sit(state: RoyalPostState, playing: boolean, ctx: Ctx): Result {
  const seat = state.seats[ctx.by];
  if (!seat) return new GameError('not-seated', 'You are not in this game.');
  if (seat.playing === playing) {
    // "Just watch" from someone waiting for a seat: they'd rather keep watching.
    if (!seat.waiting) return state;
    const { waiting: _, ...rest } = seat;
    return { ...state, seats: { ...state.seats, [ctx.by]: rest } };
  }
  if (state.phase === 'playing')
    return new GameError('in-progress', 'You can sit down or stand up between games.');
  if (playing && players(state).length >= editionOf(state).maxPlayers) {
    return new GameError('full', `Only ${editionOf(state).maxPlayers} can play this edition.`);
  }
  // A choice either way: a player who stands up stays up until they sit down again.
  const { waiting: _, ...rest } = seat;
  return { ...state, seats: { ...state.seats, [ctx.by]: { ...rest, playing } } };
}

function start(state: RoyalPostState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  if (state.phase === 'playing') return new GameError('in-progress', 'A game is already running.');
  // Late joiners who watched the last game are dealt in, if there's a seat.
  state = seatWaiting(state);
  const edition = editionOf(state);
  const seated = players(state);
  if (seated.length < edition.minPlayers)
    return new GameError('too-few', `${edition.minPlayers} players are needed.`);
  if (seated.length > edition.maxPlayers)
    return new GameError('too-many', `At most ${edition.maxPlayers} can play this edition.`);
  const seats = Object.fromEntries(
    Object.entries(state.seats).map(([id, s]) => [id, { ...s, tokens: 0 }]),
  );
  const next: RoyalPostState = {
    ...state,
    phase: 'playing',
    seats,
    target: tokensToWin(edition, seated.length, state.settings.short),
    round: null,
    log: [],
    notes: {},
    winners: [],
    endReason: null,
    gamesPlayed: state.gamesPlayed + 1,
  };
  const first = seated[ctx.rng.int(seated.length)]!;
  return beginRound(next, first, ctx.now, ctx.rng);
}

function nextRound(state: RoyalPostState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  const round = state.round;
  if (state.phase !== 'playing' || !round || round.stage !== 'over')
    return new GameError('wrong-stage', 'Finish this round first.');
  // The round winner starts; with several (or none still seated), one is picked at random.
  const seated = players(state);
  const winners = (round.result?.winners ?? []).filter((id) => seated.includes(id));
  const pool = winners.length > 0 ? winners : seated;
  return beginRound(state, pool[ctx.rng.int(pool.length)]!, ctx.now, ctx.rng);
}

function backToLobby(state: RoyalPostState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  return seatWaiting({
    ...state,
    phase: 'lobby',
    round: null,
    log: [],
    notes: {},
    winners: [],
    endReason: null,
  });
}

function reduce(state: RoyalPostState, action: RoyalPostAction, ctx: Ctx): Result {
  switch (action.type) {
    case 'update-settings':
      return updateSettings(state, action, ctx);
    case 'sit':
      return sit(state, action.playing, ctx);
    case 'start':
      return start(state, ctx);
    case 'play':
      return play(state, action, ctx.by, ctx.now);
    case 'chancellor-keep':
      return chancellorKeep(state, action, ctx.by, ctx.now);
    case 'next-round':
      return nextRound(state, ctx);
    case 'back-to-lobby':
      return backToLobby(state, ctx);
  }
}

// ---- Players coming and going ----

function create(ctx: CreateCtx, playersIn: readonly PlayerInfo[]): RoyalPostState {
  let state: RoyalPostState = {
    phase: 'lobby',
    settings: { edition: 'classic', turnSeconds: null, timerMode: 'soft' },
    seed: newSeed(ctx.rng),
    seats: {},
    target: 0,
    round: null,
    log: [],
    notes: {},
    seq: 0,
    winners: [],
    endReason: null,
    gamesPlayed: 0,
  };
  for (const p of playersIn) state = playerJoined(state, p);
  return state;
}

function playerJoined(state: RoyalPostState, player: PlayerInfo): RoyalPostState {
  const existing = state.seats[player.id];
  if (existing)
    return { ...state, seats: { ...state.seats, [player.id]: { ...existing, name: player.name } } };
  // Between games newcomers sit down if there's room; otherwise they wait for a seat, and are
  // seated at the next game (or as soon as an edition with more seats is picked).
  const playing = state.phase !== 'playing' && players(state).length < editionOf(state).maxPlayers;
  const seat: Seat = {
    name: player.name,
    playing,
    tokens: 0,
    ...(playing ? {} : { waiting: true }),
  };
  return { ...state, seats: { ...state.seats, [player.id]: seat } };
}

/**
 * Someone left for good. Mid-round they are knocked out and their hand is shown; if it was their
 * turn, play moves on. With fewer than two players left, the game ends.
 */
function playerLeft(state: RoyalPostState, playerId: PlayerId, now: number): RoyalPostState {
  const seat = state.seats[playerId];
  if (!seat) return state;
  const seats = { ...state.seats };
  delete seats[playerId];
  const notes = { ...state.notes };
  delete notes[playerId];
  let next: RoyalPostState = { ...state, seats, notes };
  const round = next.round;
  if (next.phase !== 'playing' || !round || !seat.playing) return next;
  const inRound = round.players[playerId];
  if (inRound && !inRound.out && round.stage === 'chancellor' && round.current === playerId) {
    // Leaving mid-choice: the drawn cards go back under the deck, unseen, so only the card they
    // held before the Chancellor is shown as they leave.
    const drew = inRound.hand.length - 1;
    const back = inRound.hand.slice(-drew);
    next = withRound(next, { deck: [...round.deck, ...back], stage: 'play' });
    next = withPlayer(next, playerId, { hand: inRound.hand.slice(0, -drew) });
  }
  if (inRound && !inRound.out && round.stage !== 'over') {
    next = knockOut(next, playerId, 'left', null);
  } else if (inRound) {
    next = withPlayer(next, playerId, { left: true });
  }
  if (players(next).length < MIN_PLAYERS) return endGame(next, 'too-few');
  const r = next.round!;
  if (r.stage === 'over' || !inRound) return next;
  if (alive(r).length <= 1) return endRound(next, 'last-standing');
  if (r.current === playerId) return finishTurn(withRound(next, { stage: 'play' }), now);
  return next;
}

// ---- Timers ----

function nextDeadline(state: RoyalPostState): number | null {
  if (state.phase !== 'playing' || state.settings.timerMode !== 'strict') return null;
  const round = state.round;
  if (!round || round.stage === 'over') return null;
  return round.deadline;
}

/**
 * The move made for a player: on the Chancellor, keep a random card; otherwise the lower card
 * (unless the Countess must go), at a random valid target, with a random Guard guess. Shared by
 * the strict timer (from the state) and playtest bots (from their own view).
 */
function pickMove(
  edition: EditionConfig,
  hand: readonly Role[],
  stage: RoundStage,
  me: PlayerId,
  targetsFor: (card: Role) => PlayerId[],
  rng: Rng,
): RoyalPostAction | null {
  if (hand.length === 0) return null;
  if (stage === 'chancellor') {
    const keepAt = rng.int(hand.length);
    return {
      type: 'chancellor-keep',
      keep: hand[keepAt]!,
      bottomOrder: hand.filter((_, i) => i !== keepAt),
    };
  }
  // The lower card, unless the Countess must be played.
  const card = mustPlayCountess(hand)
    ? 'countess'
    : [...hand].sort((a, b) => rankOf(edition, a) - rankOf(edition, b))[0]!;
  const targets = targetsFor(card);
  const others = targets.filter((id) => id !== me);
  const pool = others.length > 0 ? others : targets;
  const target = pool.length > 0 ? pool[rng.int(pool.length)] : undefined;
  const guesses = guardGuesses(edition);
  const guess = card === 'guard' && target ? guesses[rng.int(guesses.length)] : undefined;
  return {
    type: 'play',
    card,
    ...(target ? { target } : {}),
    ...(guess ? { guess } : {}),
  };
}

/** The move a strict timer makes for a player who ran out of time. */
export function autoMove(state: RoyalPostState, rng: Rng): RoyalPostAction | null {
  const round = state.round;
  if (!round || round.stage === 'over') return null;
  const me = round.current;
  return pickMove(
    editionOf(state),
    round.players[me]!.hand,
    round.stage,
    me,
    (card) => validTargets(round, me, card),
    rng,
  );
}

/** A playtest bot's move, from its own view only: the strict timer's move, on its own turn. */
export function royalPostBot(view: RoyalPostView, ctx: BotCtx): RoyalPostAction | null {
  const round = view.round;
  if (view.phase !== 'playing' || !round || round.stage === 'over') return null;
  if (round.current !== ctx.me) return null;
  const alive = round.players.filter((p) => !p.out);
  const targetsFor = (card: Role) => {
    if (!needsTarget(card)) return [];
    const others = alive.filter((p) => p.id !== ctx.me && !p.protected).map((p) => p.id);
    return card === 'prince' ? [...others, ctx.me] : others;
  };
  return pickMove(
    EDITIONS[view.settings.edition],
    view.hand,
    round.stage,
    ctx.me,
    targetsFor,
    ctx.rng,
  );
}

/** A strict timer plays for the slow player, so the round always moves on. */
function onDeadline(state: RoyalPostState, now: number): RoyalPostState {
  const due = nextDeadline(state);
  if (due === null || now < due) return state;
  const round = state.round!;
  const rng = hiddenRng(state, now);
  const move = autoMove(state, rng);
  const result =
    move?.type === 'play'
      ? play(state, move, round.current, now, true)
      : move?.type === 'chancellor-keep'
        ? chancellorKeep(state, move, round.current, now, true)
        : null;
  if (!result || result instanceof GameError) return withRound(state, { deadline: null });
  return { ...result, seed: newSeed(rng) };
}

// ---- Views ----

/**
 * The cards a player's Chancellor notes say are still in the deck: each sits `from + i` places
 * from the top when put there, and moves up one for every card since taken off the top. Cards put
 * underneath later don't move it, so a card is still there until enough have been drawn.
 */
export function knownDeck(round: Round, notes: readonly Note[]): Role[] {
  if (round.stage === 'over') return [];
  const drawn = round.topDrawn ?? 0;
  const known: { at: number; card: Role }[] = [];
  for (const n of notes) {
    if (n.kind !== 'bottom' || n.round !== round.number) continue;
    n.cards.forEach((card, i) => {
      const place = n.from + i - (drawn - n.at);
      if (place >= 0) known.push({ at: place, card });
    });
  }
  return known.sort((a, b) => a.at - b.at).map((k) => k.card);
}

function view(state: RoyalPostState, viewer: PlayerId | null): RoyalPostView {
  const seatViews: SeatView[] = Object.entries(state.seats).map(([id, s]) => ({
    id,
    name: s.name,
    playing: s.playing,
    tokens: s.tokens,
    ...(s.waiting ? { waiting: true } : {}),
  }));
  const me = viewer === null ? null : (seatViews.find((s) => s.id === viewer) ?? null);
  const round = state.round;
  const edition = editionOf(state);
  return {
    phase: state.phase,
    settings: state.settings,
    seats: seatViews,
    me,
    target:
      state.phase === 'lobby'
        ? tokensToWin(edition, seatViews.filter((s) => s.playing).length, state.settings.short)
        : state.target,
    round: round
      ? {
          number: round.number,
          players: round.order.map((id) => {
            const p = round.players[id]!;
            return {
              id,
              name: state.seats[id]?.name ?? p.name,
              out: p.out,
              protected: p.protected,
              left: p.left,
              discards: [...p.discards],
              handCount: p.hand.length,
            };
          }),
          current: round.current,
          stage: round.stage,
          deckCount: round.deck.length,
          setAside: round.setAside !== null,
          faceUp: [...round.faceUp],
          deadline: round.deadline,
          result: round.result,
        }
      : null,
    hand: viewer === null || !round ? [] : [...(round.players[viewer]?.hand ?? [])],
    log: state.log,
    notes: viewer === null ? [] : [...(state.notes[viewer] ?? [])],
    knownDeck: viewer === null || !round ? [] : knownDeck(round, state.notes[viewer] ?? []),
    winners: state.winners,
    endReason: state.endReason,
  };
}

export const royalPost: GameDefinition<RoyalPostState, RoyalPostAction, RoyalPostView> = {
  id: 'royal-post',
  name: 'Royal Post',
  description: 'Win the royal favour with one card in hand: deduce, protect and outlast.',
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
  awards: royalPostAwards,
  bot: royalPostBot,
};
