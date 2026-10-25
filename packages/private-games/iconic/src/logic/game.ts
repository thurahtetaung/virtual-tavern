import {
  type ActionCtx,
  type CreateCtx,
  type GameDefinition,
  GameError,
  type PlayerId,
  type PlayerInfo,
  type Rng,
  createRng,
  wordKey,
} from '@vt/game-sdk';
import { iconicAwards } from './awards.ts';
import { guide } from './guide.ts';
import { insights } from './insights.ts';
import {
  type Board,
  CHOOSE_MS,
  CUBE_CAP,
  type ClueSet,
  type Game,
  type GameView,
  type How,
  type IconicAction,
  type IconicState,
  type IconicView,
  LEVELS,
  LEVEL_BONUS,
  type Level,
  MAX_GUESSES,
  MAX_GUESS_LENGTH,
  MAX_HISTORY,
  MAX_PLAYERS,
  MIN_PLAYERS,
  REVEAL_MS,
  type Round,
  type RoundView,
  SETS,
  type SeatView,
  type SetId,
  type Settings,
  UNDO_MS,
  WORDS_PER_LEVEL,
  WORDS_TO_END,
  actionSchema,
} from './types.ts';
import { drawCard, keptLists, newDeck, offeredLists, wordsFrom } from './words.ts';

type Ctx = ActionCtx;
type Result = IconicState | GameError;

const err = (code: string, message: string) => new GameError(code, message);
/** State is plain JSON, and a JSON round trip copies it several times faster than structuredClone. */
const copy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const draft = (s: IconicState): IconicState => copy(s);
const hiddenRng = (state: IconicState, now: number) => createRng((state.seed ^ now) >>> 0);
const newSeed = (rng: Rng) => rng.int(2 ** 32);

// ---- Reading the table ----

export function players(state: IconicState): PlayerId[] {
  return Object.entries(state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));
}

export const emptyBoard = (): Board =>
  Object.fromEntries(SETS.map((id) => [id, { marker: null, cubes: [] }])) as unknown as Board;

/** Cubes on the board for one set (stacks counted). */
export const cubesOf = (set: ClueSet) => set.cubes.reduce((n, c) => n + c.n, 0);

/** Every piece on the board: markers and cubes. */
export const piecesOf = (board: Board) =>
  SETS.reduce((n, id) => n + cubesOf(board[id]) + (board[id].marker !== null ? 1 : 0), 0);

/** How many clue givers a round has with these settings and this many players. */
export function giverCount(settings: Settings, seated: number): number {
  const want = settings.givers === 'auto' ? (seated >= 5 ? 2 : 1) : settings.givers;
  // Someone must be left to guess.
  return Math.max(1, Math.min(want, seated - 1));
}

/** Everyone guessing this round: not a clue giver or the helper. */
export const guessers = (g: Game) =>
  g.order.filter((id) => !g.round.givers.includes(id) && g.round.helper !== id);

/** The clue team: the givers and, once invited, the helper. */
export const team = (r: Round) => (r.helper ? [...r.givers, r.helper] : [...r.givers]);

/** Who the table is waiting on right now. */
export function awaited(g: Game): PlayerId[] {
  const r = g.round;
  if (r.stage !== 'choose') return [];
  if (r.proposal) return r.givers.filter((id) => id !== r.proposal!.by);
  return r.picker ? [r.picker] : [...r.givers];
}

/** Whether the clue givers may invite a helper now: once the round clock has run out. */
export function helperOpen(state: IconicState): boolean {
  const r = state.game?.round;
  if (!r || r.stage !== 'clue' || r.helper || state.phase !== 'playing') return false;
  return state.settings.roundMinutes === null || r.reminded;
}

const looksRight = (r: Round) =>
  r.answer
    ? r.guesses.filter((x) => wordKey(x.text) === wordKey(r.answer!.word)).map((x) => x.id)
    : [];

// ---- Rounds ----

/** The seat after `from` (wrapping), among `order`; `from` itself if alone. */
function after(order: readonly PlayerId[], from: PlayerId): PlayerId {
  const at = order.indexOf(from);
  return order[(at + 1) % order.length] ?? from;
}

