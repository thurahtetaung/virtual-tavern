import {
  type ActionCtx,
  type CreateCtx,
  type GameDefinition,
  GameError,
  type PlayerId,
  type PlayerInfo,
  createRng,
  containsWord,
  isNumberOnly,
  isSingleWord,
  normaliseWord,
  sameAnswer,
  sameClue,
  wordPool,
} from '@vt/game-sdk';
import { echoAwards } from './awards.ts';
import { guide } from './guide.ts';
import { insights } from './insights.ts';
import {
  CARD_SIZE,
  type Card,
  type ClueView,
  DEFAULT_DECK_SIZE,
  type EchoAction,
  type EchoState,
  type EchoView,
  JUDGE_GRACE_MS,
  MAX_HISTORY,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type Outcome,
  type Role,
  type Seat,
  type Turn,
  type TurnView,
  actionSchema,
} from './types.ts';

type Ctx = ActionCtx;
type Result = EchoState | GameError;

const SEED_RANGE = 0x1_0000_0000;
const ROOM_CAPACITY = 20;

export function playingIds(state: EchoState): PlayerId[] {
  return Object.entries(state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));
}

const deadline = (seconds: number | null, now: number) =>
  seconds === null ? null : now + seconds * 1000;

const clueId = (giver: PlayerId, index: number) => `${giver}:${index}`;

/** End-of-game rating, scaled to the deck: all cards right is Perfect. */
export function rating(score: number, deckSize: number): string {
  const share = deckSize > 0 ? score / deckSize : 0;
  if (share >= 1) return 'Perfect';
  if (share >= 0.85) return 'Amazing';
  if (share >= 0.7) return 'Great';
  if (share >= 0.5) return 'Good';
  if (share >= 0.25) return 'A good start';
  return 'Try again';
}

// ---- Card flow ----

/** The playing seat after the current guesser, in seat order; leavers keep their old place. */
function nextGuesser(state: EchoState, turn: Turn): PlayerId | null {
  const order = [
    ...turn.seatOrder,
    ...Object.keys(state.seats).filter((id) => !turn.seatOrder.includes(id)),
  ];
  const from = order.indexOf(turn.guesser);
  for (let k = 1; k <= order.length; k++) {
    const id = order[(from + k) % order.length]!;
    if (id !== turn.guesser && state.seats[id]?.playing) return id;
  }
  return playingIds(state)[0] ?? null;
}

function endGame(state: EchoState, endReason: 'finished' | 'too-few'): EchoState {
  return { ...state, phase: 'over', turn: null, deck: [], endReason };
}

/** Deals the top card to `guesser`, or ends the game when the deck is done. */
function deal(state: EchoState, guesser: PlayerId, now: number): EchoState {
  const [card, ...deck] = state.deck;
  if (state.cardsLeft <= 0 || !card) return endGame(state, 'finished');
  return {
    ...state,
    deck,
    turn: {
      guesser,
      card,
      pick: null,
      stage: 'pick',
      seatOrder: Object.keys(state.seats),
      givers: [],
      perGiver: 1,
      clues: {},
      cancelled: {},
      guess: null,
      outcome: null,
      countedBy: null,
      deadline: deadline(state.settings.guessSeconds, now),
    },
  };
}

function withTurn(state: EchoState, patch: Partial<Turn>): EchoState {
  return { ...state, turn: { ...state.turn!, ...patch } };
}

/** Everyone playing except the guesser. */
function liveGivers(state: EchoState, turn: Turn): PlayerId[] {
  return playingIds(state).filter((id) => id !== turn.guesser);
}

function beginClues(state: EchoState, pick: number, now: number): EchoState {
  const turn = state.turn!;
  const givers = liveGivers(state, turn);
  return withTurn(state, {
    pick,
    stage: 'clues',
    givers,
    perGiver: givers.length === 2 ? 2 : 1,
    deadline: deadline(state.settings.clueSeconds, now),
  });
}

/** Every clue that is the same word (`sameClue`) as another player's clue cancels. */
function cancellations(clues: Record<PlayerId, string[]>): Record<string, 'duplicate'> {
  const all = Object.entries(clues).flatMap(([giver, list]) =>
    list.map((text, i) => ({ giver, text, id: clueId(giver, i) })),
  );
  const cancelled: Record<string, 'duplicate'> = {};
  for (const clue of all) {
    if (all.some((o) => o.giver !== clue.giver && sameClue(o.text, clue.text))) {
      cancelled[clue.id] = 'duplicate';
    }
  }
  return cancelled;
}

