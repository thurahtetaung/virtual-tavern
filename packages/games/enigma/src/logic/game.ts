import {
  type ActionCtx,
  type CreateCtx,
  type GameDefinition,
  GameError,
  type PlayerId,
  type PlayerInfo,
  type Rng,
  wordPool,
} from '@vt/game-sdk';
import { guide } from './guide.ts';
import {
  CODE_LENGTH,
  type Code,
  type EnigmaAction,
  type EnigmaState,
  type EnigmaView,
  FIRST_INTERCEPT_ROUND,
  KEYWORD_COUNT,
  MAX_CHAT_MESSAGES,
  MAX_NOTE_LENGTH,
  MAX_ROUNDS,
  MIN_TEAM_SIZE,
  type Role,
  type Seat,
  TOKENS_TO_END,
  type Team,
  type TeamState,
  type Transmission,
  type TransmissionView,
  type Vote,
  actionSchema,
} from './types.ts';

type Ctx = ActionCtx;
type Result = EnigmaState | GameError;
type Side = 'decode' | 'intercept';

export const TEAMS = ['red', 'blue'] as const;
export const otherTeam = (t: Team): Team => (t === 'red' ? 'blue' : 'red');

const sameCode = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((d, i) => d === b[i]);

/** A guess that could be the real code: three distinct digits 1–4. */
export const isCompleteCode = (draft: readonly number[]) =>
  draft.length === CODE_LENGTH &&
  draft.every((d) => d >= 1 && d <= KEYWORD_COUNT) &&
  new Set(draft).size === CODE_LENGTH;

export function membersOf(state: EnigmaState, team: Team): PlayerId[] {
  return Object.entries(state.seats).flatMap(([id, s]) => (s.team === team ? [id] : []));
}

/** A team with no history. `encryptorTurn` is offset per game so rematches start with a new Encryptor. */
function emptyTeam(keywords: string[] = [], encryptorTurn = 0): TeamState {
  return {
    keywords,
    intercepts: 0,
    misses: 0,
    history: [],
    chat: [],
    notes: { guesses: Array<string>(KEYWORD_COUNT).fill(''), general: '', editedBy: null },
    encryptorTurn,
  };
}

const deadline = (seconds: number | null, now: number) =>
  seconds === null ? null : now + seconds * 1000;

function drawCode(rng: Rng): Code {
  return rng.shuffle(Array.from({ length: KEYWORD_COUNT }, (_, i) => i + 1)).slice(0, CODE_LENGTH);
}

/** Who would have to agree on `side` of a transmission if guessing started now. */
function liveVoters(state: EnigmaState, tx: Transmission, side: Side): PlayerId[] {
  if (side === 'decode') return membersOf(state, tx.team).filter((id) => id !== tx.encryptor);
  return state.round >= FIRST_INTERCEPT_ROUND ? membersOf(state, otherTeam(tx.team)) : [];
}

/**
 * Who must agree on `side` of a transmission. Fixed when guessing starts (so a player joining
 * mid-round can't stall the vote) and pruned as players leave (so departures never stall it).
 */
export function votersFor(state: EnigmaState, tx: Transmission, side: Side): PlayerId[] {
  return (side === 'decode' ? tx.decodeVoters : tx.interceptVoters) ?? liveVoters(state, tx, side);
}

/**
 * Keeps a transmission that hasn't been sent yet playable: an Encryptor who left is replaced by
 * the first teammate, and a team too small to decode (nobody but the Encryptor) can't transmit
 * at all, so its turn fails as a miscommunication.
 */
function repairTransmission(state: EnigmaState, tx: Transmission): Transmission {
  if (tx.clues || tx.revealed || tx.expired) return tx;
  const members = membersOf(state, tx.team);
  if (members.length < MIN_TEAM_SIZE) return { ...tx, expired: true };
  return members.includes(tx.encryptor) ? tx : { ...tx, encryptor: members[0]! };
}

/**
 * The agreed code once every voter has locked in the same complete code; null if nobody can vote;
 * undefined while still undecided.
 */
