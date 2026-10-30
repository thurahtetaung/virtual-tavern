import {
  type ActionCtx,
  type ContentProvider,
  type CreateCtx,
  GameError,
  type PlayerId,
  type PlayerInfo,
  type Rng,
  createRng,
} from '@vt/game-sdk';
import {
  type Card,
  type Category,
  type PackSummary,
  cardsFrom,
  categoriesFrom,
  packsOf,
  tierRank,
} from './content.ts';
import {
  GOALS,
  type Goal,
  type GoalId,
  MIN_GENRES,
  MODES,
  STYLE_IDS,
  type StyleId,
  complete,
  genreInfo,
  genresOf,
  goalFor,
  nounOf,
  progress,
  titlesNeeded,
} from './genres.ts';
import {
  type CliffhangerAction,
  type CliffhangerState,
  COUNTDOWN_MS,
  DECIDE_MS,
  type FaceOff,
  type FaceOffResult,
  type Hand,
  MAX_LOG,
  MAX_PLAYERS,
  MAX_USED,
  MIN_TEAM,
  OPENING_MS,
  PLACE_MS,
  RECAP_MS,
  type Round,
  type Settings,
  type Slot,
  TEAMS,
  type TeamId,
  UNDO_MS,
  other,
} from './types.ts';

type Result = CliffhangerState | GameError;
const err = (code: string, message: string) => new GameError(code, message);

const SEED_RANGE = 0x1_0000_0000;
/** Cards a game draws up front (about forty rounds); past that the discards are reshuffled. */
export const DECK_CAP = 240;
export const CATEGORY_CAP = 200;

// ---- Test rig (browser tests only) ----

let testOrder = false;
/**
 * Test servers only: every game deals the cards and categories in the packs' own order (no
 * shuffle, nothing moved back for having been drawn before), so a browser test knows every hand.
 */
export function setTestDeck(on = true): void {
  testOrder = on;
}

// ---- Helpers ----

export const teamOf = (state: CliffhangerState, id: PlayerId | null): TeamId | null =>
  id === null ? null : (state.seats[id]?.team ?? null);

export const membersOf = (state: CliffhangerState, team: TeamId): PlayerId[] =>
  Object.entries(state.seats).flatMap(([id, s]) => (s.team === team ? [id] : []));

export const seatedIds = (state: CliffhangerState): PlayerId[] =>
  Object.entries(state.seats).flatMap(([id, s]) => (s.team ? [id] : []));

const nameOf = (state: CliffhangerState, id: PlayerId) => state.seats[id]?.name ?? 'Someone';

export const goalNow = (state: Pick<CliffhangerState, 'goal' | 'target'>): Goal =>
  state.target ?? GOALS[state.goal];

export const progressOf = (state: CliffhangerState, team: TeamId) =>
  progress(
    state.collections[team].map((c) => c.genre),
    goalNow(state),
  );

/** One genre (one card that counts) from the goal. */
export const atMatchPoint = (state: CliffhangerState, team: TeamId) => {
  const p = progressOf(state, team);
  return p.need - p.have === 1;
};

/** Randomness for steps without a `ctx` (timers): drawn from the hidden seed, which moves on. */
function seeded(state: CliffhangerState): [Rng, CliffhangerState] {
  const rng = createRng(state.seed);
  return [rng, { ...state, seed: rng.int(SEED_RANGE) }];
}

const log = (state: CliffhangerState, text: string): CliffhangerState => ({
  ...state,
  log: [...state.log, { round: state.round?.number ?? 0, text }].slice(-MAX_LOG),
});

const withRound = (state: CliffhangerState, patch: Partial<Round>): CliffhangerState => ({
  ...state,
  round: { ...state.round!, ...patch },
});

/** The next face-off pair: each team's next player in its own rotation. */
export function peekPair(state: CliffhangerState): Record<TeamId, PlayerId> | null {
  const a = state.rotation.a.order;
  const b = state.rotation.b.order;
  if (!a.length || !b.length) return null;
  return {
    a: a[state.rotation.a.next % a.length]!,
    b: b[state.rotation.b.next % b.length]!,
  };
}

/** The styles of this game's squares (Mix with fresh styles deals them each round). */
function roundStyles(settings: Settings, rng: Rng): StyleId[] {
  if (settings.mode !== 'mix') return [...MODES[settings.mode].styles];
  if (settings.mixFresh) return rng.shuffle(settings.mixStyles).slice(0, 3);
  return settings.mixStyles.slice(0, 3);
}

/** Why the Mix styles can't be played, or null. */
export function mixProblem(settings: Pick<Settings, 'mixStyles' | 'mixFresh'>): GameError | null {
  const n = settings.mixStyles.length;
  if (settings.mixFresh ? n < 3 : n !== 3) {
    return err(
      'mix-styles',
      settings.mixFresh
        ? 'Tick at least three styles to deal from.'
        : 'Tick exactly three styles, one for each square.',
    );
  }
  return null;
}

// ---- Cards and categories ----

/** Draws `n` cards from the top, reshuffling the discards when the pile runs out. */
function draw(state: CliffhangerState, n: number): [Card[], CliffhangerState] | null {
  let s = state;
  if (s.deck.length < n && s.discard.length) {
    const [rng, next] = seeded(s);
    s = { ...next, deck: [...s.deck, ...rng.shuffle(s.discard)], discard: [] };
  }
  if (s.deck.length < n) return null;
  const cards = s.deck.slice(0, n);
  return [
    cards,
    {
      ...s,
      deck: s.deck.slice(n),
      usedCardIds: [
        ...s.usedCardIds.filter((id) => !cards.some((c) => c.id === id)),
        ...cards.map((c) => c.id),
      ].slice(-MAX_USED),
    },
  ];
}

/** The next category; the pile goes round again once it is used up. */
function drawCategory(state: CliffhangerState): [Category, CliffhangerState] {
  const [first, ...rest] = state.categories;
  return [
    first!,
    {
      ...state,
      categories: [...rest, first!],
      usedCategoryIds: [...state.usedCategoryIds.filter((id) => id !== first!.id), first!.id].slice(
        -MAX_USED,
      ),
    },
  ];
}

