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
import { z } from 'zod';
import {
  COLOURS,
  type CardId,
  DECK,
  type Position,
  TOP_TRUMP,
  isCard,
  isTrump,
  legalCards,
  matches,
  signalPositions,
  suitOf,
  winningIndex,
} from './cards.ts';
import { type Check, type Table, captainCannot, evaluate, predictionOf } from './checks.ts';
import { mustRedraw } from './conflicts.ts';
import {
  type AttemptComms,
  type MissionDef,
  type TaskCard,
  type Voyage,
  taskCards,
  voyages,
} from './content.ts';
import {
  type Attempt,
  BRIEFING_SECONDS,
  type Campaign,
  DUMMY,
  type DraftState,
  EPILOGUE,
  HOLD_SECONDS,
  MAX_EMOTES,
  MAX_SEATED,
  MAX_USED_TASKS,
  MIN_PLAYERS,
  type MissionControlAction,
  type MissionControlState,
  type MissionLog,
  type MissionPlay,
  type MissionSummary,
  type Result,
  type Settings,
  type TaskInPlay,
  type VoyageSummary,
} from './types.ts';

type Ctx = ActionCtx;
type Result_ = MissionControlState | GameError;

const SEED_RANGE = 0x1_0000_0000;
const err = (code: string, message: string) => new GameError(code, message);

// ---- Test rig (browser tests only) ----

export interface TestDeal {
  /** Hands by seat order (the dummy's 14: the first 7 face down, then 7 face up). */
  hands?: CardId[][];
  /** Task ids (the part after the pack id) to use instead of a draw. */
  tasks?: string[];
}

let testDeal: TestDeal | null = null;
/** Test servers only: fix every deal's hands and tasks, so a browser test knows the table. */
export function setTestDeal(deal: TestDeal | null): void {
  testDeal = deal;
}

/** Parses `MISSION_CONTROL_TEST_DEAL`: `hands=p1 p2 …|b1 …|…;tasks=3,7`. */
export function parseTestDeal(raw: string): TestDeal {
  const out: TestDeal = {};
  for (const part of raw.split(';')) {
    const [k, v = ''] = part.split('=');
    if (k?.trim() === 'hands')
      out.hands = v.split('|').map((h) =>
        h
          .trim()
          .split(/[\s,]+/)
          .filter(isCard),
      );
    if (k?.trim() === 'tasks')
      out.tasks = v
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
  }
  return out;
}

// ---- Seats and the table ----

export function humans(state: MissionControlState): PlayerId[] {
  return Object.entries(state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));
}

/** Seat order: the seated players, and the dummy where the crew put it (two players). */
export function crewOrder(players: readonly string[], dummyAfter: 0 | 1): string[] {
  if (players.length !== 2) return [...players];
  const out = [...players];
  out.splice(dummyAfter + 1, 0, DUMMY);
  return out;
}

/** The difficulty column for a table: three players' for two (the dummy makes three). */
export const sizeOf = (crew: number): 3 | 4 | 5 => (crew <= 3 ? 3 : crew === 4 ? 4 : 5);
export const tricksFor = (crew: number) => Math.floor(DECK.length / Math.max(3, crew));

/** Who plays the seat: the captain plays the dummy. */
export const controller = (a: Attempt, seat: string) => (seat === DUMMY ? a.captain : seat);
/** Seats a player acts for. */
export const controls = (a: Attempt, id: string) => [
  ...(a.crew.includes(id) ? [id] : []),
  ...(a.crew.includes(DUMMY) && a.captain === id ? [DUMMY] : []),
];

/** A seat's cards it may choose from: the dummy only shows its face-up row. */
export function playable(a: Attempt, seat: string): CardId[] {
  if (seat === DUMMY && a.dummy) return a.dummy.up.filter((c): c is CardId => c !== null);
  return a.hands[seat] ?? [];
}

const nextSeat = (a: Attempt, seat: string, step = 1) =>
  a.crew[(a.crew.indexOf(seat) + step + a.crew.length) % a.crew.length]!;

/** Seats from `from` round the table, `from` first. */
const rotate = (crew: readonly string[], from: string) => {
  const i = crew.indexOf(from);
  return [...crew.slice(i), ...crew.slice(0, i)];
};

// ---- Campaign ----

const emptyLog = (): MissionLog => ({
  attempts: 0,
  distress: false,
  done: null,
  crew: [],
  practice: 0,
  practised: false,
});

export function newCampaign(key: string, now: number, epilogue: number): Campaign {
  return {
    key,
    started: now,
    finished: null,
    members: {},
    log: {},
    epilogue: { level: epilogue, successes: 0, attempts: 0, distress: 0 },
  };
}

/** The next mission in order: the first not yet done, else the epilogue. */
export function nextMission(campaign: Campaign | undefined, voyage: VoyageSummary): number {
  for (const m of voyage.missions) if (!campaign?.log[m.n]?.done) return m.n;
  return voyage.epilogue ? EPILOGUE : voyage.missions.at(-1)!.n;
}

function summarise(v: Voyage): VoyageSummary {
  return {
    key: v.key,
    packId: v.packId,
    name: v.name ?? v.key,
    missions: v.missions.map((m): MissionSummary => ({
      n: m.n,
      title: m.title ?? null,
      difficulty: m.difficulty,
      comms: m.comms,
      selection: m.selection,
      timed: !!m.timer,
      fixed: m.difficulty === null,
    })),
    epilogue: v.epilogue
      ? { difficulty: v.epilogue.difficulty, title: v.epilogue.title ?? null }
      : null,
  };
}

/** Re-reads the voyages on offer (lobby actions), keeping a valid choice. */
function refresh(state: MissionControlState, content: ContentProvider): MissionControlState {
  const list = voyages(content).map(summarise);
  const keep = list.some((v) => v.key === state.settings.voyageKey);
  return {
    ...state,
    voyages: list,
    settings: {
      ...state.settings,
      voyageKey: keep ? state.settings.voyageKey : (list[0]?.key ?? null),
    },
  };
}

export const voyageOf = (state: MissionControlState) =>
  state.voyages.find((v) => v.key === state.settings.voyageKey) ?? null;

// ---- The state carried into a linked room ("Same crew, new game") ----

const campaignSchema = z.object({
  key: z.string().max(40),
  started: z.number(),
  finished: z.number().nullable(),
  members: z.record(z.string(), z.string()),
  log: z.record(
    z.string(),
    z.object({
      attempts: z.number().int().min(0),
      distress: z.boolean(),
      done: z.number().nullable(),
      crew: z.array(z.string()),
      practice: z.number().int().min(0),
      practised: z.boolean(),
    }),
  ),
  epilogue: z.object({
    level: z.number().int(),
    successes: z.number().int(),
    attempts: z.number().int(),
    distress: z.number().int(),
  }),
});
const carriedSchema = z.object({ campaigns: z.record(z.string(), campaignSchema) });

export const carry = (state: MissionControlState) => ({ campaigns: state.campaigns });