function consensus(state: EnigmaState, tx: Transmission, side: Side): Code | null | undefined {
  const voters = votersFor(state, tx, side);
  if (voters.length === 0) return null;
  const votes = voters.map((id) => tx[side][id]);
  if (!votes.every((v): v is Vote => !!v?.locked)) return undefined;
  const first = votes[0]!.draft;
  return votes.every((v) => sameCode(v.draft, first)) ? [...first] : undefined;
}

// ---- Round flow ----

function beginRound(
  state: EnigmaState,
  round: number,
  ctx: { rng: Rng; now: number },
): EnigmaState {
  const first = round % 2 === 1 ? state.startingTeam : otherTeam(state.startingTeam);
  const teams = { ...state.teams };
  const transmissions = [first, otherTeam(first)].map((team): Transmission => {
    const members = membersOf(state, team);
    const turn = teams[team].encryptorTurn;
    teams[team] = { ...teams[team], encryptorTurn: turn + 1 };
    return repairTransmission(state, {
      team,
      encryptor: members.length ? members[turn % members.length]! : '',
      code: drawCode(ctx.rng),
      clues: null,
      expired: false,
      decode: {},
      intercept: {},
      decodeVoters: null,
      interceptVoters: null,
      revealed: false,
    });
  });
  return maybeStartGuessing(
    {
      ...state,
      round,
      teams,
      transmissions,
      active: state.settings.flow === 'simultaneous' ? [0, 1] : [0],
      stage: 'clue',
      deadline: deadline(state.settings.clueSeconds, ctx.now),
    },
    ctx.now,
  );
}

function activeTx(state: EnigmaState): Transmission[] {
  return state.active.map((i) => state.transmissions[i]!);
}

function withTx(state: EnigmaState, index: number, tx: Transmission): EnigmaState {
  const transmissions = [...state.transmissions];
  transmissions[index] = tx;
  return { ...state, transmissions };
}

/**
 * Moves on once every active Encryptor has sent clues (or run out of time, or can't send any).
 * Freezes who votes on each side as guessing starts.
 */
function maybeStartGuessing(state: EnigmaState, now: number): EnigmaState {
  if (state.stage !== 'clue') return state;
  let next = state;
  for (const i of state.active) {
    next = withTx(next, i, repairTransmission(next, next.transmissions[i]!));
  }
  if (!activeTx(next).every((tx) => tx.clues || tx.expired)) return next;
  next = { ...next, stage: 'guess', deadline: deadline(state.settings.guessSeconds, now) };
  for (const i of state.active) {
    const tx = next.transmissions[i]!;
    next = withTx(next, i, {
      ...tx,
      decodeVoters: liveVoters(next, tx, 'decode'),
      interceptVoters: liveVoters(next, tx, 'intercept'),
      // No clues means nothing to decode: it counts as a miscommunication.
      ...(tx.expired ? { decodeResult: null, interceptResult: null } : {}),
    });
  }
  return settleVotes(next);
}

/** Resolves any side that has reached agreement; reveals once every active transmission is settled. */
function settleVotes(state: EnigmaState): EnigmaState {
  if (state.stage !== 'guess') return state;
  let next = state;
  for (const i of state.active) {
    const tx = next.transmissions[i]!;
    const decodeResult =
      tx.decodeResult !== undefined ? tx.decodeResult : consensus(next, tx, 'decode');
    const interceptResult =
      tx.interceptResult !== undefined ? tx.interceptResult : consensus(next, tx, 'intercept');
    next = withTx(next, i, { ...tx, decodeResult, interceptResult });
  }
  const done = activeTx(next).every(
    (tx) => tx.decodeResult !== undefined && tx.interceptResult !== undefined,
  );
  return done ? reveal(next) : next;
}