/** Moves on to guessing once every giver has sent clues (or the clue timer forces it). */
function maybeStartGuessing(state: EchoState, now: number, force = false): EchoState {
  let turn = state.turn;
  if (state.phase !== 'playing' || !turn || turn.stage !== 'clues') return state;
  // Every giver left but there are still players: whoever is playing now writes the clues.
  if (turn.givers.length === 0) {
    const givers = liveGivers(state, turn);
    turn = { ...turn, givers, perGiver: givers.length === 2 ? 2 : 1 };
    state = { ...state, turn };
  }
  if (!force && !turn.givers.every((g) => turn.clues[g])) return state;
  const missed = turn.givers.filter((g) => !turn.clues[g]);
  return withTurn(state, {
    stage: 'guess',
    ...(missed.length > 0 && { missed }),
    cancelled: cancellations(turn.clues),
    deadline: deadline(state.settings.guessSeconds, now),
  });
}

function reveal(
  state: EchoState,
  outcome: Outcome,
  countedBy: PlayerId | null,
  timedOut = false,
): EchoState {
  const turn = state.turn!;
  const word = turn.card[turn.pick!]!;
  let { score, cardsLeft, deck } = state;
  // A wrong guess on the last card has no next card to lose.
  const burned = outcome === 'wrong' && state.cardsLeft >= 2;
  if (outcome === 'right') {
    score += 1;
    cardsLeft -= 1;
  } else if (outcome === 'pass') {
    cardsLeft -= 1;
  } else {
    // A wrong guess costs this card and the next one.
    cardsLeft = Math.max(0, cardsLeft - 2);
    deck = deck.slice(1);
  }
  const nameOf = (id: PlayerId) => state.seats[id]?.name ?? '';
  const entry = {
    word,
    guesser: turn.guesser,
    guesserName: nameOf(turn.guesser),
    guess: turn.guess,
    outcome,
    countedBy,
    clues: Object.entries(turn.clues).flatMap(([by, list]) =>
      list.map((text, i) => ({
        by,
        name: nameOf(by),
        text,
        cancelled: !!turn.cancelled[clueId(by, i)],
      })),
    ),
    ...(timedOut && { timedOut: true }),
    ...(turn.missed &&
      turn.missed.length > 0 && { missed: turn.missed.map(nameOf).filter(Boolean) }),
    ...(burned ? { burned: true as const } : {}),
  };
  return {
    ...state,
    score,
    cardsLeft,
    deck,
    history: [...state.history, entry].slice(-MAX_HISTORY),
    turn: {
      ...turn,
      stage: 'reveal',
      outcome,
      countedBy,
      deadline: null,
      ...(timedOut && { timedOut: true }),
    },
  };
}

// ---- Actions ----

function requireHost(ctx: Ctx) {
  return ctx.isHost ? null : new GameError('not-host', 'Only the host can do that.');
}

function requireStage(state: EchoState, stage: Turn['stage']): Turn | GameError {
  if (state.phase !== 'playing' || !state.turn) {
    return new GameError('not-playing', 'No game in progress.');
  }
  if (state.turn.stage !== stage) return new GameError('wrong-stage', "That's not possible now.");
  return state.turn;
}

function updateSettings(
  state: EchoState,
  action: Extract<EchoAction, { type: 'update-settings' }>,
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
    if (ids.some((id) => !known.has(id))) {
      return new GameError('unknown-word-list', 'That word list no longer exists.');
    }
    settings.wordListIds = ids;
  }
  if (action.deckSize !== undefined) settings.deckSize = action.deckSize;
  if (action.clueSeconds !== undefined) settings.clueSeconds = action.clueSeconds;
  if (action.guessSeconds !== undefined) settings.guessSeconds = action.guessSeconds;
  if (action.timerMode !== undefined) settings.timerMode = action.timerMode;
  return { ...state, settings };
}

