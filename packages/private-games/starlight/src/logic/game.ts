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
import { starlightAwards } from './awards.ts';
import { starlightBot } from './bot.ts';
import { guide } from './guide.ts';
import { insights } from './insights.ts';
import { keptListIds, offeredLists, wordsFrom } from './lobby.ts';
import { announce, finish, nextScout, present, show, starsOf, unshown } from './reveal.ts';
import {
  CARDS_PER_GAME,
  CARD_SETS,
  COLUMNS,
  GRID,
  MAX_MARKS,
  MAX_PLAYERS,
  MIN_MARKS,
  MIN_PLAYERS,
  REPLACED_LINE,
  ROUNDS,
  type Round,
  type RoundView,
  SEAT_COLORS,
  STELLAR_SET,
  type Seat,
  type SeatView,
  type StarlightAction,
  type StarlightState,
  type StarlightView,
  actionSchema,
  cardsIn,
} from './types.ts';

type Ctx = ActionCtx;
type Result = StarlightState | GameError;

const deadline = (seconds: number | null, now: number) =>
  seconds === null ? null : now + seconds * 1000;

const total = (seat: { rounds: number[] }) => seat.rounds.reduce((a, b) => a + b, 0);

export function players(state: StarlightState): PlayerId[] {
  return Object.entries(state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));
}

/** Randomness for deadlines and leavers, mixed with the hidden seed so the clock can't replay it. */
const hiddenRng = (state: StarlightState, now: number) => createRng((state.seed ^ now) >>> 0);
const newSeed = (rng: Rng) => rng.int(2 ** 32);

function nextColor(state: StarlightState) {
  const used = new Set(Object.values(state.seats).map((s) => s.color));
  return SEAT_COLORS.find((c) => !used.has(c)) ?? SEAT_COLORS[0];
}

/** The card pool of the chosen sets. */
export const poolOf = (sets: readonly string[]) =>
  CARD_SETS.filter((s) => sets.includes(s.id)).flatMap(cardsIn);

/** Sets the clock for the round's current step. */
function timed(state: StarlightState, round: Round, now: number): Round {
  const s = state.settings;
  const seconds =
    round.stage === 'mark' ? s.clueSeconds : round.stage === 'reveal' ? s.guessSeconds : null;
  return { ...round, deadline: deadline(seconds, now) };
}

function withRound(state: StarlightState, round: Round, now: number): StarlightState {
  const stepped = round.stage === 'done' ? round : timed(state, round, now);
  if (round.stage !== 'done' || !round.results || state.round?.stage === 'done')
    return { ...state, round: stepped };
  // The round has just been scored: write each player's points.
  const seats = { ...state.seats };
  for (const [id, r] of Object.entries(round.results)) {
    const seat = seats[id];
    if (seat) seats[id] = { ...seat, rounds: [...seat.rounds, r.points] };
  }
  return { ...state, seats, round: stepped };
}

function beginRound(
  state: StarlightState,
  no: number,
  first: PlayerId,
  board: number[],
  fresh: number[],
  now: number,
): StarlightState {
  const [word, ...words] = state.words;
  const round: Round = {
    no,
    first,
    players: players(state),
    gone: [],
    board,
    fresh,
    word: word!,
    stage: 'mark',
    marks: {},
    locked: [],
    counts: null,
    dark: null,
    scout: null,
    shown: [],
    fallen: [],
    results: null,
    deadline: null,
    autoLocked: [],
  };
  return { ...state, words, round: timed(state, round, now) };
}

/** The first playing seat after `from`, clockwise; from the first seat if `from` has gone. */
function playingAfter(state: StarlightState, from: PlayerId, order: readonly PlayerId[]) {
  const i = order.indexOf(from);
  const ring = i < 0 ? order : [...order.slice(i + 1), ...order.slice(0, i + 1)];
  return ring.find((id) => state.seats[id]?.playing) ?? players(state)[0];
}

function endGame(state: StarlightState, endReason: StarlightState['endReason']): StarlightState {
  const seated = players(state);
  const pool = seated.length ? seated : Object.keys(state.seats);
  const top = Math.max(...pool.map((id) => total(state.seats[id]!)));
  return {
    ...state,
    phase: 'over',
    winners: pool.filter((id) => total(state.seats[id]!) === top),
    endReason,
    round: state.round ? { ...state.round, deadline: null } : null,
  };
}