/** Unseen first (shuffled), then the ones this room drew longest ago. */
function freshFirst<T extends { id: string }>(items: T[], used: readonly string[], rng: Rng): T[] {
  if (testOrder) return items;
  const at = new Map(used.map((id, i) => [id, i]));
  const unseen = rng.shuffle(items.filter((c) => !at.has(c.id)));
  const seen = items.filter((c) => at.has(c.id)).sort((x, y) => at.get(x.id)! - at.get(y.id)!);
  return [...unseen, ...seen];
}

// ---- The game's end ----

function endGame(
  state: CliffhangerState,
  endReason: Exclude<CliffhangerState['endReason'], null>,
  winner: TeamId | null = null,
): CliffhangerState {
  return { ...state, phase: 'over', winner, endReason };
}

/** The most genres each team has trailed by, kept up to date for comebacks. */
function noteBehind(state: CliffhangerState): CliffhangerState {
  const a = progressOf(state, 'a').have;
  const b = progressOf(state, 'b').have;
  return {
    ...state,
    behind: { a: Math.max(state.behind.a, b - a), b: Math.max(state.behind.b, a - b) },
  };
}

/** Checked as each team's turn ends and after each 3-for-1 steal: the first to complete wins. */
function checkWin(state: CliffhangerState, team: TeamId): CliffhangerState | null {
  if (
    !complete(
      state.collections[team].map((c) => c.genre),
      goalNow(state),
    )
  )
    return null;
  return endGame(state, 'won', team);
}

// ---- Rounds ----

function startRound(state: CliffhangerState, now: number): CliffhangerState {
  const pair = peekPair(state);
  if (!pair) return endGame(state, 'too-few');
  let s: CliffhangerState = {
    ...state,
    rotation: {
      a: { ...state.rotation.a, next: state.rotation.a.next + 1 },
      b: { ...state.rotation.b, next: state.rotation.b.next + 1 },
    },
  };
  const [rng, seededState] = seeded(s);
  s = seededState;
  const pa = progressOf(s, 'a').have;
  const pb = progressOf(s, 'b').have;
  const suddenDeath = s.settings.suddenDeath && atMatchPoint(s, 'a') && atMatchPoint(s, 'b');
  const round: Round = {
    number: (s.round?.number ?? 0) + 1,
    stage: 'countdown',
    pair,
    styles: roundStyles(s.settings, rng),
    stageEnds: now + COUNTDOWN_MS,
    after: 'faceoff',
    suddenDeath,
    pick: null,
    category: null,
    faceoff: null,
    faceoffResult: null,
    hands: {},
    board: {},
    order: [],
    turnNo: 0,
    turn: null,
    results: [],
    steal: null,
    steals: [],
  };
  s = { ...s, round };
  const trailing: TeamId | null = pa < pb ? 'a' : pb < pa ? 'b' : null;
  if (s.settings.comebackPick && trailing && !suddenDeath && s.categories.length > 1) {
    const [one, s1] = drawCategory(s);
    const [two, s2] = drawCategory(s1);
    return withRound(s2, {
      stage: 'pick-category',
      stageEnds: null,
      after: null,
      pick: { by: pair[trailing], options: [one, two], deadline: now + DECIDE_MS },
    });
  }
  return s;
}

function flip(state: CliffhangerState, now: number): CliffhangerState {
  let s = state;
  let category = s.round!.category;
  if (!category) [category, s] = drawCategory(s);
  const faceoff: FaceOff = {
    flippedAt: now,
    on: null,
    deadline: s.settings.openingClock ? now + OPENING_MS : null,
    answers: 0,
    last: null,
    firstAt: null,
    swaps: 0,
  };
  return withRound(s, { stage: 'faceoff', stageEnds: null, after: null, category, faceoff });
}

function decideFaceOff(
  state: CliffhangerState,
  winner: PlayerId,
  how: FaceOffResult['how'],
  now: number,
): CliffhangerState {
  const round = state.round!;
  const fo = round.faceoff!;
  const loser = winner === round.pair.a ? round.pair.b : round.pair.a;
  const result: FaceOffResult = {
    winner,
    loser,
    how,
    answers: fo.answers,
    ms: fo.firstAt === null ? 0 : now - fo.firstAt,
  };
  const winTeam = teamOf(state, winner) ?? (winner === round.pair.a ? 'a' : 'b');
  let s = log(
    withRound(state, {
      faceoffResult: result,
      faceoff: { ...fo, on: null, deadline: null },
      order: [winTeam, other(winTeam)],
    }),
    `${nameOf(state, winner)} won the face-off${fo.answers ? ` after ${fo.answers} ${fo.answers === 1 ? 'answer' : 'answers'}` : ''}.`,
  );
  if (round.suddenDeath) return endGame(s, 'sudden-death', winTeam);
  const noAdvantage = s.settings.noAdvantage;
  const first = draw(s, noAdvantage ? 5 : 6);
  if (!first) return endGame(s, 'no-cards');
  s = first[1];
  const hands: Round['hands'] = {
    [winner]: {
      team: winTeam,
      offered: first[0],
      slots: [null, null, null],
      deadline: now + PLACE_MS,
    },
  };
  if (noAdvantage) {
    const second = draw(s, 5);
    if (!second) return endGame(s, 'no-cards');
    s = second[1];
    hands[loser] = {
      team: other(winTeam),
      offered: second[0],
      slots: [null, null, null],
      deadline: now + PLACE_MS,
    };
  }
  return withRound(s, { stage: 'keep', hands });
}

/** The hand's three squares, the empty ones filled with the easiest cards left. */
function completeSlots(hand: Hand): string[] {
  const chosen = hand.slots.filter((id): id is string => !!id);
  const rest = hand.offered
    .filter((c) => !chosen.includes(c.id))
    .map((c, i) => ({ c, i }))
    .sort((x, y) => tierRank(x.c) - tierRank(y.c) || x.i - y.i)
    .map(({ c }) => c.id);
  return hand.slots.map((id) => id ?? rest.shift()!);
}