// ---- Create and seats ----

export function create(ctx: CreateCtx, players: readonly PlayerInfo[]): MissionControlState {
  const carried = carriedSchema.safeParse(ctx.carried);
  let state: MissionControlState = {
    phase: 'lobby',
    settings: {
      voyageKey: null,
      playedCards: true,
      realTime: true,
      openTable: false,
      dummyAfter: 1,
    },
    seats: {},
    voyages: [],
    campaigns: carried.success ? carried.data.campaigns : {},
    chosen: null,
    attempt: null,
    usedTasks: [],
    seed: ctx.rng.int(SEED_RANGE),
    emotes: [],
    notice: null,
    attemptsPlayed: 0,
  };
  state = refresh(state, ctx.content);
  for (const p of players) state = playerJoined(state, p);
  return state;
}

export function playerJoined(state: MissionControlState, player: PlayerInfo): MissionControlState {
  const existing = state.seats[player.id];
  if (existing) {
    if (existing.name === player.name) return state;
    return { ...state, seats: { ...state.seats, [player.id]: { ...existing, name: player.name } } };
  }
  const playing = state.phase === 'lobby' && humans(state).length < MAX_SEATED;
  return { ...state, seats: { ...state.seats, [player.id]: { name: player.name, playing } } };
}

export function playerLeft(state: MissionControlState, playerId: PlayerId): MissionControlState {
  if (!state.seats[playerId]) return state;
  const { [playerId]: gone, ...seats } = state.seats;
  let next: MissionControlState = { ...state, seats };
  const a = state.attempt;
  if (a && a.crew.includes(playerId) && a.stage !== 'done') {
    next = {
      ...next,
      phase: 'lobby',
      attempt: null,
      notice: `${gone!.name} left, so the attempt stopped. It doesn't count.`,
    };
  }
  return next;
}

// ---- Drawing tasks ----

function canHoldTwo(m: MissionPlay, crew: number, count: number): boolean {
  if (
    m.selection !== 'normal' &&
    m.selection !== 'captain-skips' &&
    m.selection !== 'hardest-first'
  )
    return true;
  return count > crew - (m.selection === 'captain-skips' ? 1 : 0);
}

const asTask = (c: TaskCard, size: 3 | 4 | 5): TaskInPlay => ({
  key: c.key,
  check: c.check,
  text: c.text,
  difficulty: c.difficulty[size],
  owner: null,
  crew: false,
  prediction: null,
  state: 'open',
  progress: null,
  why: null,
  at: null,
  fedBy: [],
});

/**
 * Task cards to exactly `target` difficulty: unused ones first, skipping any card that would
 * overshoot; a card that can't be met alongside an earlier one goes back for one of the same
 * difficulty.
 */
export function drawTasks(
  pool: readonly TaskCard[],
  used: readonly string[],
  target: number,
  size: 3 | 4 | 5,
  mission: MissionPlay,
  crew: number,
  rng: Rng,
): { cards: TaskCard[]; redraws: number } {
  const total = tricksFor(crew);
  let best: { cards: TaskCard[]; redraws: number } = { cards: [], redraws: 0 };
  for (let attempt = 0; attempt < 30; attempt++) {
    const fresh = rng.shuffle(pool.filter((c) => !used.includes(c.key)));
    const old = rng.shuffle(pool.filter((c) => used.includes(c.key)));
    const deck = [...fresh, ...old];
    const cards: TaskCard[] = [];
    let sum = 0;
    let redraws = 0;
    while (sum < target && deck.length) {
      const c = deck.shift()!;
      if (sum + c.difficulty[size] > target) continue;
      cards.push(c);
      sum += c.difficulty[size];
    }
    // Redraw clashing pairs, latest first revealed (judged with the final count of tasks).
    for (let i = 1; i < cards.length; i++) {
      const earlier = cards.slice(0, i).map((c) => c.check);
      const holdTwo = canHoldTwo(mission, crew, cards.length);
      if (!mustRedraw(earlier, cards[i]!.check, total, holdTwo)) continue;
      const d = cards[i]!.difficulty[size];
      const swap = deck.findIndex(
        (c) => c.difficulty[size] === d && !mustRedraw(earlier, c.check, total, holdTwo),
      );
      redraws++;
      if (swap < 0) {
        cards.splice(i, 1);
        i--;
        sum -= d;
        continue;
      }
      cards[i] = deck.splice(swap, 1)[0]!;
    }
    if (sum === target) return { cards, redraws };
    if (
      cards.reduce((s, c) => s + c.difficulty[size], 0) >
      best.cards.reduce((s, c) => s + c.difficulty[size], 0)
    )
      best = { cards, redraws };
  }
  return best;
}

// ---- The deal ----

function deal(crew: readonly string[], rng: Rng) {
  const hands: Record<string, CardId[]> = Object.fromEntries(crew.map((s) => [s, []]));
  let dummy: Attempt['dummy'] = null;
  if (testDeal?.hands && testDeal.hands.length === crew.length) {
    crew.forEach((s, i) => (hands[s] = [...testDeal!.hands![i]!]));
    if (crew.includes(DUMMY)) {
      const d = hands[DUMMY]!;
      dummy = { down: d.slice(0, 7), up: d.slice(7, 14) };
    }
    return { hands, dummy };
  }
  if (crew.includes(DUMMY)) {
    const rest = rng.shuffle(DECK.filter((c) => c !== TOP_TRUMP));
    const down = rest.splice(0, 7);
    const up = rest.splice(0, 7);
    dummy = { down, up };
    hands[DUMMY] = [...down, ...up];
    const people = crew.filter((s) => s !== DUMMY);
    const deck = rng.shuffle([...rest, TOP_TRUMP]);
    deck.forEach((c, i) => hands[people[i % people.length]!]!.push(c));
    return { hands, dummy };
  }
  rng.shuffle(DECK).forEach((c, i) => hands[crew[i % crew.length]!]!.push(c));
  return { hands, dummy };
}

/** A task's printed re-deal rule: one hand holds every card of one of its sets. */
const needsRedeal = (hands: Record<string, CardId[]>, tasks: readonly { reDeal?: CardId[][] }[]) =>
  tasks.some((t) =>
    (t.reDeal ?? []).some((set) =>
      Object.values(hands).some((h) => set.every((c) => h.includes(c))),
    ),
  );

const captainOf = (hands: Record<string, CardId[]>) =>
  Object.entries(hands).find(([, h]) => h.includes(TOP_TRUMP))![0];

// ---- Starting an attempt ----

function missionDef(voyage: Voyage | undefined, n: number): MissionDef | null {
  return voyage?.missions.find((m) => m.n === n) ?? null;
}

