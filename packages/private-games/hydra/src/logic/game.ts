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
import { hydraAwards } from './awards.ts';
import { countBlue, newDeck, topUp } from './deck.ts';
import { guide } from './guide.ts';
import { insights } from './insights.ts';
import { BLUE_CARDS, PORTRAITS, leaderKnowsTeam, powerAt, rolesFor, setupFor } from './tables.ts';
import {
  BEAT_MS,
  BLUE_TO_WIN,
  type Ballot,
  CHAOS_MS,
  type Claim,
  type ClaimNeed,
  DEFAULT_CLAIM_SECONDS,
  type EndReason,
  type Game,
  type GameView,
  type HydraAction,
  type HydraState,
  type HydraView,
  type Ineligible,
  type Known,
  LEADER_ZONE,
  MAX_NOTICES,
  MAX_SEATS,
  MIN_PLAYERS,
  type MyRole,
  NUDGE_MS,
  type Policy,
  type Power,
  RED_TO_WIN,
  type Round,
  type SeatView,
  type Settings,
  type Stage,
  TRACKER_MAX,
  type Team,
  type Truth,
  VETO_ZONE,
  actionSchema,
} from './types.ts';

type Ctx = ActionCtx;
type Result = HydraState | GameError;

const err = (code: string, message: string) => new GameError(code, message);

// ---- Pure helpers (also used by the UI and tests) ----

/** Seated players, in seat order. */
export function seated(state: Pick<HydraState, 'seats'>): PlayerId[] {
  return Object.entries(state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));
}

export const teamOf = (role: Game['roles'][string]): Team => (role === 'blue' ? 'blue' : 'red');

export const alive = (g: Pick<Game, 'players' | 'dead'>) =>
  g.players.filter((p) => !g.dead.includes(p));

/** The next living player clockwise after `from` (who may be dead themselves). */
export function nextLiving(g: Pick<Game, 'players' | 'dead'>, from: PlayerId): PlayerId {
  const n = g.players.length;
  const i = g.players.indexOf(from);
  for (let k = 1; k <= n; k++) {
    const p = g.players[(i + k) % n]!;
    if (!g.dead.includes(p)) return p;
  }
  return from;
}

/** Who would be the next Presidential Candidate after the current round, as things stand. */
export const upNext = (g: Game): PlayerId => g.specialNext ?? nextLiving(g, g.rotation);

/** Why each seat can't be nominated Chancellor by the current President. */
export function ineligibility(g: Game): Record<PlayerId, Ineligible> {
  const out: Record<PlayerId, Ineligible> = {};
  const fiveLeft = alive(g).length <= 5;
  for (const p of g.players) {
    if (p === g.president) out[p] = 'self';
    else if (g.dead.includes(p)) out[p] = 'dead';
    else if (g.lastElected?.chancellor === p) out[p] = 'term-limit-chancellor';
    else if (g.lastElected?.president === p && !fiveLeft) out[p] = 'term-limit-president';
  }
  return out;
}

export const eligible = (g: Game) => {
  const bad = ineligibility(g);
  return g.players.filter((p) => !bad[p]);
};

export const vetoUnlocked = (g: Pick<Game, 'enacted'>) => g.enacted.red >= VETO_ZONE;

/** Players the President may target with a power. */
export function powerTargets(g: Game, power: Power): PlayerId[] {
  return alive(g).filter(
    (p) => p !== g.president && (power !== 'investigate' || !g.investigated.includes(p)),
  );
}

/** Who the table is waiting on right now. */
export function awaited(state: HydraState): PlayerId[] {
  const g = state.game;
  if (state.phase !== 'playing' || !g) return [];
  switch (state.stage) {
    case 'reveal':
      return g.players.filter((p) => !g.ready.includes(p));
    case 'nominate':
    case 'legislate-president':
    case 'veto-response':
    case 'power':
      return [g.president];
    case 'legislate-chancellor':
      return g.chancellor ? [g.chancellor] : [];
    case 'vote':
      return alive(g).filter((p) => !(p in g.votes) && !g.abstain.includes(p));
    case 'claim':
      return g.needs.map((n) => n.by);
    default:
      return [];
  }
}

const newSeed = (rng: Rng) => rng.int(2 ** 32);
/** Randomness for deadlines and leavers, mixed with the hidden seed so the clock can't replay it. */
const hiddenRng = (state: HydraState, now: number) =>
  createRng((state.seed ^ now ^ ((state.game?.rounds.length ?? 0) << 9)) >>> 0);

const patch = (state: HydraState, p: Partial<Game>): HydraState => ({
  ...state,
  game: { ...state.game!, ...p },
});

/** Updates the current (last) round. */
function patchRound(state: HydraState, p: Partial<Round>): HydraState {
  const g = state.game!;
  const last = g.rounds.at(-1);
  if (!last) return state;
  return patch(state, { rounds: [...g.rounds.slice(0, -1), { ...last, ...p }] });
}

const currentRound = (g: Game) => g.rounds.at(-1)!;

/** The truth entry for the current round (created on first use). */
function patchTruth(state: HydraState, p: Partial<Truth>): HydraState {
  const g = state.game!;
  const n = currentRound(g).n;
  const has = g.truth.find((t) => t.round === n);
  const base: Truth = has ?? {
    round: n,
    drawn: null,
    presidentDiscard: null,
    chancellorHand: null,
    chancellorDiscard: null,
    enacted: null,
    vetoed: false,
    peek: null,
    investigate: null,
  };
  const next = { ...base, ...p };
  return patch(state, {
    truth: has ? g.truth.map((t) => (t.round === n ? next : t)) : [...g.truth, next],
  });
}