/** Locks a hand onto its team's squares: the winner's leftovers go to the loser (or are discarded). */
function lockHand(state: CliffhangerState, player: PlayerId, now: number): CliffhangerState {
  const round = state.round!;
  const hand = round.hands[player];
  if (!hand) return state;
  const ids = completeSlots(hand);
  const byId = new Map(hand.offered.map((c) => [c.id, c]));
  const slots: Slot[] = ids.map((id, i) => ({
    style: round.styles[i]!,
    card: byId.get(id)!,
    got: null,
    gotAt: null,
  }));
  const rest = hand.offered.filter((c) => !ids.includes(c.id));
  const hands = { ...round.hands };
  delete hands[player];
  let s = state;
  const winner = round.faceoffResult?.winner;
  if (rest.length) {
    if (player === winner && !state.settings.noAdvantage) {
      const loser = round.faceoffResult!.loser;
      hands[loser] = {
        team: other(hand.team),
        offered: rest,
        slots: [null, null, null],
        deadline: now + PLACE_MS,
      };
    } else s = { ...s, discard: [...s.discard, ...rest] };
  }
  s = withRound(s, { hands, board: { ...round.board, [hand.team]: slots } });
  if (player === winner && round.stage === 'keep') {
    s = withRound(s, { stage: 'countdown', after: 'turn', stageEnds: now + COUNTDOWN_MS });
  }
  return s;
}

function lockAll(state: CliffhangerState, now: number): CliffhangerState {
  let s = state;
  for (const id of Object.keys(s.round!.hands)) s = lockHand(s, id, now);
  return s;
}

const unguessed = (slots: Slot[] | undefined) => (slots ?? []).filter((x) => x.got === null);

/** What the turn's describer can still get: their own cards, then (once those are done) the other team's. */
function available(state: CliffhangerState): { own: Slot[]; steal: Slot[] } {
  const round = state.round!;
  const team = round.turn!.team;
  return { own: unguessed(round.board[team]), steal: unguessed(round.board[other(team)]) };
}

function beginTurn(state: CliffhangerState, now: number): CliffhangerState {
  // The describer's own cards lock now; the other side keeps placing during this turn.
  const team = state.round!.order[state.round!.turnNo]!;
  let s = state;
  for (const [id, hand] of Object.entries(s.round!.hands)) {
    if (hand!.team === team) s = lockHand(s, id, now);
  }
  const round = s.round!;
  const own = unguessed(round.board[team]);
  s = withRound(s, {
    stage: 'turn',
    stageEnds: null,
    after: null,
    turn: {
      team,
      describer: round.pair[team],
      startedAt: now,
      endsAt: now + s.settings.turnSeconds * 1000,
      focus: own[0]?.card.id ?? null,
      stealOpen: own.length === 0,
      gots: [],
    },
  });
  const left = available(s);
  return left.own.length + left.steal.length === 0 ? endTurn(s, now) : s;
}

function endTurn(state: CliffhangerState, now: number): CliffhangerState {
  const round = state.round!;
  const turn = round.turn!;
  const team = turn.team;
  const slots = TEAMS.flatMap((t) => (round.board[t] ?? []).map((x) => ({ x, t })));
  const won = turn.gots.flatMap((id) => {
    const hit = slots.find(({ x }) => x.card.id === id);
    return hit ? [hit] : [];
  });
  const missed = unguessed(round.board[team]).map((x) => x.card);
  let s: CliffhangerState = {
    ...state,
    collections: {
      ...state.collections,
      [team]: [...state.collections[team], ...won.map((w) => w.x.card)],
    },
  };
  s = withRound(s, {
    turn: { ...turn, endsAt: Math.min(turn.endsAt, now) },
    results: [
      ...round.results,
      {
        team,
        describer: turn.describer,
        got: won.map(({ x, t }) => ({
          card: x.card,
          style: x.style,
          steal: t !== team,
          ms: Math.max(0, (x.gotAt ?? now) - turn.startedAt),
        })),
        missed,
      },
    ],
  });
  const n = won.length;
  s = log(
    noteBehind(s),
    `${nameOf(s, turn.describer)} got ${n} ${nounOf(s.goal === 'tv' ? 'tv' : 'films', n !== 1)}${
      won.some((w) => w.t !== team) ? ` (${won.filter((w) => w.t !== team).length} stolen)` : ''
    }.`,
  );
  const win = checkWin(s, team);
  if (win) return win;
  if (round.turnNo === 0) {
    return withRound(s, { stage: 'recap', stageEnds: now + RECAP_MS, after: 'turn', turnNo: 1 });
  }
  return endRound(s, now);
}

/** A team may trade three of one genre for any one card of the other team's. */
export function stealGenres(state: CliffhangerState, team: TeamId): string[] {
  if (!state.collections[other(team)].length) return [];
  const counts = new Map<string, number>();
  for (const c of state.collections[team]) counts.set(c.genre, (counts.get(c.genre) ?? 0) + 1);
  return [...counts].filter(([, n]) => n >= 3).map(([g]) => g);
}

function endRound(state: CliffhangerState, now: number): CliffhangerState {
  const round = state.round!;
  const leftover = TEAMS.flatMap((t) => unguessed(round.board[t]).map((x) => x.card));
  const s: CliffhangerState = { ...state, discard: [...state.discard, ...leftover] };
  return nextSteal(
    withRound(s, { steal: { queue: [...round.order], deadline: now + DECIDE_MS } }),
    now,
    false,
  );
}

/** Offers the 3-for-1 steal to the next team that can make it; then the next round. */
function nextSteal(state: CliffhangerState, now: number, advance: boolean): CliffhangerState {
  const queue = [...(state.round!.steal?.queue ?? [])];
  if (advance) queue.shift();
  while (queue.length && stealGenres(state, queue[0]!).length === 0) queue.shift();
  if (!queue.length) return startRound(withRound(state, { steal: null }), now);
  return withRound(state, {
    stage: 'steal',
    stageEnds: null,
    after: null,
    steal: { queue, deadline: now + DECIDE_MS },
  });
}