function missionPlay(
  state: MissionControlState,
  voyage: Voyage,
  n: number,
  practice: boolean,
): MissionPlay | null {
  if (n === EPILOGUE) {
    if (!voyage.epilogue) return null;
    const campaign = state.campaigns[voyage.key];
    return {
      n,
      title: voyage.epilogue.title ?? null,
      rule: voyage.epilogue.rule ?? null,
      story: voyage.epilogue.story ?? null,
      fresh: null,
      difficulty: campaign?.epilogue.level ?? voyage.epilogue.difficulty,
      comms: 'normal',
      commsFrom: null,
      selection: 'free',
      wanted: 1,
      seconds: null,
      practice: false,
    };
  }
  const def = missionDef(voyage, n);
  if (!def) return null;
  const timed = !!def.timer && state.settings.realTime;
  const untimed = def.timer && !timed ? def.timer.untimed : {};
  return {
    n,
    title: def.title ?? null,
    rule: def.rule ?? null,
    story: def.story ?? null,
    fresh: def.fresh ?? null,
    difficulty: untimed.difficulty ?? def.difficulty,
    comms: untimed.comms ?? def.comms,
    commsFrom: def.commsFrom ?? null,
    selection: def.selection,
    wanted: def.wanted ?? 1,
    seconds: timed ? def.timer!.seconds : null,
    practice,
  };
}

const emptyDraft = (): DraftState => ({
  order: [],
  at: 0,
  round: 0,
  passed: [],
  answers: {},
  chosen: [],
  ready: [],
  given: false,
});

/**
 * Deals a new attempt at a mission: tasks (drawn, the mission's own, or the same as last time),
 * the cards, and the captain. New missions open on the briefing; retries go straight to the draft.
 */
function begin(
  state: MissionControlState,
  ctx: Ctx,
  n: number,
  opts: { practice: boolean; same?: TaskInPlay[]; briefing: boolean },
): Result_ {
  const voyage = voyages(ctx.content).find((v) => v.key === state.settings.voyageKey);
  if (!voyage) return err('no-voyage', 'No campaign is loaded yet. Ask the admin to import it.');
  const mission = missionPlay(state, voyage, n, opts.practice);
  if (!mission) return err('no-mission', 'That mission is not in the logbook.');
  const players = humans(state);
  if (players.length < MIN_PLAYERS)
    return err('too-few', `At least ${MIN_PLAYERS} players must sit down.`);
  const crew = crewOrder(players, state.settings.dummyAfter);
  const size = sizeOf(crew.length);
  const total = tricksFor(crew.length);
  const rng = createRng(state.seed);

  // Tasks first: some decide whether the cards must be dealt again.
  let tasks: TaskInPlay[];
  let redraws = 0;
  const def = n === EPILOGUE ? null : missionDef(voyage, n);
  const pool = taskCards(ctx.content);
  const reDeals: { reDeal?: CardId[][] }[] = [];
  if (opts.same) {
    tasks = opts.same.map((t) => ({
      ...t,
      owner: null,
      prediction: null,
      state: 'open' as const,
      progress: null,
      why: null,
      at: null,
      fedBy: [],
    }));
    for (const t of tasks)
      reDeals.push({ reDeal: pool.find((c) => c.key === t.key)?.reDeal ?? [] });
  } else if (def?.fixedTasks?.length || def?.conditions?.length) {
    tasks = [
      ...(def.fixedTasks ?? []).map((f, i) => ({
        ...asTask(
          {
            key: `fixed:${i}`,
            check: f.check,
            text: f.text,
            difficulty: { 3: 0, 4: 0, 5: 0 },
            reDeal: [],
          },
          size,
        ),
      })),
      ...(def.conditions ?? []).map((f, i) => ({
        ...asTask(
          {
            key: `crew:${i}`,
            check: f.check,
            text: f.text,
            difficulty: { 3: 0, 4: 0, 5: 0 },
            reDeal: [],
          },
          size,
        ),
        crew: true,
      })),
    ];
  } else if (mission.difficulty !== null) {
    let cards: TaskCard[];
    if (testDeal?.tasks) {
      cards = testDeal.tasks.flatMap((id) =>
        pool.filter((c) => c.key.endsWith(`:${id}`)).slice(0, 1),
      );
    } else {
      if (!pool.length)
        return err('no-tasks', 'No task cards are loaded yet. Ask the admin to import them.');
      ({ cards, redraws } = drawTasks(
        pool,
        state.usedTasks,
        mission.difficulty,
        size,
        mission,
        crew.length,
        rng,
      ));
    }
    tasks = cards.map((c) => asTask(c, size));
    reDeals.push(...cards);
  } else {
    tasks = [];
  }

  // The deal, again while a task's printed re-deal rule applies.
  let dealt = deal(crew, rng);
  let redeals = 0;
  while (!testDeal?.hands && needsRedeal(dealt.hands, reDeals) && redeals < 50) {
    dealt = deal(crew, rng);
    redeals++;
  }
  const captain = captainOf(dealt.hands);
  // A comparison with the captain can't stay where the mission may force every task (or the
  // hardest) onto the captain: it is replaced by one of the same difficulty, as the rulebook does
  // with tasks that can't be met.
  if (
    !opts.same &&
    !testDeal?.tasks &&
    mission.difficulty !== null &&
    def &&
    !def.fixedTasks?.length
  ) {
    const forced =
      mission.selection === 'captain-offers' ||
      (mission.selection === 'crew-wanted' && mission.wanted === 1) ||
      mission.selection === 'hardest-first';
    if (forced) {
      tasks = tasks.map((t) => {
        if (!captainCannot(t.check)) return t;
        const swap = pool.find(
          (c) =>
            c.difficulty[size] === t.difficulty &&
            !captainCannot(c.check) &&
            !tasks.some((x) => x.key === c.key),
        );
        if (!swap) return t;
        redraws++;
        return asTask(swap, size);
      });
    }
  }

  // Unfamiliar terrain: a random colour card sets this attempt's signals.
  let terrain: CardId | null = null;
  let comms: AttemptComms;
  if (mission.comms === 'terrain') {
    const colours = DECK.filter((c) => !isTrump(c));
    terrain = colours[rng.int(colours.length)]!;
    const v = Number(terrain.slice(1));
    comms = v <= 3 ? 'normal' : v <= 6 ? 'currents' : 'rapture';
  } else {
    comms = mission.comms;
  }

  const log = n === EPILOGUE ? null : state.campaigns[voyage.key]?.log[n];
  const number =
    n === EPILOGUE
      ? (state.campaigns[voyage.key]?.epilogue.attempts ?? 0) + 1
      : (opts.practice ? (log?.practice ?? 0) : (log?.attempts ?? 0)) + 1;

  const attempt: Attempt = {
    mission,
    number,
    stage: 'briefing',
    crew,
    captain,
    hands: dealt.hands,
    dealt: structuredClone(dealt.hands),
    dummy: dealt.dummy,
    total,
    tasks,
    draft: emptyDraft(),
    terrain,
    comms,
    tokens: comms === 'rapture' || comms === 'none' ? [] : crew.filter((s) => s !== DUMMY),
    pool: comms === 'rapture' ? crew.length - 2 : 0,
    signals: [],
    holds: [],
    holdSince: null,
    distress: {
      proposal: null,
      accepted: [],
      dive: [],
      used: false,
      dir: null,
      passes: {},
      received: {},
    },
    tricks: [],
    current: [],
    turn: captain,
    ready: [],
    deadline: opts.briefing ? ctx.now + BRIEFING_SECONDS * 1000 : null,
    startedAt: ctx.now,
    playStartedAt: null,
    result: null,
    redeals,
    redraws,
  };
  const usedTasks = [
    ...state.usedTasks.filter((k) => !tasks.some((t) => t.key === k)),
    ...tasks
      .filter((t) => !t.key.startsWith('fixed:') && !t.key.startsWith('crew:'))
      .map((t) => t.key),
  ].slice(-MAX_USED_TASKS);
  const campaigns = { ...state.campaigns };
  if (!campaigns[voyage.key]) {
    campaigns[voyage.key] = newCampaign(voyage.key, ctx.now, voyage.epilogue?.difficulty ?? 18);
  }
  const next: MissionControlState = {
    ...state,
    phase: 'playing',
    campaigns,
    attempt,
    usedTasks,
    seed: rng.int(SEED_RANGE),
    emotes: [],
    notice: null,
  };
  return opts.briefing ? next : withAttempt(next, enterDraft(attempt));
}