function notice(state: HydraState, text: string, now: number): HydraState {
  const g = state.game!;
  const id = g.noticeSeq + 1;
  return patch(state, {
    noticeSeq: id,
    notices: [...g.notices, { id, text, at: now }].slice(-MAX_NOTICES),
  });
}

const nameOf = (g: Game, id: PlayerId | null | undefined) => (id && g.names[id]) || 'Someone';

const TIMED: Partial<Record<Stage, 'pick' | 'vote'>> = {
  nominate: 'pick',
  vote: 'vote',
  'legislate-president': 'pick',
  'legislate-chancellor': 'pick',
  'veto-response': 'pick',
  power: 'pick',
};

/** Moves to `stage`, setting its clock (a strict or reminder timer) or clearing it. */
function atStage(state: HydraState, stage: Stage, now: number): HydraState {
  const kind = TIMED[stage];
  const s = state.settings;
  const secs = kind === 'pick' ? s.pickSeconds : kind === 'vote' ? s.voteSeconds : null;
  return {
    ...state,
    stage,
    game: { ...state.game!, deadline: secs === null ? null : now + secs * 1000 },
  };
}

// ---- Flow ----

function finish(state: HydraState, winner: Team, reason: EndReason): HydraState {
  return {
    ...state,
    phase: 'over',
    stage: null,
    game: {
      ...state.game!,
      winner,
      reason,
      deadline: null,
      hand: [],
      peek: null,
      needs: [],
      claimDeadline: null,
      votes: {},
      abstain: [],
    },
  };
}

/** A win on the boards, if there is one. */
function boardWin(state: HydraState): HydraState | null {
  const g = state.game!;
  if (g.enacted.blue >= BLUE_TO_WIN) return finish(state, 'blue', 'blue-policies');
  if (g.enacted.red >= RED_TO_WIN) return finish(state, 'red', 'red-policies');
  return null;
}

/** A new round: the next Presidential Candidate (or the special election's pick) nominates. */
function nextRound(state: HydraState, now: number): HydraState {
  const g = state.game!;
  const special = g.specialNext !== null;
  const president = g.specialNext ?? nextLiving(g, g.rotation);
  return atStage(
    patch(state, {
      president,
      rotation: special ? g.rotation : president,
      specialNext: null,
      special,
      chancellor: null,
      votes: {},
      abstain: [],
      hand: [],
      vetoRequested: false,
      vetoRefused: false,
      power: null,
      peek: null,
      needs: [],
      claimDeadline: null,
    }),
    'nominate',
    now,
  );
}

function beginChaos(state: HydraState, now: number): HydraState {
  return { ...state, stage: 'chaos', game: { ...state.game!, deadline: now + CHAOS_MS } };
}

/** The people enact the top policy: its power is ignored, the tracker resets, term limits go. */
function resolveChaos(state: HydraState, now: number, rng: Rng): HydraState {
  const g = state.game!;
  const [card, ...deck] = g.deck;
  if (!card) return nextRound(state, now);
  const enacted = { ...g.enacted, [card]: g.enacted[card] + 1 };
  const top = topUp(deck, g.discard, rng);
  let s = patch(state, {
    deck: top.deck,
    discard: top.discard,
    enacted,
    tracker: 0,
    lastElected: null,
  });
  s = patchRound(s, { chaos: card, tracker: 0 });
  if (top.reshuffled) s = notice(s, 'The discard pile was shuffled back into the deck.', now);
  return boardWin(s) ?? nextRound(s, now);
}

/** The top three go to the President. */
function startSession(state: HydraState, now: number): HydraState {
  const g = state.game!;
  const hand = g.deck.slice(0, 3);
  let s = patch(state, { hand, deck: g.deck.slice(3), vetoRequested: false, vetoRefused: false });
  s = patchTruth(s, { drawn: [...hand] });
  return atStage(s, 'legislate-president', now);
}

function resolveCheck(state: HydraState, now: number): HydraState {
  const g = state.game!;
  if (g.chancellor && g.roles[g.chancellor] === 'leader')
    return finish(state, 'red', 'leader-elected');
  const s = patchRound(
    patch(state, {
      cleared:
        g.chancellor && !g.cleared.includes(g.chancellor)
          ? [...g.cleared, g.chancellor]
          : g.cleared,
    }),
    { cleared: true },
  );
  return startSession(s, now);
}

/** Every vote is in (or given up on): a strict majority of the votes cast elects. */
function resolveVote(state: HydraState, now: number): HydraState {
  const g = state.game!;
  const cast = Object.values(g.votes);
  const yes = cast.filter((b) => b === 'yes').length;
  const elected = yes > cast.length - yes;
  let s = patchRound(state, {
    votes: { ...g.votes },
    missing: [...g.abstain],
    elected,
    tracker: elected ? g.tracker : g.tracker + 1,
  });
  s = patch(s, { votes: {}, abstain: [] });
  if (elected) {
    s = patch(s, { lastElected: { president: g.president, chancellor: g.chancellor! } });
    if (g.enacted.red >= LEADER_ZONE) {
      if (g.quick) return resolveCheck(s, now);
      return { ...s, stage: 'leader-check', game: { ...s.game!, deadline: now + BEAT_MS } };
    }
    return startSession(s, now);
  }
  const tracker = g.tracker + 1;
  s = patch(s, { tracker });
  return tracker >= TRACKER_MAX ? beginChaos(s, now) : nextRound(s, now);
}