function sit(state: EchoState, playing: boolean, ctx: Ctx): Result {
  const seat = state.seats[ctx.by];
  if (!seat) return new GameError('not-seated', 'You are not in this game.');
  if (seat.playing === playing) return state;
  if (playing) {
    if (playingIds(state).length >= MAX_PLAYERS) {
      return new GameError('table-full', `At most ${MAX_PLAYERS} players can play.`);
    }
    // Mid-game, a new player joins the rotation from the next card.
    return { ...state, seats: { ...state.seats, [ctx.by]: { ...seat, playing: true } } };
  }
  return withdraw(
    { ...state, seats: { ...state.seats, [ctx.by]: { ...seat, playing: false } } },
    ctx.by,
    ctx.now,
  );
}

function start(state: EchoState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  if (state.phase === 'playing') return new GameError('in-progress', 'A game is already running.');
  const players = playingIds(state);
  if (players.length < MIN_PLAYERS) {
    return new GameError('too-few-players', `Echo needs at least ${MIN_PLAYERS} players.`);
  }
  if (players.length > MAX_PLAYERS) {
    return new GameError('too-many-players', `At most ${MAX_PLAYERS} players can play.`);
  }
  const { deckSize } = state.settings;
  const pool = wordPool(ctx.content.words(state.settings.wordListIds));
  const needed = deckSize * CARD_SIZE;
  if (pool.length < needed) {
    return new GameError(
      'not-enough-words',
      `A deck of ${deckSize} cards needs at least ${needed} words in the chosen lists.`,
    );
  }
  const words = ctx.rng.shuffle(pool).slice(0, needed);
  const deck: Card[] = Array.from({ length: deckSize }, (_, i) =>
    words.slice(i * CARD_SIZE, (i + 1) * CARD_SIZE),
  );
  const fresh: EchoState = {
    ...state,
    phase: 'playing',
    deck,
    turn: null,
    score: 0,
    cardsLeft: deckSize,
    history: [],
    seed: ctx.rng.int(SEED_RANGE),
    gamesPlayed: state.gamesPlayed + 1,
    endReason: null,
  };
  // Each game starts with the next player along, so rematches don't always start the same.
  return deal(fresh, players[state.gamesPlayed % players.length]!, ctx.now);
}

function backToLobby(state: EchoState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  return {
    ...state,
    phase: 'lobby',
    deck: [],
    turn: null,
    score: 0,
    cardsLeft: 0,
    history: [],
    endReason: null,
  };
}

function pick(state: EchoState, index: number, ctx: Ctx): Result {
  const turn = requireStage(state, 'pick');
  if (turn instanceof GameError) return turn;
  if (turn.guesser !== ctx.by) return new GameError('not-guesser', 'Only the guesser picks.');
  if (index >= turn.card.length) return new GameError('bad-pick', 'Pick one of the cards.');
  return beginClues(state, index, ctx.now);
}

/** Why a clue can't be used, or null if it's fine. The UI uses it to explain a refusal inline. */
export function clueProblem(clue: string, word: string): GameError | null {
  if (!isSingleWord(clue) || !/[\p{L}\p{N}]/u.test(clue)) {
    return new GameError('not-one-word', `“${clue}” isn't a single word.`);
  }
  if (isNumberOnly(clue)) return new GameError('number-only', "A clue can't be just a number.");
  if (containsWord(clue, word)) {
    return new GameError('is-the-word', `“${clue}” gives the word away.`);
  }
  return null;
}

/** The first problem with a player's set of clues: each clue's own, then two of the same. */
export function cluesProblem(clues: readonly string[], word: string): GameError | null {
  for (const clue of clues) {
    const problem = clueProblem(clue, word);
    if (problem) return problem;
  }
  if (clues.some((c, i) => clues.some((o, j) => j < i && sameClue(o, c)))) {
    return new GameError('same-clue-twice', 'Your two clues must be different words.');
  }
  return null;
}

function giveClues(state: EchoState, clues: string[], ctx: Ctx): Result {
  const turn = requireStage(state, 'clues');
  if (turn instanceof GameError) return turn;
  if (!turn.givers.includes(ctx.by)) {
    return new GameError('not-giver', "You're not writing clues for this card.");
  }
  if (clues.length !== turn.perGiver) {
    return new GameError(
      'clue-count',
      turn.perGiver === 2 ? 'Write two clues.' : 'Write one clue.',
    );
  }
  const word = turn.card[turn.pick!]!;
  const problem = cluesProblem(clues, word);
  if (problem) return problem;
  return maybeStartGuessing(
    withTurn(state, { clues: { ...turn.clues, [ctx.by]: clues } }),
    ctx.now,
  );
}