const withAttempt = (state: MissionControlState, a: Attempt): MissionControlState => ({
  ...state,
  attempt: a,
});

// ---- The draft ----

const toAssign = (a: Attempt) => a.tasks.filter((t) => !t.crew);
const unassigned = (a: Attempt) =>
  a.tasks.flatMap((t, i) => (!t.crew && t.owner === null ? [i] : []));

function enterDraft(a: Attempt): Attempt {
  const draft = emptyDraft();
  const m = a.mission;
  if (m.selection === 'crew-wanted')
    draft.order = [...rotate(a.crew, a.captain).slice(1), a.captain];
  else if (m.selection === 'captain-offers') draft.order = rotate(a.crew, a.captain).slice(1);
  else if (m.selection === 'captain-skips')
    draft.order = rotate(a.crew, a.captain).filter((s) => s !== a.captain);
  else draft.order = rotate(a.crew, a.captain);
  const next: Attempt = { ...a, stage: 'draft', draft, deadline: null };
  return toAssign(next).length === 0 ? enterDistress(next) : next;
}

/** The normal draft: whose pick it is. */
const picker = (a: Attempt) => a.draft.order[a.draft.at % a.draft.order.length]!;

/** Normal draft: whether the seat on turn may pass. */
export function canPass(a: Attempt): boolean {
  if (a.stage !== 'draft' || !isRoundRobin(a)) return false;
  const seat = picker(a);
  const left = unassigned(a);
  if (seat === a.captain && left.every((i) => captainCannot(a.tasks[i]!.check))) return true;
  const n = toAssign(a).length;
  if (n >= a.draft.order.length) return false;
  // One round only: the tasks left must still fit the pickers after this one.
  const after = a.draft.order.length - 1 - a.draft.at;
  return after >= 0 && left.length <= after;
}

const isRoundRobin = (a: Attempt) =>
  a.mission.selection === 'normal' ||
  a.mission.selection === 'captain-skips' ||
  a.mission.selection === 'hardest-first';

/** Whether `seat` may hold task `i` (the captain never holds a comparison with the captain). */
function mayHold(a: Attempt, seat: string, i: number): GameError | null {
  const t = a.tasks[i];
  if (!t || t.crew) return err('no-task', 'There is no such task.');
  if (seat === a.captain && captainCannot(t.check))
    return err('captain-cannot', 'The captain can’t take a task that compares with the captain.');
  return null;
}

function hardestFirst(a: Attempt, seat: string, i: number): GameError | null {
  if (a.mission.selection !== 'hardest-first' || seat !== a.captain) return null;
  if (a.tasks.some((t) => t.owner !== null)) return null;
  const options = toAssign(a).filter((t) => !captainCannot(t.check));
  const top = Math.max(...options.map((t) => t.difficulty));
  if (a.tasks[i]!.difficulty < top)
    return err('hardest-first', 'The captain must first take the hardest task on show.');
  return null;
}

const assign = (a: Attempt, i: number, owner: string | null): Attempt => ({
  ...a,
  tasks: a.tasks.map((t, j) => (j === i ? { ...t, owner } : t)),
  draft: { ...a.draft, ready: [] },
});

/** After a pick or a pass in the normal draft: the next picker, or the end of the draft. */
function advancePick(a: Attempt): Attempt {
  if (unassigned(a).length === 0) return enterDistress(a);
  let next = { ...a, draft: { ...a.draft, at: a.draft.at + 1 } };
  // Skip a captain who may hold none of what is left.
  for (let i = 0; i < next.draft.order.length; i++) {
    const seat = picker(next);
    if (seat !== next.captain || unassigned(next).some((j) => !captainCannot(next.tasks[j]!.check)))
      break;
    next = { ...next, draft: { ...next.draft, at: next.draft.at + 1 } };
  }
  return next;
}

function lockable(a: Attempt): boolean {
  if (unassigned(a).length) return false;
  if (a.mission.selection !== 'crew-wanted' || a.mission.wanted < 2) return true;
  // Each volunteer takes at least one, when there are enough they may hold.
  const able = a.draft.chosen.filter((s) =>
    toAssign(a).some((t) => !(s === a.captain && captainCannot(t.check))),
  );
  return toAssign(a).length < able.length || able.every((s) => a.tasks.some((t) => t.owner === s));
}

// ---- Distress, the pass and predictions ----

function enterDistress(a: Attempt): Attempt {
  return {
    ...a,
    stage: 'distress',
    distress: {
      proposal: null,
      accepted: [],
      dive: [],
      used: false,
      dir: null,
      passes: {},
      received: {},
    },
    ready: [],
  };
}

/** Seats that can pass a card (a colour card; the dummy's must be face up). */
const canGive = (a: Attempt, seat: string) => playable(a, seat).some((c) => !isTrump(c));

const needsPrediction = (a: Attempt) =>
  a.tasks.some((t) => t.owner !== null && predictionOf(t.check) && t.prediction === null);

function afterDistress(a: Attempt, now: number): Attempt {
  return needsPrediction(a) ? { ...a, stage: 'predict' } : enterPlay(a, now);
}

function doPass(a: Attempt): Attempt {
  const hands = structuredClone(a.hands);
  const dummy = a.dummy && { up: [...a.dummy.up], down: [...a.dummy.down] };
  const received: Record<string, CardId> = {};
  const moves = a.crew.map((seat) => ({
    from: seat,
    to: nextSeat(a, seat, a.distress.dir === 'left' ? 1 : -1),
    card: a.distress.passes[seat]!,
  }));
  const slots: Record<string, number> = {};
  for (const m of moves) {
    hands[m.from] = hands[m.from]!.filter((c) => c !== m.card);
    if (m.from === DUMMY && dummy) {
      const slot = dummy.up.indexOf(m.card);
      slots[DUMMY] = slot;
      dummy.up[slot] = null;
    }
  }
  for (const m of moves) {
    hands[m.to]!.push(m.card);
    received[m.to] = m.card;
    if (m.to === DUMMY && dummy) dummy.up[slots[DUMMY]!] = m.card;
  }
  return {
    ...a,
    hands,
    dummy,
    dealt: structuredClone(hands),
    distress: { ...a.distress, received },
  };
}