/** The claims the table waits for; players who left are skipped at once. */
function beginClaims(
  state: HydraState,
  needs: ClaimNeed[],
  after: Game['after'],
  now: number,
): HydraState {
  const g = state.game!;
  const gone = needs.filter((n) => g.left.includes(n.by));
  let s = state;
  for (const n of gone)
    s = addClaim(s, { by: n.by, kind: n.kind, target: n.target, skipped: 'left', at: now });
  const open = needs.filter((n) => !g.left.includes(n.by));
  s = patch(s, {
    needs: open,
    after,
    claimDeadline: now + state.settings.claimSeconds * 1000,
    hand: [],
    peek: null,
  });
  if (!open.length) return afterClaims(s, now);
  return { ...s, stage: 'claim', game: { ...s.game!, deadline: s.game!.claimDeadline } };
}

function addClaim(state: HydraState, claim: Claim): HydraState {
  const g = state.game!;
  const clean = Object.fromEntries(
    Object.entries(claim).filter(([, v]) => v !== undefined),
  ) as unknown as Claim;
  return patchRound(state, { claims: [...currentRound(g).claims, clean] });
}

function afterClaims(state: HydraState, now: number): HydraState {
  const g = state.game!;
  const s = patch(state, { needs: [], claimDeadline: null });
  if (g.after === 'power' && g.power) {
    const next = atStage(s, 'power', now);
    return g.power === 'peek' ? patch(next, { peek: next.game!.deck.slice(0, 3) }) : next;
  }
  if (g.after === 'chaos') return beginChaos(s, now);
  return nextRound(s, now);
}

/** The government's policy goes on the board (the other is discarded). */
function enactPolicy(state: HydraState, index: number, now: number, rng: Rng): HydraState {
  const g = state.game!;
  const card = g.hand[index]!;
  const other = g.hand[1 - index]!;
  const enacted = { ...g.enacted, [card]: g.enacted[card] + 1 };
  const top = topUp(g.deck, [...g.discard, other], rng);
  let s = patch(state, { deck: top.deck, discard: top.discard, enacted, tracker: 0, hand: [] });
  s = patchTruth(s, { chancellorDiscard: other, enacted: card });
  s = patchRound(s, { session: { enacted: card, vetoed: false, shuffled: true }, tracker: 0 });
  if (top.reshuffled) s = notice(s, 'The discard pile was shuffled back into the deck.', now);
  const won = boardWin(s);
  if (won) return won;
  const power = card === 'red' ? powerAt(g.players.length, enacted.red) : null;
  s = patch(s, { power });
  return beginClaims(
    s,
    [
      { by: g.president, kind: 'president' },
      { by: g.chancellor!, kind: 'chancellor' },
    ],
    power ? 'power' : 'next',
    now,
  );
}

// ---- Acting for someone ----

/**
 * Plays `player`'s turn with a random legal move (a strict timer, the host's "Act for", or a
 * player who has left). A missing vote isn't counted; claims are never made for anyone.
 */
function actFor(
  state: HydraState,
  player: PlayerId,
  why: 'timer' | 'host' | 'left',
  now: number,
  rng: Rng,
): HydraState {
  const g = state.game;
  if (!g || !awaited(state).includes(player)) return state;
  const record = (s: HydraState, what: string) => {
    const r = currentRound(s.game!);
    return r ? patchRound(s, { autos: [...r.autos, { who: player, what }] }) : s;
  };
  const by = why === 'timer' ? 'the timer' : why === 'host' ? 'the host' : 'the table';
  const say = (s: HydraState, what: string) =>
    notice(
      s,
      `${why === 'timer' ? '⏱ Time ran out: ' : ''}${what} for ${nameOf(g, player)} by ${by}.`,
      now,
    );
  switch (state.stage) {
    case 'reveal': {
      const next = patch(state, { ready: [...g.ready, player] });
      return next.game!.ready.length >= g.players.length ? nextRoundFromReveal(next, now) : next;
    }
    case 'nominate': {
      const options = eligible(g);
      const pick = options[rng.int(options.length)]!;
      return nominate(say(state, 'a Chancellor was nominated'), pick, now, 'nomination');
    }
    case 'vote': {
      const s = record(say(state, 'the vote was left uncounted'), 'vote not counted');
      const next = patch(s, { abstain: [...g.abstain, player] });
      return awaited(next).length === 0 ? resolveVote(next, now) : next;
    }
    case 'legislate-president':
      return discard(record(say(state, 'a card was discarded'), 'discard'), rng.int(3), now, rng);
    case 'legislate-chancellor':
      return enactPolicy(record(say(state, 'a policy was enacted'), 'enact'), rng.int(2), now, rng);
    case 'veto-response':
      return answerVeto(
        record(say(state, 'the veto was answered'), 'veto answer'),
        rng.int(2) === 0,
        now,
        rng,
      );
    case 'power': {
      const power = g.power!;
      if (power === 'peek') return peekDone(record(say(state, 'the peek was closed'), 'peek'), now);
      const options = powerTargets(g, power);
      const target = options[rng.int(options.length)];
      if (!target) return nextRound(state, now);
      return usePower(record(say(state, 'a target was chosen'), power), power, target, now, true);
    }
    case 'claim':
      if (why !== 'left') return state;
      return skipClaim(state, player, 'left', now);
    default:
      return state;
  }
}

/** Plays every turn the table is waiting on from players who have left for good. */
function autopilot(state: HydraState, now: number): HydraState {
  let next = state;
  for (let i = 0; i < 200; i++) {
    const g = next.game;
    if (next.phase !== 'playing' || !g || g.left.length === 0) return next;
    const gone = awaited(next).find((p) => g.left.includes(p));
    if (!gone) return next;
    next = actFor(next, gone, 'left', now, hiddenRng(next, now + i));
  }
  return next;
}

// ---- Actions ----

const requireHost = (ctx: Ctx) =>
  ctx.isHost ? null : err('not-host', 'Only the host can do that.');