function reveal(state: EnigmaState): EnigmaState {
  let next: EnigmaState = { ...state, stage: 'reveal', deadline: null };
  for (const i of state.active) {
    const tx = next.transmissions[i]!;
    const decodeGuess = tx.decodeResult ?? null;
    const interceptGuess = tx.interceptResult ?? null;
    const decoded = decodeGuess !== null && sameCode(decodeGuess, tx.code);
    const intercepted = interceptGuess !== null && sameCode(interceptGuess, tx.code);
    const sender = next.teams[tx.team];
    const receiver = next.teams[otherTeam(tx.team)];
    next = {
      ...next,
      teams: {
        ...next.teams,
        [tx.team]: {
          ...sender,
          misses: sender.misses + (decoded ? 0 : 1),
          history: [
            ...sender.history,
            {
              round: next.round,
              code: tx.code,
              clues: tx.clues,
              decodeGuess,
              interceptGuess,
              decoded,
              intercepted,
            },
          ],
        },
        [otherTeam(tx.team)]: {
          ...receiver,
          intercepts: receiver.intercepts + (intercepted ? 1 : 0),
        },
      },
    };
    next = withTx(next, i, { ...tx, revealed: true });
  }
  return next;
}

/** End-of-round check: 2 interceptions win, 2 miscommunications lose; score settles ties and round 8. */
export function decideWinner(state: EnigmaState): Team | 'draw' | null {
  const qualifies = (t: Team) =>
    state.teams[t].intercepts >= TOKENS_TO_END || state.teams[otherTeam(t)].misses >= TOKENS_TO_END;
  const red = qualifies('red');
  const blue = qualifies('blue');
  if (red !== blue) return red ? 'red' : 'blue';
  if (!red && state.round < MAX_ROUNDS) return null;
  const score = (t: Team) => state.teams[t].intercepts - state.teams[t].misses;
  const diff = score('red') - score('blue');
  return diff > 0 ? 'red' : diff < 0 ? 'blue' : 'draw';
}

// ---- Actions ----

function requireHost(ctx: Ctx) {
  return ctx.isHost ? null : new GameError('not-host', 'Only the host can do that.');
}

function seatOf(state: EnigmaState, id: PlayerId): Seat | GameError {
  return state.seats[id] ?? new GameError('not-seated', 'You are not in this game.');
}

function teamSeat(state: EnigmaState, id: PlayerId): (Seat & { team: Team }) | GameError {
  const seat = seatOf(state, id);
  if (seat instanceof GameError) return seat;
  return seat.team
    ? (seat as Seat & { team: Team })
    : new GameError('no-team', 'Join a team first.');
}

function updateSettings(
  state: EnigmaState,
  action: Extract<EnigmaAction, { type: 'update-settings' }>,
  ctx: Ctx,
): Result {
  const err = requireHost(ctx);
  if (err) return err;
  if (state.phase === 'playing')
    return new GameError('in-progress', 'Settings can only change between games.');
  const settings = { ...state.settings };
  if (action.wordListIds) {
    const known = new Set(ctx.content.wordLists().map((l) => l.id));
    const ids = [...new Set(action.wordListIds)];
    if (ids.some((id) => !known.has(id))) {
      return new GameError('unknown-word-list', 'That word list no longer exists.');
    }
    settings.wordListIds = ids;
  }
  if (action.flow) settings.flow = action.flow;
  if (action.clueSeconds !== undefined) settings.clueSeconds = action.clueSeconds;
  if (action.guessSeconds !== undefined) settings.guessSeconds = action.guessSeconds;
  if (action.timerMode !== undefined) settings.timerMode = action.timerMode;
  return { ...state, settings };
}

function joinTeam(state: EnigmaState, team: Team | null, ctx: Ctx): Result {
  const seat = seatOf(state, ctx.by);
  if (seat instanceof GameError) return seat;
  if (state.phase !== 'playing') {
    return { ...state, seats: { ...state.seats, [ctx.by]: { ...seat, team } } };
  }
  // Keywords seen this game stick to the player, even across leaving and rejoining the room.
  const known = state.seen?.[ctx.by] ?? seat.team;
  if (known !== null && known !== team) {
    return new GameError(
      'team-locked',
      "You've seen your team's keywords, so you can't switch mid-game.",
    );
  }
  const seen = team ? { ...state.seen, [ctx.by]: team } : state.seen;
  return { ...state, seen, seats: { ...state.seats, [ctx.by]: { ...seat, team } } };
}