// ---- Actions ----

const requireHost = (ctx: ActionCtx) =>
  ctx.isHost ? null : err('not-host', 'Only the host can do that.');

function requireStage(state: CliffhangerState, ...stages: Round['stage'][]): Round | GameError {
  if (state.phase !== 'playing' || !state.round) return err('not-playing', 'No game in progress.');
  if (!stages.includes(state.round.stage)) return err('wrong-stage', 'That’s not possible now.');
  return state.round;
}

function updateSettings(
  state: CliffhangerState,
  action: Extract<CliffhangerAction, { type: 'update-settings' }>,
  ctx: ActionCtx,
): Result {
  const no = requireHost(ctx);
  if (no) return no;
  const settings: Settings = { ...state.settings };
  if (action.sound !== undefined) {
    settings.sound = action.sound;
    settings.soundChosen = true;
  }
  // The sound may change mid-game; nothing else may.
  const others = Object.entries(action).some(
    ([k, v]) => k !== 'type' && k !== 'sound' && v !== undefined,
  );
  if (state.phase === 'playing') {
    if (others) return err('in-progress', 'Settings can only change between games.');
    return { ...state, settings };
  }
  if (action.packIds) {
    const known = new Set(state.packs.map((p) => p.id));
    const ids = [...new Set(action.packIds)];
    if (ids.some((id) => !known.has(id)))
      return err('unknown-pack', 'That pack is no longer available.');
    settings.packIds = ids;
  }
  if (action.mixStyles) {
    settings.mixStyles = STYLE_IDS.filter((s) => action.mixStyles!.includes(s));
  }
  if (action.deck !== undefined) settings.deck = action.deck;
  if (action.goal !== undefined) {
    // A preset sets the film genres and how many of each.
    settings.goal = action.goal;
    settings.filmGenres = [...GOALS[action.goal].genres];
    settings.each = GOALS[action.goal].each as 1 | 2;
  }
  if (action.genres) {
    const known = genresOf(settings.deck).map((g) => g.id);
    const genres = known.filter((id) => action.genres!.includes(id));
    if (action.genres.some((id) => !known.includes(id)))
      return err('unknown-genre', 'That genre is not in this deck.');
    if (genres.length < MIN_GENRES)
      return err('too-few-genres', `Keep at least ${MIN_GENRES} genres.`);
    settings[settings.deck === 'tv' ? 'tvGenres' : 'filmGenres'] = genres;
  }
  if (action.each !== undefined) settings.each = action.each;
  for (const key of [
    'mode',
    'mixFresh',
    'answerSeconds',
    'turnSeconds',
    'noSequels',
    'newWordsOnly',
    'noAdvantage',
    'comebackPick',
    'suddenDeath',
    'openingClock',
    'timerMode',
  ] as const) {
    if (action[key] !== undefined)
      (settings as unknown as Record<string, unknown>)[key] = action[key];
  }
  return {
    ...state,
    settings,
    goal: goalIdOf(settings),
    genreCounts: genreCounts(ctx.content, settings),
  };
}

/** Titles per genre in the chosen packs of the settings' deck, each title once. */
function genreCounts(content: ContentProvider, settings: Settings): Record<string, number> {
  const all = genresOf(settings.deck).map((g) => g.id);
  const counts: Record<string, number> = Object.fromEntries(all.map((id) => [id, 0]));
  for (const c of cardsFrom(content, settings.deck, settings.packIds, all)) counts[c.genre]! += 1;
  return counts;
}

/** The goal's genres with too few titles for a long game. */
export function shortGenres(goal: Goal, counts: Record<string, number>): string[] {
  return goal.genres.filter((g) => (counts[g] ?? 0) < titlesNeeded(goal.each));
}

/**
 * A capped deck that still holds every goal genre's first `floor` titles (so no genre is left out
 * of a big pack's draw), then the rest in order; the order of `cards` is kept.
 */
function capped(cards: Card[], floor: number, cap: number): Card[] {
  if (cards.length <= cap) return cards;
  const keep = new Set<string>();
  const per = new Map<string, number>();
  for (const c of cards) {
    const n = per.get(c.genre) ?? 0;
    if (n < floor) {
      per.set(c.genre, n + 1);
      keep.add(c.id);
    }
  }
  for (const c of cards) {
    if (keep.size >= cap) break;
    keep.add(c.id);
  }
  return cards.filter((c) => keep.has(c.id));
}

const goalIdOf = (settings: Settings): GoalId => (settings.deck === 'tv' ? 'tv' : settings.goal);

function chooseTeam(state: CliffhangerState, team: TeamId | null, ctx: ActionCtx): Result {
  const seat = state.seats[ctx.by];
  if (!seat) return err('not-seated', 'You are not in this game.');
  if (seat.team === team) return state;
  if (state.phase === 'playing') {
    if (seat.team !== null) return err('in-progress', 'Teams can only change between games.');
    if (team === null) return state;
  }
  if (team && seatedIds(state).length >= MAX_PLAYERS && seat.team === null) {
    return err('table-full', `At most ${MAX_PLAYERS} players can play.`);
  }
  let s: CliffhangerState = { ...state, seats: { ...state.seats, [ctx.by]: { ...seat, team } } };
  if (state.phase === 'playing' && team) {
    s = {
      ...s,
      rotation: {
        ...s.rotation,
        [team]: { ...s.rotation[team], order: [...s.rotation[team].order, ctx.by] },
      },
    };
  }
  return s;
}

function shuffleTeams(state: CliffhangerState, ctx: ActionCtx): Result {
  const no = requireHost(ctx);
  if (no) return no;
  if (state.phase === 'playing') return err('in-progress', 'Teams can only change between games.');
  const seated = ctx.rng.shuffle(seatedIds(state));
  const seats = { ...state.seats };
  seated.forEach((id, i) => {
    seats[id] = { ...seats[id]!, team: i % 2 === 0 ? 'a' : 'b' };
  });
  return { ...state, seats };
}

