import {
  type ActionCtx,
  type ContentProvider,
  type CreateCtx,
  type GameDefinition,
  GameError,
  type PlayerId,
  type PlayerInfo,
  type Question,
  type QuestionDeckSummary,
  createRng,
  wordKey,
} from '@vt/game-sdk';
import { guide } from './guide.ts';
import { insights } from './insights.ts';
import {
  AUTO_FOOL_POINTS,
  DEFAULT_ROUNDS,
  FOOL_POINTS,
  type HoodwinkAction,
  type HoodwinkState,
  type HoodwinkView,
  MAX_LIE_LENGTH,
  MAX_PLAYERS,
  MAX_USED_QUESTIONS,
  MIN_OPTIONS,
  MIN_PLAYERS,
  type Option,
  type OptionView,
  POINT_STEP,
  type Role,
  type Round,
  type RoundView,
  type Score,
  type ScoreView,
  type Seat,
  TRUTH_POINTS,
  actionSchema,
} from './types.ts';

type Ctx = ActionCtx;
type Result = HoodwinkState | GameError;

const SEED_RANGE = 0x1_0000_0000;
const ROOM_CAPACITY = 20;

export function playingIds(state: HoodwinkState): PlayerId[] {
  return Object.entries(state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));
}

const deadline = (seconds: number | null, now: number) =>
  seconds === null ? null : now + seconds * 1000;

const offeredDecks = (content: ContentProvider): QuestionDeckSummary[] =>
  content.questionDecks?.() ?? [];

/** The decks a new room starts with: every deck that isn't adults-only. */
export const defaultDeckIds = (decks: readonly QuestionDeckSummary[]) =>
  decks.filter((d) => !d.adult).map((d) => d.id);

/** Points for one round: the final round counts double. */
export const multiplier = (round: Pick<Round, 'number'>, rounds: number) =>
  round.number >= rounds ? 2 : 1;

/**
 * One author's share of a lie's points, rounded down to a multiple of `POINT_STEP`. A lie the game
 * picked for its author (`auto`) is worth half.
 */
export function liePoints(fooled: number, authors: number, factor: number, auto = false): number {
  if (authors <= 0) return 0;
  const share = ((auto ? AUTO_FOOL_POINTS : FOOL_POINTS) * factor * fooled) / authors;
  return Math.floor(share / POINT_STEP) * POINT_STEP;
}

/** A lie as stored: trimmed, with runs of spaces collapsed. */
export const tidyLie = (text: string) => text.replace(/\s+/g, ' ').trim();

/** How an answer is shown on the board: first letter capitalised, for truth and lies alike. */
export const displayText = (text: string) => {
  const tidy = tidyLie(text);
  return tidy.charAt(0).toLocaleUpperCase('en') + tidy.slice(1);
};

/** Why a lie can't be used, or null if it's fine. */
export function lieProblem(text: string, question?: Pick<Question, 'answer' | 'alternates'>) {
  if (/[\r\n]/.test(text.trim())) return new GameError('lie-lines', 'Keep your lie to one line.');
  const lie = tidyLie(text);
  if (!lie) return new GameError('empty-lie', 'Write a lie first.');
  if (lie.length > MAX_LIE_LENGTH) {
    return new GameError('lie-too-long', `Keep your lie to ${MAX_LIE_LENGTH} characters.`);
  }
  if (question) {
    const key = wordKey(lie);
    if ([question.answer, ...question.alternates].some((a) => wordKey(a) === key)) {
      return new GameError('is-the-truth', 'That’s the real answer — write a lie!');
    }
  }
  return null;
}

// ---- Round flow ----

function endGame(state: HoodwinkState, endReason: 'finished' | 'too-few'): HoodwinkState {
  return { ...state, phase: 'over', round: null, questions: [], endReason };
}

function withRound(state: HoodwinkState, patch: Partial<Round>): HoodwinkState {
  return { ...state, round: { ...state.round!, ...patch } };
}

/** Starts the next question with everyone playing, or ends the game when none are left. */
function beginRound(state: HoodwinkState, number: number, now: number): HoodwinkState {
  const [question, ...questions] = state.questions;
  if (!question || number > state.settings.rounds) return endGame(state, 'finished');
  const players = playingIds(state);
  const scores = { ...state.scores };
  for (const id of players) {
    scores[id] = {
      ...(scores[id] ?? { score: 0, fooled: 0, truths: 0 }),
      name: state.seats[id]!.name,
    };
  }
  return {
    ...state,
    questions,
    scores,
    round: {
      number,
      question,
      stage: 'write',
      players,
      lies: {},
      autoLies: [],
      options: [],
      voters: [],
      votes: {},
      points: {},
      deadline: deadline(state.settings.clueSeconds, now),
    },
  };
}