// ---- Rooms saved before the word-switch step went ----

/** A round as saved while the First Scout could still switch a two-word card's word. */
interface SavedRound extends Omit<Round, 'stage' | 'word'> {
  stage: Round['stage'] | 'word';
  word?: string;
  card?: string[];
  side?: 0 | 1;
}

const isSaved = (state: StarlightState) => {
  const round = state.round as SavedRound | null;
  return (
    state.words.some((w) => typeof w !== 'string') ||
    (!!round && (round.word === undefined || round.stage === 'word'))
  );
};

/**
 * Brings a room saved with word cards up to date: each card plays its chosen word (the top one if
 * nobody had chosen yet), and a round waiting on the choice moves on to marking, timed from `now`
 * (or keeping its clock when only viewing).
 */
function upgraded(state: StarlightState, now: number | null): StarlightState {
  if (!isSaved(state)) return state;
  const words = (state.words as unknown[]).map((w) =>
    Array.isArray(w) ? String(w[0]) : String(w),
  );
  const saved = state.round as SavedRound | null;
  if (!saved) return { ...state, words };
  const { card, side, ...rest } = saved;
  const word = saved.word ?? card?.[side ?? 0] ?? card?.[0] ?? '';
  const round: Round = { ...rest, word, stage: rest.stage === 'word' ? 'mark' : rest.stage };
  const next = { ...state, words };
  return saved.stage === 'word' && now !== null
    ? { ...next, round: timed(next, round, now) }
    : { ...next, round };
}

// ---- Lobby ----

/** Keeps the offered word lists fresh between games, and the selection to lists still offered. */
function refreshLists(state: StarlightState, ctx: Ctx): StarlightState {
  if (state.phase === 'playing') return state;
  const wordLists = offeredLists(ctx.content);
  const wordListIds = keptListIds(state.settings.wordListIds, wordLists);
  return { ...state, wordLists, settings: { ...state.settings, wordListIds } };
}

function requireHost(ctx: Ctx) {
  return ctx.isHost ? null : new GameError('not-host', 'Only the host can do that.');
}

function updateSettings(
  state: StarlightState,
  action: Extract<StarlightAction, { type: 'update-settings' }>,
  ctx: Ctx,
): Result {
  const err = requireHost(ctx);
  if (err) return err;
  if (state.phase === 'playing')
    return new GameError('in-progress', 'Settings can only change between games.');
  const settings = { ...state.settings };
  if (action.sets) {
    const known = new Set(CARD_SETS.map((s) => s.id));
    if (action.sets.some((id) => !known.has(id)))
      return new GameError('unknown-set', 'That card set does not exist.');
    settings.sets = [...action.sets];
  }
  if (action.wordListIds) {
    const offered = new Set(state.wordLists.map((l) => l.id));
    if (action.wordListIds.some((id) => !offered.has(id)))
      return new GameError('unknown-list', 'That word list is not available.');
    settings.wordListIds = [...action.wordListIds];
  }
  if (action.clueSeconds !== undefined) settings.clueSeconds = action.clueSeconds;
  if (action.guessSeconds !== undefined) settings.guessSeconds = action.guessSeconds;
  if (action.timerMode !== undefined) settings.timerMode = action.timerMode;
  return { ...state, settings };
}

/** Seats change in the lobby, at the end, and between rounds. */
export const seatsOpen = (state: { phase: string; round: { stage: string } | null }) =>
  state.phase !== 'playing' || state.round?.stage === 'done';

function sit(state: StarlightState, playing: boolean, ctx: Ctx): Result {
  const seat = state.seats[ctx.by];
  if (!seat) return new GameError('not-seated', 'You are not in this game.');
  if (seat.playing === playing) return state;
  if (!seatsOpen(state))
    return new GameError('in-progress', 'You can sit down or stand up between rounds.');
  if (playing && players(state).length >= MAX_PLAYERS)
    return new GameError('full', `Only ${MAX_PLAYERS} can play at once.`);
  return { ...state, seats: { ...state.seats, [ctx.by]: { ...seat, playing } } };
}