function start(state: CliffhangerState, ctx: ActionCtx): Result {
  const no = requireHost(ctx);
  if (no) return no;
  if (state.phase === 'playing') return err('in-progress', 'A game is already running.');
  for (const t of TEAMS) {
    if (membersOf(state, t).length < MIN_TEAM) {
      return err('team-too-small', `Each team needs at least ${MIN_TEAM} players.`);
    }
  }
  const settings = state.settings;
  if (settings.mode === 'mix') {
    const bad = mixProblem(settings);
    if (bad) return bad;
  }
  const goal = goalFor(settings);
  const noun = nounOf(settings.deck, true);
  if (goal.genres.length < MIN_GENRES) {
    return err('too-few-genres', `Pick at least ${MIN_GENRES} genres to collect.`);
  }
  // No titles at all means no pack is picked; titles only outside the goal's genres are too few.
  const allGenres = genresOf(settings.deck).map((g) => g.id);
  if (cardsFrom(ctx.content, settings.deck, settings.packIds, allGenres).length === 0) {
    return err('no-cards', `Pick at least one pack of ${noun} first.`);
  }
  const cards = cardsFrom(ctx.content, settings.deck, settings.packIds, goal.genres);
  const counts: Record<string, number> = {};
  for (const c of cards) counts[c.genre] = (counts[c.genre] ?? 0) + 1;
  const short = shortGenres(goal, counts);
  if (short.length) {
    const names = short.map((g) => genreInfo(g, settings.deck).name).join(', ');
    return err(
      'too-few-titles',
      `Too few ${noun} in ${names}: each genre needs ${titlesNeeded(goal.each)} in the chosen packs. Add packs or turn ${short.length > 1 ? 'those genres' : 'it'} off.`,
    );
  }
  const categories = categoriesFrom(ctx.content, settings.deck, settings.packIds);
  if (categories.length === 0) {
    return err('no-categories', 'Pick at least one pack of face-off categories first.');
  }
  const deck = capped(
    freshFirst(cards, state.usedCardIds, ctx.rng),
    titlesNeeded(goal.each),
    DECK_CAP,
  );
  const pile = freshFirst(categories, state.usedCategoryIds, ctx.rng).slice(0, CATEGORY_CAP);
  const fresh: CliffhangerState = {
    ...state,
    phase: 'playing',
    goal: goalIdOf(settings),
    target: goal,
    rotation: {
      a: { order: membersOf(state, 'a'), next: 0 },
      b: { order: membersOf(state, 'b'), next: 0 },
    },
    collections: { a: [], b: [] },
    deck,
    categories: pile,
    discard: [],
    round: null,
    behind: { a: 0, b: 0 },
    log: [],
    seed: ctx.rng.int(SEED_RANGE),
    gamesPlayed: state.gamesPlayed + 1,
    winner: null,
    endReason: null,
  };
  return startRound(fresh, ctx.now);
}

function backToLobby(state: CliffhangerState, ctx: ActionCtx): Result {
  const no = requireHost(ctx);
  if (no) return no;
  return {
    ...state,
    phase: 'lobby',
    round: null,
    deck: [],
    categories: [],
    discard: [],
    collections: { a: [], b: [] },
    log: [],
    winner: null,
    endReason:
      state.phase === 'playing' ? 'abandoned' : state.phase === 'lobby' ? state.endReason : null,
  };
}

function pickCategory(state: CliffhangerState, id: string, ctx: ActionCtx): Result {
  const round = requireStage(state, 'pick-category');
  if (round instanceof GameError) return round;
  if (ctx.by !== round.pick?.by)
    return err('not-picker', 'The trailing team’s face-off player picks.');
  const chosen = round.pick.options.find((c) => c.id === id);
  if (!chosen) return err('bad-category', 'Pick one of the two categories.');
  return chooseCategory(state, chosen, ctx.now);
}

function chooseCategory(
  state: CliffhangerState,
  category: Category,
  now: number,
): CliffhangerState {
  return withRound(state, {
    stage: 'countdown',
    after: 'faceoff',
    stageEnds: now + COUNTDOWN_MS,
    pick: null,
    category,
  });
}

function faceOffOf(state: CliffhangerState): FaceOff | GameError {
  const round = requireStage(state, 'faceoff');
  if (round instanceof GameError) return round;
  return withoutPause(round.faceoff!);
}

/** A face-off saved while paused (rooms from before Doubt it was removed). */
type SavedFaceOff = FaceOff & { paused?: { left: number } | null };

/** The time a saved paused face-off had left, or null. */
function savedPause(round: Round): number | null {
  const fo: SavedFaceOff | null = round.faceoff;
  return round.stage === 'faceoff' && fo?.paused ? fo.paused.left : null;
}

function withoutPause(fo: FaceOff): FaceOff {
  const { paused: _paused, ...rest } = fo as SavedFaceOff;
  return rest;
}

const inPair = (round: Round, id: PlayerId) => round.pair.a === id || round.pair.b === id;
const partner = (round: Round, id: PlayerId) => (round.pair.a === id ? round.pair.b : round.pair.a);

function said(state: CliffhangerState, ctx: ActionCtx): Result {
  const fo = faceOffOf(state);
  if (fo instanceof GameError) return fo;
  const round = state.round!;
  if (!inPair(round, ctx.by)) return err('not-in-faceoff', 'Only the two face-off players answer.');
  if (fo.on !== null && fo.on !== ctx.by)
    return err('not-your-turn', 'It’s the other player’s go.');
  return withRound(state, {
    faceoff: {
      ...fo,
      on: partner(round, ctx.by),
      deadline: ctx.now + state.settings.answerSeconds * 1000,
      answers: fo.answers + 1,
      last: ctx.by,
      firstAt: fo.firstAt ?? ctx.now,
    },
  });
}