function updateSettings(
  state: HydraState,
  action: Extract<HydraAction, { type: 'update-settings' }>,
  ctx: Ctx,
): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'playing')
    return err('in-progress', 'Settings can only change between games.');
  const s: Settings = { ...state.settings };
  if (action.rebalance !== undefined) s.rebalance = action.rebalance;
  if (action.quick !== undefined) s.quick = action.quick;
  if (action.flags !== undefined) s.flags = action.flags;
  if (action.claimSeconds !== undefined) s.claimSeconds = action.claimSeconds;
  if (action.pickSeconds !== undefined) s.pickSeconds = action.pickSeconds;
  if (action.voteSeconds !== undefined) s.voteSeconds = action.voteSeconds;
  if (action.timerMode !== undefined) s.timerMode = action.timerMode;
  return { ...state, settings: s };
}

function sit(state: HydraState, playing: boolean, ctx: Ctx): Result {
  const seat = state.seats[ctx.by];
  if (!seat) return err('not-seated', 'You are not in this room.');
  if (state.phase === 'playing') return err('in-progress', 'You can sit down between games.');
  if (seat.playing === playing) return state;
  if (playing && seated(state).length >= MAX_SEATS)
    return err('full', `At most ${MAX_SEATS} can play.`);
  return { ...state, seats: { ...state.seats, [ctx.by]: { ...seat, playing } } };
}

function start(state: HydraState, ctx: Ctx): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase === 'playing') return err('in-progress', 'A game is already running.');
  const players = seated(state).slice(0, MAX_SEATS);
  if (players.length < MIN_PLAYERS)
    return err('too-few', `It takes ${MIN_PLAYERS} to 10 players: ${players.length} seated.`);
  const rng = ctx.rng;
  const n = players.length;
  const dealt = rng.shuffle(rolesFor(n));
  const roles = Object.fromEntries(players.map((p, i) => [p, dealt[i]!]));
  const portraits = {
    blue: rng.shuffle(Array.from({ length: PORTRAITS.blue }, (_, i) => i)),
    red: rng.shuffle(Array.from({ length: PORTRAITS.red }, (_, i) => i)),
  };
  const art: Record<PlayerId, number> = {};
  for (const p of players) {
    const r = roles[p]!;
    art[p] = r === 'leader' ? 0 : (portraits[r].shift() ?? 0);
  }
  const s = state.settings;
  const setup = setupFor(n, s.rebalance);
  const first = players[rng.int(n)]!;
  const game: Game = {
    players,
    names: Object.fromEntries(players.map((p) => [p, state.seats[p]!.name])),
    roles,
    art,
    rebalance: s.rebalance,
    quick: s.quick,
    flags: s.flags,
    ready: [],
    dead: [],
    left: [],
    deck: newDeck(setup.blue, setup.red, rng),
    discard: [],
    total: setup.blue + setup.red + setup.redEnacted,
    enacted: { blue: 0, red: setup.redEnacted },
    tracker: 0,
    president: first,
    rotation: first,
    specialNext: null,
    special: false,
    chancellor: null,
    lastElected: null,
    votes: {},
    abstain: [],
    hand: [],
    vetoRequested: false,
    vetoRefused: false,
    power: null,
    peek: null,
    investigated: [],
    cleared: [],
    needs: [],
    claimDeadline: null,
    after: 'next',
    memories: {},
    rounds: [],
    truth: [],
    notices: [],
    noticeSeq: 0,
    nudges: {},
    deadline: null,
    winner: null,
    reason: null,
    startedAt: ctx.now,
  };
  return {
    ...state,
    phase: 'playing',
    stage: 'reveal',
    seed: newSeed(rng),
    gamesPlayed: state.gamesPlayed + 1,
    game,
  };
}

/** The game in play, if `by` is dealt in and alive, and it's at `stage`. */
function gameAt(state: HydraState, by: PlayerId, stage: Stage): Game | GameError {
  const g = state.game;
  if (state.phase !== 'playing' || !g) return err('not-playing', 'No game in play.');
  if (!g.players.includes(by))
    return err('watching', 'You’re watching this game. You can play in the next one.');
  if (g.dead.includes(by) && stage !== 'reveal')
    return err('dead', 'You’ve been executed: you can’t speak, vote or act any more.');
  if (state.stage !== stage) {
    const msg: Record<Stage, string> = {
      reveal: 'Everyone has already seen their role.',
      nominate: 'It isn’t time to nominate a Chancellor.',
      vote: 'There’s no government to vote on right now.',
      'leader-check': 'Wait a moment.',
      'legislate-president': 'The President isn’t choosing a card right now.',
      'legislate-chancellor': 'The Chancellor isn’t choosing a card right now.',
      'veto-response': 'Nobody has asked for a veto.',
      claim: 'Nobody is claiming right now.',
      power: 'There’s no power to use right now.',
      chaos: 'Wait a moment.',
    };
    return err('wrong-stage', msg[stage]);
  }
  return g;
}

function nextRoundFromReveal(state: HydraState, now: number): HydraState {
  // The first President was drawn at the start; they simply nominate.
  return atStage(state, 'nominate', now);
}

function ready(state: HydraState, ctx: Ctx): Result {
  const g = gameAt(state, ctx.by, 'reveal');
  if (g instanceof GameError) return g;
  if (g.ready.includes(ctx.by)) return state;
  const next = patch(state, { ready: [...g.ready, ctx.by] });
  return next.game!.ready.length >= g.players.length ? nextRoundFromReveal(next, ctx.now) : next;
}

const REASON_TEXT: Record<Ineligible, (name: string) => string> = {
  self: () => 'You can’t nominate yourself.',
  dead: (n) => `${n} has been executed.`,
  'term-limit-chancellor': (n) => `${n} was the last elected Chancellor, so they’re term-limited.`,
  'term-limit-president': (n) =>
    `${n} was the last elected President, so they’re term-limited (until only five are left).`,
  investigated: (n) => `${n} has already been investigated.`,
};