/** Comparison keys a new decoy must not match: the truth, its alternates and every lie so far. */
function takenKeys(round: Round): Set<string> {
  const { answer, alternates } = round.question;
  return new Set([answer, ...alternates, ...Object.values(round.lies)].map(wordKey));
}

/**
 * Up to `count` distinct built-in fakes for this round, drawn with the hidden seed, none matching
 * the truth or a lie already written.
 */
function pickDecoys(
  state: HoodwinkState,
  round: Round,
  count: number,
  taken = takenKeys(round),
): { picked: string[]; seed: number } {
  const keys = new Set(taken);
  const pool: string[] = [];
  for (const raw of round.question.decoys ?? []) {
    const decoy = tidyLie(raw);
    const key = wordKey(decoy);
    if (!decoy || decoy.length > MAX_LIE_LENGTH || keys.has(key)) continue;
    keys.add(key);
    pool.push(decoy);
  }
  if (count <= 0 || pool.length === 0) return { picked: [], seed: state.seed };
  const rng = createRng(state.seed);
  return { picked: rng.shuffle(pool).slice(0, count), seed: rng.int(SEED_RANGE) };
}

/**
 * Builds the board from the truth and every distinct lie, padded with house fakes up to
 * `MIN_OPTIONS` while the question's decoys last, and shuffled from the hidden seed.
 */
function board(state: HoodwinkState, round: Round): { options: Option[]; seed: number } {
  const groups = new Map<string, Option>();
  for (const id of round.players) {
    const text = round.lies[id];
    if (text === undefined) continue;
    const key = wordKey(text);
    const auto = round.autoLies.includes(id) ? [id] : [];
    const group = groups.get(key);
    if (group) {
      group.authors.push(id);
      group.auto.push(...auto);
    } else {
      groups.set(key, { text: displayText(text), truth: false, authors: [id], auto, house: false });
    }
  }
  const truth: Option = {
    text: displayText(round.question.answer),
    truth: true,
    authors: [],
    auto: [],
    house: false,
  };
  if (groups.size === 0) return { options: [truth], seed: state.seed };
  const { picked, seed } = pickDecoys(state, round, MIN_OPTIONS - 1 - groups.size);
  const house = picked.map((text): Option => ({
    text: displayText(text),
    truth: false,
    authors: [],
    auto: [],
    house: true,
  }));
  const rng = createRng(seed);
  const options = rng.shuffle([truth, ...groups.values(), ...house]);
  return { options, seed: rng.int(SEED_RANGE) };
}

/** Gives every player still without a lie a built-in fake of their own (strict lie timer). */
function fillMissingLies(state: HoodwinkState): HoodwinkState {
  const round = state.round!;
  const missing = round.players.filter((id) => round.lies[id] === undefined);
  const { picked, seed } = pickDecoys(state, round, missing.length);
  if (picked.length === 0) return state;
  const filled = missing.slice(0, picked.length);
  return withRound(
    { ...state, seed },
    {
      lies: { ...round.lies, ...Object.fromEntries(filled.map((id, i) => [id, picked[i]!])) },
      autoLies: [...round.autoLies, ...filled],
    },
  );
}

/** Moves on to voting once every player has written a lie (or the timer forces it). */
function maybeStartVoting(state: HoodwinkState, now: number, force = false): HoodwinkState {
  if (state.phase !== 'playing' || state.round?.stage !== 'write') return state;
  if (force) state = fillMissingLies(state);
  const round = state.round!;
  if (!force && !round.players.every((id) => round.lies[id] !== undefined)) return state;
  const { options, seed } = board(state, round);
  // Without a single lie there's nothing to vote on: straight to the reveal, with no points.
  if (options.length < 2) {
    return withRound({ ...state, seed }, { stage: 'reveal', options, deadline: null });
  }
  return withRound(
    { ...state, seed },
    {
      stage: 'vote',
      options,
      voters: round.players,
      deadline: deadline(state.settings.guessSeconds, now),
    },
  );
}