function newCategory(state: CliffhangerState, ctx: ActionCtx): Result {
  const fo = faceOffOf(state);
  if (fo instanceof GameError) return fo;
  if (!inPair(state.round!, ctx.by)) {
    return err('not-in-faceoff', 'Only the two face-off players can ask for a new category.');
  }
  if (fo.answers > 0) return err('answered', 'Too late: the face-off has started.');
  if (state.categories.length < 2) return err('no-other-category', 'There’s no other category.');
  return swapCategory(state, ctx.now);
}

function swapCategory(state: CliffhangerState, now: number): CliffhangerState {
  const fo = state.round!.faceoff!;
  const [category, s] = drawCategory(state);
  return withRound(s, {
    category,
    faceoff: {
      ...fo,
      flippedAt: now,
      deadline: s.settings.openingClock ? now + OPENING_MS : null,
      swaps: fo.swaps + 1,
    },
  });
}

function arrange(
  state: CliffhangerState,
  slots: (string | null)[],
  lockIt: boolean,
  ctx: ActionCtx,
): Result {
  const round = requireStage(state, 'keep', 'countdown', 'turn', 'recap');
  if (round instanceof GameError) return round;
  const hand = round.hands[ctx.by];
  if (!hand) return err('no-hand', 'You have no cards to place.');
  const offered = new Set(hand.offered.map((c) => c.id));
  const chosen = slots.filter((id): id is string => id !== null);
  if (chosen.some((id) => !offered.has(id)) || new Set(chosen).size !== chosen.length) {
    return err('bad-slots', 'Place each card once, from your own hand.');
  }
  const s = withRound(state, {
    hands: { ...round.hands, [ctx.by]: { ...hand, slots: [...slots] } },
  });
  return lockIt ? lockHand(s, ctx.by, ctx.now) : s;
}

function requireDescriber(state: CliffhangerState, ctx: ActionCtx): Round | GameError {
  const round = requireStage(state, 'turn');
  if (round instanceof GameError) return round;
  if (round.turn!.describer !== ctx.by)
    return err('not-describer', 'Only the describer can do that.');
  return round;
}

function slotOf(round: Round, card: string): { team: TeamId; slot: Slot } | null {
  for (const t of TEAMS) {
    const slot = round.board[t]?.find((x) => x.card.id === card);
    if (slot) return { team: t, slot };
  }
  return null;
}

function setSlot(round: Round, team: TeamId, card: string, patch: Partial<Slot>): Round['board'] {
  return {
    ...round.board,
    [team]: round.board[team]!.map((x) => (x.card.id === card ? { ...x, ...patch } : x)),
  };
}

function focus(state: CliffhangerState, card: string, ctx: ActionCtx): Result {
  const round = requireDescriber(state, ctx);
  if (round instanceof GameError) return round;
  const hit = slotOf(round, card);
  const turn = round.turn!;
  if (!hit || hit.slot.got || (hit.team !== turn.team && !turn.stealOpen)) {
    return err('bad-card', 'You can’t describe that one now.');
  }
  return withRound(state, { turn: { ...turn, focus: card } });
}

function got(state: CliffhangerState, card: string, ctx: ActionCtx): Result {
  const round = requireDescriber(state, ctx);
  if (round instanceof GameError) return round;
  const turn = round.turn!;
  const hit = slotOf(round, card);
  if (!hit || hit.slot.got) return err('bad-card', 'That card isn’t in play.');
  if (hit.team !== turn.team && !turn.stealOpen) {
    return err('steal-closed', 'Get your own three first, then you can steal.');
  }
  let s = withRound(state, {
    board: setSlot(round, hit.team, card, { got: turn.team, gotAt: ctx.now }),
    turn: { ...turn, gots: [...turn.gots, card] },
  });
  s = openSteal(s, ctx.now);
  const left = available(s);
  const next = left.own[0] ?? (s.round!.turn!.stealOpen ? left.steal[0] : undefined);
  s = withRound(s, { turn: { ...s.round!.turn!, focus: next?.card.id ?? null } });
  return left.own.length + (s.round!.turn!.stealOpen ? left.steal.length : 0) === 0
    ? endTurn(s, ctx.now)
    : s;
}

/** Once the describer's own three are got, the other team's cards are open (and locked in place). */
function openSteal(state: CliffhangerState, now: number): CliffhangerState {
  const turn = state.round!.turn!;
  if (turn.stealOpen || available(state).own.length) return state;
  const s = lockAll(state, now);
  return withRound(s, { turn: { ...s.round!.turn!, stealOpen: true } });
}

function undo(state: CliffhangerState, card: string, ctx: ActionCtx): Result {
  const round = requireDescriber(state, ctx);
  if (round instanceof GameError) return round;
  const turn = round.turn!;
  const hit = slotOf(round, card);
  if (turn.gots.at(-1) !== card || !hit || ctx.now - (hit.slot.gotAt ?? 0) > UNDO_MS) {
    return err('too-late', 'Too late to take that back.');
  }
  const stolen = hit.team !== turn.team;
  return withRound(state, {
    board: setSlot(round, hit.team, card, { got: null, gotAt: null }),
    turn: {
      ...turn,
      gots: turn.gots.slice(0, -1),
      focus: card,
      stealOpen: stolen || (turn.stealOpen && stolen),
    },
  });
}

function requireStealer(state: CliffhangerState, ctx: ActionCtx): TeamId | GameError {
  const round = requireStage(state, 'steal');
  if (round instanceof GameError) return round;
  const team = round.steal!.queue[0]!;
  if (teamOf(state, ctx.by) !== team) return err('not-your-steal', 'It’s the other team’s choice.');
  return team;
}