function beginRound(s: IconicState, first: PlayerId, now: number, rng: Rng) {
  const g = s.game!;
  seatWaiting(s, g);
  if (!g.order.includes(first)) first = g.order[0]!;
  const n = giverCount(s.settings, g.order.length);
  const givers = [first];
  while (givers.length < n) givers.push(after(g.order, givers.at(-1)!));
  g.round = {
    no: g.round.no + 1,
    givers,
    stage: 'choose',
    since: now,
    card: drawCard(g.deck, g.spent, rng),
    rerolled: false,
    proposal: null,
    vetoes: 0,
    picker: null,
    answer: null,
    board: emptyBoard(),
    guesses: [],
    gaveUp: [],
    helper: null,
    award: null,
    reminded: false,
    clueAt: null,
    result: null,
  };
}

function choose(r: Round, index: number, now: number) {
  r.answer = r.card[index]!;
  r.proposal = null;
  r.stage = 'clue';
  r.since = now;
  r.clueAt = now;
  r.reminded = false;
}

function endRound(
  s: IconicState,
  how: How,
  now: number,
  guess: { by: PlayerId; text: string } | null,
) {
  const g = s.game!;
  const r = g.round;
  const answer = r.answer ?? r.card[0]!;
  const points: Record<PlayerId, number> = {};
  if (guess) {
    g.wordsGuessed += 1;
    g.guessed[guess.by] = (g.guessed[guess.by] ?? 0) + 1;
    for (const id of r.givers) g.given[id] = (g.given[id] ?? 0) + 1;
    if (s.settings.scoring) {
      const bonus = s.settings.bonus ? LEVEL_BONUS[answer.level] : 0;
      points[guess.by] = 2 + bonus;
      for (const id of team(r)) points[id] = 1 + bonus;
      for (const [id, n] of Object.entries(points)) g.scores[id] = (g.scores[id] ?? 0) + n;
    }
  }
  const ms = r.clueAt === null ? 0 : Math.max(0, now - r.clueAt);
  r.stage = 'reveal';
  r.award = null;
  r.proposal = null;
  r.since = now;
  r.result = {
    outcome: guess ? 'guessed' : 'abandoned',
    how,
    word: answer.word,
    level: answer.level,
    guesser: guess?.by ?? null,
    guess: guess?.text ?? null,
    points,
    ms,
    until: now + REVEAL_MS,
  };
  g.history.push({
    no: r.no,
    word: answer.word,
    level: answer.level,
    outcome: r.result.outcome,
    how,
    givers: [...r.givers],
    guesser: guess?.by ?? null,
    helper: r.helper,
    ms,
    pieces: piecesOf(r.board),
  });
  if (g.history.length > MAX_HISTORY) g.history.splice(0, g.history.length - MAX_HISTORY);
  g.next = after(g.order, r.givers.at(-1)!);
  if (gameDone(s)) endGame(s);
}

/** Whether the game's length is reached. */
function gameDone(s: IconicState): boolean {
  const g = s.game!;
  if (s.settings.length === 'twelve') return g.wordsGuessed >= WORDS_TO_END;
  if (s.settings.length === 'each') return g.order.every((id) => (g.given[id] ?? 0) > 0);
  return false;
}

function endGame(s: IconicState) {
  const g = s.game!;
  s.phase = 'over';
  const score = (id: PlayerId) => (s.settings.scoring ? (g.scores[id] ?? 0) : (g.guessed[id] ?? 0));
  const ids = Object.keys(g.names);
  const best = Math.max(0, ...ids.map(score));
  g.winners = best > 0 ? ids.filter((id) => score(id) === best) : [];
}

/** After someone stops guessing: when every guesser has given up (or none is left), the word goes. */
function checkGiveUp(s: IconicState, now: number) {
  const g = s.game!;
  const r = g.round;
  if (r.stage !== 'clue' || r.award) return;
  const left = guessers(g);
  if (left.length === 0) endRound(s, 'left', now, null);
  else if (left.every((id) => r.gaveUp.includes(id))) endRound(s, 'gave-up', now, null);
}

// ---- Choosing ----