function randomizeTeams(state: EnigmaState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  if (state.phase === 'playing') return new GameError('in-progress', 'Wait for the game to end.');
  const order = ctx.rng.shuffle(Object.keys(state.seats));
  const teamOf = new Map(order.map((id, i) => [id, TEAMS[i % 2]!]));
  const seats = Object.fromEntries(
    Object.entries(state.seats).map(([id, s]) => [id, { ...s, team: teamOf.get(id)! }]),
  );
  return { ...state, seats };
}

function start(state: EnigmaState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  if (state.phase === 'playing') return new GameError('in-progress', 'A game is already running.');
  for (const team of TEAMS) {
    if (membersOf(state, team).length < MIN_TEAM_SIZE) {
      return new GameError('team-too-small', `Each team needs at least ${MIN_TEAM_SIZE} players.`);
    }
  }
  const pool = wordPool(ctx.content.words(state.settings.wordListIds));
  if (pool.length < KEYWORD_COUNT * 2) {
    return new GameError(
      'not-enough-words',
      `The chosen word lists need at least ${KEYWORD_COUNT * 2} words.`,
    );
  }
  const words = ctx.rng.shuffle(pool);
  // Each game's first Encryptor is the next seat along, so rematches don't always start the same.
  const turn = state.gamesPlayed;
  const fresh: EnigmaState = {
    ...state,
    phase: 'playing',
    seen: Object.fromEntries(
      Object.entries(state.seats).flatMap(([id, s]): [PlayerId, Team][] =>
        s.team ? [[id, s.team]] : [],
      ),
    ),
    teams: {
      red: emptyTeam(words.slice(0, KEYWORD_COUNT), turn),
      blue: emptyTeam(words.slice(KEYWORD_COUNT, KEYWORD_COUNT * 2), turn),
    },
    winner: null,
    gamesPlayed: state.gamesPlayed + 1,
  };
  return beginRound(fresh, 1, ctx);
}

/** Back to the lobby with the same teams; everything about the last game is forgotten. */
function backToLobby(state: EnigmaState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  return {
    ...state,
    phase: 'lobby',
    seen: {},
    round: 0,
    teams: { red: emptyTeam(), blue: emptyTeam() },
    transmissions: [],
    active: [],
    stage: 'clue',
    deadline: null,
    winner: null,
  };
}

const normalise = (s: string) => s.trim().toLowerCase();

function giveClues(state: EnigmaState, clues: string[], ctx: Ctx): Result {
  if (state.phase !== 'playing') return new GameError('not-playing', 'No game in progress.');
  const index = state.active.find((i) => state.transmissions[i]!.encryptor === ctx.by);
  if (index === undefined)
    return new GameError('not-encryptor', "You're not the Encryptor right now.");
  const tx = state.transmissions[index]!;
  if (state.stage !== 'clue' || tx.clues || tx.expired) {
    return new GameError('wrong-stage', 'Clues have already been sent.');
  }
  const trimmed = clues.map((c) => c.trim());
  const keywords = new Set(state.teams[tx.team].keywords.map(normalise));
  if (trimmed.some((c) => keywords.has(normalise(c)))) {
    return new GameError('clue-is-keyword', "A clue can't be one of your team's keywords.");
  }
  if (trimmed.some((c) => /^\p{N}+$/u.test(c))) {
    return new GameError('clue-is-number', "A clue can't be just a number.");
  }
  if (new Set(trimmed.map(normalise)).size !== trimmed.length) {
    return new GameError('clues-not-distinct', 'Give three different clues.');
  }
  return maybeStartGuessing(withTx(state, index, { ...tx, clues: trimmed }), ctx.now);
}

/** Finds the active transmission sent by `team` and which side `by` votes on. */
function voteTarget(
  state: EnigmaState,
  team: Team,
  by: PlayerId,
): { index: number; side: Side } | GameError {
  if (state.phase !== 'playing' || state.stage !== 'guess') {
    return new GameError('wrong-stage', "It's not time to guess.");
  }
  const index = state.active.find((i) => state.transmissions[i]!.team === team);
  if (index === undefined)
    return new GameError('not-active', "That team isn't transmitting right now.");
  const tx = state.transmissions[index]!;
  const seat = teamSeat(state, by);
  if (seat instanceof GameError) return seat;
  const side: Side = seat.team === team ? 'decode' : 'intercept';
  if (!votersFor(state, tx, side).includes(by)) {
    if (side === 'decode' && by === tx.encryptor)
      return new GameError('encryptor-cannot-decode', 'The Encryptor already knows the code.');
    if (side === 'intercept' && state.round < FIRST_INTERCEPT_ROUND)
      return new GameError(
        'no-intercept-yet',
        `Interception starts in round ${FIRST_INTERCEPT_ROUND}.`,
      );
    return new GameError(
      'not-voting',
      'You joined after guessing started, so you sit this one out until the next clues.',
    );
  }
  const resolved = side === 'decode' ? tx.decodeResult : tx.interceptResult;
  if (resolved !== undefined) return new GameError('settled', 'Your team has already agreed.');
  return { index, side };
}