function skipLateClues(state: EchoState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  const turn = requireStage(state, 'clues');
  if (turn instanceof GameError) return turn;
  const next = maybeStartGuessing(state, ctx.now, true);
  return next.turn?.missed?.length ? withTurn(next, { skipped: true }) : next;
}

function guess(state: EchoState, word: string, ctx: Ctx): Result {
  const turn = requireStage(state, 'guess');
  if (turn instanceof GameError) return turn;
  if (turn.guesser !== ctx.by) return new GameError('not-guesser', 'Only the guesser guesses.');
  const next = withTurn(state, { guess: word });
  // The game decides on its own: nobody is asked to judge a near miss any more.
  return reveal(next, guessMatches(word, turn.card[turn.pick!]!) ? 'right' : 'wrong', null);
}

/** Letters and digits only, so spacing, hyphens and punctuation never matter. */
const squash = (s: string) => normaliseWord(s).replace(/[^\p{L}\p{N}]/gu, '');

/** Whether two words are one typo apart: a letter added, dropped, changed or two swapped. */
function oneTypoApart(a: string, b: string): boolean {
  if (a === b || Math.abs(a.length - b.length) > 1) return a === b;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (a.length === b.length) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  const [long, short] = a.length > b.length ? [a, b] : [b, a];
  return long.slice(i + 1) === short.slice(i);
}

/**
 * A guess is right when it is the word in another form (`sameAnswer`: plurals, irregular plurals,
 * US/UK spellings, spacing, hyphens, a multi-word answer run together) or one typo away from an
 * answer of 5 or more letters. Anything else, a longer or shorter word included, is wrong.
 */
export function guessMatches(guess: string, answer: string): boolean {
  if (sameAnswer(guess, answer)) return true;
  const g = squash(guess);
  const a = squash(answer);
  if (!g || !a) return false;
  return a.length >= 5 && oneTypoApart(g, a);
}

function pass(state: EchoState, ctx: Ctx): Result {
  const turn = requireStage(state, 'guess');
  if (turn instanceof GameError) return turn;
  if (turn.guesser !== ctx.by) return new GameError('not-guesser', 'Only the guesser can pass.');
  return reveal(state, 'pass', null);
}

function judge(state: EchoState, counts: boolean, ctx: Ctx): Result {
  const turn = requireStage(state, 'judge');
  if (turn instanceof GameError) return turn;
  const giver = turn.givers.includes(ctx.by);
  if (counts && !giver) {
    return new GameError('not-giver', 'Only the clue writers can count a near miss.');
  }
  if (!counts && !giver && !ctx.isHost) {
    return new GameError('not-giver', 'Only the clue writers or the host can move on.');
  }
  // The guesser doesn't judge their own guess. A host who is guessing may only settle it when
  // nobody else can: every clue writer has gone, or they've had a fair while to decide.
  if (
    !counts &&
    ctx.by === turn.guesser &&
    turn.givers.length > 0 &&
    ctx.now < (turn.judgeStarted ?? 0) + JUDGE_GRACE_MS
  ) {
    return new GameError(
      'guesser-judging',
      'The clue writers decide on your guess. Give them a moment first.',
    );
  }
  return counts ? reveal(state, 'right', ctx.by) : reveal(state, 'wrong', null);
}

function nextCard(state: EchoState, cardsLeft: number | undefined, ctx: Ctx): Result {
  // Anyone at the table may deal on, so nobody waits for a host who has looked away.
  if (!ctx.isHost && !state.seats[ctx.by]?.playing) {
    return new GameError('not-at-table', 'Only players at the table can deal the next card.');
  }
  // Two people tapping Next card together: the second tap finds the card already dealt.
  if (cardsLeft !== undefined && cardsLeft === state.cardsLeft && state.turn?.stage === 'pick') {
    return state;
  }
  const turn = requireStage(state, 'reveal');
  if (turn instanceof GameError) return turn;
  if (state.cardsLeft <= 0) return endGame(state, 'finished');
  const guesser = nextGuesser(state, turn);
  return guesser ? deal(state, guesser, ctx.now) : endGame(state, 'too-few');
}