function steal3(state: CliffhangerState, genre: string, card: string, ctx: ActionCtx): Result {
  const team = requireStealer(state, ctx);
  if (team instanceof GameError) return team;
  if (!stealGenres(state, team).includes(genre)) {
    return err('bad-genre', 'You need three cards of that genre to trade.');
  }
  const theirs = state.collections[other(team)];
  const took = theirs.find((c) => c.id === card);
  if (!took) return err('bad-card', 'Pick one of the other team’s cards.');
  const mine = [...state.collections[team]];
  const gave: Card[] = [];
  for (let i = mine.length - 1; i >= 0 && gave.length < 3; i--) {
    if (mine[i]!.genre === genre) gave.push(...mine.splice(i, 1));
  }
  let s: CliffhangerState = {
    ...state,
    collections: {
      ...state.collections,
      [team]: [...mine, took],
      [other(team)]: theirs.filter((c) => c.id !== card),
    },
    discard: [...state.discard, ...gave],
  };
  s = withRound(s, { steals: [...s.round!.steals, { team, by: ctx.by, gave: genre, took }] });
  s = log(
    noteBehind(s),
    `${nameOf(s, ctx.by)} traded three ${genreInfo(genre, s.settings.deck).name} for “${took.title}”.`,
  );
  return checkWin(s, team) ?? nextSteal(s, ctx.now, true);
}

function pass(state: CliffhangerState, ctx: ActionCtx): Result {
  const team = requireStealer(state, ctx);
  if (team instanceof GameError) return team;
  return nextSteal(state, ctx.now, true);
}

/** The host, once a soft step's time is up, takes the safe choice for the slow ones. */
function skip(state: CliffhangerState, ctx: ActionCtx): Result {
  const no = requireHost(ctx);
  if (no) return no;
  const round = requireStage(state, 'pick-category', 'steal');
  if (round instanceof GameError) return round;
  const due = round.stage === 'steal' ? round.steal!.deadline : round.pick!.deadline;
  if (ctx.now < due) return err('not-yet', 'Give them until the clock runs out.');
  return fallback(state, ctx.now);
}

/** The safe choice for a soft step: a category picked at random, or no 3-for-1 steal. */
function fallback(state: CliffhangerState, now: number): CliffhangerState {
  const round = state.round!;
  if (round.stage === 'pick-category' && round.pick) {
    const [rng, s] = seeded(state);
    return chooseCategory(s, round.pick.options[rng.int(round.pick.options.length)]!, now);
  }
  if (round.stage === 'steal') return nextSteal(state, now, true);
  return state;
}

function onCall(state: CliffhangerState, on: boolean, ctx: ActionCtx): Result {
  const seat = state.seats[ctx.by];
  if (!seat) return err('not-seated', 'You are not in this game.');
  return { ...state, seats: { ...state.seats, [ctx.by]: { ...seat, onCall: on } } };
}

/** Keeps the pack list up to date between games: packs switched off drop out of the selection. */
function refreshPacks(state: CliffhangerState, content: ContentProvider): CliffhangerState {
  if (state.phase === 'playing') return state;
  const packs = packsOf(content);
  const offered = new Set(packs.map((p) => p.id));
  const kept = state.settings.packIds.filter((id) => offered.has(id));
  const packIds = kept.length ? kept : packs.map((p) => p.id);
  const same =
    packIds.length === state.settings.packIds.length &&
    packIds.every((id, i) => id === state.settings.packIds[i]);
  const settings = same ? state.settings : { ...state.settings, packIds };
  return { ...state, packs, settings, genreCounts: genreCounts(content, settings) };
}

export function reduce(state: CliffhangerState, action: CliffhangerAction, ctx: ActionCtx): Result {
  const s = refreshPacks(state, ctx.content);
  switch (action.type) {
    case 'update-settings':
      return updateSettings(s, action, ctx);
    case 'table-volume': {
      // The host's sliders for the table screen: any time, mid-game too.
      const no = requireHost(ctx);
      if (no) return no;
      return {
        ...s,
        settings: {
          ...s.settings,
          tableVolumes: { ...s.settings.tableVolumes, ...action.volumes },
        },
      };
    }
    case 'team':
      return chooseTeam(s, action.team, ctx);
    case 'shuffle-teams':
      return shuffleTeams(s, ctx);
    case 'on-call':
      return onCall(s, action.onCall, ctx);
    case 'start':
      return start(s, ctx);
    case 'back-to-lobby':
      return backToLobby(s, ctx);
    case 'pick-category':
      return pickCategory(s, action.id, ctx);
    case 'new-category':
      return newCategory(s, ctx);
    case 'said':
      return said(s, ctx);
    case 'arrange':
      return arrange(s, action.slots, false, ctx);
    case 'lock':
      return arrange(
        s,
        action.slots ?? s.round?.hands[ctx.by]?.slots ?? [null, null, null],
        true,
        ctx,
      );
    case 'focus':
      return focus(s, action.card, ctx);
    case 'got':
      return got(s, action.card, ctx);
    case 'undo':
      return undo(s, action.card, ctx);
    case 'steal':
      return steal3(s, action.genre, action.card, ctx);
    case 'pass':
      return pass(s, ctx);
    case 'skip':
      return skip(s, ctx);
  }
}

// ---- Players coming and going ----

export function defaultSettings(packs: readonly PackSummary[]): Settings {
  return {
    deck: 'films',
    goal: 'base',
    mode: 'room',
    mixStyles: ['one-word', 'quote', 'act'],
    mixFresh: false,
    packIds: packs.map((p) => p.id),
    answerSeconds: 15,
    turnSeconds: 30,
    noSequels: false,
    newWordsOnly: false,
    noAdvantage: false,
    comebackPick: false,
    suddenDeath: false,
    openingClock: false,
    timerMode: 'soft',
    sound: 'host',
    soundChosen: false,
    tableVolumes: {},
  };
}

export function create(ctx: CreateCtx, players: readonly PlayerInfo[]): CliffhangerState {
  const packs = packsOf(ctx.content);
  let state: CliffhangerState = {
    phase: 'lobby',
    settings: defaultSettings(packs),
    seats: {},
    packs,
    goal: 'base',
    rotation: { a: { order: [], next: 0 }, b: { order: [], next: 0 } },
    collections: { a: [], b: [] },
    deck: [],
    categories: [],
    discard: [],
    round: null,
    behind: { a: 0, b: 0 },
    log: [],
    usedCardIds: [],
    usedCategoryIds: [],
    seed: ctx.rng.int(SEED_RANGE),
    gamesPlayed: 0,
    winner: null,
    endReason: null,
  };
  for (const p of players) state = playerJoined(state, p);
  return state;
}