function setVote(
  state: EnigmaState,
  team: Team,
  ctx: Ctx,
  update: (v: Vote | undefined) => Vote | GameError,
): Result {
  const target = voteTarget(state, team, ctx.by);
  if (target instanceof GameError) return target;
  const tx = state.transmissions[target.index]!;
  const vote = update(tx[target.side][ctx.by]);
  if (vote instanceof GameError) return vote;
  const next = withTx(state, target.index, {
    ...tx,
    [target.side]: { ...tx[target.side], [ctx.by]: vote },
  });
  return settleVotes(next);
}

/** An Encryptor whose team is still decoding their code must not drop hints in chat. */
function isSilenced(state: EnigmaState, id: PlayerId): boolean {
  return (
    state.phase === 'playing' &&
    state.stage === 'guess' &&
    activeTx(state).some((tx) => tx.encryptor === id && tx.decodeResult === undefined)
  );
}

function chat(state: EnigmaState, text: string, ctx: Ctx): Result {
  const seat = teamSeat(state, ctx.by);
  if (seat instanceof GameError) return seat;
  if (isSilenced(state, ctx.by)) {
    return new GameError(
      'encryptor-silent',
      'Encryptors stay quiet in chat until their team has locked in the code.',
    );
  }
  const t = state.teams[seat.team];
  const messages = [...t.chat, { by: ctx.by, text, at: ctx.now }].slice(-MAX_CHAT_MESSAGES);
  return { ...state, teams: { ...state.teams, [seat.team]: { ...t, chat: messages } } };
}

function setNote(state: EnigmaState, slot: number | 'general', text: string, ctx: Ctx): Result {
  const seat = teamSeat(state, ctx.by);
  if (seat instanceof GameError) return seat;
  if (slot !== 'general' && text.length > MAX_NOTE_LENGTH) {
    return new GameError(
      'note-too-long',
      `Keyword guesses are at most ${MAX_NOTE_LENGTH} characters.`,
    );
  }
  const t = state.teams[seat.team];
  const notes =
    slot === 'general'
      ? { ...t.notes, general: text, editedBy: ctx.by }
      : {
          ...t.notes,
          guesses: t.notes.guesses.map((g, i) => (i === slot - 1 ? text : g)),
          editedBy: ctx.by,
        };
  return { ...state, teams: { ...state.teams, [seat.team]: { ...t, notes } } };
}

function nextRound(state: EnigmaState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  if (state.phase !== 'playing' || state.stage !== 'reveal') {
    return new GameError('wrong-stage', 'Finish this round first.');
  }
  // Alternating: the second team transmits before the round ends.
  if (state.active.length === 1 && state.active[0] === 0) {
    return maybeStartGuessing(
      {
        ...state,
        active: [1],
        stage: 'clue',
        deadline: deadline(state.settings.clueSeconds, ctx.now),
      },
      ctx.now,
    );
  }
  const winner = decideWinner(state);
  if (winner) {
    return {
      ...state,
      phase: 'over',
      winner,
      deadline: null,
      // The other team opens the rematch.
      startingTeam: otherTeam(state.startingTeam),
    };
  }
  return beginRound(state, state.round + 1, ctx);
}