function pick(s: IconicState, by: PlayerId, index: number, now: number): GameError | null {
  const r = s.game!.round;
  if (r.stage !== 'choose') return err('wrong-stage', 'The word is already chosen.');
  if (!r.givers.includes(by)) return err('not-giver', 'Only the clue givers choose the word.');
  if (r.proposal)
    return err('proposed', 'A word is proposed: your partner agrees or vetoes it first.');
  if (r.picker && r.picker !== by) return err('not-picker', 'It’s your partner’s pick now.');
  if (!r.card[index]) return err('bad-word', 'That word isn’t on the card.');
  if (r.givers.length === 1) choose(r, index, now);
  else r.proposal = { by, index };
  return null;
}

function agree(s: IconicState, by: PlayerId, now: number): GameError | null {
  const r = s.game!.round;
  if (r.stage !== 'choose' || !r.proposal) return err('no-proposal', 'Nothing to agree to.');
  if (!r.givers.includes(by) || r.proposal.by === by)
    return err('not-partner', 'Your partner decides on your proposal.');
  choose(r, r.proposal.index, now);
  return null;
}

/** A veto passes the pick to the partner; a second veto keeps the last pick. */
function veto(s: IconicState, by: PlayerId, now: number): GameError | null {
  const r = s.game!.round;
  if (r.stage !== 'choose' || !r.proposal) return err('no-proposal', 'Nothing to veto.');
  if (!r.givers.includes(by) || r.proposal.by === by)
    return err('not-partner', 'Your partner decides on your proposal.');
  if (r.vetoes >= 1) {
    choose(r, r.proposal.index, now);
    return null;
  }
  r.vetoes += 1;
  r.proposal = null;
  r.picker = by;
  return null;
}

function reroll(s: IconicState, by: PlayerId, rng: Rng): GameError | null {
  const g = s.game!;
  const r = g.round;
  if (r.stage !== 'choose') return err('wrong-stage', 'The word is already chosen.');
  if (!r.givers.includes(by)) return err('not-giver', 'Only the clue givers choose the word.');
  if (r.rerolled) return err('rerolled', 'You have had your new card this turn.');
  if (r.proposal) return err('proposed', 'A word is proposed: agree or veto it first.');
  r.card = drawCard(g.deck, g.spent, rng);
  r.rerolled = true;
  return null;
}

// ---- Placing pieces ----

function clueTeam(s: IconicState, by: PlayerId): GameError | null {
  const r = s.game!.round;
  if (r.stage !== 'clue') return err('wrong-stage', 'No clues now.');
  if (!team(r).includes(by)) return err('not-giver', 'Only the clue givers place pieces.');
  return null;
}

/**
 * A tap on an icon: the set's marker if it is off the board, else a cube (on a cube of the same
 * set already there, a stacked one). Sub-sets wait for the main marker.
 */
function place(s: IconicState, by: PlayerId, set: SetId, icon: number): GameError | null {
  const e = clueTeam(s, by);
  if (e) return e;
  const board = s.game!.round.board;
  const c = board[set];
  if (set !== 'main' && board.main.marker === null)
    return err('main-first', 'Place the main ? marker first.');
  if (c.marker === null) {
    c.marker = icon;
    return null;
  }
  if (cubesOf(c) >= CUBE_CAP[set])
    return err('no-cubes', `All ${CUBE_CAP[set]} cubes of this set are on the board.`);
  const stack = c.cubes.find((x) => x.icon === icon);
  if (stack) stack.n += 1;
  else c.cubes.push({ icon, n: 1 });
  return null;
}

/** Takes one piece of the set off an icon: a cube first, then the marker. */
function remove(s: IconicState, by: PlayerId, set: SetId, icon: number): GameError | null {
  const e = clueTeam(s, by);
  if (e) return e;
  const c = s.game!.round.board[set];
  const at = c.cubes.findIndex((x) => x.icon === icon);
  if (at >= 0) {
    c.cubes[at]!.n -= 1;
    if (c.cubes[at]!.n <= 0) c.cubes.splice(at, 1);
    return null;
  }
  if (c.marker === icon) {
    c.marker = null;
    return null;
  }
  return err('nothing-there', 'None of that set’s pieces is on that icon.');
}

function wipe(s: IconicState, by: PlayerId): GameError | null {
  const e = clueTeam(s, by);
  if (e) return e;
  s.game!.round.board = emptyBoard();
  return null;
}