/** Newcomers join the smaller team (at the end of its rotation mid-game), or watch at a full table. */
export function playerJoined(state: CliffhangerState, player: PlayerInfo): CliffhangerState {
  const existing = state.seats[player.id];
  if (existing) {
    return { ...state, seats: { ...state.seats, [player.id]: { ...existing, name: player.name } } };
  }
  const full = seatedIds(state).length >= MAX_PLAYERS;
  const team: TeamId | null = full
    ? null
    : membersOf(state, 'b').length < membersOf(state, 'a').length
      ? 'b'
      : 'a';
  let s: CliffhangerState = {
    ...state,
    seats: { ...state.seats, [player.id]: { name: player.name, team, onCall: false } },
  };
  if (state.phase === 'playing' && team) {
    s = {
      ...s,
      rotation: {
        ...s.rotation,
        [team]: { ...s.rotation[team], order: [...s.rotation[team].order, player.id] },
      },
    };
  }
  return s;
}

/** Swaps one player for another wherever the round names them. */
function replaceIn(round: Round, from: PlayerId, to: PlayerId): Round {
  const swap = (id: PlayerId | null) => (id === from ? to : id);
  const hands = { ...round.hands };
  if (hands[from]) {
    hands[to] = hands[from];
    delete hands[from];
  }
  const fo = round.faceoff;
  return {
    ...round,
    pair: { a: swap(round.pair.a)!, b: swap(round.pair.b)! },
    hands,
    pick: round.pick && { ...round.pick, by: swap(round.pick.by)! },
    faceoff: fo && {
      ...fo,
      on: swap(fo.on),
      last: swap(fo.last),
    },
    faceoffResult: round.faceoffResult && {
      ...round.faceoffResult,
      winner: swap(round.faceoffResult.winner)!,
      loser: swap(round.faceoffResult.loser)!,
    },
    turn: round.turn && { ...round.turn, describer: swap(round.turn.describer)! },
  };
}

/**
 * A leaver drops out of their team's rotation. A face-off player or describer is replaced by the
 * next teammate in the rotation, who takes their cards and clock; a team below two ends the game.
 */
export function playerLeft(
  state: CliffhangerState,
  playerId: PlayerId,
  _now: number,
): CliffhangerState {
  const seat = state.seats[playerId];
  if (!seat) return state;
  const seats = { ...state.seats };
  delete seats[playerId];
  let s: CliffhangerState = { ...state, seats };
  const team = seat.team;
  if (state.phase !== 'playing' || !team) return s;
  const rot = s.rotation[team];
  const at = rot.order.indexOf(playerId);
  const order = rot.order.filter((id) => id !== playerId);
  let next = at >= 0 && at < rot.next % Math.max(1, rot.order.length) ? rot.next - 1 : rot.next;
  if (membersOf(s, team).length < MIN_TEAM || order.length === 0) {
    return endGame({ ...s, rotation: { ...s.rotation, [team]: { order, next } } }, 'too-few');
  }
  const round = s.round;
  if (round && round.pair[team] === playerId) {
    const stand = order[next % order.length]!;
    next += 1;
    s = { ...s, round: replaceIn(round, playerId, stand) };
    s = log(s, `${nameOf(s, stand)} takes over for ${seat.name}.`);
  }
  return { ...s, rotation: { ...s.rotation, [team]: { order, next } } };
}

// ---- Timers ----

export function nextDeadline(state: CliffhangerState): number | null {
  const round = state.round;
  if (state.phase !== 'playing' || !round) return null;
  const times: number[] = Object.values(round.hands).map((h) => h!.deadline);
  if (round.stageEnds !== null) times.push(round.stageEnds);
  if (round.stage === 'faceoff' && round.faceoff?.deadline) times.push(round.faceoff.deadline);
  // A face-off saved while paused resumes at once.
  if (savedPause(round) !== null) times.push(round.faceoff!.flippedAt);
  if (round.stage === 'turn' && round.turn) times.push(round.turn.endsAt);
  const strict = state.settings.timerMode === 'strict';
  if (strict && round.stage === 'pick-category' && round.pick) times.push(round.pick.deadline);
  if (strict && round.stage === 'steal' && round.steal) times.push(round.steal.deadline);
  return times.length ? Math.min(...times) : null;
}

export function onDeadline(state: CliffhangerState, now: number): CliffhangerState {
  let s = state;
  // Several clocks can be due at once (a hand and the stage): handle each in turn.
  for (let i = 0; i < 6; i++) {
    const due = nextDeadline(s);
    if (due === null || now < due || s.phase !== 'playing') return s;
    s = step(s, now);
  }
  return s;
}

function step(state: CliffhangerState, now: number): CliffhangerState {
  const round = state.round!;
  const late = Object.entries(round.hands).find(([, h]) => h!.deadline <= now);
  if (late) return lockHand(state, late[0], now);
  const left = savedPause(round);
  if (left !== null) {
    return withRound(state, { faceoff: { ...withoutPause(round.faceoff!), deadline: now + left } });
  }
  if (round.stageEnds !== null && round.stageEnds <= now) {
    if (round.stage === 'countdown') {
      return round.after === 'turn' ? beginTurn(state, now) : flip(state, now);
    }
    if (round.stage === 'recap') {
      return withRound(state, { stage: 'countdown', after: 'turn', stageEnds: now + COUNTDOWN_MS });
    }
  }
  if (round.stage === 'faceoff' && round.faceoff?.deadline && round.faceoff.deadline <= now) {
    const fo = round.faceoff;
    // Nobody answered within the opening clock: a new category, the same pair.
    if (fo.on === null) return swapCategory(state, now);
    return decideFaceOff(state, partner(round, fo.on), 'time', now);
  }
  if (round.stage === 'turn' && round.turn && round.turn.endsAt <= now) return endTurn(state, now);
  return fallback(state, now);
}
