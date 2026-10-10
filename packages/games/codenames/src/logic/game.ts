import {
  type ActionCtx,
  wordPool,
  type CreateCtx,
  type GameDefinition,
  GameError,
  type PlayerId,
  type PlayerInfo,
} from '@vt/game-sdk';
import {
  ASSASSINS,
  BOARD_SIZE,
  type Card,
  type CodenamesAction,
  type CodenamesState,
  type CodenamesView,
  type EndTurnReason,
  OTHER_TEAM_AGENTS,
  type Role,
  STARTING_TEAM_AGENTS,
  type Seat,
  type Team,
  type Turn,
  type WinReason,
  actionSchema,
} from './types.ts';
import { guide } from './guide.ts';
import { insights } from './insights.ts';

type Ctx = ActionCtx;
type Result = CodenamesState | GameError;

const CLUE_PATTERN = /^[\p{L}\p{N}'’-]+$/u;
const NUMBER_PATTERN = /^\p{N}+$/u;

export { wordPool };

export const otherTeam = (team: Team): Team => (team === 'red' ? 'blue' : 'red');

export function remainingAgents(board: readonly Card[], team: Team): number {
  return board.filter((c) => c.kind === team && !c.revealed).length;
}

function deadline(seconds: number | null, now: number): number | null {
  return seconds === null ? null : now + seconds * 1000;
}

function newTurn(state: CodenamesState, team: Team, now: number): Turn {
  return {
    team,
    stage: 'clue',
    clue: null,
    guessesMade: 0,
    deadline: deadline(state.settings.clueSeconds, now),
  };
}

function hasRole(state: CodenamesState, team: Team, role: Seat['role']): boolean {
  return Object.values(state.seats).some((s) => s.team === team && s.role === role);
}

/** A team needs a spymaster to give a clue and an operative to guess. */
function canPlay(state: CodenamesState, team: Team): boolean {
  return hasRole(state, team, 'spymaster') && hasRole(state, team, 'operative');
}

function endTurn(state: CodenamesState, reason: EndTurnReason, now: number): CodenamesState {
  const team = state.turn!.team;
  const next = otherTeam(team);
  const ended: CodenamesState = {
    ...state,
    turn: newTurn(state, next, now),
    suggestions: {},
    log: [...state.log, { type: 'end-turn', team, reason }],
  };
  // A team that can't play (no spymaster or no operative) forfeits its turn straight away, as
  // long as the other team can take it. If neither can, the turn waits for someone to sit down.
  if (!canPlay(state, next) && canPlay(state, team)) return endTurn(ended, 'forfeit', now);
  return ended;
}

function endGame(state: CodenamesState, winner: Team, reason: WinReason): CodenamesState {
  return {
    ...state,
    phase: 'over',
    turn: null,
    suggestions: {},
    winner,
    winReason: reason,
    // The other team opens the rematch.
    startingTeam: otherTeam(state.startingTeam),
    log: [...state.log, { type: 'game-over', winner, reason }],
  };
}

function seatOf(state: CodenamesState, id: PlayerId): Seat | GameError {
  return state.seats[id] ?? new GameError('not-seated', 'You are not in this game.');
}

function spymasterOf(state: CodenamesState, team: Team): PlayerId | undefined {
  return Object.entries(state.seats).find(
    ([, s]) => s.team === team && s.role === 'spymaster',
  )?.[0];
}

function requireHost(ctx: Ctx): GameError | null {
  return ctx.isHost ? null : new GameError('not-host', 'Only the host can do that.');
}

/** Checks that `by` is an operative on the team currently guessing. */
function requireGuesser(state: CodenamesState, by: PlayerId): GameError | Turn {
  const turn = state.turn;
  if (state.phase !== 'playing' || !turn)
    return new GameError('not-playing', 'No game in progress.');
  if (turn.stage !== 'guess') return new GameError('wrong-stage', 'Waiting for a clue.');
  const seat = seatOf(state, by);
  if (seat instanceof GameError) return seat;
  if (seat.team !== turn.team || seat.role !== 'operative') {
    return new GameError('not-your-turn', "Only the guessing team's operatives can do that.");
  }
  return turn;
}

function requireUnrevealed(state: CodenamesState, index: number): GameError | Card {
  const card = state.board[index];
  if (!card) return new GameError('bad-card', 'No such card.');
  if (card.revealed) return new GameError('already-revealed', 'That card is already revealed.');
  return card;
}

function updateSettings(
  state: CodenamesState,
  action: Extract<CodenamesAction, { type: 'update-settings' }>,
  ctx: Ctx,
): Result {
  const err = requireHost(ctx);
  if (err) return err;
  if (state.phase === 'playing') {
    return new GameError('in-progress', 'Settings can only change between games.');
  }
  const settings = { ...state.settings };
  if (action.wordListIds) {
    const known = new Set(ctx.content.wordLists().map((l) => l.id));
    const ids = [...new Set(action.wordListIds)];
    const unknown = ids.find((id) => !known.has(id));
    if (unknown) return new GameError('unknown-word-list', 'That word list no longer exists.');
    settings.wordListIds = ids;
  }
  if (action.clueSeconds !== undefined) settings.clueSeconds = action.clueSeconds;
  if (action.guessSeconds !== undefined) settings.guessSeconds = action.guessSeconds;
  if (action.timerMode !== undefined) settings.timerMode = action.timerMode;
  return { ...state, settings };
}

/** `suggestions` without any of `id`'s marks. */
function withoutMarksOf(
  suggestions: CodenamesState['suggestions'],
  id: PlayerId,
): CodenamesState['suggestions'] {
  const next: Record<number, PlayerId[]> = {};
  for (const [card, ids] of Object.entries(suggestions)) {
    const left = ids.filter((other) => other !== id);
    if (left.length) next[Number(card)] = left;
  }
  return next;
}

/**
 * Why `seat` may not move to `team`/`role` while a game is running, or null if it may. Seated
 * players stay put, except to fill their own team's vacant spymaster seat. Newcomers may join a
 * team, unless they have already seen the key, in which case only their old seat will do.
 */
function seatLock(state: CodenamesState, by: PlayerId, seat: Seat, team: Team | null, role: Role) {
  if (team === null) return new GameError('team-locked', 'Seats are locked during a game.');
  const held = state.keyHolders?.[by];
  if (seat.team !== null) {
    if (held !== undefined || team !== seat.team) {
      return new GameError('team-locked', 'Seats are locked during a game.');
    }
    return null;
  }
  if (held !== undefined && (team !== held || role !== 'spymaster')) {
    return new GameError(
      'team-locked',
      "You've seen the key, so you can only resume as that team's spymaster.",
    );
  }
  return null;
}

function joinTeam(
  state: CodenamesState,
  action: Extract<CodenamesAction, { type: 'join-team' }>,
  ctx: Ctx,
): Result {
  const seat = seatOf(state, ctx.by);
  if (seat instanceof GameError) return seat;
  const role = action.team === null ? 'operative' : action.role;
  if (seat.team === action.team && seat.role === role) return state;
  if (state.phase === 'playing') {
    const locked = seatLock(state, ctx.by, seat, action.team, role);
    if (locked) return locked;
  }
  if (action.team !== null && role === 'spymaster') {
    const current = spymasterOf(state, action.team);
    if (current !== undefined && current !== ctx.by) {
      return new GameError('seat-taken', `${action.team} already has a spymaster.`);
    }
  }
  const keyHolders =
    state.phase === 'playing' && action.team !== null && role === 'spymaster'
      ? { ...state.keyHolders, [ctx.by]: action.team }
      : state.keyHolders;
  return {
    ...state,
    seats: { ...state.seats, [ctx.by]: { ...seat, team: action.team, role } },
    keyHolders,
    suggestions: withoutMarksOf(state.suggestions, ctx.by),
  };
}

function randomizeTeams(state: CodenamesState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  if (state.phase === 'playing') return new GameError('in-progress', 'Wait for the game to end.');
  const order = ctx.rng.shuffle(Object.keys(state.seats));
  const seats: Record<PlayerId, Seat> = {};
  // Keep join order in the record; assign teams from the shuffled order.
  const assigned = new Map<PlayerId, Pick<Seat, 'team' | 'role'>>();
  order.forEach((id, i) => {
    const team: Team = i % 2 === 0 ? state.startingTeam : otherTeam(state.startingTeam);
    assigned.set(id, { team, role: i < 2 ? 'spymaster' : 'operative' });
  });
  for (const [id, seat] of Object.entries(state.seats)) {
    seats[id] = { ...seat, ...assigned.get(id)! };
  }
  return { ...state, seats };
}

function start(state: CodenamesState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  if (state.phase === 'playing') return new GameError('in-progress', 'A game is already running.');
  for (const team of ['red', 'blue'] as const) {
    const members = Object.values(state.seats).filter((s) => s.team === team);
    if (!members.some((s) => s.role === 'spymaster')) {
      return new GameError('missing-spymaster', `The ${team} team needs a spymaster.`);
    }
    if (!members.some((s) => s.role === 'operative')) {
      return new GameError('missing-operative', `The ${team} team needs at least one operative.`);
    }
  }
  const pool = wordPool(ctx.content.words(state.settings.wordListIds));
  if (pool.length < BOARD_SIZE) {
    return new GameError(
      'not-enough-words',
      `The selected word lists have ${pool.length} unique words; ${BOARD_SIZE} are needed.`,
    );
  }
  const first = state.startingTeam;
  const kinds = ctx.rng.shuffle([
    ...Array<Team>(STARTING_TEAM_AGENTS).fill(first),
    ...Array<Team>(OTHER_TEAM_AGENTS).fill(otherTeam(first)),
    ...Array<'assassin'>(ASSASSINS).fill('assassin'),
    ...Array<'bystander'>(BOARD_SIZE - STARTING_TEAM_AGENTS - OTHER_TEAM_AGENTS - ASSASSINS).fill(
      'bystander',
    ),
  ]);
  const words = ctx.rng.shuffle(pool).slice(0, BOARD_SIZE);
  const board: Card[] = words.map((word, i) => ({ word, kind: kinds[i]!, revealed: false }));
  const keyHolders: Record<PlayerId, Team> = {};
  for (const [id, seat] of Object.entries(state.seats)) {
    if (seat.team !== null && seat.role === 'spymaster') keyHolders[id] = seat.team;
  }
  const next: CodenamesState = {
    ...state,
    phase: 'playing',
    keyHolders,
    board,
    suggestions: {},
    log: [],
    winner: null,
    winReason: null,
    gamesPlayed: state.gamesPlayed + 1,
  };
  return { ...next, turn: newTurn(next, first, ctx.now) };
}

function backToLobby(state: CodenamesState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  // Abandons any game in progress: the board and its log go with it.
  return {
    ...state,
    phase: 'lobby',
    keyHolders: {},
    board: [],
    turn: null,
    suggestions: {},
    log: [],
    winner: null,
    winReason: null,
  };
}

function giveClue(
  state: CodenamesState,
  action: Extract<CodenamesAction, { type: 'give-clue' }>,
  ctx: Ctx,
): Result {
  const turn = state.turn;
  if (state.phase !== 'playing' || !turn)
    return new GameError('not-playing', 'No game in progress.');
  if (turn.stage !== 'clue') return new GameError('wrong-stage', 'A clue was already given.');
  const seat = seatOf(state, ctx.by);
  if (seat instanceof GameError) return seat;
  if (seat.team !== turn.team || seat.role !== 'spymaster') {
    return new GameError('not-your-turn', "Only the current team's spymaster can give a clue.");
  }
  const word = action.word.trim();
  if (!CLUE_PATTERN.test(word)) return new GameError('bad-clue', 'A clue must be a single word.');
  if (NUMBER_PATTERN.test(word)) {
    return new GameError('clue-is-number', 'A clue cannot be just a number.');
  }
  const lower = word.toLocaleLowerCase('en');
  if (state.board.some((c) => !c.revealed && c.word.toLocaleLowerCase('en') === lower)) {
    return new GameError('bad-clue', 'The clue cannot be a word on the board.');
  }
  const left = remainingAgents(state.board, turn.team);
  if (action.count > left) {
    return new GameError(
      'count-too-high',
      `Your team only has ${left} agent${left === 1 ? '' : 's'} left to find.`,
    );
  }
  return {
    ...state,
    turn: {
      ...turn,
      stage: 'guess',
      clue: { word, count: action.count },
      guessesMade: 0,
      deadline: deadline(state.settings.guessSeconds, ctx.now),
    },
    log: [...state.log, { type: 'clue', team: turn.team, by: ctx.by, word, count: action.count }],
  };
}

function toggleSuggestion(state: CodenamesState, index: number, ctx: Ctx): Result {
  const turn = requireGuesser(state, ctx.by);
  if (turn instanceof GameError) return turn;
  const card = requireUnrevealed(state, index);
  if (card instanceof GameError) return card;
  const current = state.suggestions[index] ?? [];
  const next = current.includes(ctx.by)
    ? current.filter((id) => id !== ctx.by)
    : [...current, ctx.by];
  const suggestions = { ...state.suggestions, [index]: next };
  if (next.length === 0) delete suggestions[index];
  return { ...state, suggestions };
}

function guess(state: CodenamesState, index: number, ctx: Ctx): Result {
  const turn = requireGuesser(state, ctx.by);
  if (turn instanceof GameError) return turn;
  const card = requireUnrevealed(state, index);
  if (card instanceof GameError) return card;

  const board = state.board.map((c, i) => (i === index ? { ...c, revealed: true } : c));
  const suggestions = { ...state.suggestions };
  delete suggestions[index];
  const guessesMade = turn.guessesMade + 1;
  const next: CodenamesState = {
    ...state,
    board,
    suggestions,
    turn: { ...turn, guessesMade },
    log: [
      ...state.log,
      { type: 'guess', team: turn.team, by: ctx.by, word: card.word, kind: card.kind },
    ],
  };

  if (card.kind === 'assassin') return endGame(next, otherTeam(turn.team), 'assassin');
  for (const team of [turn.team, otherTeam(turn.team)]) {
    if (remainingAgents(board, team) === 0) return endGame(next, team, 'all-agents');
  }
  if (card.kind !== turn.team) return endTurn(next, 'wrong-guess', ctx.now);
  // A clue for N allows N + 1 guesses.
  if (guessesMade >= (turn.clue?.count ?? 1) + 1) {
    return endTurn(next, 'out-of-guesses', ctx.now);
  }
  return next;
}

/**
 * Operatives may pass once they have guessed at least once. The host may end any turn at any
 * stage, which is logged as an override so a stuck turn (nobody left to act) can move on.
 */
function endTurnAction(state: CodenamesState, ctx: Ctx): Result {
  const turn = requireGuesser(state, ctx.by);
  if (!(turn instanceof GameError) && turn.guessesMade > 0)
    return endTurn(state, 'passed', ctx.now);
  if (ctx.isHost && state.phase === 'playing' && state.turn) return endTurn(state, 'host', ctx.now);
  if (turn instanceof GameError) return turn;
  return new GameError('must-guess', 'Guess at least once before ending your turn.');
}

function reduce(state: CodenamesState, action: CodenamesAction, ctx: Ctx): Result {
  switch (action.type) {
    case 'update-settings':
      return updateSettings(state, action, ctx);
    case 'join-team':
      return joinTeam(state, action, ctx);
    case 'randomize-teams':
      return randomizeTeams(state, ctx);
    case 'start':
      return start(state, ctx);
    case 'back-to-lobby':
      return backToLobby(state, ctx);
    case 'give-clue':
      return giveClue(state, action, ctx);
    case 'toggle-suggestion':
      return toggleSuggestion(state, action.card, ctx);
    case 'guess':
      return guess(state, action.card, ctx);
    case 'end-turn':
      return endTurnAction(state, ctx);
  }
}

function create(ctx: CreateCtx, players: readonly PlayerInfo[]): CodenamesState {
  const firstList = ctx.content.wordLists()[0];
  return {
    phase: 'lobby',
    settings: {
      wordListIds: firstList ? [firstList.id] : [],
      clueSeconds: null,
      guessSeconds: null,
      timerMode: 'soft',
    },
    seats: Object.fromEntries(
      players.map((p) => [p.id, { name: p.name, team: null, role: 'operative' }]),
    ),
    startingTeam: ctx.rng.int(2) === 0 ? 'red' : 'blue',
    keyHolders: {},
    board: [],
    turn: null,
    suggestions: {},
    log: [],
    winner: null,
    winReason: null,
    gamesPlayed: 0,
  };
}

function playerJoined(state: CodenamesState, player: PlayerInfo): CodenamesState {
  const existing = state.seats[player.id];
  const seat: Seat = existing
    ? { ...existing, name: player.name }
    : { name: player.name, team: null, role: 'operative' };
  return { ...state, seats: { ...state.seats, [player.id]: seat } };
}

function playerLeft(state: CodenamesState, playerId: PlayerId, now: number): CodenamesState {
  if (!state.seats[playerId]) return state;
  const seats = { ...state.seats };
  delete seats[playerId];
  const next = { ...state, seats, suggestions: withoutMarksOf(state.suggestions, playerId) };
  // Nobody left who can act for the current team: forfeit the turn rather than stall.
  if (next.phase === 'playing' && next.turn && !canPlay(next, next.turn.team)) {
    return endTurn(next, 'forfeit', now);
  }
  return next;
}

function view(state: CodenamesState, viewer: PlayerId | null): CodenamesView {
  const mySeat = viewer === null ? undefined : state.seats[viewer];
  const seesKey = state.phase === 'over' || (mySeat?.role === 'spymaster' && mySeat.team !== null);
  const seesSuggestions = mySeat?.team != null && mySeat.team === state.turn?.team;
  return {
    phase: state.phase,
    settings: state.settings,
    seats: Object.entries(state.seats).map(([id, s]) => ({ id, ...s })),
    me: mySeat && viewer !== null ? { id: viewer, ...mySeat } : null,
    startingTeam: state.startingTeam,
    keyHolders: state.keyHolders ?? {},
    board: state.board.map((card, i) => ({
      word: card.word,
      kind: card.revealed || seesKey ? card.kind : null,
      revealed: card.revealed,
      suggestedBy: seesSuggestions ? (state.suggestions[i] ?? []) : [],
    })),
    turn: state.turn,
    remaining: {
      red: remainingAgents(state.board, 'red'),
      blue: remainingAgents(state.board, 'blue'),
    },
    log: state.log,
    winner: state.winner,
    winReason: state.winReason,
  };
}

/** Only strict timers are enforced; soft ones are shown to players but never end a turn. */
function nextDeadline(state: CodenamesState): number | null {
  if (state.phase !== 'playing' || state.settings.timerMode !== 'strict') return null;
  return state.turn?.deadline ?? null;
}

function onDeadline(state: CodenamesState, now: number): CodenamesState {
  const due = nextDeadline(state);
  return due !== null && now >= due ? endTurn(state, 'timeout', now) : state;
}

export const codenames: GameDefinition<CodenamesState, CodenamesAction, CodenamesView> = {
  id: 'codenames',
  name: 'Codenames',
  description: 'Two teams race to contact their agents from one-word clues.',
  minPlayers: 4,
  maxPlayers: 20,
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
};
