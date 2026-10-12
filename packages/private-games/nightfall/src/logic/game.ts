import { nightfallBot } from './bot.ts';
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
import { guide } from './guide.ts';
import { nightfallAwards } from './awards.ts';
import { insights } from './insights.ts';
import { type StepCtx, actInStep, beginStep, endStep, promptFor } from './night.ts';
import { buildNightPlan, stepDef } from './plan.ts';
import { cardsNeeded, recommended } from './presets.ts';
import { weightsProblem } from './tables.ts';
import { resolveVote } from './resolve.ts';
import {
  ARTIFACT_IDS,
  ENABLED_SETS,
  ROLES,
  type RoleId,
  defaultArtifacts,
  marksInUse,
} from './roles.ts';
import {
  type Card,
  type CenterKind,
  DEFAULT_DAY_SECONDS,
  DEFAULT_STEP_SECONDS,
  type GamePlayer,
  type GameRound,
  MAX_NOTES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  NIGHT_INTRO_MS,
  type NightAction,
  type NightfallAction,
  type NightfallState,
  type Stage,
  type NightfallView,
  type SeatView,
  type Settings,
  VOTE_APP,
  VOTE_SECONDS,
  actionSchema,
} from './types.ts';

type Ctx = ActionCtx;
type Result = NightfallState | GameError;

// ---- Helpers ----

/**
 * The stage and the coarse phase the room host's stats read: a game is `playing` from the deal
 * to the vote, and `over` at the reveal.
 */
const at = (stage: Stage): Pick<NightfallState, 'stage' | 'phase'> => ({
  stage,
  phase: stage === 'lobby' ? 'lobby' : stage === 'reveal' ? 'over' : 'playing',
});

const newSeed = (rng: Rng) => rng.int(2 ** 32);
const hiddenRng = (state: NightfallState, now: number) => createRng((state.seed ^ now) >>> 0);
const clone = <T>(v: T): T => structuredClone(v);

/** Seated players, in seat order. */
export function seated(state: Pick<NightfallState, 'seats'>): PlayerId[] {
  return Object.entries(state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));
}

const requireHost = (ctx: Ctx) =>
  ctx.isHost ? null : new GameError('not-host', 'Only the host can do that.');

/** The players still at the table (not left), in seat order. */
const present = (r: GameRound) => r.order.filter((p) => !r.players[p]!.left);

/** Why these roles can't be dealt to `players` players, or null if they can. */
export function setupProblem(roles: readonly RoleId[], players: number): string | null {
  if (players < MIN_PLAYERS) return `${MIN_PLAYERS} players are needed (${players} so far).`;
  if (players > MAX_PLAYERS) return `At most ${MAX_PLAYERS} can play.`;
  const counts = new Map<RoleId, number>();
  for (const r of roles) counts.set(r, (counts.get(r) ?? 0) + 1);
  for (const [r, n] of counts) {
    if (!ENABLED_SETS.includes(ROLES[r].set)) return `The ${r} card isn’t available yet.`;
    if (n > ROLES[r].count)
      return `There ${ROLES[r].count === 1 ? 'is' : 'are'} only ${ROLES[r].count} ${r} card${ROLES[r].count === 1 ? '' : 's'}.`;
  }
  if (roles.includes('alpha-wolf') && !roles.some((r) => r !== 'alpha-wolf' && ROLES[r].werewolf))
    return 'The Alpha Wolf needs another werewolf card for the centre werewolf slot.';
  const need = cardsNeeded(players, roles);
  if (roles.length !== need)
    return `Pick ${need} cards for ${players} players (${roles.length} picked).`;
  return null;
}

// ---- The deal ----

/** A rigged deal (tests): the seat order's roles, the centre and the centre werewolf. */
export interface Deal {
  players: RoleId[];
  center: RoleId[];
  wolf?: RoleId;
}