function reveal(state: HoodwinkState): HoodwinkState {
  const round = state.round!;
  const factor = multiplier(round, state.settings.rounds);
  const points: Record<PlayerId, number> = {};
  const scores: Record<PlayerId, Score> = { ...state.scores };
  const add = (id: PlayerId, patch: Partial<Omit<Score, 'name'>>) => {
    const s = scores[id] ?? { name: state.seats[id]?.name ?? '', score: 0, fooled: 0, truths: 0 };
    scores[id] = {
      ...s,
      score: s.score + (patch.score ?? 0),
      fooled: s.fooled + (patch.fooled ?? 0),
      truths: s.truths + (patch.truths ?? 0),
    };
    points[id] = (points[id] ?? 0) + (patch.score ?? 0);
  };
  for (const id of round.players) points[id] = 0;
  const fooledBy = round.options.map(() => 0);
  for (const [voter, pick] of Object.entries(round.votes)) {
    const option = round.options[pick];
    if (!option) continue;
    if (option.truth) add(voter, { score: TRUTH_POINTS * factor, truths: 1 });
    else fooledBy[pick]! += 1;
  }
  // House fakes have no authors, so whoever picks one simply scores nothing.
  round.options.forEach((option, i) => {
    const fooled = fooledBy[i]!;
    if (option.truth || fooled === 0) return;
    for (const author of option.authors) {
      const auto = option.auto.includes(author);
      add(author, { score: liePoints(fooled, option.authors.length, factor, auto), fooled });
    }
  });
  return {
    ...state,
    scores,
    round: { ...round, stage: 'reveal', points, deadline: null },
  };
}

/** Reveals once every voter still here has voted (or the timer forces it). */
function maybeReveal(state: HoodwinkState, force = false): HoodwinkState {
  const round = state.round;
  if (state.phase !== 'playing' || !round || round.stage !== 'vote') return state;
  if (!force && !round.voters.every((id) => round.votes[id] !== undefined)) return state;
  return reveal(state);
}

// ---- Actions ----

function requireHost(ctx: Ctx) {
  return ctx.isHost ? null : new GameError('not-host', 'Only the host can do that.');
}

function requireStage(state: HoodwinkState, stage: Round['stage']): Round | GameError {
  if (state.phase !== 'playing' || !state.round) {
    return new GameError('not-playing', 'No game in progress.');
  }
  if (state.round.stage !== stage) return new GameError('wrong-stage', "That's not possible now.");
  return state.round;
}

function updateSettings(
  state: HoodwinkState,
  action: Extract<HoodwinkAction, { type: 'update-settings' }>,
  ctx: Ctx,
): Result {
  const err = requireHost(ctx);
  if (err) return err;
  if (state.phase === 'playing') {
    return new GameError('in-progress', 'Settings can only change between games.');
  }
  const settings = { ...state.settings };
  if (action.deckIds) {
    const known = new Set(state.decks.map((d) => d.id));
    const ids = [...new Set(action.deckIds)];
    if (ids.some((id) => !known.has(id))) {
      return new GameError('unknown-deck', 'That question deck is no longer available.');
    }
    settings.deckIds = ids;
  }
  if (action.rounds !== undefined) settings.rounds = action.rounds;
  if (action.clueSeconds !== undefined) settings.clueSeconds = action.clueSeconds;
  if (action.guessSeconds !== undefined) settings.guessSeconds = action.guessSeconds;
  if (action.timerMode !== undefined) settings.timerMode = action.timerMode;
  return { ...state, settings };
}

function sit(state: HoodwinkState, playing: boolean, ctx: Ctx): Result {
  const seat = state.seats[ctx.by];
  if (!seat) return new GameError('not-seated', 'You are not in this game.');
  if (seat.playing === playing) return state;
  if (playing) {
    if (playingIds(state).length >= MAX_PLAYERS) {
      return new GameError('table-full', `At most ${MAX_PLAYERS} players can play.`);
    }
    // Mid-game, a new player joins from the next round.
    return { ...state, seats: { ...state.seats, [ctx.by]: { ...seat, playing: true } } };
  }
  return withdraw(
    { ...state, seats: { ...state.seats, [ctx.by]: { ...seat, playing: false } } },
    ctx.by,
    ctx.now,
  );
}

/**
 * Draws `count` distinct questions: ones this room hasn't seen first, then (only if the decks run
 * short) the least recently used of the rest.
 */