// ---- Guessing and judging ----

function guess(s: IconicState, by: PlayerId, raw: string, now: number): GameError | null {
  const g = s.game!;
  const r = g.round;
  if (r.stage !== 'clue') return err('wrong-stage', 'No guessing now.');
  if (!guessers(g).includes(by))
    return err('not-guesser', 'The clue team knows the word: no guessing.');
  const text = raw.trim().replace(/\s+/g, ' ');
  if (!text || !wordKey(text)) return err('empty', 'Type a guess first.');
  if (text.length > MAX_GUESS_LENGTH)
    return err('too-long', `Keep a guess under ${MAX_GUESS_LENGTH} characters.`);
  const key = wordKey(text);
  if (r.guesses.some((x) => x.by === by && wordKey(x.text) === key))
    return err('repeat', 'You already guessed that.');
  if (r.guesses.length >= MAX_GUESSES)
    return err('too-many', 'That’s a lot of guesses: time to pass or give up?');
  s.seq += 1;
  r.guesses.push({ id: s.seq, by, text, at: now, mark: null });
  return null;
}

function judge(s: IconicState, by: PlayerId): GameError | null {
  const r = s.game!.round;
  if (r.stage !== 'clue') return err('wrong-stage', 'Nothing to judge now.');
  if (!r.givers.includes(by)) return err('not-giver', 'Only the clue givers judge guesses.');
  return null;
}

function mark(
  s: IconicState,
  by: PlayerId,
  id: number,
  value: 'wrong' | 'close' | null,
): GameError | null {
  const e = judge(s, by);
  if (e) return e;
  const x = s.game!.round.guesses.find((q) => q.id === id);
  if (!x) return err('no-guess', 'That guess is gone.');
  x.mark = value;
  return null;
}

function award(s: IconicState, by: PlayerId, id: number, now: number): GameError | null {
  const e = judge(s, by);
  if (e) return e;
  const g = s.game!;
  const r = g.round;
  if (r.award) return err('awarded', 'A guess is already marked right.');
  const x = r.guesses.find((q) => q.id === id);
  if (!x) return err('no-guess', 'That guess is gone.');
  if (!guessers(g).includes(x.by)) return err('not-guesser', 'That player isn’t guessing now.');
  r.award = { guess: id, by, until: now + UNDO_MS };
  return null;
}

function undo(s: IconicState, by: PlayerId, now: number): GameError | null {
  const e = judge(s, by);
  if (e) return e;
  const r = s.game!.round;
  if (!r.award) return err('no-award', 'Nothing to take back.');
  r.award = null;
  checkGiveUp(s, now);
  return null;
}

function finishAward(s: IconicState, now: number) {
  const r = s.game!.round;
  const x = r.guesses.find((q) => q.id === r.award?.guess);
  if (!x) {
    r.award = null;
    return;
  }
  endRound(s, 'right', now, { by: x.by, text: x.text });
}

function giveUp(s: IconicState, by: PlayerId, on: boolean, now: number): GameError | null {
  const g = s.game!;
  const r = g.round;
  if (r.stage !== 'clue') return err('wrong-stage', 'Nothing to give up on now.');
  if (!guessers(g).includes(by)) return err('not-guesser', 'Only guessers give up.');
  r.gaveUp = r.gaveUp.filter((id) => id !== by);
  if (on) r.gaveUp.push(by);
  checkGiveUp(s, now);
  return null;
}

function pass(s: IconicState, by: PlayerId, now: number): GameError | null {
  const r = s.game!.round;
  if (r.stage !== 'clue') return err('wrong-stage', 'Nothing to pass now.');
  if (!r.givers.includes(by)) return err('not-giver', 'Only the clue givers can pass.');
  if (r.award) return err('awarded', 'A guess is marked right: undo it first.');
  endRound(s, 'pass', now, null);
  return null;
}