function nominate(state: HydraState, player: PlayerId, now: number, auto?: string): HydraState {
  const g = state.game!;
  const round: Round = {
    n: g.rounds.length + 1,
    president: g.president,
    chancellor: player,
    special: g.special,
    votes: {},
    missing: [],
    elected: null,
    tracker: g.tracker,
    session: null,
    chaos: null,
    power: null,
    claims: [],
    cleared: false,
    autos: auto ? [{ who: g.president, what: auto }] : [],
  };
  return atStage(
    patch(state, { chancellor: player, votes: {}, abstain: [], rounds: [...g.rounds, round] }),
    'vote',
    now,
  );
}

function nominateAction(state: HydraState, player: PlayerId, ctx: Ctx): Result {
  const g = gameAt(state, ctx.by, 'nominate');
  if (g instanceof GameError) return g;
  if (g.president !== ctx.by)
    return err('not-president', 'Only the Presidential Candidate nominates a Chancellor.');
  if (!g.players.includes(player)) return err('bad-player', 'That player isn’t in this game.');
  const why = ineligibility(g)[player];
  if (why) return err(why, REASON_TEXT[why](nameOf(g, player)));
  return nominate(state, player, ctx.now);
}

function vote(state: HydraState, ballot: Ballot, ctx: Ctx): Result {
  const g = gameAt(state, ctx.by, 'vote');
  if (g instanceof GameError) return g;
  const next = patch(state, {
    votes: { ...g.votes, [ctx.by]: ballot },
    abstain: g.abstain.filter((p) => p !== ctx.by),
  });
  return awaited(next).length === 0 ? resolveVote(next, ctx.now) : next;
}

function discard(state: HydraState, index: number, now: number, rng: Rng): HydraState {
  const g = state.game!;
  const card = g.hand[index]!;
  const rest = g.hand.filter((_, i) => i !== index);
  // Shuffled, so the order the President leaves them in can't signal anything.
  const passed = rng.shuffle(rest);
  const round = currentRound(g).n;
  const remember = (id: PlayerId, as: 'president' | 'chancellor', cards: Policy[]) => [
    ...(g.memories[id] ?? []),
    { kind: 'hand' as const, round, as, cards: [...cards] },
  ];
  const memories = { ...g.memories, [g.president]: remember(g.president, 'president', g.hand) };
  memories[g.chancellor!] = [
    ...(memories[g.chancellor!] ?? []),
    { kind: 'hand', round, as: 'chancellor', cards: [...passed] },
  ];
  let s = patch(state, { hand: passed, discard: [...g.discard, card], memories });
  s = patchTruth(s, { presidentDiscard: card, chancellorHand: [...passed] });
  return atStage(s, 'legislate-chancellor', now);
}

function discardAction(state: HydraState, index: number, ctx: Ctx): Result {
  const g = gameAt(state, ctx.by, 'legislate-president');
  if (g instanceof GameError) return g;
  if (g.president !== ctx.by) return err('not-president', 'Only the President discards now.');
  if (!g.hand[index]) return err('bad-card', 'Pick one of your three cards.');
  return discard(state, index, ctx.now, ctx.rng);
}

function enactAction(state: HydraState, index: number, ctx: Ctx): Result {
  const g = gameAt(state, ctx.by, 'legislate-chancellor');
  if (g instanceof GameError) return g;
  if (g.chancellor !== ctx.by) return err('not-chancellor', 'Only the Chancellor enacts a policy.');
  if (!g.hand[index]) return err('bad-card', 'Pick one of your two cards.');
  return enactPolicy(state, index, ctx.now, ctx.rng);
}

function vetoAction(state: HydraState, ctx: Ctx): Result {
  const g = gameAt(state, ctx.by, 'legislate-chancellor');
  if (g instanceof GameError) return g;
  if (g.chancellor !== ctx.by)
    return err('not-chancellor', 'Only the Chancellor can ask for a veto.');
  if (!vetoUnlocked(g))
    return err('veto-locked', `The veto unlocks once ${VETO_ZONE} red policies are on the board.`);
  if (g.vetoRequested)
    return err(
      'veto-asked',
      g.vetoRefused
        ? 'The President refused the veto: you must enact one.'
        : 'You’ve already asked.',
    );
  return atStage(patch(state, { vetoRequested: true }), 'veto-response', ctx.now);
}

function answerVeto(state: HydraState, agree: boolean, now: number, rng: Rng): HydraState {
  const g = state.game!;
  if (!agree)
    return atStage(
      notice(patch(state, { vetoRefused: true }), 'The President refused the veto.', now),
      'legislate-chancellor',
      now,
    );
  const tracker = g.tracker + 1;
  const top = topUp(g.deck, [...g.discard, ...g.hand], rng);
  let s = patch(state, { deck: top.deck, discard: top.discard, hand: [], tracker });
  s = patchTruth(s, { vetoed: true });
  s = patchRound(s, { session: { enacted: null, vetoed: true, shuffled: true }, tracker });
  s = notice(s, 'The agenda was vetoed: both policies were discarded.', now);
  if (top.reshuffled) s = notice(s, 'The discard pile was shuffled back into the deck.', now);
  return beginClaims(
    s,
    [
      { by: g.president, kind: 'president' },
      { by: g.chancellor!, kind: 'chancellor' },
    ],
    tracker >= TRACKER_MAX ? 'chaos' : 'next',
    now,
  );
}

function vetoAnswerAction(state: HydraState, agree: boolean, ctx: Ctx): Result {
  const g = gameAt(state, ctx.by, 'veto-response');
  if (g instanceof GameError) return g;
  if (g.president !== ctx.by) return err('not-president', 'Only the President answers a veto.');
  return answerVeto(state, agree, ctx.now, ctx.rng);
}