function reduce(state: EchoState, action: EchoAction, ctx: Ctx): Result {
  switch (action.type) {
    case 'update-settings':
      return updateSettings(state, action, ctx);
    case 'sit':
      return sit(state, action.playing, ctx);
    case 'start':
      return start(state, ctx);
    case 'back-to-lobby':
      return backToLobby(state, ctx);
    case 'pick':
      return pick(state, action.index, ctx);
    case 'give-clues':
      return giveClues(state, action.clues, ctx);
    case 'guess':
      return guess(state, action.word, ctx);
    case 'pass':
      return pass(state, ctx);
    case 'count-it':
      return judge(state, true, ctx);
    case 'continue':
      return judge(state, false, ctx);
    case 'skip-late-clues':
      return skipLateClues(state, ctx);
    case 'next-card':
      return nextCard(state, action.cardsLeft, ctx);
  }
}

// ---- Players coming and going ----

function create(ctx: CreateCtx, players: readonly PlayerInfo[]): EchoState {
  const firstList = ctx.content.wordLists()[0];
  return {
    phase: 'lobby',
    settings: {
      wordListIds: firstList ? [firstList.id] : [],
      deckSize: DEFAULT_DECK_SIZE,
      clueSeconds: null,
      guessSeconds: null,
      timerMode: 'soft',
    },
    seats: Object.fromEntries(
      players.map((p, i) => [p.id, { name: p.name, playing: i < MAX_PLAYERS }]),
    ),
    deck: [],
    turn: null,
    score: 0,
    cardsLeft: 0,
    history: [],
    seed: ctx.rng.int(SEED_RANGE),
    gamesPlayed: 0,
    endReason: null,
  };
}

function playerJoined(state: EchoState, player: PlayerInfo): EchoState {
  const existing = state.seats[player.id];
  // A newcomer plays if there's room; mid-game they watch until the next card.
  const seat: Seat = existing
    ? { ...existing, name: player.name }
    : { name: player.name, playing: playingIds(state).length < MAX_PLAYERS };
  return { ...state, seats: { ...state.seats, [player.id]: seat } };
}

/**
 * Takes a player out of the current card once they've left or stood up (their seat is already
 * gone or no longer playing). Keeps the game moving, and ends it below the minimum.
 */
function withdraw(state: EchoState, id: PlayerId, now: number): EchoState {
  const turn = state.turn;
  if (state.phase !== 'playing' || !turn) return state;
  if (playingIds(state).length < MIN_PLAYERS) return endGame(state, 'too-few');
  if (turn.stage === 'reveal') return state;

  if (turn.guesser === id) {
    // The card goes back on top for the next guesser. A word the leaver had picked has been
    // seen by the clue writers, so it is struck off; the rest of the card stays unseen.
    const card = turn.pick === null ? turn.card : turn.card.filter((_, i) => i !== turn.pick);
    const back: EchoState =
      card.length > 0
        ? { ...state, deck: [card, ...state.deck] }
        : { ...state, cardsLeft: state.cardsLeft - 1 };
    const guesser = nextGuesser(state, turn);
    return guesser ? deal(back, guesser, now) : endGame(state, 'too-few');
  }

  if (!turn.givers.includes(id)) return state;
  const givers = turn.givers.filter((g) => g !== id);
  if (turn.stage !== 'clues') {
    // Clues already given stay in play; the leaver just can't judge any more.
    return withTurn(state, { givers });
  }
  const clues = { ...turn.clues };
  delete clues[id];
  return maybeStartGuessing(withTurn(state, { givers, clues }), now);
}

function playerLeft(state: EchoState, playerId: PlayerId, now: number): EchoState {
  if (!state.seats[playerId]) return state;
  const seats = { ...state.seats };
  delete seats[playerId];
  return withdraw({ ...state, seats }, playerId, now);
}

// ---- Timers ----

function nextDeadline(state: EchoState): number | null {
  const turn = state.turn;
  if (state.phase !== 'playing' || state.settings.timerMode !== 'strict' || !turn) return null;
  return turn.stage === 'reveal' ? null : turn.deadline;
}

