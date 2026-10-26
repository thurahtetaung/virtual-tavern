import {
  type ActionCtx,
  type ContentProvider,
  type CreateCtx,
  type GameDefinition,
  GameError,
  type OpenQuestion,
  type PlayerId,
  type PlayerInfo,
  type QuestionDeckSummary,
  createRng,
} from '@vt/game-sdk';
import { stampedeAwards } from './awards.ts';
import { stampedeBot } from './bot.ts';
import { guide } from './guide.ts';
import { insights } from './insights.ts';
import { autoGroups, groupLabel, tidyAnswer } from './match.ts';
import {
  DEFAULT_TARGET,
  type Group,
  type GroupView,
  type HistoryEntry,
  MAX_ANSWER_LENGTH,
  MAX_HISTORY,
  MAX_MOOS,
  MAX_PLAYERS,
  MAX_USED_QUESTIONS,
  MIN_PLAYERS,
  MOO_GAP_MS,
  PICK_MS,
  ROOM_CAPACITY,
  type Role,
  type Round,
  type RoundResult,
  type RoundView,
  type Score,
  type ScoreView,
  type Seat,
  type StampedeAction,
  type StampedeState,
  type StampedeView,
  actionSchema,
} from './types.ts';

type Ctx = ActionCtx;
type Result = StampedeState | GameError;

const SEED_RANGE = 0x1_0000_0000;

export function playingIds(state: StampedeState): PlayerId[] {
  return Object.entries(state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));
}

const offeredDecks = (content: ContentProvider): QuestionDeckSummary[] =>
  content.questionDecks?.() ?? [];

/** The decks a new room starts with: every deck that isn't adults-only. */
export const defaultDeckIds = (decks: readonly QuestionDeckSummary[]) =>
  decks.filter((d) => !d.adult).map((d) => d.id);

const deadlineIn = (seconds: number | null, now: number) =>
  seconds === null ? null : now + seconds * 1000;

/** Why an answer can't be used, or null if it's fine. */
export function answerProblem(text: string): GameError | null {
  if (/[\r\n]/.test(text.trim())) return new GameError('answer-lines', 'Keep it to one line.');
  const answer = tidyAnswer(text);
  if (!answer) return new GameError('empty-answer', 'Write an answer first.');
  if (answer.length > MAX_ANSWER_LENGTH) {
    return new GameError(
      'answer-too-long',
      `Keep it short: at most ${MAX_ANSWER_LENGTH} characters.`,
    );
  }
  return null;
}

/** Who the round still waits for while answers are written. */
export const missingPlayers = (round: Pick<Round, 'players' | 'answers'>) =>
  round.players.filter((id) => round.answers[id] === undefined);

/** Players who can win: seated and playing, without the Pink Cow. */
function eligible(state: StampedeState): PlayerId[] {
  return Object.keys(state.scores).filter(
    (id) => state.seats[id]?.playing === true && id !== state.pinkCow,
  );
}

// ---- Questions ----

/** The question pool: the chosen decks' open questions, each once. */
function pool(state: StampedeState, ctx: Ctx): OpenQuestion[] {
  const seen = new Set<string>();
  return (ctx.content.openQuestions?.(state.settings.deckIds) ?? []).filter((q) => {
    if (seen.has(q.id) || !q.prompt) return false;
    seen.add(q.id);
    return true;
  });
}

/**
 * One question: a random one this room hasn't had yet, or (once the decks are used up) the one
 * it had longest ago. Never `not` (the question being swapped out) while there is another.
 */
function drawQuestion(
  state: StampedeState,
  ctx: Ctx,
  not?: string,
): { question: OpenQuestion; usedQuestionIds: string[] } | null {
  const all = pool(state, ctx);
  const choices = all.length > 1 ? all.filter((q) => q.id !== not) : all;
  if (choices.length === 0) return null;
  const used = new Map(state.usedQuestionIds.map((id, i) => [id, i]));
  const fresh = choices.filter((q) => !used.has(q.id));
  const question = fresh.length
    ? fresh[ctx.rng.int(fresh.length)]!
    : choices.reduce((a, b) => (used.get(a.id)! <= used.get(b.id)! ? a : b));
  return {
    question,
    usedQuestionIds: [
      ...state.usedQuestionIds.filter((id) => id !== question.id),
      question.id,
    ].slice(-MAX_USED_QUESTIONS),
  };
}