function invite(s: IconicState, by: PlayerId, player: PlayerId): GameError | null {
  const g = s.game!;
  const r = g.round;
  if (r.stage !== 'clue' || !r.givers.includes(by))
    return err('not-giver', 'Only the clue givers invite a helper.');
  if (r.helper) return err('has-helper', 'You already have a helper.');
  if (!helperOpen(s)) return err('too-soon', 'A helper can join once the round clock runs out.');
  if (!guessers(g).includes(player)) return err('bad-player', 'Pick someone who is guessing.');
  if (r.award?.guess && r.guesses.find((q) => q.id === r.award!.guess)?.by === player)
    return err('awarded', 'Their guess is marked right.');
  r.helper = player;
  r.gaveUp = r.gaveUp.filter((id) => id !== player);
  return null;
}

/** The host chooses for absent clue givers: their proposal, else a word at random. */
function actFor(s: IconicState, now: number, rng: Rng): GameError | null {
  const r = s.game!.round;
  if (r.stage !== 'choose') return err('wrong-stage', 'Only the word choice can be made for them.');
  choose(r, r.proposal?.index ?? rng.int(r.card.length), now);
  r.auto = true;
  return null;
}

// ---- Lobby ----

function requireHost(ctx: Ctx) {
  return ctx.isHost ? null : err('not-host', 'Only the host can do that.');
}

/** Keeps the offered word lists fresh between games, and the choice to lists still offered. */
function refreshLists(state: IconicState, ctx: Ctx): IconicState {
  if (state.phase === 'playing') return state;
  const wordLists = offeredLists(ctx.content);
  const lists = keptLists(state.settings.lists, wordLists);
  return { ...state, wordLists, settings: { ...state.settings, lists } };
}

/** Why the host can't start yet, or null. */
export function startProblem(state: IconicState, counts: Record<Level, number>): string | null {
  const n = players(state).length;
  if (n < MIN_PLAYERS) return `${MIN_PLAYERS} players are needed.`;
  if (n > MAX_PLAYERS) return `At most ${MAX_PLAYERS} can play.`;
  for (const level of LEVELS)
    if (counts[level] < WORDS_PER_LEVEL)
      return `The ${level} word lists need at least ${WORDS_PER_LEVEL} words.`;
  return null;
}

function seatWaiting(s: IconicState, g: Game | null) {
  let free = MAX_PLAYERS - (g ? g.order.length : players(s).length);
  for (const [id, seat] of Object.entries(s.seats)) {
    if (free <= 0) break;
    if (!seat.waiting) continue;
    delete seat.waiting;
    seat.playing = true;
    free -= 1;
    if (g && !g.order.includes(id)) {
      g.order.push(id);
      g.names[id] = seat.name;
    }
  }
}