function onDeadline(state: EchoState, now: number): EchoState {
  const due = nextDeadline(state);
  const turn = state.turn;
  if (due === null || now < due || !turn) return state;
  switch (turn.stage) {
    case 'pick': {
      // Picks for the guesser, from the hidden seed so nobody can predict it.
      const rng = createRng(state.seed);
      const index = rng.int(turn.card.length);
      return withTurn(beginClues({ ...state, seed: rng.int(SEED_RANGE) }, index, now), {
        autoPicked: true,
      });
    }
    case 'clues':
      return maybeStartGuessing(state, now, true);
    case 'guess':
      return reveal(state, 'pass', null, true);
    case 'judge':
      return reveal(state, 'wrong', null, true);
    case 'reveal':
      return state;
  }
}

// ---- What each viewer may see ----

function roleOf(state: EchoState, viewer: PlayerId | null): Role {
  const turn = state.turn;
  if (viewer === null || !state.seats[viewer]?.playing) return 'spectator';
  if (!turn) return 'giver';
  if (turn.guesser === viewer) return 'guesser';
  if (turn.stage === 'pick') return 'giver';
  return turn.givers.includes(viewer) || turn.clues[viewer] ? 'giver' : 'waiting';
}

function turnView(state: EchoState, turn: Turn, viewer: PlayerId | null): TurnView {
  const revealed = turn.stage === 'reveal';
  const isGuesser = viewer === turn.guesser && !revealed;
  const cluesOut = turn.stage !== 'pick' && turn.stage !== 'clues';
  const all: ClueView[] = Object.entries(turn.clues).flatMap(([by, list]) =>
    list.map((text, i) => ({
      by,
      name: state.seats[by]?.name ?? null,
      text,
      cancelled: !!turn.cancelled[clueId(by, i)],
      sameAs: [] as PlayerId[],
    })),
  );
  for (const clue of all) {
    if (!clue.cancelled) continue;
    clue.sameAs = [
      ...new Set(
        all
          .filter((c) => c !== clue && c.by !== clue.by && sameClue(c.text, clue.text))
          .map((c) => c.by!),
      ),
    ];
  }
  let clues: ClueView[] = [];
  if (cluesOut) {
    clues = isGuesser
      ? all
          .filter((c) => !c.cancelled)
          .map((c) => ({ by: null, name: null, text: c.text, cancelled: false, sameAs: [] }))
          .sort((a, b) => a.text.localeCompare(b.text, 'en'))
      : all;
  }
  const word = turn.pick === null || isGuesser ? null : turn.card[turn.pick]!;
  return {
    guesser: turn.guesser,
    stage: turn.stage,
    cardSize: turn.card.length,
    pick: turn.pick,
    word,
    wordCount: turn.pick === null ? null : turn.card[turn.pick]!.trim().split(/\s+/).length,
    givers: turn.givers,
    perGiver: turn.perGiver,
    submitted: Object.keys(turn.clues),
    myClues: viewer === null ? null : (turn.clues[viewer] ?? null),
    clues,
    cancelledCount: cluesOut ? Object.keys(turn.cancelled).length : 0,
    guess: turn.guess,
    outcome: turn.outcome,
    countedBy: turn.countedBy,
    deadline: turn.deadline,
    autoPicked: !!turn.autoPicked,
    missed: turn.missed ?? [],
    skipped: !!turn.skipped,
    timedOut: !!turn.timedOut,
  };
}

function view(state: EchoState, viewer: PlayerId | null): EchoView {
  const mySeat = viewer === null ? undefined : state.seats[viewer];
  return {
    phase: state.phase,
    settings: state.settings,
    seats: Object.entries(state.seats).map(([id, s]) => ({ id, ...s })),
    me: mySeat && viewer !== null ? { id: viewer, ...mySeat } : null,
    role: roleOf(state, viewer),
    turn: state.phase === 'playing' && state.turn ? turnView(state, state.turn, viewer) : null,
    score: state.score,
    cardsLeft: state.cardsLeft,
    history: state.history,
    endReason: state.endReason,
  };
}

export const echo: GameDefinition<EchoState, EchoAction, EchoView> = {
  id: 'echo',
  name: 'Echo',
  description: 'Everyone writes a one-word clue for the guesser, but matching clues cancel out.',
  minPlayers: MIN_PLAYERS,
  /** Room capacity: up to `MAX_PLAYERS` play, the rest watch. */
  maxPlayers: ROOM_CAPACITY,
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
  awards: echoAwards,
};