// ---- Round flow ----

function withRound(state: StampedeState, patch: Partial<Round>): StampedeState {
  return { ...state, round: { ...state.round!, ...patch } };
}

function endGame(
  state: StampedeState,
  endReason: Exclude<StampedeState['endReason'], null>,
): StampedeState {
  // A round that never reached its reveal goes, so nobody's answer is ever shown.
  const round = state.round?.result ? state.round : null;
  return { ...state, phase: 'over', round, endReason };
}

function beginRound(
  state: StampedeState,
  number: number,
  drawn: { question: OpenQuestion; usedQuestionIds: string[] },
  now: number,
): StampedeState {
  const players = playingIds(state);
  const scores = { ...state.scores };
  for (const id of players) {
    scores[id] = {
      ...(scores[id] ?? { cows: 0, herds: 0, pinks: 0 }),
      name: state.seats[id]!.name,
    };
  }
  return {
    ...state,
    scores,
    usedQuestionIds: drawn.usedQuestionIds,
    moos: [],
    round: {
      number,
      question: drawn.question,
      stage: 'answer',
      players,
      answers: {},
      skipped: false,
      late: [],
      deadline: deadlineIn(state.settings.answerSeconds, now),
      groups: [],
      result: null,
      pick: null,
    },
  };
}

/** Answers are in (or time is up): they group themselves and the round is scored at once. */
function endWriting(state: StampedeState, now: number, force = false): StampedeState {
  const round = state.round;
  if (state.phase !== 'playing' || round?.stage !== 'answer') return state;
  const missing = missingPlayers(round);
  if (!force && missing.length > 0) return state;
  return score(
    withRound(state, {
      late: missing,
      deadline: null,
      groups: autoGroups(round.players, round.answers),
    }),
    now,
  );
}

/**
 * Scores the groups. The single biggest group (of at least 2) is the herd and each of
 * its players gets a cow; a tie for the biggest scores nobody. A player alone with their answer
 * takes the Pink Cow when they are the only one; with several, the holder may pick (house rule).
 */
function score(state: StampedeState, now: number): StampedeState {
  const round = state.round!;
  const groups = round.groups.filter((g) => g.members.length > 0);
  const top = Math.max(0, ...groups.map((g) => g.members.length));
  const biggest = groups.filter((g) => g.members.length === top);
  const herd = top >= 2 && biggest.length === 1 ? biggest[0]! : null;
  const loners = groups.filter((g) => g.members.length === 1).map((g) => g.members[0]!);
  const scorers = herd ? [...herd.members] : [];
  const blanks = round.players.filter((id) => round.answers[id] === undefined);

  const scores = { ...state.scores };
  for (const id of round.players) {
    const s = scores[id] ?? { name: state.seats[id]?.name ?? '', cows: 0, herds: 0, pinks: 0 };
    scores[id] = scorers.includes(id) ? { ...s, cows: s.cows + 1, herds: s.herds + 1 } : s;
  }

  const holder = state.pinkCow;
  const result: RoundResult = {
    herd: herd?.id ?? null,
    scorers,
    tie: top >= 2 && biggest.length > 1,
    loners,
    blanks,
    pinkFrom: holder,
    pinkTo: holder,
    pinkHow: null,
    raisedTo: null,
    winners: [],
  };
  const scored: StampedeState = { ...state, scores };

  if (loners.length === 1) return finish(givePink(scored, result, loners[0]!, 'lone'));
  if (loners.length > 1 && state.settings.holderPicks && holder !== null) {
    // A holder who is one of them must pass it on.
    const options = loners.filter((id) => id !== holder);
    if (options.length === 1) return finish(givePink(scored, result, options[0]!, 'picked'));
    return withRound(scored, {
      stage: 'pick',
      result,
      pick: { options, deadline: now + PICK_MS },
    });
  }
  return finish(withRound(scored, { result }));
}