function reduce(state: EnigmaState, action: EnigmaAction, ctx: Ctx): Result {
  switch (action.type) {
    case 'update-settings':
      return updateSettings(state, action, ctx);
    case 'join-team':
      return joinTeam(state, action.team, ctx);
    case 'randomize-teams':
      return randomizeTeams(state, ctx);
    case 'start':
      return start(state, ctx);
    case 'back-to-lobby':
      return backToLobby(state, ctx);
    case 'give-clues':
      return giveClues(state, action.clues, ctx);
    case 'set-guess':
      return setVote(state, action.team, ctx, () => ({ draft: [...action.draft], locked: false }));
    case 'lock-guess':
      return setVote(state, action.team, ctx, (v) =>
        v && isCompleteCode(v.draft)
          ? { ...v, locked: true }
          : new GameError('incomplete', 'Pick three different numbers first.'),
      );
    case 'unlock-guess':
      return setVote(state, action.team, ctx, (v) => ({
        draft: v?.draft ?? [0, 0, 0],
        locked: false,
      }));
    case 'chat':
      return chat(state, action.text, ctx);
    case 'set-note':
      return setNote(state, action.slot, action.text, ctx);
    case 'next-round':
      return nextRound(state, ctx);
  }
}

// ---- Players coming and going ----

function create(ctx: CreateCtx, players: readonly PlayerInfo[]): EnigmaState {
  const firstList = ctx.content.wordLists()[0];
  return {
    phase: 'lobby',
    settings: {
      wordListIds: firstList ? [firstList.id] : [],
      flow: 'simultaneous',
      clueSeconds: null,
      guessSeconds: null,
      timerMode: 'soft',
    },
    seats: Object.fromEntries(players.map((p) => [p.id, { name: p.name, team: null }])),
    seen: {},
    startingTeam: ctx.rng.int(2) === 0 ? 'red' : 'blue',
    round: 0,
    teams: { red: emptyTeam(), blue: emptyTeam() },
    transmissions: [],
    active: [],
    stage: 'clue',
    deadline: null,
    winner: null,
    gamesPlayed: 0,
  };
}

function playerJoined(state: EnigmaState, player: PlayerInfo): EnigmaState {
  const existing = state.seats[player.id];
  const seat: Seat = existing
    ? { ...existing, name: player.name }
    : { name: player.name, team: null };
  return { ...state, seats: { ...state.seats, [player.id]: seat } };
}

function playerLeft(state: EnigmaState, playerId: PlayerId, now: number): EnigmaState {
  const seat = state.seats[playerId];
  if (!seat) return state;
  const seats = { ...state.seats };
  delete seats[playerId];
  let next: EnigmaState = { ...state, seats };
  if (state.phase !== 'playing') return next;

  // `seen` is deliberately kept: rejoining must not unlock the other team's keywords.
  const without = (votes: Record<PlayerId, Vote>) => {
    const copy = { ...votes };
    delete copy[playerId];
    return copy;
  };
  const prune = (voters: PlayerId[] | null) => voters && voters.filter((id) => id !== playerId);
  next = {
    ...next,
    transmissions: next.transmissions.map((tx) =>
      repairTransmission(next, {
        ...tx,
        decode: without(tx.decode),
        intercept: without(tx.intercept),
        decodeVoters: prune(tx.decodeVoters),
        interceptVoters: prune(tx.interceptVoters),
      }),
    ),
  };
  return settleVotes(maybeStartGuessing(next, now));
}

// ---- Timers ----

function nextDeadline(state: EnigmaState): number | null {
  if (
    state.phase !== 'playing' ||
    state.settings.timerMode !== 'strict' ||
    state.stage === 'reveal'
  )
    return null;
  return state.deadline;
}

function onDeadline(state: EnigmaState, now: number): EnigmaState {
  const due = nextDeadline(state);
  if (due === null || now < due) return state;
  if (state.stage === 'clue') {
    let next = state;
    for (const i of state.active) {
      const tx = next.transmissions[i]!;
      if (!tx.clues) next = withTx(next, i, { ...tx, expired: true });
    }
    return maybeStartGuessing(next, now);
  }
  // Guess timer: any side that hasn't agreed simply fails.
  let next = state;
  for (const i of state.active) {
    const tx = next.transmissions[i]!;
    next = withTx(next, i, {
      ...tx,
      decodeResult: tx.decodeResult === undefined ? null : tx.decodeResult,
      interceptResult: tx.interceptResult === undefined ? null : tx.interceptResult,
    });
  }
  return reveal(next);
}