/** Shuffles the selected cards into a deal for the seated players. */
export function shuffleDeal(roles: readonly RoleId[], players: number, rng: Rng): Deal {
  const cards = [...roles];
  let wolf: RoleId | undefined;
  if (cards.includes('alpha-wolf')) {
    // The centre werewolf is set aside before dealing: a plain Werewolf if there is one.
    const pool = cards.filter((r) => r !== 'alpha-wolf' && ROLES[r].werewolf);
    wolf = pool.includes('werewolf') ? 'werewolf' : pool[rng.int(pool.length)]!;
    cards.splice(cards.indexOf(wolf), 1);
  }
  const shuffled = rng.shuffle(cards);
  return {
    players: shuffled.slice(0, players),
    center: shuffled.slice(players),
    ...(wolf ? { wolf } : {}),
  };
}

/** Deals a new game: everyone gets a card and the phase moves to getting ready. */
export function dealGame(state: NightfallState, deal: Deal, order: PlayerId[]): NightfallState {
  let nextCard = 0;
  const card = (role: RoleId): Card => ({
    id: nextCard++,
    role,
    faceUp: false,
    shield: null,
    artifact: null,
    copied: null,
    became: null,
  });
  const players: Record<PlayerId, GamePlayer> = {};
  const cards: Record<PlayerId, Card> = {};
  order.forEach((p, i) => {
    const c = card(deal.players[i]!);
    cards[p] = c;
    players[p] = {
      name: state.seats[p]?.name ?? 'Someone',
      cardId: c.id,
      dealt: c.role,
      night: c.role,
      ready: false,
      readyToVote: false,
      vote: null,
      left: false,
    };
  });
  const center: { kind: CenterKind; card: Card }[] = deal.center.map((r) => ({
    kind: 'center',
    card: card(r),
  }));
  if (deal.wolf) center.push({ kind: 'wolf', card: card(deal.wolf) });
  // With the Vampire set's roles, everyone starts with a face-down Mark of Clarity.
  const marks = marksInUse(state.settings.roles)
    ? Object.fromEntries(order.map((p) => [p, { id: 'clarity' as const, doppel: false }]))
    : null;
  const round: GameRound = {
    number: (state.round?.number ?? 0) + 1,
    order,
    players,
    cards,
    center,
    night: null,
    notes: {},
    dawn: {},
    dayDeadline: null,
    voteDeadline: null,
    result: null,
    deal: {
      players: Object.fromEntries(order.map((p) => [p, players[p]!.dealt])),
      center: center.map((c) => c.card.role),
    },
    marks,
    seerLooks: [],
    loneWolf: null,
    times: { night: null, dawn: null, vote: null },
  };
  return { ...state, ...at('ready'), round, gamesPlayed: state.gamesPlayed + 1 };
}

function start(state: NightfallState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  // Before the night, the host may shuffle and deal again.
  if (state.stage !== 'lobby' && state.stage !== 'reveal' && state.stage !== 'ready')
    return new GameError('in-progress', 'A game is already running.');
  const order = seated(state);
  const problem = setupProblem(state.settings.roles, order.length);
  if (problem) return new GameError('setup', problem);
  const deal = shuffleDeal(state.settings.roles, order.length, ctx.rng);
  const dealt = dealGame(state, deal, order);
  // A redeal is the same game, not another one.
  const games = state.stage === 'ready' ? state.gamesPlayed : dealt.gamesPlayed;
  const round =
    state.stage === 'ready' ? { ...dealt.round!, number: state.round!.number } : dealt.round;
  return { ...dealt, round, gamesPlayed: games, seed: newSeed(ctx.rng) };
}

// ---- Getting ready ----

function ready(state: NightfallState, ctx: Ctx): Result {
  const r = state.round;
  if (state.stage !== 'ready' || !r) return new GameError('wrong-phase', 'Not now.');
  const p = r.players[ctx.by];
  if (!p) return new GameError('not-playing', 'You’re watching this game.');
  if (p.ready) return state;
  const next = clone(state);
  next.round!.players[ctx.by]!.ready = true;
  if (present(next.round!).every((q) => next.round!.players[q]!.ready))
    return startNight(next, ctx.now);
  return next;
}