function givePink(
  state: StampedeState,
  result: RoundResult,
  to: PlayerId,
  how: NonNullable<RoundResult['pinkHow']>,
): StampedeState {
  const moved = to !== state.pinkCow;
  const scores = { ...state.scores };
  if (moved && scores[to]) scores[to] = { ...scores[to], pinks: scores[to].pinks + 1 };
  return withRound(
    { ...state, scores, pinkCow: to },
    { result: { ...result, pinkTo: to, pinkHow: how }, pick: null },
  );
}

/**
 * The end of a round: the reveal, then the win check. Among players without the Pink Cow at or
 * above the target, a single leader wins; a tie on top raises the target to one above the tied
 * score (or, with the shared-win house rule, they all win).
 */
function finish(state: StampedeState): StampedeState {
  const round = state.round!;
  const result = { ...round.result! };
  const at = eligible(state).filter((id) => state.scores[id]!.cows >= state.target);
  const best = Math.max(0, ...at.map((id) => state.scores[id]!.cows));
  const leaders = at.filter((id) => state.scores[id]!.cows === best);
  let target = state.target;
  if (leaders.length === 1 || (leaders.length > 1 && state.settings.sharedWin)) {
    result.winners = leaders;
  } else if (leaders.length > 1) {
    target = best + 1;
    result.raisedTo = target;
  }
  const herd = round.groups.find((g) => g.id === result.herd);
  const entry: HistoryEntry = {
    number: round.number,
    prompt: round.question.prompt,
    herd: herd ? groupLabel(herd, round.answers) : null,
    herdSize: herd?.members.length ?? 0,
    scorers: result.scorers,
    pinkTo: result.pinkTo,
    pinkMoved: result.pinkTo !== result.pinkFrom,
  };
  const next: StampedeState = {
    ...state,
    target,
    history: [...state.history, entry].slice(-MAX_HISTORY),
    winners: result.winners,
    round: { ...round, stage: 'reveal', result, pick: null },
  };
  return result.winners.length ? endGame(next, 'won') : next;
}

// ---- Actions ----

function requireHost(ctx: Ctx) {
  return ctx.isHost ? null : new GameError('not-host', 'Only the host can do that.');
}

function requireStage(state: StampedeState, stage: Round['stage']): Round | GameError {
  if (state.phase !== 'playing' || !state.round) {
    return new GameError('not-playing', 'No game in progress.');
  }
  if (state.round.stage !== stage) return new GameError('wrong-stage', "That's not possible now.");
  return state.round;
}

function updateSettings(
  state: StampedeState,
  action: Extract<StampedeAction, { type: 'update-settings' }>,
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
  if (action.target !== undefined) settings.target = action.target;
  if (action.answerSeconds !== undefined) settings.answerSeconds = action.answerSeconds;
  if (action.timerMode !== undefined) settings.timerMode = action.timerMode;
  if (action.skip !== undefined) settings.skip = action.skip;
  if (action.holderPicks !== undefined) settings.holderPicks = action.holderPicks;
  if (action.sharedWin !== undefined) settings.sharedWin = action.sharedWin;
  return { ...state, settings, target: settings.target };
}