/** Why the host can't start yet, or null. */
export function startProblem(state: StarlightState, words: number): string | null {
  const n = players(state).length;
  if (n < MIN_PLAYERS) return `${MIN_PLAYERS} players are needed.`;
  if (n > MAX_PLAYERS) return `At most ${MAX_PLAYERS} can play.`;
  if (poolOf(state.settings.sets).length < CARDS_PER_GAME)
    return `The chosen card sets need at least ${CARDS_PER_GAME} cards.`;
  if (words < ROUNDS) return `The chosen word lists need at least ${ROUNDS} words.`;
  return null;
}

function start(state: StarlightState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  if (state.phase === 'playing') return new GameError('in-progress', 'A game is already running.');
  const words = wordsFrom(ctx.content, state.settings.wordListIds);
  const problem = startProblem(state, words.length);
  if (problem) return new GameError('cannot-start', problem);
  const deck = ctx.rng.shuffle(poolOf(state.settings.sets)).slice(0, CARDS_PER_GAME);
  const seats = Object.fromEntries(
    Object.entries(state.seats).map(([id, s]) => [id, { ...s, rounds: [] }]),
  );
  const seated = players(state);
  const next: StarlightState = {
    ...state,
    phase: 'playing',
    seats,
    seed: newSeed(ctx.rng),
    pile: deck.slice(GRID),
    words: ctx.rng.shuffle(words).slice(0, ROUNDS),
    winners: [],
    endReason: null,
    gamesPlayed: state.gamesPlayed + 1,
    departed: {},
  };
  const first = seated[ctx.rng.int(seated.length)]!;
  return beginRound(next, 1, first, deck.slice(0, GRID), [], ctx.now);
}

function backToLobby(state: StarlightState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  return {
    ...state,
    phase: 'lobby',
    round: null,
    pile: [],
    words: [],
    winners: [],
    endReason: null,
  };
}

// ---- A round ----

function inRound(state: StarlightState, by: PlayerId): Round | GameError {
  const round = state.round;
  if (state.phase !== 'playing' || !round)
    return new GameError('not-playing', 'No game in progress.');
  if (!present(round).includes(by)) return new GameError('watching', "You're watching this round.");
  return round;
}

function marking(state: StarlightState, ctx: Ctx): Round | GameError {
  const round = inRound(state, ctx.by);
  if (round instanceof GameError) return round;
  if (round.stage !== 'mark')
    return new GameError('wrong-stage', 'The cards are already chosen for this round.');
  return round;
}

function mark(state: StarlightState, positions: number[], ctx: Ctx): Result {
  const round = marking(state, ctx);
  if (round instanceof GameError) return round;
  if (round.locked.includes(ctx.by))
    return new GameError('locked', 'Unlock your slate to change it.');
  return {
    ...state,
    round: { ...round, marks: { ...round.marks, [ctx.by]: [...positions].sort((a, b) => a - b) } },
  };
}

/** Once everyone has locked, the slates are final: the Announce, then the Reveal begins. */
function maybeAnnounce(state: StarlightState, round: Round, now: number): StarlightState {
  if (!present(round).every((id) => round.locked.includes(id))) return { ...state, round };
  return withRound(state, announce(round), now);
}

function lock(state: StarlightState, ctx: Ctx): Result {
  const round = marking(state, ctx);
  if (round instanceof GameError) return round;
  if (round.locked.includes(ctx.by)) return state;
  const n = (round.marks[ctx.by] ?? []).length;
  if (n < MIN_MARKS || n > MAX_MARKS)
    return new GameError('marks', `Mark at least ${MIN_MARKS} and at most ${MAX_MARKS} cards.`);
  return maybeAnnounce(state, { ...round, locked: [...round.locked, ctx.by] }, ctx.now);
}

function unlock(state: StarlightState, ctx: Ctx): Result {
  const round = marking(state, ctx);
  if (round instanceof GameError) return round;
  return { ...state, round: { ...round, locked: round.locked.filter((id) => id !== ctx.by) } };
}

function showCard(state: StarlightState, pos: number, ctx: Ctx): Result {
  const round = inRound(state, ctx.by);
  if (round instanceof GameError) return round;
  const next = show(round, pos, ctx.by);
  return next instanceof GameError ? next : withRound(state, next, ctx.now);
}