// ---- Play ----

function enterPlay(a: Attempt, now: number): Attempt {
  const next: Attempt = {
    ...a,
    stage: 'play',
    turn: a.captain,
    playStartedAt: now,
    deadline: a.mission.seconds ? now + a.mission.seconds * 1000 : null,
    ready: [],
  };
  return settle(next);
}

/** Why `seat` can't signal now, or null. */
export function signalBlock(a: Attempt, seat: string): string | null {
  if (a.stage !== 'play') return 'Signals open once the dive begins.';
  if (seat === DUMMY || !a.crew.includes(seat)) return 'Only crew members signal.';
  if (a.comms === 'none') return 'No signals on this mission.';
  if (a.current.length) return 'Not during a trick: signal before the next one starts.';
  if (a.mission.commsFrom && a.tricks.length + 1 < a.mission.commsFrom)
    return `Signals open before trick ${a.mission.commsFrom}.`;
  if (a.draft.given && a.tricks.length > 0)
    return 'Every signal had to be made before the first trick.';
  if (a.comms === 'rapture') {
    if (a.pool <= 0) return 'The shared tokens are all used.';
  } else if (!a.tokens.includes(seat)) {
    return 'You’ve used your signal for this attempt.';
  }
  const signalled = new Set(a.signals.filter((s) => !s.played).map((s) => s.card));
  const any = (a.hands[seat] ?? []).some(
    (c) => !signalled.has(c) && signalPositions(a.hands[seat]!, c).length,
  );
  return any ? null : 'None of your cards can be signalled (trumps never can).';
}

/** The viewer's cards that can be signalled now, with their positions. */
export function signalable(a: Attempt, seat: string): Record<CardId, Position[]> {
  if (signalBlock(a, seat)) return {};
  const hand = a.hands[seat] ?? [];
  const signalled = new Set(a.signals.filter((s) => !s.played).map((s) => s.card));
  const out: Record<CardId, Position[]> = {};
  for (const c of hand) {
    const pos = signalPositions(hand, c);
    if (pos.length && !signalled.has(c)) out[c] = pos;
  }
  return out;
}

const led = (a: Attempt) => (a.current[0] ? suitOf(a.current[0].card) : null);

/** Cards the seat on turn may play. */
export const legalFor = (a: Attempt, seat: string) =>
  a.stage === 'play' && a.turn === seat ? legalCards(playable(a, seat), led(a)) : [];

function table(a: Attempt): Table {
  return {
    tricks: a.tricks,
    current: a.current,
    total: a.total,
    crew: a.crew,
    captain: a.captain,
    hands: a.hands,
    size: sizeOf(a.crew.length),
    final: a.tricks.length >= a.total,
  };
}

/** Cards a task cares about, to credit the teammates who fed them. */
function fedMatch(c: Check): ((card: CardId) => boolean) | null {
  switch (c.kind) {
    case 'win-cards':
      return (x) => c.cards.includes(x);
    case 'win-count':
      return c.n > 0 ? (x) => matches(c.match, x) : null;
    case 'win-with-card':
      return (x) => matches(c.target, x);
    case 'colour-set':
    case 'equal':
    case 'more':
      return (x) => !isTrump(x);
    case 'all': {
      const parts = c.checks.map(fedMatch).filter((f) => f !== null);
      return parts.length ? (x) => parts.some((f) => f(x)) : null;
    }
    default:
      return null;
  }
}

/** Re-judges every task; ends the attempt on the first failure or once everything is done. */
function settle(a: Attempt): Attempt {
  const t = table(a);
  let failed = null as { i: number; why: string } | null;
  const tasks = a.tasks.map((task, i) => {
    if (task.state !== 'open') return task;
    if (task.owner === null && !task.crew) return task;
    const s = evaluate(task.check, task.owner, t, task.prediction);
    const progress = s.progress ?? null;
    if (s.state === 'open') return { ...task, progress };
    const at = a.tricks.length || null;
    if (s.state === 'failed') {
      failed ??= { i, why: s.why };
      return { ...task, state: 'failed' as const, why: s.why, progress, at };
    }
    const last = a.tricks.at(-1);
    const feeds = fedMatch(task.check);
    const fedBy =
      last && feeds && task.owner && last.winner === task.owner
        ? [
            ...new Set(
              last.plays.filter((p) => p.by !== task.owner && feeds(p.card)).map((p) => p.by),
            ),
          ]
        : [];
    return { ...task, state: 'done' as const, progress, at, fedBy };
  });
  const next = { ...a, tasks };
  if (failed)
    return end(next, {
      success: false,
      why: failed.why,
      task: failed.i,
      timedOut: false,
      tricks: a.tricks.length,
    });
  if (tasks.every((x) => x.state === 'done'))
    return end(next, {
      success: true,
      why: null,
      task: null,
      timedOut: false,
      tricks: a.tricks.length,
    });
  if (t.final) {
    const i = tasks.findIndex((x) => x.state === 'open');
    return end(next, {
      success: false,
      why: 'Not met by the last trick.',
      task: i,
      timedOut: false,
      tricks: a.tricks.length,
    });
  }
  return next;
}

function end(a: Attempt, result: Result): Attempt {
  return { ...a, stage: 'done', result, deadline: null, holds: [], holdSince: null };
}

/** Records a finished attempt in the campaign's logbook. */
function record(state: MissionControlState, now: number): MissionControlState {
  const a = state.attempt!;
  const key = state.settings.voyageKey!;
  const c = state.campaigns[key];
  if (!c) return state;
  const members = { ...c.members };
  for (const s of a.crew) if (s !== DUMMY && state.seats[s]) members[s] = state.seats[s].name;
  const success = !!a.result?.success;
  let campaign: Campaign = { ...c, members };
  if (a.mission.n === EPILOGUE) {
    const e = c.epilogue;
    campaign.epilogue = {
      level: e.level + (success ? 1 : 0),
      successes: e.successes + (success ? 1 : 0),
      attempts: e.attempts + 1,
      distress: e.distress + (a.distress.used ? 1 : 0),
    };
  } else {
    const log = { ...(c.log[a.mission.n] ?? emptyLog()) };
    if (a.mission.practice) {
      log.practice++;
      if (success) log.practised = true;
    } else {
      log.attempts++;
      if (a.distress.used && !log.distress) {
        log.distress = true;
        log.attempts++;
      }
      if (success && log.done === null) {
        log.done = now;
        log.crew = a.crew.filter((s) => s !== DUMMY).map((s) => state.seats[s]?.name ?? '?');
      }
    }
    campaign = { ...campaign, log: { ...c.log, [a.mission.n]: log } };
    const voyage = voyageOf(state);
    if (voyage && !campaign.finished && voyage.missions.every((m) => campaign.log[m.n]?.done))
      campaign.finished = now;
  }
  return {
    ...state,
    phase: 'over',
    campaigns: { ...state.campaigns, [key]: campaign },
    attemptsPlayed: state.attemptsPlayed + 1,
  };
}