function draw(state: HoodwinkState, pool: Question[], count: number, ctx: Ctx): Question[] {
  const used = new Map(state.usedQuestionIds.map((id, i) => [id, i]));
  const fresh = pool.filter((q) => !used.has(q.id));
  if (fresh.length >= count) return ctx.rng.shuffle(fresh).slice(0, count);
  const stale = pool
    .filter((q) => used.has(q.id))
    .sort((a, b) => used.get(a.id)! - used.get(b.id)!)
    .slice(0, count - fresh.length);
  return ctx.rng.shuffle([...fresh, ...stale]);
}

function start(state: HoodwinkState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  if (state.phase === 'playing') return new GameError('in-progress', 'A game is already running.');
  const players = playingIds(state);
  if (players.length < MIN_PLAYERS) {
    return new GameError('too-few-players', `Hoodwink needs at least ${MIN_PLAYERS} players.`);
  }
  if (players.length > MAX_PLAYERS) {
    return new GameError('too-many-players', `At most ${MAX_PLAYERS} players can play.`);
  }
  const { rounds, deckIds } = state.settings;
  if (deckIds.length === 0) return new GameError('no-decks', 'Pick at least one question deck.');
  const seen = new Set<string>();
  const pool = (ctx.content.questions?.(deckIds) ?? []).filter((q) => {
    if (seen.has(q.id) || !q.prompt || !q.answer) return false;
    seen.add(q.id);
    return true;
  });
  if (pool.length < rounds) {
    return new GameError(
      'not-enough-questions',
      `${rounds} rounds need at least ${rounds} questions in the chosen decks.`,
    );
  }
  const questions = draw(state, pool, rounds, ctx);
  const drawn = new Set(questions.map((q) => q.id));
  const usedQuestionIds = [
    ...state.usedQuestionIds.filter((id) => !drawn.has(id)),
    ...questions.map((q) => q.id),
  ].slice(-MAX_USED_QUESTIONS);
  const fresh: HoodwinkState = {
    ...state,
    phase: 'playing',
    questions,
    round: null,
    scores: {},
    usedQuestionIds,
    seed: ctx.rng.int(SEED_RANGE),
    gamesPlayed: state.gamesPlayed + 1,
    endReason: null,
  };
  return beginRound(fresh, 1, ctx.now);
}

function backToLobby(state: HoodwinkState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  return { ...state, phase: 'lobby', questions: [], round: null, scores: {}, endReason: null };
}

function lie(state: HoodwinkState, text: string, ctx: Ctx): Result {
  const round = requireStage(state, 'write');
  if (round instanceof GameError) return round;
  if (!round.players.includes(ctx.by)) {
    return new GameError('not-playing-round', "You're watching this round. You join the next one.");
  }
  const problem = lieProblem(text, round.question);
  if (problem) return problem;
  return maybeStartVoting(
    withRound(state, {
      lies: { ...round.lies, [ctx.by]: tidyLie(text) },
      autoLies: round.autoLies.filter((id) => id !== ctx.by),
    }),
    ctx.now,
  );
}

/** "Lie for me": a random built-in fake becomes the player's lie, worth half points. */
function lieForMe(state: HoodwinkState, ctx: Ctx): Result {
  const round = requireStage(state, 'write');
  if (round instanceof GameError) return round;
  if (!round.players.includes(ctx.by)) {
    return new GameError('not-playing-round', "You're watching this round. You join the next one.");
  }
  const { picked, seed } = pickDecoys(state, round, 1);
  const decoy = picked[0];
  if (!decoy)
    return new GameError('no-decoys', 'No ready-made lies left for this one. Write your own!');
  return maybeStartVoting(
    withRound(
      { ...state, seed },
      {
        lies: { ...round.lies, [ctx.by]: decoy },
        autoLies: [...round.autoLies.filter((id) => id !== ctx.by), ctx.by],
      },
    ),
    ctx.now,
  );
}

function vote(state: HoodwinkState, option: number, ctx: Ctx): Result {
  const round = requireStage(state, 'vote');
  if (round instanceof GameError) return round;
  if (!round.voters.includes(ctx.by)) {
    return new GameError('not-voter', "You're watching this round. You join the next one.");
  }
  const picked = round.options[option];
  if (!picked) return new GameError('bad-option', 'Pick one of the answers.');
  if (picked.authors.includes(ctx.by)) {
    return new GameError('own-lie', "That's your own lie! Pick another answer.");
  }
  return maybeReveal(withRound(state, { votes: { ...round.votes, [ctx.by]: option } }));
}