/** Everyone closes their eyes; the first step follows a short pause. */
export function startNight(state: NightfallState, now: number): NightfallState {
  const next = state.round === null ? state : clone(state);
  const r = next.round!;
  const roles = next.settings.roles;
  r.times.night = now;
  r.night = {
    plan: buildNightPlan(roles),
    index: -1,
    deadline: now + NIGHT_INTRO_MS,
    actors: [],
    work: {},
    touched: [],
    knownWolves: [],
    bag: next.settings.artifacts.filter((a) => defaultArtifacts(roles).includes(a)),
    vampires: [],
    vampireTarget: null,
    timeline: [],
  };
  return { ...next, ...at('night') };
}

// ---- The night ----

function stepCtx(state: NightfallState, rng: Rng, now?: number): StepCtx {
  const r = state.round!;
  const night = r.night!;
  return {
    r,
    step: night.index,
    def: stepDef(night.plan[night.index]!),
    settings: state.settings,
    rng,
    nextId: () => ++state.seq,
    ...(now !== undefined ? { now } : {}),
  };
}

function nightAction(state: NightfallState, a: NightAction, ctx: Ctx): Result {
  const night = state.round?.night;
  if (state.stage !== 'night' || !night) return new GameError('wrong-phase', 'It isn’t night.');
  if (night.index < 0 || a.step !== night.index)
    return new GameError('stale', 'That step is over.');
  const next = clone(state);
  const err = actInStep(stepCtx(next, ctx.rng), ctx.by, a);
  return err ?? next;
}

/** Ends the current step (or the intro) and starts the next, or daybreak. */
function advanceNight(state: NightfallState, now: number, rng: Rng): NightfallState {
  const next = clone(state);
  const night = next.round!.night!;
  if (night.index >= 0) endStep(stepCtx(next, rng, now));
  const index = night.index + 1;
  if (index >= night.plan.length) return dawn(next, now);
  night.index = index;
  beginStep(stepCtx(next, rng, now), now);
  return next;
}

/** Daybreak: taps on the shoulder and artifacts are learned, and the day clock starts. */
function dawn(state: NightfallState, now: number): NightfallState {
  const r = state.round!;
  for (const p of r.order) {
    const learned = [...(r.dawn[p] ?? [])];
    const artifact = r.cards[p]!.artifact;
    if (artifact) learned.push({ kind: 'artifact', artifact });
    if (!learned.length) continue;
    const list = r.notes[p] ?? [];
    for (const body of learned) list.push({ ...body, id: ++state.seq, step: -1 });
    r.notes[p] = list.slice(-MAX_NOTES);
  }
  r.dawn = {};
  r.night!.actors = [];
  r.night!.work = {};
  // The aliens' timer and the ripples may have shortened the day.
  r.dayDeadline = now + (r.daySeconds ?? state.settings.daySeconds) * 1000;
  r.times.dawn = now;
  return { ...state, ...at('day') };
}

// ---- Day and vote ----

function readyToVote(state: NightfallState, ready: boolean, ctx: Ctx): Result {
  const r = state.round;
  if (state.stage !== 'day' || !r) return new GameError('wrong-phase', 'The day is over.');
  const p = r.players[ctx.by];
  if (!p) return new GameError('not-playing', 'You’re watching this game.');
  const next = clone(state);
  next.round!.players[ctx.by]!.readyToVote = ready;
  if (present(next.round!).every((q) => next.round!.players[q]!.readyToVote))
    return startVote(next, ctx.now);
  return next;
}

/** Host: open the vote now, without waiting for everyone (someone dropped out, say). */
function startVoteNow(state: NightfallState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  if (state.stage !== 'day' || !state.round) return new GameError('wrong-phase', 'Not now.');
  return startVote(clone(state), ctx.now);
}