/** Commits an attempt change: a newly finished attempt goes into the logbook. */
function commit(state: MissionControlState, a: Attempt, now: number): MissionControlState {
  const before = state.attempt;
  const next = withAttempt(state, a);
  return before?.stage !== 'done' && a.stage === 'done' ? record(next, now) : next;
}

function playCard(
  state: MissionControlState,
  a: Attempt,
  seat: string,
  c: CardId,
  now: number,
): MissionControlState {
  const hands = { ...a.hands, [seat]: a.hands[seat]!.filter((x) => x !== c) };
  const dummy =
    seat === DUMMY && a.dummy
      ? { ...a.dummy, up: a.dummy.up.map((x) => (x === c ? null : x)) }
      : a.dummy;
  const current = [...a.current, { by: seat, card: c }];
  const signals = a.signals.map((s) => (s.card === c ? { ...s, played: true } : s));
  let next: Attempt = { ...a, hands, dummy, current, signals, holds: [], holdSince: null };
  if (current.length < a.crew.length) {
    next = { ...next, turn: nextSeat(a, seat) };
    return commit(state, settle(next), now);
  }
  // The trick is complete.
  const winner = current[winningIndex(current.map((p) => p.card))]!.by;
  let flipped = dummy;
  if (dummy) {
    // A face-down card turns up once the card on it has been played, after the trick.
    flipped = {
      up: dummy.up.map((x, i) => (x === null && dummy.down[i] ? dummy.down[i] : x)),
      down: dummy.down.map((x, i) => (dummy.up[i] === null ? null : x)),
    };
  }
  next = {
    ...next,
    dummy: flipped,
    tricks: [...a.tricks, { plays: current, winner }],
    current: [],
    turn: winner,
  };
  return commit(state, settle(next), now);
}

/** A player's hold lifted (the clock goes when nobody holds). */
function dropHold(a: Attempt, by: string): Pick<Attempt, 'holds' | 'holdSince'> {
  const holds = a.holds.filter((s) => s !== by);
  return { holds, holdSince: holds.length ? a.holdSince : null };
}

// ---- Reduce ----