function nextRound(state: HoodwinkState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  const round = requireStage(state, 'reveal');
  if (round instanceof GameError) return round;
  if (round.number >= state.settings.rounds) return endGame(state, 'finished');
  return beginRound(state, round.number + 1, ctx.now);
}

/**
 * Keeps the deck list up to date between games: decks an admin removed or switched off drop out
 * of the selection, and an empty selection falls back to the defaults.
 */
function refreshDecks(state: HoodwinkState, ctx: Ctx): HoodwinkState {
  if (state.phase === 'playing') return state;
  const decks = offeredDecks(ctx.content);
  const offered = new Set(decks.map((d) => d.id));
  const kept = state.settings.deckIds.filter((id) => offered.has(id));
  const deckIds = kept.length ? kept : defaultDeckIds(decks);
  const settings =
    deckIds.length === state.settings.deckIds.length &&
    deckIds.every((id, i) => id === state.settings.deckIds[i])
      ? state.settings
      : { ...state.settings, deckIds };
  return { ...state, decks, settings };
}

function reduce(state: HoodwinkState, action: HoodwinkAction, ctx: Ctx): Result {
  const current = refreshDecks(state, ctx);
  switch (action.type) {
    case 'update-settings':
      return updateSettings(current, action, ctx);
    case 'sit':
      return sit(current, action.playing, ctx);
    case 'start':
      return start(current, ctx);
    case 'back-to-lobby':
      return backToLobby(current, ctx);
    case 'lie':
      return lie(current, action.text, ctx);
    case 'lie-for-me':
      return lieForMe(current, ctx);
    case 'vote':
      return vote(current, action.option, ctx);
    case 'next-round':
      return nextRound(current, ctx);
  }
}

// ---- Players coming and going ----

function create(ctx: CreateCtx, players: readonly PlayerInfo[]): HoodwinkState {
  const decks = offeredDecks(ctx.content);
  return {
    phase: 'lobby',
    settings: {
      deckIds: defaultDeckIds(decks),
      rounds: DEFAULT_ROUNDS,
      clueSeconds: null,
      guessSeconds: null,
      timerMode: 'soft',
    },
    seats: Object.fromEntries(
      players.map((p, i) => [p.id, { name: p.name, playing: i < MAX_PLAYERS }]),
    ),
    decks,
    questions: [],
    round: null,
    scores: {},
    usedQuestionIds: [],
    seed: ctx.rng.int(SEED_RANGE),
    gamesPlayed: 0,
    endReason: null,
  };
}

function playerJoined(state: HoodwinkState, player: PlayerInfo): HoodwinkState {
  const existing = state.seats[player.id];
  // A newcomer plays if there's room; mid-game they watch until the next round.
  const seat: Seat = existing
    ? { ...existing, name: player.name }
    : { name: player.name, playing: playingIds(state).length < MAX_PLAYERS };
  const score = state.scores[player.id];
  return {
    ...state,
    seats: { ...state.seats, [player.id]: seat },
    scores: score
      ? { ...state.scores, [player.id]: { ...score, name: player.name } }
      : state.scores,
  };
}

/**
 * Takes a player out of the current round once they've left or stood up. A lie still being written
 * is dropped; once voting has started it stays on the board. Ends the game below the minimum.
 */
function withdraw(state: HoodwinkState, id: PlayerId, now: number): HoodwinkState {
  const round = state.round;
  if (state.phase !== 'playing' || !round) return state;
  if (playingIds(state).length < MIN_PLAYERS) return endGame(state, 'too-few');
  switch (round.stage) {
    case 'write': {
      if (!round.players.includes(id)) return state;
      const lies = { ...round.lies };
      delete lies[id];
      return maybeStartVoting(
        withRound(state, {
          players: round.players.filter((p) => p !== id),
          lies,
          autoLies: round.autoLies.filter((p) => p !== id),
        }),
        now,
      );
    }
    case 'vote': {
      // A vote already cast still counts.
      if (!round.voters.includes(id) || round.votes[id] !== undefined) return state;
      return maybeReveal(withRound(state, { voters: round.voters.filter((v) => v !== id) }));
    }
    case 'reveal':
      return state;
  }
}

function playerLeft(state: HoodwinkState, playerId: PlayerId, now: number): HoodwinkState {
  if (!state.seats[playerId]) return state;
  const seats = { ...state.seats };
  delete seats[playerId];
  return withdraw({ ...state, seats }, playerId, now);
}

// ---- Timers ----