function deal(state: IconicState, ctx: Ctx): Result {
  const s = draft(refreshLists(state, ctx));
  seatWaiting(s, null);
  const words = {} as Record<Level, string[]>;
  const seen = new Set<string>();
  for (const level of LEVELS) {
    // A word in two levels' lists counts for the easier one only.
    words[level] = wordsFrom(ctx.content, s.settings.lists[level]).filter((w) => {
      const key = wordKey(w);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
  const counts = Object.fromEntries(LEVELS.map((l) => [l, words[l].length])) as Record<
    Level,
    number
  >;
  const problem = startProblem(s, counts);
  if (problem) return err('cannot-start', problem);
  const order = players(s);
  const zero = () => Object.fromEntries(order.map((id) => [id, 0]));
  s.phase = 'playing';
  s.gamesPlayed += 1;
  const first = order[ctx.rng.int(order.length)]!;
  s.game = {
    order,
    names: Object.fromEntries(order.map((id) => [id, s.seats[id]!.name])),
    scores: zero(),
    guessed: zero(),
    given: zero(),
    wordsGuessed: 0,
    next: first,
    deck: Object.fromEntries(LEVELS.map((l) => [l, newDeck(words[l], ctx.rng)])) as Record<
      Level,
      string[]
    >,
    spent: { easy: [], hard: [], challenging: [] },
    round: {
      no: 0,
      givers: [],
      stage: 'choose',
      since: ctx.now,
      card: [],
      rerolled: false,
      proposal: null,
      vetoes: 0,
      picker: null,
      answer: null,
      board: emptyBoard(),
      guesses: [],
      gaveUp: [],
      helper: null,
      award: null,
      reminded: false,
      clueAt: null,
      result: null,
    },
    history: [],
    winners: [],
  };
  beginRound(s, first, ctx.now, ctx.rng);
  s.seed = newSeed(ctx.rng);
  return s;
}

function updateSettings(
  state: IconicState,
  action: Extract<IconicAction, { type: 'update-settings' }>,
  ctx: Ctx,
): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'playing') return err('in-progress', 'Settings change between games.');
  const s = draft(state);
  const set = s.settings;
  if (action.givers !== undefined) set.givers = action.givers;
  if (action.length !== undefined) set.length = action.length;
  if (action.scoring !== undefined) set.scoring = action.scoring;
  if (action.bonus !== undefined) set.bonus = action.bonus;
  if (action.roundMinutes !== undefined) set.roundMinutes = action.roundMinutes;
  if (action.timerMode !== undefined) set.timerMode = action.timerMode;
  if (action.lists) {
    const offered = new Set(s.wordLists.map((l) => l.id));
    if (action.lists.ids.some((id) => !offered.has(id)))
      return err('unknown-list', 'That word list is not available.');
    set.lists[action.lists.level] = [...action.lists.ids];
  }
  return s;
}

function sit(state: IconicState, playing: boolean, ctx: Ctx): Result {
  const seat = state.seats[ctx.by];
  if (!seat) return err('not-seated', 'You are not in this room.');
  if (state.phase === 'playing' && state.game?.order.includes(ctx.by))
    return err('in-progress', 'You can stand up between games.');
  if (seat.playing === playing && !seat.waiting) return state;
  const s = draft(state);
  const mine = s.seats[ctx.by]!;
  delete mine.waiting;
  if (s.phase === 'playing' && playing) {
    // Mid-game a newcomer joins at the next round, if there is room.
    if (s.game!.order.length >= MAX_PLAYERS) return err('full', `Only ${MAX_PLAYERS} can play.`);
    mine.waiting = true;
    return s;
  }
  if (playing && players(s).length >= MAX_PLAYERS)
    return err('full', `Only ${MAX_PLAYERS} can play.`);
  mine.playing = playing;
  return s;
}

function backToLobby(state: IconicState, ctx: Ctx): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'lobby') return err('wrong-phase', 'No game to leave.');
  const s = draft(state);
  s.phase = 'lobby';
  s.game = null;
  seatWaiting(s, null);
  return refreshLists(s, ctx);
}

// ---- Actions ----

function inPlay(state: IconicState, fn: (s: IconicState) => GameError | null): Result {
  if (state.phase !== 'playing' || !state.game) return err('not-playing', 'No game in play.');
  const s = draft(state);
  const e = fn(s);
  return e ?? s;
}

function reduce(state: IconicState, action: IconicAction, ctx: Ctx): Result {
  const by = ctx.by;
  const now = ctx.now;
  switch (action.type) {
    case 'update-settings':
      return updateSettings(refreshLists(state, ctx), action, ctx);
    case 'sit':
      return sit(refreshLists(state, ctx), action.playing, ctx);
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
    case 'end-game': {
      const e = requireHost(ctx);
      if (e) return e;
      if (state.settings.length !== 'endless')
        return err('not-endless', 'This game ends by itself.');
      return inPlay(state, (s) => {
        if (s.game!.round.stage === 'clue' && s.game!.round.award) finishAward(s, now);
        if (s.phase === 'playing') endGame(s);
        return null;
      });
    }
    case 'pick':
      return inPlay(state, (s) => pick(s, by, action.index, now));
    case 'agree':
      return inPlay(state, (s) => agree(s, by, now));
    case 'veto':
      return inPlay(state, (s) => veto(s, by, now));
    case 'reroll':
      return inPlay(state, (s) => reroll(s, by, ctx.rng));
    case 'place':
      return inPlay(state, (s) => place(s, by, action.set, action.icon));
    case 'remove':
      return inPlay(state, (s) => remove(s, by, action.set, action.icon));
    case 'wipe':
      return inPlay(state, (s) => wipe(s, by));
    case 'guess':
      return inPlay(state, (s) => guess(s, by, action.text, now));
    case 'mark':
      return inPlay(state, (s) => mark(s, by, action.guess, action.mark));
    case 'award':
      return inPlay(state, (s) => award(s, by, action.guess, now));
    case 'undo':
      return inPlay(state, (s) => undo(s, by, now));
    case 'give-up':
      return inPlay(state, (s) => giveUp(s, by, action.on, now));
    case 'pass':
      return inPlay(state, (s) => pass(s, by, now));
    case 'invite':
      return inPlay(state, (s) => invite(s, by, action.player));
    case 'act-for': {
      const e = requireHost(ctx);
      if (e) return e;
      return inPlay(state, (s) => actFor(s, now, ctx.rng));
    }
  }
}