export function reduce(
  state: MissionControlState,
  action: MissionControlAction,
  ctx: Ctx,
): Result_ {
  const by = ctx.by;
  const seat = state.seats[by];
  switch (action.type) {
    case 'update-settings': {
      if (!ctx.isHost) return err('not-host', 'Only the host can change the settings.');
      if (state.phase !== 'lobby' && !(state.attempt?.stage === 'done'))
        return err('in-play', 'Settings can change between attempts.');
      const s: Settings = { ...state.settings };
      if (action.voyageKey !== undefined) {
        if (state.phase !== 'lobby') return err('in-play', 'Change the campaign in the lobby.');
        s.voyageKey = action.voyageKey;
      }
      if (action.playedCards !== undefined) s.playedCards = action.playedCards;
      if (action.realTime !== undefined) s.realTime = action.realTime;
      if (action.openTable !== undefined) s.openTable = action.openTable;
      if (action.dummyAfter !== undefined) s.dummyAfter = action.dummyAfter;
      return refresh(
        { ...state, settings: s, chosen: action.voyageKey !== undefined ? null : state.chosen },
        ctx.content,
      );
    }
    case 'sit': {
      if (!seat) return err('not-here', 'Join the room first.');
      if (state.phase !== 'lobby')
        return err('in-play', 'Sit down between missions, in the lobby.');
      if (action.playing && !seat.playing && humans(state).length >= MAX_SEATED)
        return err('full', `At most ${MAX_SEATED} crew members dive at once.`);
      return refresh(
        { ...state, seats: { ...state.seats, [by]: { ...seat, playing: action.playing } } },
        ctx.content,
      );
    }
    case 'choose': {
      if (!ctx.isHost) return err('not-host', 'Only the host picks the mission.');
      if (state.phase !== 'lobby') return err('in-play', 'Pick a mission in the lobby.');
      const voyage = voyageOf(state);
      if (
        action.mission !== null &&
        !voyage?.missions.some((m) => m.n === action.mission) &&
        !(action.mission === EPILOGUE && voyage?.epilogue)
      )
        return err('no-mission', 'That mission is not in the logbook.');
      return { ...state, chosen: action.mission };
    }
    case 'start': {
      if (!ctx.isHost) return err('not-host', 'Only the host starts the mission.');
      if (state.phase !== 'lobby') return err('in-play', 'A mission is already under way.');
      const fresh = refresh(state, ctx.content);
      const voyage = voyageOf(fresh);
      if (!voyage)
        return err('no-voyage', 'No campaign is loaded yet. Ask the admin to import it.');
      const next = nextMission(fresh.campaigns[voyage.key], voyage);
      const n = fresh.chosen ?? next;
      const doneBefore = n !== EPILOGUE && !!fresh.campaigns[voyage.key]?.log[n]?.done;
      return begin(fresh, ctx, n, { practice: n !== next || doneBefore, briefing: true });
    }
    case 'lobby': {
      if (!ctx.isHost) return err('not-host', 'Only the host can go back to the lobby.');
      if (state.phase === 'lobby') return state;
      const stopped = state.attempt && state.attempt.stage !== 'done';
      return refresh(
        {
          ...state,
          phase: 'lobby',
          attempt: null,
          chosen: null,
          notice: stopped ? 'The host stopped the attempt. It doesn’t count.' : null,
        },
        ctx.content,
      );
    }
    case 'retry':
    case 'next': {
      const a = state.attempt;
      if (!a || a.stage !== 'done') return err('not-yet', 'Wait for the attempt to end.');
      if (!seat?.playing && !ctx.isHost) return err('not-crew', 'Only the crew decides.');
      if (action.type === 'retry') {
        if (a.result?.success) return err('succeeded', 'This mission is done: on to the next.');
        // A mission's own tasks come back by themselves; drawn ones are kept on request.
        const drawn =
          a.tasks.length > 0 && a.tasks.every((t) => !t.crew && !t.key.startsWith('fixed:'));
        return begin(state, ctx, a.mission.n, {
          practice: a.mission.practice,
          briefing: false,
          ...(action.same && drawn && { same: a.tasks }),
        });
      }
      if (!a.result?.success) return err('failed', 'Try the mission again first.');
      const voyage = voyageOf(state);
      if (!voyage) return err('no-voyage', 'No campaign is loaded.');
      const n = nextMission(state.campaigns[voyage.key], voyage);
      // Epilogue dives follow one another without a briefing.
      return begin(state, ctx, n, {
        practice: false,
        briefing: !(n === EPILOGUE && a.mission.n === EPILOGUE),
      });
    }
    case 'emote': {
      const a = state.attempt;
      if (!a || !a.crew.includes(by)) return err('not-crew', 'Only the crew can react.');
      if (a.stage !== 'play' && a.stage !== 'done') return err('not-now', 'React after a trick.');
      if (a.current.length) return err('mid-trick', 'React once the trick is over.');
      const emotes = [
        ...state.emotes,
        { by, emoji: action.emoji, at: ctx.now, trick: a.tricks.length },
      ].slice(-MAX_EMOTES);
      return { ...state, emotes };
    }
    default:
      break;
  }

  const a = state.attempt;
  if (!a || state.phase !== 'playing') return err('not-playing', 'No mission is under way.');
  if (!a.crew.includes(by)) return err('not-crew', 'You are watching this dive.');
  const mine = controls(a, by);
  const actor = (forSeat?: string) => {
    if (!forSeat || forSeat === by) return by;
    return forSeat === DUMMY && mine.includes(DUMMY) ? DUMMY : null;
  };
  const people = a.crew.filter((s) => s !== DUMMY);

  switch (action.type) {
    case 'ready': {
      if (a.stage === 'briefing') {
        const ready = [...new Set([...a.ready, by])];
        const next = { ...a, ready };
        if (people.every((p) => ready.includes(p))) return withAttempt(state, enterDraft(next));
        return withAttempt(state, next);
      }
      if (
        a.stage === 'draft' &&
        (a.mission.selection === 'free' ||
          a.mission.selection === 'all-to-one' ||
          a.draft.chosen.length > 1)
      ) {
        if (!lockable(a))
          return err(
            'not-assigned',
            a.draft.chosen.length > 1
              ? 'Both of you need at least one task, and every task needs a holder.'
              : 'Every task needs a holder first.',
          );
        const ready = [...new Set([...a.draft.ready, by])];
        const next = { ...a, draft: { ...a.draft, ready } };
        if (people.every((p) => ready.includes(p))) return withAttempt(state, enterDistress(next));
        return withAttempt(state, next);
      }
      return err('not-now', 'Nothing to get ready for right now.');
    }
    case 'take':
    case 'pass': {
      if (a.stage !== 'draft' || !isRoundRobin(a))
        return err('not-now', 'It isn’t a pick-in-turn draft.');
      const seatNow = picker(a);
      if (controller(a, seatNow) !== by) return err('not-your-turn', 'Wait for your turn to pick.');
      if (action.type === 'pass') {
        if (!canPass(a))
          return err('no-pass', 'You can’t pass now: every task must find a holder this round.');
        return withAttempt(
          state,
          advancePick({ ...a, draft: { ...a.draft, passed: [...a.draft.passed, seatNow] } }),
        );
      }
      if (a.tasks[action.task]?.owner != null) return err('taken', 'That task is taken.');
      const bad = mayHold(a, seatNow, action.task) ?? hardestFirst(a, seatNow, action.task);
      if (bad) return bad;
      return withAttempt(state, advancePick(assign(a, action.task, seatNow)));
    }
    case 'claim': {
      if (a.stage !== 'draft') return err('not-now', 'Tasks are taken in the draft.');
      const split = a.mission.selection === 'crew-wanted' && a.draft.chosen.length > 1;
      if (a.mission.selection !== 'free' && !split)
        return err('not-free', 'Tasks aren’t freely chosen on this mission.');
      const who = actor(action.for);
      if (!who) return err('not-yours', 'You can only take tasks for yourself.');
      if (split && !a.draft.chosen.includes(who))
        return err('not-chosen', 'Only the two volunteers share these tasks.');
      const t = a.tasks[action.task];
      if (!t || t.crew) return err('no-task', 'There is no such task.');
      if (action.on) {
        if (t.owner !== null)
          return err('taken', 'That task is taken. Its holder can put it back.');
        const bad = mayHold(a, who, action.task);
        if (bad) return bad;
        return withAttempt(state, assign(a, action.task, who));
      }
      if (t.owner !== who) return err('not-yours', 'Only its holder can put a task back.');
      return withAttempt(state, assign(a, action.task, null));
    }
    case 'take-all': {
      if (a.stage !== 'draft' || a.mission.selection !== 'all-to-one')
        return err('not-now', 'Not on this mission.');
      const who = actor(action.for);
      if (!who) return err('not-yours', 'You can only volunteer yourself.');
      for (let i = 0; i < a.tasks.length; i++) {
        if (a.tasks[i]!.crew) continue;
        const bad = mayHold(a, who, i);
        if (bad) return bad;
      }
      return withAttempt(state, {
        ...a,
        tasks: a.tasks.map((t) => (t.crew ? t : { ...t, owner: who })),
        draft: { ...a.draft, ready: [] },
      });
    }
    case 'answer': {
      const m = a.mission.selection;
      if (a.stage !== 'draft' || (m !== 'crew-wanted' && m !== 'captain-offers'))
        return err('not-now', 'Nobody is asking right now.');
      const d = a.draft;
      if (d.at >= d.order.length || (m === 'crew-wanted' && d.chosen.length >= a.mission.wanted))
        return err('not-now', 'Everyone has answered.');
      const asked = d.order[d.at]!;
      if (controller(a, asked) !== by) return err('not-your-turn', 'Wait to be asked.');
      if (m === 'crew-wanted') {
        const need = a.mission.wanted - d.chosen.length;
        if (!action.yes && need >= d.order.length - d.at)
          return err('must-yes', 'Someone has to take them, and you are the last who can.');
      }
      const answers = { ...d.answers, [asked]: action.yes };
      const chosen = m === 'crew-wanted' && action.yes ? [...d.chosen, asked] : d.chosen;
      let next: Attempt = { ...a, draft: { ...d, answers, chosen, at: d.at + 1 } };
      if (m === 'crew-wanted' && chosen.length >= a.mission.wanted) {
        if (a.mission.wanted === 1) {
          next = {
            ...next,
            tasks: next.tasks.map((t) => (t.crew ? t : { ...t, owner: chosen[0]! })),
          };
          return withAttempt(state, enterDistress(next));
        }
      }
      return withAttempt(state, next);
    }
    case 'give': {
      if (a.stage !== 'draft' || a.mission.selection !== 'captain-offers')
        return err('not-now', 'Not on this mission.');
      if (by !== a.captain) return err('not-captain', 'The captain decides.');
      if (a.draft.at < a.draft.order.length)
        return err('not-yet', 'Wait until everyone has answered.');
      const to = action.to;
      if (to !== a.captain && a.draft.answers[to] !== true)
        return err('not-willing', 'Give them to a crew member who said yes, or keep them.');
      if (to === a.captain) {
        for (let i = 0; i < a.tasks.length; i++) {
          if (a.tasks[i]!.crew) continue;
          const bad = mayHold(a, to, i);
          if (bad) return bad;
        }
      }
      const next: Attempt = {
        ...a,
        tasks: a.tasks.map((t) => (t.crew ? t : { ...t, owner: to })),
        draft: { ...a.draft, chosen: [to], given: to !== a.captain },
      };
      return withAttempt(state, enterDistress(next));
    }
    case 'distress': {
      if (a.stage !== 'distress')
        return err('not-now', 'A distress signal is sent before the dive.');
      if (a.distress.proposal) return err('pending', 'A distress signal is already proposed.');
      if (!a.crew.every((s) => canGive(a, s)))
        return err('no-cards', 'Someone has only trumps to pass, so nobody can pass.');
      return withAttempt(state, {
        ...a,
        distress: { ...a.distress, proposal: { by, dir: action.dir }, accepted: [by], dive: [] },
      });
    }
    case 'distress-answer': {
      if (a.stage !== 'distress' || !a.distress.proposal)
        return err('not-now', 'Nobody proposed a distress signal.');
      if (!action.yes)
        return withAttempt(state, {
          ...a,
          distress: { ...a.distress, proposal: null, accepted: [] },
        });
      const accepted = [...new Set([...a.distress.accepted, by])];
      if (people.every((p) => accepted.includes(p))) {
        return withAttempt(state, {
          ...a,
          stage: 'pass',
          distress: {
            ...a.distress,
            accepted,
            used: true,
            dir: a.distress.proposal.dir,
            passes: {},
          },
        });
      }
      return withAttempt(state, { ...a, distress: { ...a.distress, accepted } });
    }
    case 'dive': {
      if (a.stage !== 'distress') return err('not-now', 'Not now.');
      if (a.distress.proposal) return err('pending', 'Answer the distress proposal first.');
      const dive = [...new Set([...a.distress.dive, by])];
      const next = { ...a, distress: { ...a.distress, dive } };
      if (people.every((p) => dive.includes(p)))
        return commit(state, afterDistress(next, ctx.now), ctx.now);
      return withAttempt(state, next);
    }
    case 'pass-card': {
      if (a.stage !== 'pass') return err('not-now', 'Cards are passed after a distress signal.');
      const who = actor(action.for);
      if (!who) return err('not-yours', 'Pass your own card.');
      if (isTrump(action.card)) return err('trump', 'Trumps can’t be passed.');
      if (!playable(a, who).includes(action.card))
        return err('no-card', 'That card isn’t in the hand.');
      const passes = { ...a.distress.passes, [who]: action.card };
      let next: Attempt = { ...a, distress: { ...a.distress, passes } };
      if (a.crew.every((s) => passes[s])) {
        next = doPass(next);
        return commit(state, afterDistress(next, ctx.now), ctx.now);
      }
      return withAttempt(state, next);
    }
    case 'predict': {
      if (a.stage !== 'predict')
        return err('not-now', 'Predictions are made before the first trick.');
      const t = a.tasks[action.task];
      if (!t || !predictionOf(t.check)) return err('no-task', 'That task needs no prediction.');
      if (!t.owner || controller(a, t.owner) !== by)
        return err('not-yours', 'Only its holder predicts.');
      if (action.n > a.total) return err('too-many', `There are only ${a.total} tricks.`);
      const next = {
        ...a,
        tasks: a.tasks.map((x, i) => (i === action.task ? { ...x, prediction: action.n } : x)),
      };
      return needsPrediction(next)
        ? withAttempt(state, next)
        : commit(state, enterPlay(next, ctx.now), ctx.now);
    }
    case 'signal': {
      const block = signalBlock(a, by);
      if (block) return err('no-signal', block);
      const options = signalable(a, by)[action.card];
      if (!options)
        return err(
          'bad-card',
          'That card can’t be signalled: only your highest, only or lowest card of a colour.',
        );
      // Under currents the card shows without its position.
      const currents = a.comms === 'currents';
      if (!currents && (!action.pos || !options.includes(action.pos)))
        return err('bad-position', 'That position isn’t true for this card.');
      return withAttempt(state, {
        ...a,
        signals: [
          ...a.signals,
          {
            by,
            card: action.card,
            pos: currents ? null : action.pos,
            played: false,
            before: a.tricks.length + 1,
          },
        ],
        tokens: a.comms === 'rapture' ? a.tokens : a.tokens.filter((s) => s !== by),
        pool: a.comms === 'rapture' ? a.pool - 1 : a.pool,
        ...dropHold(a, by),
      });
    }
    case 'hold': {
      if (a.stage !== 'play' || a.current.length)
        return err('not-now', 'Ask for a moment between tricks.');
      if (action.on) {
        const block = signalBlock(a, by);
        if (block) return err('no-signal', block);
        return withAttempt(state, {
          ...a,
          holds: [...new Set([...a.holds, by])],
          holdSince: a.holdSince ?? ctx.now,
        });
      }
      return withAttempt(state, { ...a, ...dropHold(a, by) });
    }
    case 'play': {
      if (a.stage !== 'play') return err('not-now', 'The dive hasn’t started.');
      if (controller(a, a.turn) !== by) return err('not-your-turn', 'Wait for your turn.');
      if (!a.current.length && a.holds.length)
        return err('hold', 'Someone asked for a moment to signal. Wait for them (20 s at most).');
      if (!playable(a, a.turn).includes(action.card))
        return err('no-card', 'That card isn’t in the hand.');
      if (!legalFor(a, a.turn).includes(action.card))
        return err('follow-suit', 'Follow the colour that was led if you can.');
      return playCard(state, a, a.turn, action.card, ctx.now);
    }
    default:
      return err('unknown', 'Unknown action.');
  }
}