function nextDeadline(state: HoodwinkState): number | null {
  const round = state.round;
  if (state.phase !== 'playing' || state.settings.timerMode !== 'strict' || !round) return null;
  return round.stage === 'reveal' ? null : round.deadline;
}

function onDeadline(state: HoodwinkState, now: number): HoodwinkState {
  const due = nextDeadline(state);
  const round = state.round;
  if (due === null || now < due || !round) return state;
  switch (round.stage) {
    case 'write':
      return maybeStartVoting(state, now, true);
    case 'vote':
      return maybeReveal(state, true);
    case 'reveal':
      return state;
  }
}

// ---- What each viewer may see ----

function roleOf(state: HoodwinkState, viewer: PlayerId | null): Role {
  if (viewer === null || !state.seats[viewer]?.playing) return 'spectator';
  const round = state.round;
  if (state.phase !== 'playing' || !round) return 'player';
  return round.players.includes(viewer) || round.voters.includes(viewer) ? 'player' : 'waiting';
}

function roundView(state: HoodwinkState, round: Round, viewer: PlayerId | null): RoundView {
  const revealed = round.stage === 'reveal';
  const options: OptionView[] = round.options.map((o, i) => ({
    index: i,
    text: o.text,
    mine: viewer !== null && o.authors.includes(viewer),
    truth: revealed ? o.truth : null,
    authors: revealed ? o.authors : null,
    voters: revealed
      ? Object.entries(round.votes).flatMap(([id, pick]) => (pick === i ? [id] : []))
      : null,
    auto: revealed ? o.auto : null,
    house: revealed ? o.house : null,
  }));
  return {
    number: round.number,
    rounds: state.settings.rounds,
    double: multiplier(round, state.settings.rounds) > 1,
    stage: round.stage,
    prompt: round.question.prompt,
    deckId: round.question.deckId,
    answer: revealed ? round.question.answer : null,
    players: round.players,
    written: round.players.filter((id) => round.lies[id] !== undefined),
    myLie: viewer === null ? null : (round.lies[viewer] ?? null),
    myLieAuto: viewer !== null && round.autoLies.includes(viewer),
    canLieForMe: (round.question.decoys ?? []).length > 0,
    options,
    voters: round.voters,
    voted: round.voters.filter((id) => round.votes[id] !== undefined),
    myVote: viewer === null ? null : (round.votes[viewer] ?? null),
    points: revealed ? round.points : null,
    deadline: round.deadline,
  };
}

export function rankedScores(state: HoodwinkState): ScoreView[] {
  return Object.entries(state.scores)
    .map(([id, s]) => ({ id, ...s, left: !state.seats[id] }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'en'));
}

/** Everyone tied on the highest value of `pick` (nobody if the best is 0). */
function leaders(scores: readonly ScoreView[], pick: (s: ScoreView) => number): PlayerId[] {
  const best = Math.max(0, ...scores.map(pick));
  return best > 0 ? scores.filter((s) => pick(s) === best).map((s) => s.id) : [];
}

/** The end-of-game awards: top score, most players fooled, most truths found. Ties share. */
export function awards(scores: readonly ScoreView[]) {
  return {
    winners: leaders(scores, (s) => s.score),
    bestLiar: leaders(scores, (s) => s.fooled),
    truthSeeker: leaders(scores, (s) => s.truths),
  };
}

function view(state: HoodwinkState, viewer: PlayerId | null): HoodwinkView {
  const mySeat = viewer === null ? undefined : state.seats[viewer];
  return {
    phase: state.phase,
    settings: state.settings,
    seats: Object.entries(state.seats).map(([id, s]) => ({ id, ...s })),
    me: mySeat && viewer !== null ? { id: viewer, ...mySeat } : null,
    role: roleOf(state, viewer),
    decks: state.decks,
    round: state.phase === 'playing' && state.round ? roundView(state, state.round, viewer) : null,
    scores: rankedScores(state),
    endReason: state.endReason,
  };
}

export const hoodwink: GameDefinition<HoodwinkState, HoodwinkAction, HoodwinkView> = {
  id: 'hoodwink',
  name: 'Hoodwink',
  description:
    'Write fake answers to bizarre true questions, fool your friends, and find the truth.',
  minPlayers: MIN_PLAYERS,
  /** Room capacity: up to `MAX_PLAYERS` play, the rest watch. */
  maxPlayers: ROOM_CAPACITY,
  access: 'private',
  usesWordLists: false,
  usesQuestionDecks: true,
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
};