function sit(state: StampedeState, playing: boolean, ctx: Ctx): Result {
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

function start(state: StampedeState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  if (state.phase === 'playing') return new GameError('in-progress', 'A game is already running.');
  const players = playingIds(state);
  if (players.length < MIN_PLAYERS) {
    return new GameError('too-few-players', `This game needs at least ${MIN_PLAYERS} players.`);
  }
  if (state.settings.deckIds.length === 0) {
    return new GameError('no-decks', 'Pick at least one question deck.');
  }
  const drawn = drawQuestion(state, ctx);
  if (!drawn) return new GameError('no-questions', 'The chosen decks have no questions.');
  const fresh: StampedeState = {
    ...state,
    phase: 'playing',
    scores: {},
    pinkCow: null,
    target: state.settings.target,
    round: null,
    history: [],
    moos: [],
    seed: ctx.rng.int(SEED_RANGE),
    gamesPlayed: state.gamesPlayed + 1,
    winners: [],
    endReason: null,
  };
  return beginRound(fresh, 1, drawn, ctx.now);
}

function backToLobby(state: StampedeState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  return {
    ...state,
    phase: 'lobby',
    scores: {},
    pinkCow: null,
    target: state.settings.target,
    round: null,
    history: [],
    moos: [],
    winners: [],
    endReason:
      state.phase === 'playing' ? 'abandoned' : state.phase === 'lobby' ? state.endReason : null,
  };
}

function answer(state: StampedeState, text: string, ctx: Ctx): Result {
  const round = requireStage(state, 'answer');
  if (round instanceof GameError) return round;
  if (!round.players.includes(ctx.by)) {
    return new GameError('not-playing-round', "You're watching this round. You join the next one.");
  }
  const problem = answerProblem(text);
  if (problem) return problem;
  return endWriting(
    withRound(state, { answers: { ...round.answers, [ctx.by]: tidyAnswer(text) } }),
    ctx.now,
  );
}

/** A nudge at everyone still writing, from someone who isn't. */
function moo(state: StampedeState, ctx: Ctx): Result {
  const round = requireStage(state, 'answer');
  if (round instanceof GameError) return round;
  if (!state.seats[ctx.by]) return new GameError('not-seated', 'You are not in this game.');
  if (round.players.includes(ctx.by) && round.answers[ctx.by] === undefined) {
    return new GameError('answer-first', 'Send your own answer before you moo at anyone!');
  }
  const missing = missingPlayers(round);
  if (missing.length === 0) return new GameError('nobody-missing', 'Everyone has answered.');
  const last = state.moos.findLast((m) => m.from === ctx.by);
  if (last && ctx.now - last.at < MOO_GAP_MS) {
    return new GameError('moo-too-soon', 'Give them a moment before you moo again.');
  }
  return {
    ...state,
    moos: [...state.moos, { from: ctx.by, to: missing, at: ctx.now }].slice(-MAX_MOOS),
  };
}

function skip(state: StampedeState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  const round = requireStage(state, 'answer');
  if (round instanceof GameError) return round;
  if (!state.settings.skip) return new GameError('no-skips', 'Skipping is off in this game.');
  if (round.skipped) {
    return new GameError('skipped-already', 'You’ve already swapped this round’s question.');
  }
  const drawn = drawQuestion(state, ctx, round.question.id);
  if (!drawn || drawn.question.id === round.question.id) {
    return new GameError('no-other-question', 'There’s no other question to swap in.');
  }
  return {
    ...state,
    usedQuestionIds: drawn.usedQuestionIds,
    moos: [],
    round: {
      ...round,
      question: drawn.question,
      answers: {},
      skipped: true,
      deadline: deadlineIn(state.settings.answerSeconds, ctx.now),
    },
  };
}

/** The host stops waiting: anyone still writing has no answer this round. */
function continueWithout(state: StampedeState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  const round = requireStage(state, 'answer');
  if (round instanceof GameError) return round;
  if (missingPlayers(round).length === 0) {
    return new GameError('nobody-missing', 'Everyone is in already.');
  }
  return endWriting(state, ctx.now, true);
}

/**
 * Rounds saved mid-check by the version that had a host check: scored as they stand (the groups
 * were already made). Every action first passes through here.
 */
function upgraded(state: StampedeState, now: number): StampedeState {
  return state.phase === 'playing' && state.round?.stage === 'merge' ? score(state, now) : state;
}

function pick(state: StampedeState, player: PlayerId, ctx: Ctx): Result {
  const round = requireStage(state, 'pick');
  if (round instanceof GameError) return round;
  if (ctx.by !== state.pinkCow) {
    return new GameError('not-holder', 'Only the player holding it picks who takes it.');
  }
  if (!round.pick?.options.includes(player)) {
    return new GameError('bad-pick', 'Pick one of the players who were alone with their answer.');
  }
  return finish(givePink(state, round.result!, player, 'picked'));
}

function nextRound(state: StampedeState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  const round = requireStage(state, 'reveal');
  if (round instanceof GameError) return round;
  if (playingIds(state).length < MIN_PLAYERS) return endGame(state, 'too-few');
  const drawn = drawQuestion(state, ctx);
  if (!drawn) return endGame(state, 'no-questions');
  return beginRound(state, round.number + 1, drawn, ctx.now);
}

/**
 * Keeps the deck list up to date between games: decks an admin removed or switched off drop out
 * of the selection, and an empty selection falls back to the defaults.
 */
function refreshDecks(state: StampedeState, ctx: Ctx): StampedeState {
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

function reduce(state: StampedeState, action: StampedeAction, ctx: Ctx): Result {
  const current = upgraded(refreshDecks(state, ctx), ctx.now);
  switch (action.type) {
    case 'update-settings':
      return updateSettings(current, action, ctx);
    case 'sit':
      return sit(current, action.playing, ctx);
    case 'start':
      return start(current, ctx);
    case 'back-to-lobby':
      return backToLobby(current, ctx);
    case 'answer':
      return answer(current, action.text, ctx);
    case 'moo':
      return moo(current, ctx);
    case 'skip':
      return skip(current, ctx);
    case 'continue-without':
      return continueWithout(current, ctx);
    case 'reveal':
      // Only an old round mid-check has anything to reveal (done by `upgraded` above).
      return current.round?.stage === state.round?.stage
        ? new GameError('wrong-stage', "That's not possible now.")
        : current;
    case 'pick':
      return pick(current, action.player, ctx);
    case 'next-round':
      return nextRound(current, ctx);
  }
}

// ---- Players coming and going ----

function create(ctx: CreateCtx, players: readonly PlayerInfo[]): StampedeState {
  const decks = offeredDecks(ctx.content);
  return {
    phase: 'lobby',
    settings: {
      deckIds: defaultDeckIds(decks),
      target: DEFAULT_TARGET,
      answerSeconds: null,
      timerMode: 'soft',
      skip: true,
      holderPicks: false,
      sharedWin: false,
    },
    seats: Object.fromEntries(
      players.map((p, i) => [p.id, { name: p.name, playing: i < MAX_PLAYERS }]),
    ),
    decks,
    scores: {},
    pinkCow: null,
    target: DEFAULT_TARGET,
    round: null,
    history: [],
    moos: [],
    usedQuestionIds: [],
    seed: ctx.rng.int(SEED_RANGE),
    gamesPlayed: 0,
    winners: [],
    endReason: null,
  };
}

function playerJoined(state: StampedeState, player: PlayerInfo): StampedeState {
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
 * Takes a player out of the round in play once they've left or stood up: their answer goes with
 * them until the reveal (so it can never hand anyone the Pink Cow), and they drop out of the
 * holder's pick. Ends the game below the minimum.
 */
function withdraw(state: StampedeState, id: PlayerId, now: number): StampedeState {
  const round = state.round;
  if (state.phase !== 'playing' || !round) return state;
  if (playingIds(state).length < MIN_PLAYERS) return endGame(state, 'too-few');
  switch (round.stage) {
    case 'answer': {
      if (!round.players.includes(id)) return state;
      const answers = { ...round.answers };
      delete answers[id];
      return endWriting(
        withRound(state, { players: round.players.filter((p) => p !== id), answers }),
        now,
      );
    }
    case 'merge': {
      // A round saved mid-check by an older version: the leaver's answer goes, then it's scored.
      if (!round.players.includes(id)) return score(state, now);
      const answers = { ...round.answers };
      delete answers[id];
      return score(
        withRound(state, {
          players: round.players.filter((p) => p !== id),
          answers,
          late: round.late.filter((p) => p !== id),
          groups: round.groups
            .map((g) => ({ ...g, members: g.members.filter((m) => m !== id) }))
            .filter((g) => g.members.length > 0),
        }),
        now,
      );
    }
    case 'pick': {
      // The holder left: the cow is back in the middle.
      if (state.pinkCow === null)
        return finish(withRound(state, { result: { ...round.result!, pinkTo: null } }));
      const options = round.pick!.options.filter((p) => p !== id);
      if (options.length === 0) return finish(state);
      return withRound(state, { pick: { ...round.pick!, options } });
    }
    case 'reveal':
      return state;
  }
}

/** A leaver keeps their cows on the board but can't win; the Pink Cow goes back to the middle. */
function playerLeft(state: StampedeState, playerId: PlayerId, now: number): StampedeState {
  if (!state.seats[playerId]) return state;
  const seats = { ...state.seats };
  delete seats[playerId];
  return withdraw(
    {
      ...state,
      seats,
      pinkCow: state.pinkCow === playerId ? null : state.pinkCow,
    },
    playerId,
    now,
  );
}

// ---- Timers ----

function nextDeadline(state: StampedeState): number | null {
  const round = state.round;
  if (state.phase !== 'playing' || !round) return null;
  if (round.stage === 'pick') return round.pick?.deadline ?? null;
  if (round.stage === 'answer' && state.settings.timerMode === 'strict') return round.deadline;
  return null;
}

function onDeadline(state: StampedeState, now: number): StampedeState {
  const due = nextDeadline(state);
  const round = state.round;
  if (due === null || now < due || !round) return state;
  if (round.stage === 'answer') return endWriting(state, now, true);
  if (round.stage === 'pick' && round.pick) {
    const rng = createRng(state.seed);
    const to = round.pick.options[rng.int(round.pick.options.length)]!;
    return finish(givePink({ ...state, seed: rng.int(SEED_RANGE) }, round.result!, to, 'timeout'));
  }
  return state;
}

// ---- What each viewer may see ----

function roleOf(state: StampedeState, viewer: PlayerId | null): Role {
  if (viewer === null || !state.seats[viewer]?.playing) return 'spectator';
  const round = state.round;
  if (state.phase !== 'playing' || !round) return 'player';
  return round.players.includes(viewer) ? 'player' : 'waiting';
}

function groupView(group: Group, answers: Record<PlayerId, string>): GroupView {
  return {
    id: group.id,
    label: groupLabel(group, answers),
    members: group.members,
    answers: Object.fromEntries(group.members.map((id) => [id, answers[id] ?? ''])),
  };
}

function roundView(state: StampedeState, round: Round, viewer: PlayerId | null): RoundView {
  const shown = round.stage === 'pick' || round.stage === 'reveal';
  return {
    number: round.number,
    stage: round.stage,
    prompt: round.question.prompt,
    questionId: round.question.id,
    deckId: round.question.deckId,
    players: round.players,
    answered: round.players.filter((id) => round.answers[id] !== undefined),
    myAnswer: viewer === null ? null : (round.answers[viewer] ?? null),
    canSkip: round.stage === 'answer' && state.settings.skip && !round.skipped,
    skipped: round.skipped,
    late: round.stage === 'answer' ? [] : round.late,
    deadline: round.stage === 'answer' ? round.deadline : null,
    groups: shown ? round.groups.map((g) => groupView(g, round.answers)) : null,
    result: round.result,
    pick: round.pick,
  };
}

export function rankedScores(state: StampedeState): ScoreView[] {
  return Object.entries(state.scores)
    .map(([id, s]) => ({ id, ...s, left: !state.seats[id] }))
    .sort((a, b) => b.cows - a.cows || a.name.localeCompare(b.name, 'en'));
}

function view(state: StampedeState, viewer: PlayerId | null): StampedeView {
  const mySeat = viewer === null ? undefined : state.seats[viewer];
  return {
    phase: state.phase,
    settings: state.settings,
    seats: Object.entries(state.seats).map(([id, s]) => ({ id, ...s })),
    me: mySeat && viewer !== null ? { id: viewer, ...mySeat } : null,
    role: roleOf(state, viewer),
    decks: state.decks,
    round: state.phase !== 'lobby' && state.round ? roundView(state, state.round, viewer) : null,
    scores: rankedScores(state),
    pinkCow: state.pinkCow,
    target: state.target,
    history: state.history,
    moos: state.moos,
    winners: state.winners,
    endReason: state.endReason,
  };
}

export const stampede: GameDefinition<StampedeState, StampedeAction, StampedeView> = {
  id: 'stampede',
  name: 'Stampede',
  description:
    'Answer odd questions the way everyone else will. Match the herd to win cows; stand alone and you get the Pink Cow.',
  minPlayers: MIN_PLAYERS,
  maxPlayers: ROOM_CAPACITY,
  maxSeated: MAX_PLAYERS,
  access: 'private',
  usesWordLists: false,
  usesQuestionDecks: true,
  questionKind: 'open',
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
  awards: stampedeAwards,
  bot: stampedeBot,
  botInfo: {
    note: 'Bots answer and pass on the Pink Cow; the host (always a person) checks the groups.',
  },
};

export type { Score };