function startVote(state: NightfallState, now: number): NightfallState {
  const r = state.round!;
  r.voteDeadline = now + VOTE_SECONDS * 1000;
  r.times.vote = now;
  r.dayDeadline = null;
  return { ...state, ...at('vote') };
}

/** A ripple made these players vote with both hands. */
const twoHanded = (r: GameRound, p: PlayerId) => r.rules?.twoVotes?.includes(p) ?? false;

/** Everyone still at the table has cast every vote they have. */
const allVoted = (r: GameRound) =>
  present(r).every(
    (q) => r.players[q]!.vote != null && (!twoHanded(r, q) || r.players[q]!.vote2 != null),
  );

function vote(state: NightfallState, target: PlayerId, hand: 2 | undefined, ctx: Ctx): Result {
  const r = state.round;
  if (state.stage !== 'vote' || !r) return new GameError('wrong-phase', 'It isn’t time to vote.');
  const me = r.players[ctx.by];
  if (!me || me.left) return new GameError('not-playing', 'You’re watching this game.');
  if (hand === 2 && !twoHanded(r, ctx.by))
    return new GameError('one-hand', 'You only have one vote.');
  if (target === VOTE_APP) {
    if (!r.rules?.voteApp) return new GameError('bad-target', 'You can’t vote for the app.');
  } else {
    if (target === ctx.by) return new GameError('self-vote', 'Vote for someone else.');
    if (!r.players[target]) return new GameError('bad-target', 'That player isn’t in the game.');
    if (r.players[target].left) return new GameError('left', 'That player has left the game.');
  }
  const next = clone(state);
  const p = next.round!.players[ctx.by]!;
  if (hand === 2) p.vote2 = target;
  else p.vote = target;
  if (allVoted(next.round!)) return finish(next);
  return next;
}

/** Everyone has voted (or time ran out): count the votes and reveal everything. */
function finish(state: NightfallState): NightfallState {
  const r = state.round!;
  const votes = Object.fromEntries(r.order.map((p) => [p, r.players[p]!.vote]));
  const votes2 = Object.fromEntries(
    r.order.flatMap((p) => (twoHanded(r, p) ? [[p, r.players[p]!.vote2 ?? null]] : [])),
  );
  r.result = resolveVote(r.order, r.cards, votes, r.marks ?? null, {
    ...(r.aliens ? { aliens: r.aliens } : {}),
    ...(r.oracle ? { oracle: r.oracle } : {}),
    ...(r.blob ? { blob: r.blob } : {}),
    ...(Object.keys(votes2).length ? { votes2 } : {}),
    ...(r.rules?.voteApp ? { voteApp: true } : {}),
    center: r.center.map((c) => c.card),
  });
  r.voteDeadline = null;
  return { ...state, ...at('reveal') };
}

// ---- Lobby ----

function updateSettings(
  state: NightfallState,
  a: Extract<NightfallAction, { type: 'update-settings' }>,
  ctx: Ctx,
): Result {
  const err = requireHost(ctx);
  if (err) return err;
  if (state.stage !== 'lobby' && state.stage !== 'reveal')
    return new GameError('in-progress', 'Settings can only change between games.');
  const settings: Settings = { ...state.settings };
  if (a.roles) {
    for (const role of a.roles)
      if (!ENABLED_SETS.includes(ROLES[role].set))
        return new GameError('unavailable', 'That card isn’t available yet.');
    const counts = new Map<RoleId, number>();
    for (const role of a.roles) counts.set(role, (counts.get(role) ?? 0) + 1);
    for (const [role, n] of counts)
      if (n > ROLES[role].count)
        return new GameError('too-many', `There are only ${ROLES[role].count} of that card.`);
    settings.roles = [...a.roles];
  }
  if (a.stepSeconds !== undefined) settings.stepSeconds = a.stepSeconds;
  if (a.daySeconds !== undefined) settings.daySeconds = a.daySeconds;
  if (a.narration !== undefined) settings.narration = a.narration;
  if (a.music !== undefined) settings.music = a.music;
  if (a.loneWolf !== undefined) settings.loneWolf = a.loneWolf;
  if (a.artifacts !== undefined) settings.artifacts = [...new Set(a.artifacts)];
  if (a.weights !== undefined) {
    const problem = weightsProblem(a.weights);
    if (problem) return new GameError('bad-weights', problem);
    settings.weights = structuredClone(a.weights);
  }
  return { ...state, settings };
}

