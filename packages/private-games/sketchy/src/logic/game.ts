import {
  type ActionCtx,
  type ContentProvider,
  type CreateCtx,
  type Drawing,
  GameError,
  type PlayerId,
  type PlayerInfo,
  type Rng,
  createRng,
  validateDrawing,
  wordKey,
} from '@vt/game-sdk';
import {
  PLAYER_SLOT,
  type PackSummary,
  type Prompt,
  decoysFrom,
  lower,
  promptPacks,
  promptsFrom,
} from './content.ts';
import {
  ARTIST_POINTS,
  DEFAULT_SOUND,
  DEFAULT_DRAW_SECONDS,
  DEFAULT_VOTE_SECONDS,
  DEFAULT_WRITE_SECONDS,
  FOOL_POINTS,
  type Game,
  MAX_LIE_LENGTH,
  MAX_PLAYERS,
  MAX_USED_PROMPTS,
  MIN_OPTIONS,
  MIN_PLAYERS,
  type Option,
  POINT_STEP,
  REVEAL_STEP_MS,
  type Score,
  type Seat,
  type SketchyAction,
  type SketchyState,
  STREAK_POINTS,
  TRUTH_POINTS,
  type Turn,
  roundsFor,
} from './types.ts';

type Ctx = ActionCtx;
type Result = SketchyState | GameError;

const SEED_RANGE = 0x1_0000_0000;
/** House titles each drawing gets to pad its board, at most. */
const DECOYS_PER_TURN = 24;

const err = (code: string, message: string) => new GameError(code, message);

export function playingIds(state: SketchyState): PlayerId[] {
  return Object.entries(state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));
}

const deadline = (seconds: number | null, now: number) =>
  seconds === null ? null : now + seconds * 1000;

// ---- Test rig (browser tests only) ----

let rigAllowed = false;
/**
 * Test servers only: every game deals the prompts in the packs' own order (no shuffle) and the
 * drawings come up in seat order, so a browser test knows what each player draws.
 */
export function enableTestRig(on = true): void {
  rigAllowed = on;
}

// ---- Lies ----

/** A lie as stored and shown: one line, lowercase, like every title on the board. */
export const tidyLie = (text: string) => lower(text);

/**
 * `wordKey` with hyphens and other punctuation read as spaces, so "robo-cop" meets "robo cop" and
 * "robocop's" meets "robocops".
 */