function usePower(
  state: HydraState,
  power: Power,
  target: PlayerId,
  now: number,
  auto: boolean,
): HydraState {
  const g = state.game!;
  let s = patchRound(state, { power: { kind: power, target, auto } });
  s = patch(s, { power: null });
  switch (power) {
    case 'investigate': {
      const team = teamOf(g.roles[target]!);
      const mine = g.memories[g.president] ?? [];
      const round = currentRound(g).n;
      s = patch(s, {
        investigated: [...g.investigated, target],
        memories: {
          ...g.memories,
          [g.president]: [...mine, { kind: 'investigate', round, target, team }],
        },
      });
      s = patchTruth(s, { investigate: { target, team } });
      return beginClaims(s, [{ by: g.president, kind: 'investigate', target }], 'next', now);
    }
    case 'special':
      s = notice(
        patch(s, { specialNext: target, rotation: g.president }),
        `${nameOf(g, g.president)} called a special election: ${nameOf(g, target)} is the next Presidential Candidate.`,
        now,
      );
      return nextRound(s, now);
    case 'execute': {
      s = patch(s, { dead: [...g.dead, target] });
      s = notice(s, `${nameOf(g, target)} has been executed and can no longer speak or vote.`, now);
      if (g.roles[target] === 'leader') return finish(s, 'blue', 'leader-executed');
      return nextRound(s, now);
    }
    case 'peek':
      return s;
  }
}

function peekDone(state: HydraState, now: number): HydraState {
  const g = state.game!;
  const cards = g.deck.slice(0, 3);
  const round = currentRound(g).n;
  let s = patchRound(state, { power: { kind: 'peek', target: null, auto: false } });
  s = patch(s, {
    power: null,
    peek: null,
    memories: {
      ...g.memories,
      [g.president]: [...(g.memories[g.president] ?? []), { kind: 'peek', round, cards }],
    },
  });
  s = patchTruth(s, { peek: [...cards] });
  return beginClaims(s, [{ by: g.president, kind: 'peek' }], 'next', now);
}

function powerAction(
  state: HydraState,
  power: Exclude<Power, 'peek'>,
  target: PlayerId,
  ctx: Ctx,
): Result {
  const g = gameAt(state, ctx.by, 'power');
  if (g instanceof GameError) return g;
  if (g.president !== ctx.by) return err('not-president', 'Only the President uses the power.');
  if (g.power !== power) return err('wrong-power', 'That isn’t the power on the board right now.');
  if (target === ctx.by) return err('self', 'Pick someone else.');
  if (!g.players.includes(target)) return err('bad-player', 'That player isn’t in this game.');
  if (g.dead.includes(target)) return err('dead', `${nameOf(g, target)} has been executed.`);
  if (power === 'investigate' && g.investigated.includes(target))
    return err(
      'investigated',
      `${nameOf(g, target)} has already been investigated. Nobody can be investigated twice.`,
    );
  return usePower(state, power, target, ctx.now, false);
}

function peekAction(state: HydraState, ctx: Ctx): Result {
  const g = gameAt(state, ctx.by, 'power');
  if (g instanceof GameError) return g;
  if (g.president !== ctx.by) return err('not-president', 'Only the President uses the power.');
  if (g.power !== 'peek') return err('wrong-power', 'That isn’t the power on the board right now.');
  return peekDone(state, ctx.now);
}

function claimAction(
  state: HydraState,
  action: Extract<HydraAction, { type: 'claim' }>,
  ctx: Ctx,
): Result {
  const g = gameAt(state, ctx.by, 'claim');
  if (g instanceof GameError) return g;
  const need = g.needs.find((n) => n.by === ctx.by);
  if (!need) {
    const made = currentRound(g).claims.some((c) => c.by === ctx.by);
    return err(
      made ? 'claimed' : 'no-claim',
      made ? 'Claims are final: yours is already in.' : 'You have nothing to claim right now.',
    );
  }
  const claim: Claim = { by: ctx.by, kind: need.kind, at: ctx.now };
  switch (need.kind) {
    case 'president':
    case 'chancellor': {
      const max = need.kind === 'president' ? 3 : 2;
      if (action.blues === undefined || action.blues > max)
        return err('bad-claim', `Say how many of your ${max} cards were blue.`);
      claim.blues = action.blues;
      if (need.kind === 'president') {
        const d = action.discarded;
        if (!d) return err('bad-claim', 'Say which colour you discarded.');
        if ((d === 'blue' && action.blues === 0) || (d === 'red' && action.blues === 3))
          return err('bad-claim', 'You can only discard a colour you say you drew.');
        claim.discarded = d;
      }
      break;
    }
    case 'peek':
      if (!action.cards) return err('bad-claim', 'Say the top three cards, in order.');
      claim.cards = [...action.cards];
      break;
    case 'investigate':
      if (!action.team) return err('bad-claim', 'Say which colour you saw.');
      claim.target = need.target;
      claim.team = action.team;
      break;
  }
  return settleNeed(addClaim(state, claim), ctx.by, ctx.now);
}

function settleNeed(state: HydraState, by: PlayerId, now: number): HydraState {
  const g = state.game!;
  const needs = g.needs.filter((n) => n.by !== by);
  const s = patch(state, { needs });
  return needs.length ? s : afterClaims(s, now);
}

function skipClaim(
  state: HydraState,
  player: PlayerId,
  why: 'host' | 'left',
  now: number,
): HydraState {
  const g = state.game!;
  const need = g.needs.find((n) => n.by === player);
  if (!need) return state;
  let s = addClaim(state, {
    by: player,
    kind: need.kind,
    target: need.target,
    skipped: why,
    at: now,
  });
  if (why === 'host') s = notice(s, `The host skipped ${nameOf(g, player)}’s claim.`, now);
  return settleNeed(s, player, now);
}