// ---- Players coming and going ----

function create(ctx: CreateCtx, playersIn: readonly PlayerInfo[]): IconicState {
  const wordLists = offeredLists(ctx.content);
  let state: IconicState = {
    phase: 'lobby',
    settings: {
      givers: 'auto',
      length: 'twelve',
      scoring: true,
      bonus: false,
      roundMinutes: 5,
      timerMode: 'soft',
      lists: keptLists(undefined, wordLists),
    },
    wordLists,
    seed: newSeed(ctx.rng),
    seats: {},
    game: null,
    seq: 0,
    gamesPlayed: 0,
  };
  for (const p of playersIn) state = playerJoined(state, p);
  return state;
}

function playerJoined(state: IconicState, player: PlayerInfo): IconicState {
  const s = draft(state);
  const existing = s.seats[player.id];
  if (existing) {
    existing.name = player.name;
    if (s.game?.names[player.id]) s.game.names[player.id] = player.name;
    return s;
  }
  const count = s.phase === 'playing' ? s.game!.order.length : players(s).length;
  const room = count < MAX_PLAYERS;
  // Mid-game a newcomer sits down at the next round.
  s.seats[player.id] =
    s.phase === 'playing'
      ? { name: player.name, playing: false, ...(room && { waiting: true }) }
      : { name: player.name, playing: room };
  return s;
}

/**
 * Someone left the room for good. A clue giver leaving abandons the word; a helper just leaves
 * the team; a guesser leaving may leave only players who gave up. With one player left the game
 * ends.
 */
function playerLeft(state: IconicState, playerId: PlayerId, now: number): IconicState {
  if (!state.seats[playerId]) return state;
  const s = draft(state);
  delete s.seats[playerId];
  const g = s.game;
  if (s.phase !== 'playing' || !g || !g.order.includes(playerId)) {
    if (s.phase !== 'playing') seatWaiting(s, null);
    return s;
  }
  const r = g.round;
  const wasGiver = r.givers.includes(playerId);
  // Their place in the rotation passes on before they go.
  if (g.next === playerId) g.next = after(g.order, playerId);
  if (r.helper === playerId) r.helper = null;
  r.gaveUp = r.gaveUp.filter((id) => id !== playerId);
  if (r.award && r.guesses.find((q) => q.id === r.award!.guess)?.by === playerId) r.award = null;
  // No word chosen yet: the next clue givers take a new card at once.
  const restart = wasGiver && r.stage === 'choose';
  if (restart) g.next = after(g.order, r.givers.at(-1)!);
  else if (wasGiver && r.stage === 'clue') endRound(s, 'left', now, null);
  g.order = g.order.filter((id) => id !== playerId);
  if (g.next === playerId) g.next = g.order[0] ?? playerId;
  if (s.phase !== 'playing') return s;
  if (g.order.length < 2) endGame(s);
  else if (restart) {
    const rng = hiddenRng(state, now);
    beginRound(s, g.next, now, rng);
    s.seed = newSeed(rng);
  } else checkGiveUp(s, now);
  return s;
}

// ---- Timers ----

type Due = { at: number; why: 'remind' | 'timer' | 'award' | 'reveal' };

function deadlines(state: IconicState): Due[] {
  const g = state.game;
  if (state.phase !== 'playing' || !g) return [];
  const r = g.round;
  const out: Due[] = [];
  if (r.stage === 'choose' && !r.reminded) out.push({ at: r.since + CHOOSE_MS, why: 'remind' });
  if (r.stage === 'clue') {
    if (r.award) out.push({ at: r.award.until, why: 'award' });
    const mins = state.settings.roundMinutes;
    if (mins !== null && r.clueAt !== null) {
      const at = r.clueAt + mins * 60_000;
      if (state.settings.timerMode === 'strict' && !r.award) out.push({ at, why: 'timer' });
      else if (state.settings.timerMode === 'soft' && !r.reminded) out.push({ at, why: 'remind' });
    }
  }
  if (r.stage === 'reveal' && r.result) out.push({ at: r.result.until, why: 'reveal' });
  return out.sort((a, b) => a.at - b.at);
}