export const looseKey = (text: string) =>
  wordKey(text.replace(/['‘’ʼ`´]/g, '').replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' '));

/** The same title as far as Sketchy is concerned: equal under `wordKey` or `looseKey`. */
export const sameTitle = (a: string, b: string) =>
  wordKey(a) === wordKey(b) || looseKey(a) === looseKey(b);

/** Why a lie can't be used, or null if it's fine. The real title is only known to the server. */
export function lieProblem(text: string, truth?: Pick<Prompt, 'text' | 'alternates'>) {
  if (/[\r\n]/.test(text.trim())) return err('lie-lines', 'Keep your title to one line.');
  const lie = tidyLie(text);
  if (!lie) return err('empty-lie', 'Write a title first.');
  if (lie.length > MAX_LIE_LENGTH) {
    return err('lie-too-long', `Keep your title to ${MAX_LIE_LENGTH} characters.`);
  }
  if (truth && [truth.text, ...truth.alternates].some((t) => sameTitle(t, lie))) {
    return err('is-the-truth', 'Too close to the real title! Write a different one.');
  }
  return null;
}

/** One author's share of a lie's points, rounded down to a multiple of `POINT_STEP`. */
export function liePoints(fooled: number, authors: number): number {
  if (authors <= 0) return 0;
  const share = (FOOL_POINTS * fooled) / authors;
  return Math.floor(share / POINT_STEP) * POINT_STEP;
}

/** The streak bonus for finding the truth on the `streak`-th drawing in a row. */
export const streakBonus = (streak: number) => STREAK_POINTS * Math.max(0, streak - 1);

// ---- Helpers ----

/** The packs a new room starts with: all but friend mode, which the host switches on. */
const defaultPacks = (packs: readonly PackSummary[]) =>
  packs.filter((p) => !p.friends).map((p) => p.id);

function withGame(state: SketchyState, patch: Partial<Game>): SketchyState {
  return { ...state, game: { ...state.game!, ...patch } };
}

function withTurn(state: SketchyState, patch: Partial<Turn>): SketchyState {
  const g = state.game!;
  return withGame(state, { turn: { ...g.turn!, ...patch } });
}

function endGame(state: SketchyState, endReason: 'finished' | 'too-few'): SketchyState {
  return {
    ...state,
    phase: 'over',
    game: state.game && { ...state.game, pool: [], decoys: [] },
    endReason,
  };
}

/** The real title a prompt shows as, with `{player}` filled by another player's name. */
function fillPrompt(prompt: Prompt, artist: PlayerId, state: SketchyState, rng: Rng): Prompt {
  if (!prompt.text.includes(PLAYER_SLOT)) return prompt;
  const others = playingIds(state).filter((id) => id !== artist);
  const other = others.length ? others[rng.int(others.length)]! : artist;
  const name = lower(state.seats[other]?.name ?? 'someone');
  const fill = (s: string) => s.split(PLAYER_SLOT).join(name);
  return { ...prompt, text: fill(prompt.text), alternates: prompt.alternates.map(fill) };
}

/** Starts a round: every seated player gets a prompt and draws. */
function beginRound(state: SketchyState, round: number, now: number): SketchyState {
  const g = state.game!;
  const players = playingIds(state);
  const rng = createRng(state.seed);
  const pool = [...g.pool];
  const sketches: Game['sketches'] = {};
  for (const id of players) {
    const prompt = pool.shift();
    if (prompt) sketches[id] = { prompt: fillPrompt(prompt, id, state, rng), drawing: null };
  }
  const scores = { ...state.scores };
  for (const id of players) {
    scores[id] = {
      ...(scores[id] ?? { score: 0, fooled: 0, truths: 0, likes: 0, hits: 0 }),
      name: state.seats[id]!.name,
    };
  }
  return {
    ...state,
    scores,
    seed: rng.int(SEED_RANGE),
    game: {
      ...g,
      round,
      stage: 'draw',
      players: players.filter((id) => sketches[id]),
      pool,
      sketches,
      order: [],
      at: 0,
      turn: null,
      deadline: deadline(state.settings.drawSeconds, now),
      since: now,
    },
  };
}

/** After the drawing: the drawings come up one by one in a hidden order. */
function beginTurns(state: SketchyState, now: number): SketchyState {
  const g = state.game!;
  const artists = g.players.filter((id) => g.sketches[id]?.drawing);
  const rng = createRng(state.seed);
  const order = rigAllowed ? artists : rng.shuffle(artists);
  const next = { ...state, seed: rng.int(SEED_RANGE) };
  if (order.length === 0) return afterRound(withGame(next, { order, at: 0, turn: null }), now);
  return beginTurn(withGame(next, { order, at: 0 }), now);
}

function beginTurn(state: SketchyState, now: number): SketchyState {
  const g = state.game!;
  const artist = g.order[g.at]!;
  const truth = g.sketches[artist]!.prompt;
  const writers = g.players.filter((id) => id !== artist && state.seats[id]?.playing);
  // This drawing's share of the house titles, none matching the real title.
  const share: string[] = [];
  for (let i = 0; i < g.decoys.length && share.length < DECOYS_PER_TURN; i++) {
    const d = g.decoys[(g.decoyAt + i) % g.decoys.length]!;
    if (lieProblem(d, truth) || share.some((s) => wordKey(s) === wordKey(d))) continue;
    share.push(d);
  }
  const turn: Turn = {
    artist,
    writers,
    lies: {},
    decoys: share,
    options: [],
    voters: [],
    votes: {},
    likes: {},
    voteTimedOut: false,
    points: {},
    streakBonus: {},
    revealedAt: null,
    revealSkipped: false,
  };
  const decoyAt = g.decoys.length ? (g.decoyAt + DECOYS_PER_TURN) % g.decoys.length : 0;
  const next = withGame(state, {
    stage: 'write',
    turn,
    decoyAt,
    deadline: deadline(state.settings.writeSeconds, now),
    since: now,
  });
  // Nobody left to write (everyone else left): straight on.
  return writers.length === 0 ? maybeStartVoting(next, now, true) : next;
}

/** After a round's last drawing: the next round, or the end. */
function afterRound(state: SketchyState, now: number): SketchyState {
  const g = state.game!;
  if (g.round >= g.rounds) return endGame(state, 'finished');
  return beginRound(state, g.round + 1, now);
}

// ---- House titles (they pad a small board and score for nobody) ----

/** Comparison keys a house title must not match: the truth, its alternates and every lie. */
function takenKeys(game: Game, lies: Record<PlayerId, string>): Set<string> {
  const truth = game.sketches[game.turn!.artist]!.prompt;
  return new Set([truth.text, ...truth.alternates, ...Object.values(lies)].map(wordKey));
}

/** Up to `count` of this drawing's house titles that match nothing taken, drawn with the hidden seed. */
function pickDecoys(
  state: SketchyState,
  count: number,
  taken: ReadonlySet<string>,
): { picked: string[]; seed: number } {
  const pool = state.game!.turn!.decoys.filter((d) => !taken.has(wordKey(d)));
  if (count <= 0 || pool.length === 0) return { picked: [], seed: state.seed };
  const rng = createRng(state.seed);
  return { picked: rng.shuffle(pool).slice(0, count), seed: rng.int(SEED_RANGE) };
}

/**
 * The board: the real title and every distinct lie, padded with house titles up to the player
 * count (at least `MIN_OPTIONS`), shuffled with the hidden seed.
 */
function board(state: SketchyState): { options: Option[]; seed: number } {
  const g = state.game!;
  const turn = g.turn!;
  const groups = new Map<string, Option>();
  for (const id of turn.writers) {
    const text = turn.lies[id];
    if (text === undefined) continue;
    const key = wordKey(text);
    const group = groups.get(key);
    if (group) group.authors.push(id);
    else groups.set(key, { text, truth: false, authors: [id], house: false });
  }
  const truth: Option = {
    text: g.sketches[turn.artist]!.prompt.text,
    truth: true,
    authors: [],
    house: false,
  };
  const size = Math.max(MIN_OPTIONS, g.players.length);
  const { picked, seed } = pickDecoys(state, size - 1 - groups.size, takenKeys(g, turn.lies));
  const house = picked.map((text): Option => ({ text, truth: false, authors: [], house: true }));
  const rng = createRng(seed);
  return { options: rng.shuffle([truth, ...groups.values(), ...house]), seed: rng.int(SEED_RANGE) };
}

/** Moves on to the vote once every writer has a lie (or the timer forces it; missing lies stay out). */
function maybeStartVoting(state: SketchyState, now: number, force = false): SketchyState {
  if (state.phase !== 'playing' || state.game?.stage !== 'write') return state;
  const turn = state.game.turn!;
  if (!force && !turn.writers.every((id) => turn.lies[id] !== undefined)) return state;
  const { options, seed } = board(state);
  const voters = turn.writers;
  // Nobody to vote: straight to the reveal, with no points.
  if (voters.length === 0) return reveal(withTurn({ ...state, seed }, { options }), now);
  return withGame(withTurn({ ...state, seed }, { options, voters }), {
    stage: 'vote',
    deadline: deadline(state.settings.voteSeconds, now),
    since: now,
  });
}

function reveal(state: SketchyState, now: number): SketchyState {
  const g = state.game!;
  const turn = g.turn!;
  const points: Record<PlayerId, number> = {};
  const bonus: Record<PlayerId, number> = {};
  const scores: Record<PlayerId, Score> = { ...state.scores };
  const streaks = { ...g.streaks };
  const add = (id: PlayerId, patch: Partial<Omit<Score, 'name'>>) => {
    const s = scores[id] ?? {
      name: state.seats[id]?.name ?? '',
      score: 0,
      fooled: 0,
      truths: 0,
      likes: 0,
      hits: 0,
    };
    scores[id] = {
      ...s,
      score: s.score + (patch.score ?? 0),
      fooled: s.fooled + (patch.fooled ?? 0),
      truths: s.truths + (patch.truths ?? 0),
      likes: s.likes + (patch.likes ?? 0),
      hits: s.hits + (patch.hits ?? 0),
    };
    points[id] = (points[id] ?? 0) + (patch.score ?? 0);
  };
  points[turn.artist] = 0;
  for (const id of turn.voters) points[id] = 0;
  const fooledBy = turn.options.map(() => 0);
  let found = 0;
  for (const voter of turn.voters) {
    const pick = turn.votes[voter];
    const option = pick === undefined ? undefined : turn.options[pick];
    if (option?.truth) {
      const streak = (streaks[voter] ?? 0) + 1;
      streaks[voter] = streak;
      bonus[voter] = streakBonus(streak);
      add(voter, { score: TRUTH_POINTS + bonus[voter], truths: 1 });
      found += 1;
    } else {
      streaks[voter] = 0;
      if (option && pick !== undefined) fooledBy[pick]! += 1;
    }
  }
  if (found > 0) add(turn.artist, { score: ARTIST_POINTS * found, hits: found });
  turn.options.forEach((option, i) => {
    const fooled = fooledBy[i]!;
    if (option.truth || fooled === 0) return;
    for (const author of option.authors) {
      add(author, {
        score: liePoints(fooled, option.authors.length),
        fooled,
      });
    }
  });
  return {
    ...state,
    scores,
    game: {
      ...g,
      stage: 'reveal',
      streaks,
      deadline: null,
      since: now,
      turn: { ...turn, points, streakBonus: bonus, revealedAt: now },
    },
  };
}

/** Reveals once every voter still here has voted (or the timer forces it). */
function maybeReveal(state: SketchyState, now: number, force = false): SketchyState {
  const g = state.game;
  if (state.phase !== 'playing' || g?.stage !== 'vote') return state;
  const turn = g.turn!;
  if (!force && !turn.voters.every((id) => turn.votes[id] !== undefined)) return state;
  return reveal(state, now);
}

/** Moves on once everyone in the round has sent a drawing (or the timer forces it). */
function maybeEndDrawing(state: SketchyState, now: number, force = false): SketchyState {
  const g = state.game;
  if (state.phase !== 'playing' || g?.stage !== 'draw') return state;
  if (!force && !g.players.every((id) => g.sketches[id]?.drawing)) return state;
  return beginTurns(state, now);
}

/** When the one-by-one reveal ends on every screen (epoch ms), or null when it's all shown. */
export function revealEnd(turn: Turn): number | null {
  if (turn.revealedAt === null || turn.revealSkipped) return null;
  const picked = turn.options.filter(
    (o, i) => o.truth || Object.values(turn.votes).includes(i),
  ).length;
  return turn.revealedAt + picked * REVEAL_STEP_MS;
}

/** Folds the finished drawing into the history: the likes count for their lies' authors. */
function closeTurn(state: SketchyState): SketchyState {
  const g = state.game!;
  const turn = g.turn!;
  const likesFor: Record<PlayerId, number> = {};
  const scores = { ...state.scores };
  for (const [liker, picks] of Object.entries(turn.likes)) {
    for (const i of picks) {
      for (const author of turn.options[i]?.authors ?? []) {
        if (author === liker) continue;
        likesFor[author] = (likesFor[author] ?? 0) + 1;
      }
    }
  }
  for (const [id, n] of Object.entries(likesFor)) {
    if (scores[id]) scores[id] = { ...scores[id], likes: scores[id].likes + n };
  }
  const truth = turn.options.findIndex((o) => o.truth);
  const history = [
    ...g.history,
    {
      artist: turn.artist,
      prompt: g.sketches[turn.artist]!.prompt.text,
      found: Object.values(turn.votes).filter((v) => v === truth).length,
      voters: turn.voters.length,
      likes: likesFor,
    },
  ];
  return { ...state, scores, game: { ...g, history } };
}

// ---- Actions ----

function requireHost(ctx: Ctx) {
  return ctx.isHost ? null : err('not-host', 'Only the host can do that.');
}

function requireStage(state: SketchyState, stage: Game['stage']): Game | GameError {
  if (state.phase !== 'playing' || !state.game) return err('not-playing', 'No game in progress.');
  if (state.game.stage !== stage) return err('wrong-stage', 'That’s not possible now.');
  return state.game;
}

function updateSettings(
  state: SketchyState,
  action: Extract<SketchyAction, { type: 'update-settings' }>,
  ctx: Ctx,
): Result {
  const no = requireHost(ctx);
  if (no) return no;
  if (state.phase === 'playing')
    return err('in-progress', 'Settings can only change between games.');
  const settings = { ...state.settings };
  if (action.packIds) {
    const known = new Set(state.packs.map((p) => p.id));
    const ids = [...new Set(action.packIds)];
    if (ids.some((id) => !known.has(id))) {
      return err('unknown-pack', 'That prompt pack is no longer available.');
    }
    settings.packIds = ids;
  }
  if (action.adult !== undefined) settings.adult = action.adult;
  if (action.drawSeconds !== undefined) settings.drawSeconds = action.drawSeconds;
  if (action.writeSeconds !== undefined) settings.writeSeconds = action.writeSeconds;
  if (action.voteSeconds !== undefined) settings.voteSeconds = action.voteSeconds;
  if (action.timerMode !== undefined) settings.timerMode = action.timerMode;
  if (action.sound !== undefined) {
    settings.sound = action.sound;
    settings.soundChosen = true;
  }
  if (action.music !== undefined) settings.music = action.music;
  if (action.effects !== undefined) settings.effects = action.effects;
  if (action.voice !== undefined) settings.voice = action.voice;
  return { ...state, settings };
}

function sit(state: SketchyState, playing: boolean, ctx: Ctx): Result {
  const seat = state.seats[ctx.by];
  if (!seat) return err('not-seated', 'You are not in this game.');
  if (seat.playing === playing) return state;
  if (playing && playingIds(state).length >= MAX_PLAYERS) {
    return err('table-full', `At most ${MAX_PLAYERS} players can play.`);
  }
  const next = { ...state, seats: { ...state.seats, [ctx.by]: { ...seat, playing } } };
  // Mid-game, a new player joins from the next round's drawing.
  return playing ? next : withdraw(next, ctx.by, ctx.now);
}

/** Prompts this room hasn't drawn first, then (only if the packs run short) the oldest of the rest. */
function deal(state: SketchyState, pool: Prompt[], count: number, rng: Rng): Prompt[] {
  if (rigAllowed) return pool.slice(0, count);
  const used = new Map(state.usedPromptIds.map((id, i) => [id, i]));
  const fresh = pool.filter((p) => !used.has(p.id));
  if (fresh.length >= count) return rng.shuffle(fresh).slice(0, count);
  const stale = pool
    .filter((p) => used.has(p.id))
    .sort((a, b) => used.get(a.id)! - used.get(b.id)!)
    .slice(0, count - fresh.length);
  return [...rng.shuffle(fresh), ...rng.shuffle(stale)];
}

/** Packs the host has chosen that are still offered. */
export const chosenPacks = (packs: readonly PackSummary[], ids: readonly string[]) =>
  packs.filter((p) => ids.includes(p.id));

/** Prompts in the chosen packs, given the adult switch. */
export const promptCount = (
  packs: readonly PackSummary[],
  settings: { packIds: string[]; adult: boolean },
) =>
  chosenPacks(packs, settings.packIds).reduce(
    (n, p) => n + p.count + (settings.adult ? p.adult : 0),
    0,
  );

function start(state: SketchyState, ctx: Ctx): Result {
  const no = requireHost(ctx);
  if (no) return no;
  if (state.phase === 'playing') return err('in-progress', 'A game is already running.');
  const players = playingIds(state);
  if (players.length < MIN_PLAYERS) {
    return err('too-few-players', `This game needs at least ${MIN_PLAYERS} players.`);
  }
  if (players.length > MAX_PLAYERS) {
    return err('too-many-players', `At most ${MAX_PLAYERS} players can play.`);
  }
  const { packIds, adult } = state.settings;
  if (packIds.length === 0) return err('no-packs', 'Pick at least one prompt pack.');
  const all = promptsFrom(ctx.content, packIds, adult);
  const rounds = roundsFor(players.length);
  // Every seat's drawings, a reroll each, and some to spare for players who join later.
  const need = players.length * rounds;
  if (all.length < need) {
    return err(
      'not-enough-prompts',
      `This game needs at least ${need} prompts in the chosen packs.`,
    );
  }
  const pool = deal(state, all, Math.min(all.length, need + players.length + MAX_PLAYERS), ctx.rng);
  const dealt = new Set(pool.map((p) => p.id));
  const usedPromptIds = [
    ...state.usedPromptIds.filter((id) => !dealt.has(id)),
    ...pool.map((p) => p.id),
  ].slice(-MAX_USED_PROMPTS);
  const decoys = ctx.rng.shuffle(decoysFrom(ctx.content, adult));
  const game: Game = {
    round: 0,
    rounds,
    stage: 'draw',
    players,
    pool,
    decoys,
    decoyAt: 0,
    sketches: {},
    rerolled: [],
    order: [],
    at: 0,
    turn: null,
    hidden: [],
    streaks: {},
    history: [],
    deadline: null,
  };
  const fresh: SketchyState = {
    ...state,
    phase: 'playing',
    game,
    scores: {},
    usedPromptIds,
    seed: ctx.rng.int(SEED_RANGE),
    gamesPlayed: state.gamesPlayed + 1,
    endReason: null,
  };
  return beginRound(fresh, 1, ctx.now);
}

function backToLobby(state: SketchyState, ctx: Ctx): Result {
  const no = requireHost(ctx);
  if (no) return no;
  return {
    ...state,
    phase: 'lobby',
    game: null,
    scores: {},
    endReason:
      state.phase === 'playing' ? 'abandoned' : state.phase === 'lobby' ? state.endReason : null,
  };
}

function draw(state: SketchyState, raw: Drawing, ctx: Ctx): Result {
  const g = requireStage(state, 'draw');
  if (g instanceof GameError) return g;
  const sketch = g.sketches[ctx.by];
  if (!sketch || !g.players.includes(ctx.by)) {
    return err('not-drawing', 'You’re watching this round. You join the next one.');
  }
  if (sketch.drawing) return err('already-drawn', 'Your drawing is already in.');
  const check = validateDrawing(raw);
  if (!check.ok) return err(check.code, check.message);
  return maybeEndDrawing(
    withGame(state, {
      sketches: { ...g.sketches, [ctx.by]: { ...sketch, drawing: check.drawing } },
    }),
    ctx.now,
  );
}

/** Once a game, a player may swap their prompt for a fresh one while drawing. */
function reroll(state: SketchyState, ctx: Ctx): Result {
  const g = requireStage(state, 'draw');
  if (g instanceof GameError) return g;
  const sketch = g.sketches[ctx.by];
  if (!sketch || !g.players.includes(ctx.by)) {
    return err('not-drawing', 'You’re watching this round. You join the next one.');
  }
  if (sketch.drawing) return err('already-drawn', 'Your drawing is already in.');
  if (g.rerolled.includes(ctx.by)) {
    return err('rerolled', 'You’ve had your one new prompt this game.');
  }
  const [prompt, ...pool] = g.pool;
  if (!prompt) return err('no-prompts', 'No other prompts are left. Draw this one!');
  const rng = createRng(state.seed);
  return withGame(
    { ...state, seed: rng.int(SEED_RANGE) },
    {
      pool,
      rerolled: [...g.rerolled, ctx.by],
      sketches: {
        ...g.sketches,
        [ctx.by]: { prompt: fillPrompt(prompt, ctx.by, state, rng), drawing: null },
      },
    },
  );
}

function requireWriter(state: SketchyState, stage: 'write' | 'vote', ctx: Ctx): Turn | GameError {
  const g = requireStage(state, stage);
  if (g instanceof GameError) return g;
  const turn = g.turn!;
  if (turn.artist === ctx.by)
    return err('your-drawing', 'This is your drawing: sit back and watch!');
  const list = stage === 'write' ? turn.writers : turn.voters;
  if (!list.includes(ctx.by)) {
    return err('not-playing-round', 'You’re watching this round. You join the next one.');
  }
  return turn;
}

function lie(state: SketchyState, text: string, ctx: Ctx): Result {
  const turn = requireWriter(state, 'write', ctx);
  if (turn instanceof GameError) return turn;
  const problem = lieProblem(text, state.game!.sketches[turn.artist]!.prompt);
  if (problem) return problem;
  return maybeStartVoting(
    withTurn(state, { lies: { ...turn.lies, [ctx.by]: tidyLie(text) } }),
    ctx.now,
  );
}

function vote(state: SketchyState, option: number, ctx: Ctx): Result {
  const turn = requireWriter(state, 'vote', ctx);
  if (turn instanceof GameError) return turn;
  const picked = turn.options[option];
  if (!picked) return err('bad-option', 'Pick one of the titles.');
  if (picked.authors.includes(ctx.by)) return err('own-lie', 'That’s your own lie! Pick another.');
  return maybeReveal(withTurn(state, { votes: { ...turn.votes, [ctx.by]: option } }), ctx.now);
}

/** Whether `id` may like answers now: after their vote (the artist at any time), until the reveal ends. */
export function canLike(state: SketchyState, id: PlayerId, now: number): boolean {
  const g = state.game;
  const turn = g?.turn;
  if (state.phase !== 'playing' || !g || !turn) return false;
  const inTurn = turn.artist === id || turn.voters.includes(id);
  if (!inTurn) return false;
  if (g.stage === 'vote') return turn.artist === id || turn.votes[id] !== undefined;
  if (g.stage !== 'reveal') return false;
  const end = revealEnd(turn);
  return end !== null && now < end;
}

function like(state: SketchyState, option: number, on: boolean, ctx: Ctx): Result {
  if (!canLike(state, ctx.by, ctx.now))
    return err('no-likes', 'Likes are open after you pick, until the reveal ends.');
  const turn = state.game!.turn!;
  const picked = turn.options[option];
  if (!picked) return err('bad-option', 'Like one of the titles.');
  if (picked.authors.includes(ctx.by)) return err('own-lie', 'You can’t like your own lie.');
  const mine = turn.likes[ctx.by] ?? [];
  const next = on ? [...new Set([...mine, option])] : mine.filter((i) => i !== option);
  return withTurn(state, { likes: { ...turn.likes, [ctx.by]: next } });
}

function skipReveal(state: SketchyState, ctx: Ctx): Result {
  const no = requireHost(ctx);
  if (no) return no;
  const g = requireStage(state, 'reveal');
  if (g instanceof GameError) return g;
  return g.turn!.revealSkipped ? state : withTurn(state, { revealSkipped: true });
}

/** The host moves on after a reveal: the next drawing, the next round or the end. */
function next(state: SketchyState, ctx: Ctx): Result {
  const no = requireHost(ctx);
  if (no) return no;
  const g = requireStage(state, 'reveal');
  if (g instanceof GameError) return g;
  const closed = closeTurn(state);
  const cg = closed.game!;
  if (cg.at + 1 < cg.order.length) return beginTurn(withGame(closed, { at: cg.at + 1 }), ctx.now);
  return afterRound(closed, ctx.now);
}

function hide(state: SketchyState, hidden: boolean, ctx: Ctx): Result {
  const no = requireHost(ctx);
  if (no) return no;
  const g = state.game;
  if (state.phase !== 'playing' || !g?.turn)
    return err('no-drawing', 'There is no drawing to hide.');
  const artist = g.turn.artist;
  const list = hidden
    ? [...new Set([...g.hidden, artist])]
    : g.hidden.filter((id) => id !== artist);
  return withGame(state, { hidden: list });
}

/** Who the stage still waits for. */
export function missingPlayers(game: Game): PlayerId[] {
  const turn = game.turn;
  if (game.stage === 'draw') return game.players.filter((id) => !game.sketches[id]?.drawing);
  if (!turn) return [];
  if (game.stage === 'write') return turn.writers.filter((id) => turn.lies[id] === undefined);
  if (game.stage === 'vote') return turn.voters.filter((id) => turn.votes[id] === undefined);
  return [];
}

function continueWithout(state: SketchyState, ctx: Ctx): Result {
  const no = requireHost(ctx);
  if (no) return no;
  const g = state.game;
  if (state.phase !== 'playing' || !g || g.stage === 'reveal') {
    return err('wrong-stage', 'Nobody is being waited for.');
  }
  if (missingPlayers(g).length === 0) return err('nobody-missing', 'Everyone is in already.');
  return finishStage(state, ctx.now);
}

/** Ends the current stage as a strict timeout would. */
function finishStage(state: SketchyState, now: number): SketchyState {
  const g = state.game!;
  switch (g.stage) {
    case 'draw':
      return maybeEndDrawing(state, now, true);
    case 'write':
      return maybeStartVoting(state, now, true);
    case 'vote': {
      const turn = g.turn!;
      const missing = turn.voters.some((id) => turn.votes[id] === undefined);
      return maybeReveal(missing ? withTurn(state, { voteTimedOut: true }) : state, now, true);
    }
    case 'reveal':
      return state;
  }
}

/** Keeps the pack list up to date between games: packs switched off drop out of the selection. */
function refreshPacks(state: SketchyState, content: ContentProvider): SketchyState {
  if (state.phase === 'playing') return state;
  const packs = promptPacks(content);
  const offered = new Set(packs.map((p) => p.id));
  const kept = state.settings.packIds.filter((id) => offered.has(id));
  const packIds = kept.length ? kept : defaultPacks(packs);
  const same =
    packIds.length === state.settings.packIds.length &&
    packIds.every((id, i) => id === state.settings.packIds[i]);
  return { ...state, packs, settings: same ? state.settings : { ...state.settings, packIds } };
}

export function reduce(state: SketchyState, action: SketchyAction, ctx: Ctx): Result {
  const current = refreshPacks(state, ctx.content);
  switch (action.type) {
    case 'update-settings':
      return updateSettings(current, action, ctx);
    case 'sit':
      return sit(current, action.playing, ctx);
    case 'start':
      return start(current, ctx);
    case 'back-to-lobby':
      return backToLobby(current, ctx);
    case 'draw':
      return draw(current, action.drawing, ctx);
    case 'reroll':
      return reroll(current, ctx);
    case 'lie':
      return lie(current, action.text, ctx);
    case 'vote':
      return vote(current, action.option, ctx);
    case 'like':
      return like(current, action.option, action.on, ctx);
    case 'next':
      return next(current, ctx);
    case 'skip-reveal':
      return skipReveal(current, ctx);
    case 'continue-without':
      return continueWithout(current, ctx);
    case 'hide':
      return hide(current, action.hidden, ctx);
  }
}

// ---- Players coming and going ----

export function create(ctx: CreateCtx, players: readonly PlayerInfo[]): SketchyState {
  const packs = promptPacks(ctx.content);
  return {
    phase: 'lobby',
    settings: {
      packIds: defaultPacks(packs),
      adult: false,
      drawSeconds: DEFAULT_DRAW_SECONDS,
      writeSeconds: DEFAULT_WRITE_SECONDS,
      voteSeconds: DEFAULT_VOTE_SECONDS,
      timerMode: 'soft',
      ...DEFAULT_SOUND,
    },
    seats: Object.fromEntries(
      players.map((p, i) => [p.id, { name: p.name, playing: i < MAX_PLAYERS }]),
    ),
    packs,
    game: null,
    scores: {},
    usedPromptIds: [],
    seed: ctx.rng.int(SEED_RANGE),
    gamesPlayed: 0,
    endReason: null,
  };
}

export function playerJoined(state: SketchyState, player: PlayerInfo): SketchyState {
  const existing = state.seats[player.id];
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
 * Takes a player out of play once they've left or stood up. A drawing they sent still plays; a
 * lie still being written is dropped, but once voting has started it stays on the board, and a
 * vote cast still counts. Ends the game below the minimum.
 */
function withdraw(state: SketchyState, id: PlayerId, now: number): SketchyState {
  const g = state.game;
  if (state.phase !== 'playing' || !g) return state;
  if (playingIds(state).length < MIN_PLAYERS) return endGame(state, 'too-few');
  switch (g.stage) {
    case 'draw': {
      if (!g.players.includes(id) || g.sketches[id]?.drawing) return state;
      const sketches = { ...g.sketches };
      delete sketches[id];
      return maybeEndDrawing(
        withGame(state, { players: g.players.filter((p) => p !== id), sketches }),
        now,
      );
    }
    case 'write': {
      const turn = g.turn!;
      if (!turn.writers.includes(id)) return state;
      const lies = { ...turn.lies };
      delete lies[id];
      return maybeStartVoting(
        withTurn(state, { writers: turn.writers.filter((p) => p !== id), lies }),
        now,
      );
    }
    case 'vote': {
      const turn = g.turn!;
      if (!turn.voters.includes(id) || turn.votes[id] !== undefined) return state;
      return maybeReveal(withTurn(state, { voters: turn.voters.filter((v) => v !== id) }), now);
    }
    case 'reveal':
      return state;
  }
}

export function playerLeft(state: SketchyState, playerId: PlayerId, now: number): SketchyState {
  if (!state.seats[playerId]) return state;
  const seats = { ...state.seats };
  delete seats[playerId];
  return withdraw({ ...state, seats }, playerId, now);
}

// ---- Timers ----

export function nextDeadline(state: SketchyState): number | null {
  const g = state.game;
  if (state.phase !== 'playing' || state.settings.timerMode !== 'strict' || !g) return null;
  return g.stage === 'reveal' ? null : g.deadline;
}

export function onDeadline(state: SketchyState, now: number): SketchyState {
  const due = nextDeadline(state);
  if (due === null || now < due) return state;
  return finishStage(state, now);
}