function skipClaimAction(state: HydraState, player: PlayerId, ctx: Ctx): Result {
  const e = requireHost(ctx);
  if (e) return e;
  const g = state.game;
  if (state.phase !== 'playing' || !g || state.stage !== 'claim')
    return err('wrong-stage', 'Nobody is claiming right now.');
  if (!g.needs.some((n) => n.by === player))
    return err('not-waiting', 'The table isn’t waiting on that player’s claim.');
  if (g.claimDeadline !== null && ctx.now < g.claimDeadline)
    return err('too-soon', 'Give them until the claim timer runs out.');
  return skipClaim(state, player, 'host', ctx.now);
}

function actForAction(state: HydraState, player: PlayerId, ctx: Ctx): Result {
  const e = requireHost(ctx);
  if (e) return e;
  if (state.phase !== 'playing') return err('not-playing', 'No game in play.');
  if (state.stage === 'claim')
    return err(
      'use-skip',
      'Claims are never made for anyone: skip the claim once the timer runs out.',
    );
  if (!awaited(state).includes(player))
    return err('not-waiting', 'The table isn’t waiting on that player.');
  return actFor(state, player, 'host', ctx.now, ctx.rng);
}

function nudgeAction(state: HydraState, player: PlayerId, ctx: Ctx): Result {
  const g = state.game;
  if (state.phase !== 'playing' || !g) return err('not-playing', 'No game in play.');
  if (player === ctx.by) return err('self', 'You can’t nudge yourself.');
  if (!awaited(state).includes(player))
    return err('not-waiting', 'The table isn’t waiting on that player.');
  const last = g.nudges[player];
  if (last !== undefined && ctx.now - last < NUDGE_MS)
    return err('too-soon', `${nameOf(g, player)} was just nudged.`);
  return patch(state, { nudges: { ...g.nudges, [player]: ctx.now } });
}

function reduce(state: HydraState, action: HydraAction, ctx: Ctx): Result {
  const out = reduceOne(state, action, ctx);
  return out instanceof GameError ? out : autopilot(out, ctx.now);
}

function reduceOne(state: HydraState, action: HydraAction, ctx: Ctx): Result {
  switch (action.type) {
    case 'update-settings':
      return updateSettings(state, action, ctx);
    case 'sit':
      return sit(state, action.playing, ctx);
    case 'start':
      return start(state, ctx);
    case 'ready':
      return ready(state, ctx);
    case 'nominate':
      return nominateAction(state, action.player, ctx);
    case 'vote':
      return vote(state, action.ballot, ctx);
    case 'discard':
      return discardAction(state, action.index, ctx);
    case 'enact':
      return enactAction(state, action.index, ctx);
    case 'veto':
      return vetoAction(state, ctx);
    case 'veto-answer':
      return vetoAnswerAction(state, action.agree, ctx);
    case 'investigate':
    case 'special':
    case 'execute':
      return powerAction(state, action.type, action.player, ctx);
    case 'peek-done':
      return peekAction(state, ctx);
    case 'claim':
      return claimAction(state, action, ctx);
    case 'skip-claim':
      return skipClaimAction(state, action.player, ctx);
    case 'act-for':
      return actForAction(state, action.player, ctx);
    case 'nudge':
      return nudgeAction(state, action.player, ctx);
    case 'back-to-lobby': {
      const e = requireHost(ctx);
      if (e) return e;
      return { ...state, phase: 'lobby', stage: null, game: null };
    }
  }
}

// ---- Players coming and going ----

export const DEFAULT_SETTINGS: Settings = {
  rebalance: false,
  quick: false,
  flags: true,
  claimSeconds: DEFAULT_CLAIM_SECONDS,
  pickSeconds: null,
  voteSeconds: null,
  timerMode: 'soft',
};

function create(ctx: CreateCtx, players: readonly PlayerInfo[]): HydraState {
  let state: HydraState = {
    phase: 'lobby',
    stage: null,
    settings: { ...DEFAULT_SETTINGS },
    seed: newSeed(ctx.rng),
    table: newSeed(ctx.rng),
    seats: {},
    game: null,
    gamesPlayed: 0,
  };
  for (const p of players) state = playerJoined(state, p);
  return state;
}

/** Watchers waiting for a seat sit down, in join order, while there's room (between games). */
function fillSeats(state: HydraState): HydraState {
  if (state.phase === 'playing') return state;
  let free = MAX_SEATS - seated(state).length;
  if (free <= 0) return state;
  const seats = { ...state.seats };
  for (const [id, s] of Object.entries(seats)) {
    if (free <= 0) break;
    if (!s.playing) {
      seats[id] = { ...s, playing: true };
      free -= 1;
    }
  }
  return { ...state, seats };
}

function playerJoined(state: HydraState, player: PlayerInfo): HydraState {
  const existing = state.seats[player.id];
  const g = state.game;
  const inGame = !!g?.players.includes(player.id);
  let next: HydraState = {
    ...state,
    seats: {
      ...state.seats,
      [player.id]: existing
        ? { ...existing, name: player.name }
        : {
            name: player.name,
            playing: inGame || (state.phase !== 'playing' && seated(state).length < MAX_SEATS),
          },
    },
  };
  if (g && inGame)
    next = patch(next, {
      names: { ...g.names, [player.id]: player.name },
      left: g.left.filter((p) => p !== player.id),
    });
  return next;
}

/**
 * Someone left for good. Mid-game they keep their seat and role, and the game plays their turns
 * (random legal moves; their votes aren't counted and their claims are skipped).
 */