function nextRound(state: StarlightState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  const round = state.round;
  if (state.phase !== 'playing' || !round || round.stage !== 'done')
    return new GameError('wrong-stage', 'Finish this round first.');
  if (round.no >= ROUNDS) return endGame(state, 'rounds');
  if (players(state).length < MIN_PLAYERS) return endGame(state, 'too-few');
  // Replace the line for this round's token: bottom after I, middle after II, top after III.
  const line = REPLACED_LINE[round.no - 1]!;
  const fresh = Array.from({ length: COLUMNS }, (_, c) => line * COLUMNS + c);
  const drawn = state.pile.slice(0, COLUMNS);
  const board = round.board.map((card, pos) =>
    fresh.includes(pos) ? drawn[fresh.indexOf(pos)]! : card,
  );
  const first = playingAfter(state, round.first, Object.keys(state.seats))!;
  return beginRound(
    { ...state, pile: state.pile.slice(COLUMNS) },
    round.no + 1,
    first,
    board,
    fresh,
    ctx.now,
  );
}

function reduce(state: StarlightState, action: StarlightAction, ctx: Ctx): Result {
  const current = refreshLists(upgraded(state, ctx.now), ctx);
  switch (action.type) {
    case 'update-settings':
      return updateSettings(current, action, ctx);
    case 'sit':
      return sit(current, action.playing, ctx);
    case 'start':
      return start(current, ctx);
    case 'back-to-lobby':
      return backToLobby(current, ctx);
    case 'mark':
      return mark(current, action.positions, ctx);
    case 'lock':
      return lock(current, ctx);
    case 'unlock':
      return unlock(current, ctx);
    case 'show':
      return showCard(current, action.pos, ctx);
    case 'next-round':
      return nextRound(current, ctx);
  }
}

// ---- Players coming and going ----

function create(ctx: CreateCtx, playersIn: readonly PlayerInfo[]): StarlightState {
  const wordLists = offeredLists(ctx.content);
  let state: StarlightState = {
    phase: 'lobby',
    settings: {
      sets: [STELLAR_SET],
      wordListIds: keptListIds([], wordLists),
      clueSeconds: null,
      guessSeconds: null,
      timerMode: 'soft',
    },
    wordLists,
    seed: newSeed(ctx.rng),
    seats: {},
    pile: [],
    words: [],
    round: null,
    winners: [],
    endReason: null,
    gamesPlayed: 0,
    departed: {},
  };
  for (const p of playersIn) state = playerJoined(state, p);
  return state;
}

function playerJoined(state: StarlightState, player: PlayerInfo): StarlightState {
  const existing = state.seats[player.id];
  if (existing) {
    const seat = { ...existing, name: player.name, color: player.color ?? existing.color };
    return { ...state, seats: { ...state.seats, [player.id]: seat } };
  }
  // Between games newcomers sit straight down (if there's room); mid-game they watch until a
  // round ends. Someone coming back picks their round scores up again.
  const playing = state.phase !== 'playing' && players(state).length < MAX_PLAYERS;
  const kept = state.departed[player.id];
  const seat: Seat = {
    name: player.name,
    color: player.color ?? nextColor(state),
    playing,
    rounds: state.phase === 'lobby' ? [] : (kept ?? []),
  };
  const departed = { ...state.departed };
  delete departed[player.id];
  return { ...state, departed, seats: { ...state.seats, [player.id]: seat } };
}

function playerLeft(saved: StarlightState, id: PlayerId, now: number): StarlightState {
  const state = upgraded(saved, now);
  const seat = state.seats[id];
  if (!seat) return state;
  const seats = { ...state.seats };
  delete seats[id];
  const departed =
    state.phase === 'lobby' ? state.departed : { ...state.departed, [id]: seat.rounds };
  const next: StarlightState = { ...state, seats, departed };
  const round = state.round;
  if (state.phase !== 'playing' || !round || !present(round).includes(id) || round.stage === 'done')
    return next;
  const order = Object.keys(state.seats);
  if (round.stage === 'mark') {
    // Nothing is public yet: the leaver's slate simply goes. A leaving First Scout hands the
    // pawn on clockwise.
    const marks = { ...round.marks };
    delete marks[id];
    const rest: Round = {
      ...round,
      players: round.players.filter((p) => p !== id),
      marks,
      locked: round.locked.filter((p) => p !== id),
      first: round.first === id ? (playingAfter(next, id, order) ?? round.first) : round.first,
    };
    if (rest.players.length < MIN_PLAYERS) return endGame({ ...next, round: rest }, 'too-few');
    return maybeAnnounce(next, rest, now);
  }
  // Mid-Reveal the crosses are on the table: they keep counting for others, like a fallen
  // player's, but the leaver scouts and scores no more.
  const rest: Round = { ...round, gone: [...round.gone, id] };
  if (present(rest).length < MIN_PLAYERS) return endGame({ ...next, round: rest }, 'too-few');
  if (rest.scout !== id) return { ...next, round: rest };
  const scout = nextScout(rest, id);
  return withRound(next, scout === null ? finish(rest) : { ...rest, scout }, now);
}