// ---- Timers ----

export function nextDeadline(state: MissionControlState): number | null {
  const a = state.attempt;
  if (!a || state.phase !== 'playing') return null;
  if (a.stage === 'briefing') return a.deadline;
  if (a.stage !== 'play') return null;
  const hold = a.holdSince === null ? null : a.holdSince + HOLD_SECONDS * 1000;
  const due = [a.deadline, hold].filter((t): t is number => t !== null);
  return due.length ? Math.min(...due) : null;
}

export function onDeadline(state: MissionControlState, now: number): MissionControlState {
  const a = state.attempt;
  if (!a) return state;
  if (a.stage === 'briefing' && a.deadline !== null && now >= a.deadline)
    return withAttempt(state, enterDraft(a));
  if (a.stage !== 'play') return withAttempt(state, { ...a, deadline: null });
  if (a.deadline !== null && now >= a.deadline) {
    const failed = end(a, {
      success: false,
      why: 'Time ran out.',
      task: null,
      timedOut: true,
      tricks: a.tricks.length,
    });
    return commit(state, failed, now);
  }
  // A request to wait for a signal lapses.
  if (a.holdSince !== null && now >= a.holdSince + HOLD_SECONDS * 1000)
    return withAttempt(state, { ...a, holds: [], holdSince: null });
  return state;
}

export { COLOURS };