function playerLeft(state: HydraState, playerId: PlayerId, now: number): HydraState {
  if (!state.seats[playerId]) return state;
  const seats = { ...state.seats };
  delete seats[playerId];
  let next = fillSeats({ ...state, seats });
  const g = next.game;
  if (next.phase === 'playing' && g?.players.includes(playerId) && !g.left.includes(playerId)) {
    next = patch(next, { left: [...g.left, playerId] });
    next = autopilot(next, now);
  }
  return next;
}

// ---- Timers ----

function nextDeadline(state: HydraState): number | null {
  const g = state.game;
  if (state.phase !== 'playing' || !g) return null;
  if (state.stage === 'leader-check' || state.stage === 'chaos') return g.deadline;
  if (state.settings.timerMode !== 'strict' || !state.stage || !TIMED[state.stage]) return null;
  return g.deadline;
}

function onDeadline(state: HydraState, now: number): HydraState {
  const due = nextDeadline(state);
  if (due === null || now < due) return state;
  const rng = hiddenRng(state, now);
  if (state.stage === 'leader-check') return autopilot(resolveCheck(state, now), now);
  if (state.stage === 'chaos') return autopilot(resolveChaos(state, now, rng), now);
  const stage = state.stage;
  let next = state;
  for (const p of awaited(state)) {
    if (next.stage !== stage || next.phase !== 'playing') break;
    next = actFor(next, p, 'timer', now, hiddenRng(next, now + p.length));
  }
  if (next === state) return patch(state, { deadline: null });
  return autopilot(next, now);
}

// ---- Views ----

function knownBy(g: Game, viewer: PlayerId): Known[] {
  const r = g.roles[viewer];
  if (r === 'blue' || r === undefined) return [];
  if (r === 'leader' && !leaderKnowsTeam(g.players.length)) return [];
  return g.players
    .filter((p) => p !== viewer && g.roles[p] !== 'blue')
    .map((p) => ({ id: p, role: g.roles[p] as 'red' | 'leader' }));
}

function myRole(g: Game, viewer: PlayerId): MyRole | null {
  const r = g.roles[viewer];
  if (!r) return null;
  return { role: r, team: teamOf(r), art: g.art[viewer] ?? 0, known: knownBy(g, viewer) };
}

function handFor(state: HydraState, g: Game, viewer: PlayerId | null) {
  if (viewer === null) return null;
  switch (state.stage) {
    case 'legislate-president':
      return viewer === g.president ? [...g.hand] : null;
    case 'legislate-chancellor':
      return viewer === g.chancellor ? [...g.hand] : null;
    case 'veto-response':
      return viewer === g.chancellor || viewer === g.president ? [...g.hand] : null;
    default:
      return null;
  }
}

function gameView(state: HydraState, g: Game, viewer: PlayerId | null): GameView {
  const over = state.phase === 'over';
  return {
    players: g.players.map((id) => ({
      id,
      name: state.seats[id]?.name ?? g.names[id] ?? 'Someone',
      dead: g.dead.includes(id),
      left: g.left.includes(id),
    })),
    total: g.total,
    totalBlue: BLUE_CARDS,
    deckCount: g.deck.length,
    discardCount: g.discard.length,
    enacted: { ...g.enacted },
    tracker: g.tracker,
    president: g.president,
    chancellor: g.chancellor,
    special: g.special,
    nextPresident: upNext(g),
    lastElected: g.lastElected ? { ...g.lastElected } : null,
    ineligible: ineligibility(g),
    ready: [...g.ready],
    voted: state.stage === 'vote' ? g.players.filter((p) => p in g.votes) : [],
    myVote: state.stage === 'vote' && viewer !== null ? (g.votes[viewer] ?? null) : null,
    hand: over ? null : handFor(state, g, viewer),
    vetoRequested: g.vetoRequested,
    vetoRefused: g.vetoRefused,
    vetoUnlocked: vetoUnlocked(g),
    power: state.stage === 'power' ? g.power : null,
    peek: state.stage === 'power' && viewer === g.president && g.peek ? [...g.peek] : null,
    investigated: [...g.investigated],
    cleared: [...g.cleared],
    needs: g.needs.map((n) => ({ ...n })),
    claimDeadline: g.claimDeadline,
    memories: viewer !== null ? (g.memories[viewer] ?? []).map((m) => ({ ...m })) : [],
    rounds: g.rounds,
    notices: g.notices,
    nudges: { ...g.nudges },
    deadline: state.phase === 'playing' ? g.deadline : null,
    rebalance: g.rebalance,
    quick: g.quick,
    flags: g.flags,
    end:
      over && g.winner && g.reason
        ? {
            winner: g.winner,
            reason: g.reason,
            roles: { ...g.roles },
            art: { ...g.art },
            truth: g.truth,
          }
        : null,
  };
}

function view(state: HydraState, viewer: PlayerId | null): HydraView {
  const seats: SeatView[] = Object.entries(state.seats).map(([id, s]) => ({
    id,
    name: s.name,
    playing: s.playing,
  }));
  const g = state.game;
  return {
    phase: state.phase,
    table: state.table,
    stage: state.stage,
    settings: { ...state.settings },
    seats,
    me: viewer === null ? null : (seats.find((s) => s.id === viewer) ?? null),
    role: g && viewer !== null ? myRole(g, viewer) : null,
    game: g ? gameView(state, g, viewer) : null,
    gamesPlayed: state.gamesPlayed,
  };
}

export { countBlue };

export const hydra: GameDefinition<HydraState, HydraAction, HydraView> = {
  id: 'hydra',
  name: 'Hydra',
  description:
    'A hidden-role election game: elect governments, pass policies, and unmask the Leader before it’s too late.',
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
  awards: hydraAwards,
};