// ---- Timers ----

function nextDeadline(state: StarlightState): number | null {
  if (state.phase !== 'playing' || state.settings.timerMode !== 'strict') return null;
  return state.round?.deadline ?? null;
}

/**
 * Strict timers only, and always progress: unlocked slates lock as they stand (one random card for an empty one); a Scout shows a random cross of theirs.
 */
function onDeadline(saved: StarlightState, now: number): StarlightState {
  const due = nextDeadline(saved);
  if (due === null || now < due || !saved.round) return saved;
  // A room saved while its First Scout chose the word only moves on to marking.
  if ((saved.round as SavedRound).stage === 'word') return upgraded(saved, now);
  const state = upgraded(saved, now);
  const round = state.round!;
  const rng = hiddenRng(state, now);
  if (round.stage === 'mark') {
    const marks = { ...round.marks };
    const autoLocked: PlayerId[] = [];
    for (const id of present(round)) {
      if (round.locked.includes(id)) continue;
      autoLocked.push(id);
      if (!(marks[id] ?? []).length) marks[id] = [rng.int(GRID)];
    }
    return maybeAnnounce(state, { ...round, marks, locked: present(round), autoLocked }, now);
  }
  if (round.stage === 'reveal' && round.scout) {
    const options = unshown(round, round.scout);
    const next = show(round, options[rng.int(options.length)]!, round.scout, true);
    return next instanceof GameError ? state : withRound(state, next, now);
  }
  return { ...state, round: { ...round, deadline: null } };
}

// ---- Views ----

function roundView(round: Round, viewer: PlayerId | null): RoundView {
  const counts = round.counts;
  return {
    no: round.no,
    first: round.first,
    players: [...round.players],
    board: [...round.board],
    fresh: [...round.fresh],
    word: round.word,
    stage: round.stage,
    myMarks: viewer === null ? [] : [...(round.marks[viewer] ?? [])],
    locked: [...round.locked],
    counts: counts ? { ...counts } : null,
    dark: round.dark,
    scout: round.scout,
    shown: round.shown.map((s) => ({ ...s, markers: [...s.markers], stars: { ...s.stars } })),
    fallen: [...round.fallen],
    gone: [...round.gone],
    left: counts
      ? Object.fromEntries(round.players.map((id) => [id, unshown(round, id).length]))
      : null,
    stars: Object.fromEntries(round.players.map((id) => [id, starsOf(round, id)])),
    results: round.results,
    deadline: round.deadline,
    autoLocked: [...round.autoLocked],
  };
}

function view(saved: StarlightState, viewer: PlayerId | null): StarlightView {
  const state = upgraded(saved, null);
  const seats: SeatView[] = Object.entries(state.seats).map(([id, s]) => ({
    id,
    name: s.name,
    color: s.color,
    playing: s.playing,
    score: total(s),
    rounds: [...s.rounds],
  }));
  return {
    phase: state.phase,
    settings: state.settings,
    wordLists: state.wordLists,
    seats,
    me: viewer === null ? null : (seats.find((s) => s.id === viewer) ?? null),
    round: state.round ? roundView(state.round, viewer) : null,
    winners: state.winners,
    endReason: state.endReason,
  };
}

export const starlight: GameDefinition<StarlightState, StarlightAction, StarlightView> = {
  id: 'starlight',
  name: 'Starlight',
  description: 'Secretly mark the pictures a word brings to mind, then hope others saw them too.',
  minPlayers: MIN_PLAYERS,
  maxPlayers: 30,
  maxSeated: MAX_PLAYERS,
  access: 'private',
  usesWordLists: true,
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
  awards: starlightAwards,
  bot: starlightBot,
};