function nextDeadline(state: IconicState): number | null {
  return deadlines(state)[0]?.at ?? null;
}

function onDeadline(state: IconicState, now: number): IconicState {
  const due = deadlines(state)[0];
  if (!due || now < due.at) return state;
  const s = draft(state);
  const g = s.game!;
  const rng = hiddenRng(state, now);
  if (due.why === 'remind') g.round.reminded = true;
  else if (due.why === 'award') finishAward(s, now);
  else if (due.why === 'timer') endRound(s, 'timer', now, null);
  else beginRound(s, g.next, now, rng);
  s.seed = newSeed(rng);
  return s;
}

// ---- Views ----

function roundView(state: IconicState, g: Game, viewer: PlayerId | null): RoundView {
  const r = g.round;
  const inTeam = viewer !== null && team(r).includes(viewer);
  const isGiver = viewer !== null && r.givers.includes(viewer);
  const open = r.stage === 'reveal' || state.phase === 'over';
  const mins = state.settings.roundMinutes;
  return {
    no: r.no,
    givers: [...r.givers],
    stage: r.stage,
    since: r.since,
    chooseBy: r.stage === 'choose' ? r.since + CHOOSE_MS : null,
    clueBy:
      r.stage === 'clue' && mins !== null && r.clueAt !== null ? r.clueAt + mins * 60_000 : null,
    reminded: r.reminded,
    board: copy(r.board),
    guesses: r.guesses.map((x) => ({ ...x })),
    gaveUp: [...r.gaveUp],
    helper: r.helper,
    helperOpen: helperOpen(state),
    result: r.result ? copy(r.result) : null,
    auto: !!r.auto,
    card: open || (isGiver && r.stage === 'choose') ? r.card.map((w) => ({ ...w })) : null,
    secret:
      inTeam && !open
        ? {
            answer: r.answer ? { ...r.answer } : null,
            rerolled: isGiver ? r.rerolled : false,
            proposal: isGiver && r.proposal ? { ...r.proposal } : null,
            vetoes: isGiver ? r.vetoes : 0,
            picker: isGiver ? r.picker : null,
            looksRight: isGiver ? looksRight(r) : [],
            award: r.award ? { ...r.award } : null,
          }
        : null,
  };
}

function gameView(state: IconicState, g: Game, viewer: PlayerId | null): GameView {
  const ids = [...g.order, ...Object.keys(g.names).filter((id) => !g.order.includes(id))];
  return {
    order: [...g.order],
    players: ids.map((id) => ({
      id,
      name: state.seats[id]?.name ?? g.names[id] ?? 'Gone',
      score: g.scores[id] ?? 0,
      guessed: g.guessed[id] ?? 0,
      given: g.given[id] ?? 0,
    })),
    wordsGuessed: g.wordsGuessed,
    round: roundView(state, g, viewer),
    history: g.history.map((h) => ({ ...h, givers: [...h.givers] })),
    winners: [...g.winners],
  };
}

function view(state: IconicState, viewer: PlayerId | null): IconicView {
  const seats: SeatView[] = Object.entries(state.seats).map(([id, s]) => ({
    id,
    name: s.name,
    playing: s.playing,
    ...(s.waiting && { waiting: true }),
  }));
  return {
    phase: state.phase,
    settings: copy(state.settings),
    wordLists: state.wordLists.map((l) => ({ ...l })),
    seats,
    me: seats.find((s) => s.id === viewer) ?? null,
    game: state.game ? gameView(state, state.game, viewer) : null,
  };
}

export const iconic: GameDefinition<IconicState, IconicAction, IconicView> = {
  id: 'iconic',
  name: 'Iconic',
  description: 'Put markers and cubes on a board of icons until the table guesses your word.',
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
  awards: iconicAwards,
};