// ---- What each viewer may see ----

function roleIn(
  state: EnigmaState,
  tx: Transmission,
  viewer: PlayerId | null,
  team: Team | null,
): Role {
  if (viewer === null || team === null) return 'spectator';
  if (tx.encryptor === viewer) return 'encryptor';
  const side: Side = team === tx.team ? 'decode' : 'intercept';
  if (side === 'intercept' && state.round < FIRST_INTERCEPT_ROUND) return 'waiting';
  // Once guessing has started, only those who were there when it did get a vote.
  if (!votersFor(state, tx, side).includes(viewer)) return 'waiting';
  return side === 'decode' ? 'decoder' : 'interceptor';
}

function transmissionView(
  state: EnigmaState,
  tx: Transmission,
  index: number,
  viewer: PlayerId | null,
): TransmissionView {
  const team = viewer === null ? null : (state.seats[viewer]?.team ?? null);
  const role = roleIn(state, tx, viewer, team);
  const side: Side | null = team === null ? null : team === tx.team ? 'decode' : 'intercept';
  const voters = side ? votersFor(state, tx, side) : [];
  const teamVotes = side ? tx[side] : {};
  const locked = voters.map((id) => teamVotes[id]);
  const allLocked = voters.length > 0 && locked.every((v) => v?.locked);
  const resolved =
    side === 'decode' ? tx.decodeResult : side === 'intercept' ? tx.interceptResult : undefined;
  const over = state.phase === 'over';
  const entry = tx.revealed
    ? state.teams[tx.team].history.find((h) => h.round === state.round)
    : undefined;
  // In alternating flow the second Encryptor only learns their code once the first team is done.
  const mine = tx.encryptor === viewer && state.active.includes(index);
  return {
    team: tx.team,
    encryptor: tx.encryptor,
    code: tx.revealed || over || mine ? tx.code : null,
    clues: tx.clues,
    expired: tx.expired,
    active: state.active.includes(index),
    revealed: tx.revealed,
    role,
    teamVotes: side ? { ...teamVotes } : {},
    voters,
    disagree: allLocked && resolved === undefined,
    settled: resolved !== undefined,
    result: entry
      ? {
          decodeGuess: entry.decodeGuess,
          interceptGuess: entry.interceptGuess,
          decoded: entry.decoded,
          intercepted: entry.intercepted,
        }
      : null,
  };
}

function view(state: EnigmaState, viewer: PlayerId | null): EnigmaView {
  const mySeat = viewer === null ? undefined : state.seats[viewer];
  const myTeam = mySeat?.team ?? null;
  const over = state.phase === 'over';
  const teamView = (t: Team) => ({
    keywords: over || myTeam === t ? state.teams[t].keywords : null,
    intercepts: state.teams[t].intercepts,
    misses: state.teams[t].misses,
    history: state.teams[t].history,
    members: membersOf(state, t),
  });
  return {
    phase: state.phase,
    settings: state.settings,
    seats: Object.entries(state.seats).map(([id, s]) => ({ id, ...s })),
    me: mySeat && viewer !== null ? { id: viewer, ...mySeat } : null,
    round: state.round,
    maxRounds: MAX_ROUNDS,
    stage: state.stage,
    startingTeam: state.startingTeam,
    teams: { red: teamView('red'), blue: teamView('blue') },
    transmissions: state.transmissions.map((tx, i) => transmissionView(state, tx, i, viewer)),
    chat: myTeam ? state.teams[myTeam].chat : [],
    notes: myTeam ? state.teams[myTeam].notes : null,
    deadline: state.deadline,
    winner: state.winner,
  };
}

export const enigma: GameDefinition<EnigmaState, EnigmaAction, EnigmaView> = {
  id: 'enigma',
  name: 'Enigma',
  description: 'Two teams pass secret codes with clues while trying to crack each other’s.',
  minPlayers: 4,
  maxPlayers: 16,
  guide,
  actionSchema,
  create,
  reduce,
  playerJoined,
  playerLeft,
  view,
  nextDeadline,
  onDeadline,
};