const sameCards = (a: readonly RoleId[], b: readonly RoleId[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join();

/**
 * Between games, while the host keeps the recommended cards for the table, the cards follow the
 * table as players sit down or leave. Once the host picks other cards, they stay as picked.
 */
export function followTable(before: NightfallState, after: NightfallState): NightfallState {
  if (after.stage !== 'lobby' && after.stage !== 'reveal') return after;
  const was = seated(before).length;
  const now = seated(after).length;
  if (was === now || !sameCards(before.settings.roles, recommended(was))) return after;
  return { ...after, settings: { ...after.settings, roles: recommended(now) } };
}

function sit(state: NightfallState, playing: boolean, ctx: Ctx): Result {
  const seat = state.seats[ctx.by];
  if (!seat) return new GameError('not-seated', 'You are not in this game.');
  if (seat.playing === playing) return state;
  if (state.stage !== 'lobby' && state.stage !== 'reveal')
    return new GameError('in-progress', 'You can sit down or stand up between games.');
  if (playing && seated(state).length >= MAX_PLAYERS)
    return new GameError('full', `Only ${MAX_PLAYERS} can play.`);
  return followTable(state, {
    ...state,
    seats: { ...state.seats, [ctx.by]: { ...seat, playing } },
  });
}

function backToLobby(state: NightfallState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  return { ...state, ...at('lobby'), round: null };
}

function startNightNow(state: NightfallState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  if (state.stage !== 'ready') return new GameError('wrong-phase', 'Not now.');
  return startNight(clone(state), ctx.now);
}

function reduce(state: NightfallState, action: NightfallAction, ctx: Ctx): Result {
  switch (action.type) {
    case 'update-settings':
      return updateSettings(state, action, ctx);
    case 'sit':
      return sit(state, action.playing, ctx);
    case 'start':
    case 'play-again':
      return start(state, ctx);
    case 'ready':
      return ready(state, ctx);
    case 'start-night':
      return startNightNow(state, ctx);
    case 'night':
      return nightAction(state, action, ctx);
    case 'ready-to-vote':
      return readyToVote(state, action.ready, ctx);
    case 'start-vote':
      return startVoteNow(state, ctx);
    case 'vote':
      return vote(state, action.target, action.hand, ctx);
    case 'back-to-lobby':
      return backToLobby(state, ctx);
  }
}

// ---- Players coming and going ----

export const DEFAULT_SETTINGS: Settings = {
  roles: recommended(MIN_PLAYERS),
  stepSeconds: DEFAULT_STEP_SECONDS,
  daySeconds: DEFAULT_DAY_SECONDS,
  narration: 'host',
  music: true,
  loneWolf: true,
  // Every artifact; the ones a setup can't use (Mist without vampires) stay out of the bag.
  artifacts: [...ARTIFACT_IDS],
};

function create(ctx: CreateCtx, playersIn: readonly PlayerInfo[]): NightfallState {
  let state: NightfallState = {
    ...at('lobby'),
    settings: { ...DEFAULT_SETTINGS, roles: [...DEFAULT_SETTINGS.roles] },
    seed: newSeed(ctx.rng),
    seats: {},
    round: null,
    seq: 0,
    gamesPlayed: 0,
  };
  for (const p of playersIn) state = playerJoined(state, p);
  return state;
}

function playerJoined(state: NightfallState, player: PlayerInfo): NightfallState {
  const existing = state.seats[player.id];
  if (existing)
    return { ...state, seats: { ...state.seats, [player.id]: { ...existing, name: player.name } } };
  const between = state.stage === 'lobby' || state.stage === 'reveal';
  const playing = between && seated(state).length < MAX_PLAYERS;
  return followTable(state, {
    ...state,
    seats: { ...state.seats, [player.id]: { name: player.name, playing } },
  });
}

/**
 * Someone left for good. Between games they simply go. Mid-game their card stays on the table
 * (the night still runs every step), but they no longer act, get ready or vote.
 */
function playerLeft(state: NightfallState, playerId: PlayerId, now: number): NightfallState {
  if (!state.seats[playerId]) return state;
  const next = clone(state);
  delete next.seats[playerId];
  const r = next.round;
  const p = r?.players[playerId];
  if (!r || !p || next.stage === 'lobby' || next.stage === 'reveal')
    return followTable(state, next);
  p.left = true;
  if (present(r).length === 0) return { ...next, ...at('lobby'), round: null };
  if (next.stage === 'ready' && present(r).every((q) => r.players[q]!.ready))
    return startNight(next, now);
  if (next.stage === 'day' && present(r).every((q) => r.players[q]!.readyToVote))
    return startVote(next, now);
  if (next.stage === 'vote' && allVoted(r)) return finish(next);
  return next;
}

// ---- Timers ----

function nextDeadline(state: NightfallState): number | null {
  const r = state.round;
  if (!r) return null;
  if (state.stage === 'night') return r.night?.deadline ?? null;
  if (state.stage === 'day') return r.dayDeadline;
  if (state.stage === 'vote') return r.voteDeadline;
  return null;
}

/** Steps never wait for anyone: each ends on its clock, then the day turns to the vote. */
function onDeadline(state: NightfallState, now: number): NightfallState {
  const due = nextDeadline(state);
  if (due === null || now < due) return state;
  const rng = hiddenRng(state, now);
  let next: NightfallState;
  if (state.stage === 'night') next = advanceNight(state, now, rng);
  else if (state.stage === 'day') next = startVote(clone(state), now);
  else next = finish(clone(state));
  return { ...next, seed: newSeed(rng) };
}

// ---- Views ----

function view(state: NightfallState, viewer: PlayerId | null): NightfallView {
  const seats: SeatView[] = Object.entries(state.seats).map(([id, s]) => ({
    id,
    name: s.name,
    playing: s.playing,
  }));
  const me = viewer === null ? null : (seats.find((s) => s.id === viewer) ?? null);
  const r = state.round;
  const mine = viewer !== null ? r?.players[viewer] : undefined;
  const base: NightfallView = {
    phase: state.stage,
    settings: state.settings,
    seats,
    me,
    table: null,
    round: r?.number ?? 0,
    myRole: null,
    readyCount: 0,
    meReady: false,
    waitingOn: [],
    night: null,
    day: null,
    vote: null,
    notes: [],
    announcements: [],
    reveal: null,
    gamesPlayed: state.gamesPlayed,
  };
  if (!r || state.stage === 'lobby') return base;
  const table = r.order.map((id) => ({
    id,
    name: state.seats[id]?.name ?? r.players[id]!.name,
    left: r.players[id]!.left,
  }));
  const all = present(r);
  const out: NightfallView = {
    ...base,
    table,
    myRole: mine?.dealt ?? null,
    notes: viewer !== null && mine ? [...(r.notes[viewer] ?? [])] : [],
    announcements: [...(r.announcements ?? [])],
  };
  if (state.stage === 'ready') {
    out.readyCount = all.filter((p) => r.players[p]!.ready).length;
    out.meReady = mine?.ready ?? false;
    out.waitingOn = all.filter((p) => !r.players[p]!.ready);
  }
  if (state.stage === 'night' && r.night) {
    const night = r.night;
    const acting =
      viewer !== null && night.index >= 0 && night.actors.includes(viewer)
        ? (() => {
            // Prompts only read the state.
            const c = stepCtx(state, createRng(0));
            const w = night.work[viewer];
            const def = stepDef(night.plan[night.index]!);
            const team =
              def.id === 'vampires'
                ? night.actors
                    .filter((q) => q !== viewer)
                    .map((q) => ({ player: q, pick: night.work[q]?.picks[0] ?? null }))
                : null;
            // The Cow isn't told what the aliens were; everyone else in a random step is.
            const pick = night.picks?.[night.index];
            const cow =
              def.id === 'aliens' &&
              !(night.aliens ?? []).includes(viewer) &&
              !(pick?.kind === 'alien' && pick.fists);
            const ripple = def.id === 'ripple' ? night.ripple : undefined;
            const me = r.players[viewer]!;
            const closed =
              (def.id === 'aliens' && !(night.aliens ?? []).includes(viewer)) ||
              (def.role === 'empath' &&
                !def.repeat &&
                !(me.night === 'empath' && (def.doppel ? me.asDoppel === true : !me.asDoppel)));
            return {
              step: def.id,
              as: w?.as ?? r.players[viewer]!.night,
              prompt: promptFor(c, viewer),
              ...(team ? { team } : {}),
              ...(pick && !cow ? { told: pick } : {}),
              ...(ripple ? { ripple } : {}),
              ...(closed ? { eyes: 'closed' as const } : {}),
            };
          })()
        : null;
    out.night = {
      index: night.index,
      count: night.plan.length,
      deadline: night.deadline,
      acting,
    };
  }
  if (state.stage === 'day' || state.stage === 'vote') {
    out.day = {
      deadline: r.dayDeadline,
      readyCount: all.filter((p) => r.players[p]!.readyToVote).length,
      meReady: mine?.readyToVote ?? false,
      faceUp: r.order.flatMap((p) =>
        r.cards[p]!.faceUp ? [{ player: p, role: r.cards[p]!.role }] : [],
      ),
      shields: r.order.filter((p) => r.cards[p]!.shield !== null),
      artifacts: r.order.filter((p) => r.cards[p]!.artifact !== null),
      centerKinds: r.center.map((c) => c.kind),
      centerUp: r.center.flatMap((c, i) =>
        c.card.faceUp ? [{ center: i, role: c.card.role }] : [],
      ),
      seconds: r.daySeconds ?? state.settings.daySeconds,
      ...(r.rules ? { rules: r.rules } : {}),
    };
    out.waitingOn = all.filter((p) => !r.players[p]!.readyToVote);
  }
  if (state.stage === 'vote') {
    const two = viewer !== null && twoHanded(r, viewer);
    const done = (p: PlayerId) =>
      r.players[p]!.vote != null && (!twoHanded(r, p) || r.players[p]!.vote2 != null);
    out.vote = {
      deadline: r.voteDeadline,
      votedCount: all.filter(done).length,
      myVote: mine?.vote ?? null,
      ...(two ? { mySecond: mine?.vote2 ?? null, hands: 2 as const } : {}),
      ...(r.rules?.voteApp ? { app: true } : {}),
    };
    out.waitingOn = all.filter((p) => !done(p));
  }
  if (state.stage === 'reveal' && r.result) {
    out.reveal = {
      result: r.result,
      cards: r.cards,
      center: r.center,
      deal: r.deal,
      marks: r.marks ?? null,
      timeline: r.night?.timeline ?? [],
      plan: r.night?.plan ?? [],
    };
  }
  return out;
}

export const nightfall: GameDefinition<NightfallState, NightfallAction, NightfallView> = {
  id: 'nightfall',
  name: 'Nightfall',
  description:
    'One night, hidden roles, one vote: find the werewolves before the sun comes up, or be one.',
  minPlayers: MIN_PLAYERS,
  maxPlayers: 30,
  access: 'private',
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
  awards: nightfallAwards,
  bot: nightfallBot,
};
