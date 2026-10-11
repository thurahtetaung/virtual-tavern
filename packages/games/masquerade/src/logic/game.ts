import {
  type ActionCtx,
  type CreateCtx,
  type GameDefinition,
  GameError,
  type GameGuide,
  type PlayerId,
  type PlayerInfo,
  type Rng,
  createRng,
} from '@vt/game-sdk';
import { insightsFor } from './insights.ts';
import {
  DEFAULT_ROUND_SECONDS,
  GUESS_SECONDS,
  MAX_SEATS,
  MIN_PLAYERS,
  type MasqueradeAction,
  type MasqueradeState,
  type MasqueradeView,
  type Pack,
  type Round,
  type RoundResult,
  type SeatView,
  type SpyOutcome,
  TWO_SPIES_MIN,
  VOTE_SECONDS,
  actionSchema,
} from './types.ts';

type Ctx = ActionCtx;
type Result = MasqueradeState | GameError;

export interface MasqueradeConfig {
  id: string;
  name: string;
  description: string;
  access?: 'public' | 'private';
  pack: Pack;
  guide: GameGuide;
  /** A readable name for a location id, for the stats page. Defaults to the id. */
  locationName?: (id: string) => string;
}

// ---- Pure helpers (also used by the UI and tests) ----

/** Seated players, in seat order. */
export function seated(state: Pick<MasqueradeState, 'seats'>): PlayerId[] {
  return Object.entries(state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));
}

/** How many spies a round with `players` players gets. */
export const spyCountFor = (twoSpies: boolean, players: number) =>
  twoSpies && players >= TWO_SPIES_MIN ? 2 : 1;

/** Every location in the chosen editions, in pack order, without repeats. */
export function locationsFor(pack: Pack, editions: readonly string[]): string[] {
  const out: string[] = [];
  for (const e of pack.editions) {
    if (!editions.includes(e.id)) continue;
    for (const l of e.locations) if (!out.includes(l)) out.push(l);
  }
  return out;
}

/** Votes received by each player. */
export function tally(votes: Record<PlayerId, PlayerId>): Map<PlayerId, number> {
  const counts = new Map<PlayerId, number>();
  for (const target of Object.values(votes)) counts.set(target, (counts.get(target) ?? 0) + 1);
  return counts;
}

/**
 * Who the vote names, with `k` spies: a player with at least one vote is named when no more than
 * `k` players (themselves included) have at least as many votes. One spy: only a lone leader is
 * named (a tie at the top names nobody). Two spies: the top two, unless a tie makes "the top two"
 * ambiguous: 3-3-1 names both leaders, 3-2-2 names only the leader, 3-3-3 names nobody.
 */
export function namedBy(
  votes: Record<PlayerId, PlayerId>,
  players: readonly PlayerId[],
  k: number,
): PlayerId[] {
  const counts = tally(votes);
  const n = (id: PlayerId) => counts.get(id) ?? 0;
  return players.filter((p) => n(p) > 0 && players.filter((q) => n(q) >= n(p)).length <= k);
}

/** Points for a finished round. */
export function scoreRound(
  round: Pick<Round, 'players' | 'spies' | 'caught' | 'guesses' | 'votes' | 'location'>,
): { points: Record<PlayerId, number>; spyResults: RoundResult['spyResults'] } {
  const points: Record<PlayerId, number> = Object.fromEntries(round.players.map((p) => [p, 0]));
  const locals = round.players.filter((p) => !round.spies.includes(p));
  const spyResults: RoundResult['spyResults'] = [];
  for (const spy of round.spies) {
    const caught = round.caught.includes(spy);
    const guess = caught ? (round.guesses[spy] ?? null) : null;
    let outcome: SpyOutcome;
    if (!caught) outcome = 'escaped';
    else outcome = guess === round.location ? 'stole' : 'caught';
    if (outcome !== 'caught') points[spy] = (points[spy] ?? 0) + 2;
    else {
      for (const l of locals) points[l] = (points[l] ?? 0) + 1 + (round.votes[l] === spy ? 1 : 0);
    }
    spyResults.push({ id: spy, outcome, guess });
  }
  return { points, spyResults };
}

const newSeed = (rng: Rng) => rng.int(2 ** 32);
const hiddenRng = (state: MasqueradeState, now: number) => createRng((state.seed ^ now) >>> 0);

export function defineMasquerade(
  config: MasqueradeConfig,
): GameDefinition<MasqueradeState, MasqueradeAction, MasqueradeView> {
  const { pack } = config;
  const editionIds = pack.editions.map((e) => e.id);

  // ---- Round flow ----

  /** Deals round `number`: new spies, a new location and a fresh clock. */
  function deal(state: MasqueradeState, number: number, now: number, rng: Rng): MasqueradeState {
    const players = seated(state).slice(0, MAX_SEATS);
    const pool = locationsFor(pack, state.settings.editions);
    let used = state.used.filter((l) => pool.includes(l));
    let open = pool.filter((l) => !used.includes(l));
    if (open.length === 0) {
      used = [];
      open = pool;
    }
    const location = open[rng.int(open.length)]!;
    const spies = rng
      .shuffle(players)
      .slice(0, spyCountFor(state.settings.twoSpies, players.length));
    const starter = players[(state.starterOffset + number - 1) % players.length]!;
    const round: Round = {
      number,
      deal: state.deals + 1,
      players,
      names: Object.fromEntries(players.map((p) => [p, state.seats[p]!.name])),
      starter,
      location,
      spies,
      stage: 'talk',
      deadline: now + state.settings.roundSeconds * 1000,
      ready: [],
      votes: {},
      named: [],
      caught: [],
      guesses: {},
      result: null,
      redealtAfter: null,
    };
    return {
      ...state,
      seed: newSeed(rng),
      deals: state.deals + 1,
      used: [...used, location],
      round,
    };
  }

  const withRound = (state: MasqueradeState, patch: Partial<Round>): MasqueradeState => ({
    ...state,
    round: { ...state.round!, ...patch },
  });

  function startVote(state: MasqueradeState, now: number): MasqueradeState {
    return withRound(state, { stage: 'vote', deadline: now + VOTE_SECONDS * 1000 });
  }

  /** The vote is in: name the suspects, then caught spies guess, or straight to the reveal. */
  function resolveVote(state: MasqueradeState, now: number): MasqueradeState {
    const round = state.round!;
    const named = namedBy(round.votes, round.players, round.spies.length);
    const caught = round.spies.filter((s) => named.includes(s));
    const next = withRound(state, { named, caught });
    if (caught.length > 0)
      return withRound(next, { stage: 'guess', deadline: now + GUESS_SECONDS * 1000 });
    return finishRound(next);
  }

  function finishRound(state: MasqueradeState): MasqueradeState {
    const round = state.round!;
    const { points, spyResults } = scoreRound(round);
    const result: RoundResult = {
      location: round.location,
      spies: [...round.spies],
      votes: { ...round.votes },
      named: [...round.named],
      spyResults,
      points,
    };
    const seats = { ...state.seats };
    for (const [id, p] of Object.entries(points)) {
      const seat = seats[id];
      if (seat && p) seats[id] = { ...seat, score: seat.score + p };
    }
    const next: MasqueradeState = {
      ...state,
      seats,
      round: { ...round, stage: 'reveal', deadline: null, result },
    };
    if (round.number >= state.totalRounds) return endGame(next);
    return next;
  }

  function endGame(state: MasqueradeState): MasqueradeState {
    const players = seated(state);
    const pool = players.length > 0 ? players : Object.keys(state.seats);
    const top = Math.max(0, ...pool.map((id) => state.seats[id]!.score));
    return {
      ...state,
      phase: 'over',
      winners: top > 0 ? pool.filter((id) => state.seats[id]!.score === top) : [],
    };
  }

  function toLobby(state: MasqueradeState, notice: MasqueradeState['notice']): MasqueradeState {
    return { ...state, phase: 'lobby', round: null, notice, winners: [] };
  }

  // ---- Actions ----

  const requireHost = (ctx: Ctx) =>
    ctx.isHost ? null : new GameError('not-host', 'Only the host can do that.');

  function updateSettings(
    state: MasqueradeState,
    action: Extract<MasqueradeAction, { type: 'update-settings' }>,
    ctx: Ctx,
  ): Result {
    const err = requireHost(ctx);
    if (err) return err;
    if (state.phase === 'playing')
      return new GameError('in-progress', 'Settings can only change between games.');
    const settings = { ...state.settings };
    if (action.editions) {
      const chosen = [...new Set(action.editions)];
      if (chosen.some((e) => !editionIds.includes(e)))
        return new GameError('bad-edition', 'Pick from the editions listed.');
      settings.editions = editionIds.filter((e) => chosen.includes(e));
    }
    if (action.roundSeconds !== undefined) settings.roundSeconds = action.roundSeconds;
    if (action.rounds !== undefined) settings.rounds = action.rounds;
    if (action.twoSpies !== undefined) settings.twoSpies = action.twoSpies;
    return { ...state, settings };
  }

  function start(state: MasqueradeState, ctx: Ctx): Result {
    const err = requireHost(ctx);
    if (err) return err;
    if (state.phase === 'playing')
      return new GameError('in-progress', 'A game is already running.');
    const players = seated(state);
    if (players.length < MIN_PLAYERS)
      return new GameError('too-few', `${MIN_PLAYERS} players are needed.`);
    if (locationsFor(pack, state.settings.editions).length === 0)
      return new GameError('no-locations', 'Pick at least one edition.');
    const seats = Object.fromEntries(
      Object.entries(state.seats).map(([id, s]) => [id, { ...s, score: 0 }]),
    );
    const next: MasqueradeState = {
      ...state,
      phase: 'playing',
      seats,
      totalRounds: state.settings.rounds ?? players.length,
      round: null,
      used: [],
      notice: null,
      winners: [],
      starterOffset: ctx.rng.int(players.length),
      gamesPlayed: state.gamesPlayed + 1,
    };
    return deal(next, 1, ctx.now, ctx.rng);
  }

  /** The round in play, if `by` is dealt in and it's at `stage`. */
  function roundFor(state: MasqueradeState, by: PlayerId, stage: Round['stage']) {
    const round = state.round;
    if (state.phase !== 'playing' || !round)
      return new GameError('not-playing', 'No round in play.');
    if (!round.players.includes(by))
      return new GameError('watching', 'You join in from the next round.');
    if (round.stage !== stage) {
      const msg: Record<Round['stage'], string> = {
        talk: 'The vote has already started.',
        vote: 'The vote hasn’t started yet.',
        guess: 'Only a spy caught by the vote can guess, after the vote.',
        reveal: 'This round is over.',
      };
      return new GameError('wrong-stage', msg[stage]);
    }
    return round;
  }

  function readyToVote(state: MasqueradeState, ready: boolean, ctx: Ctx): Result {
    const round = roundFor(state, ctx.by, 'talk');
    if (round instanceof GameError) return round;
    const others = round.ready.filter((p) => p !== ctx.by);
    const next = withRound(state, { ready: ready ? [...others, ctx.by] : others });
    if (next.round!.ready.length >= round.players.length) return startVote(next, ctx.now);
    return next;
  }

  function vote(state: MasqueradeState, target: PlayerId, ctx: Ctx): Result {
    const round = roundFor(state, ctx.by, 'vote');
    if (round instanceof GameError) return round;
    if (target === ctx.by) return new GameError('self-vote', 'Vote for someone else.');
    if (!round.players.includes(target))
      return new GameError('bad-target', 'That player isn’t in this round.');
    const next = withRound(state, { votes: { ...round.votes, [ctx.by]: target } });
    if (round.players.every((p) => p in next.round!.votes)) return resolveVote(next, ctx.now);
    return next;
  }

  function spyGuess(state: MasqueradeState, location: string, ctx: Ctx): Result {
    const round = state.round;
    if (
      state.phase !== 'playing' ||
      !round ||
      round.stage !== 'guess' ||
      !round.caught.includes(ctx.by)
    ) {
      return new GameError('no-guess', 'Only a spy caught by the vote can guess, after the vote.');
    }
    if (ctx.by in round.guesses) return new GameError('guessed', 'You have already guessed.');
    if (!locationsFor(pack, state.settings.editions).includes(location))
      return new GameError('bad-location', 'Pick a location from the board.');
    const guesses = { ...round.guesses, [ctx.by]: location };
    const next = withRound(state, { guesses });
    if (round.caught.every((s) => s in guesses)) return finishRound(next);
    return next;
  }

  function nextRound(state: MasqueradeState, ctx: Ctx): Result {
    const err = requireHost(ctx);
    if (err) return err;
    const round = state.round;
    if (state.phase !== 'playing' || !round || round.stage !== 'reveal')
      return new GameError('wrong-stage', 'Finish this round first.');
    if (seated(state).length < MIN_PLAYERS)
      return new GameError('too-few', `${MIN_PLAYERS} players are needed.`);
    return deal(state, round.number + 1, ctx.now, ctx.rng);
  }

  function reduce(state: MasqueradeState, action: MasqueradeAction, ctx: Ctx): Result {
    switch (action.type) {
      case 'update-settings':
        return updateSettings(state, action, ctx);
      case 'start':
        return start(state, ctx);
      case 'ready-to-vote':
        return readyToVote(state, action.ready, ctx);
      case 'vote':
        return vote(state, action.target, ctx);
      case 'spy-guess':
        return spyGuess(state, action.location, ctx);
      case 'next-round':
        return nextRound(state, ctx);
      case 'back-to-lobby': {
        const err = requireHost(ctx);
        if (err) return err;
        return toLobby(state, null);
      }
    }
  }

  // ---- Players coming and going ----

  function create(ctx: CreateCtx, players: readonly PlayerInfo[]): MasqueradeState {
    let state: MasqueradeState = {
      phase: 'lobby',
      settings: {
        editions: [...editionIds],
        roundSeconds: DEFAULT_ROUND_SECONDS,
        rounds: null,
        twoSpies: false,
      },
      seed: newSeed(ctx.rng),
      table: newSeed(ctx.rng),
      seats: {},
      totalRounds: 0,
      round: null,
      used: [],
      deals: 0,
      starterOffset: 0,
      notice: null,
      winners: [],
      gamesPlayed: 0,
    };
    for (const p of players) state = playerJoined(state, p);
    return state;
  }

  /** Newcomers sit down while there's room; mid-game they watch until the next round. */
  function playerJoined(state: MasqueradeState, player: PlayerInfo): MasqueradeState {
    const existing = state.seats[player.id];
    if (existing)
      return {
        ...state,
        seats: { ...state.seats, [player.id]: { ...existing, name: player.name } },
      };
    const playing = seated(state).length < MAX_SEATS;
    return {
      ...state,
      seats: { ...state.seats, [player.id]: { name: player.name, playing, score: 0 } },
    };
  }

  /**
   * Someone left for good. A spy leaving mid-round voids the round, which is dealt again; anyone
   * else is dropped, with their vote and the votes cast for them. Under three players, the game
   * goes back to the lobby.
   */
  function playerLeft(state: MasqueradeState, playerId: PlayerId, now: number): MasqueradeState {
    const seat = state.seats[playerId];
    if (!seat) return state;
    const seats = { ...state.seats };
    delete seats[playerId];
    const next: MasqueradeState = { ...state, seats };
    if (next.phase !== 'playing') return next;
    if (seated(next).length < MIN_PLAYERS) return toLobby(next, 'too-few');
    const round = next.round;
    if (!round || !round.players.includes(playerId) || round.stage === 'reveal') return next;
    if (round.spies.includes(playerId)) {
      const redealt = deal(next, round.number, now, hiddenRng(next, now));
      return withRound(redealt, { redealtAfter: round.names[playerId] ?? seat.name });
    }
    const players = round.players.filter((p) => p !== playerId);
    const votes = Object.fromEntries(
      Object.entries(round.votes).filter(([from, to]) => from !== playerId && to !== playerId),
    );
    let out = withRound(next, {
      players,
      votes,
      ready: round.ready.filter((p) => p !== playerId),
      named: round.named.filter((p) => p !== playerId),
    });
    if (players.length < MIN_PLAYERS) return toLobby(out, 'too-few');
    const r = out.round!;
    if (r.stage === 'talk' && r.ready.length >= players.length) out = startVote(out, now);
    else if (r.stage === 'vote' && players.every((p) => p in votes)) out = resolveVote(out, now);
    return out;
  }

  // ---- Timers ----

  function nextDeadline(state: MasqueradeState): number | null {
    const round = state.round;
    if (state.phase !== 'playing' || !round || round.stage === 'reveal') return null;
    return round.deadline;
  }

  /** The clock runs out: talk turns to the vote, the vote resolves, a late guess counts as wrong. */
  function onDeadline(state: MasqueradeState, now: number): MasqueradeState {
    const due = nextDeadline(state);
    if (due === null || now < due) return state;
    const round = state.round!;
    switch (round.stage) {
      case 'talk':
        return startVote(state, now);
      case 'vote':
        return resolveVote(state, now);
      case 'guess': {
        const guesses = { ...round.guesses };
        for (const s of round.caught) if (!(s in guesses)) guesses[s] = null;
        return finishRound(withRound(state, { guesses }));
      }
      default:
        return state;
    }
  }

  // ---- Views ----

  function view(state: MasqueradeState, viewer: PlayerId | null): MasqueradeView {
    const seatViews: SeatView[] = Object.entries(state.seats).map(([id, s]) => ({
      id,
      name: s.name,
      playing: s.playing,
      score: s.score,
    }));
    const me = viewer === null ? null : (seatViews.find((s) => s.id === viewer) ?? null);
    const round = state.round;
    let roundView: MasqueradeView['round'] = null;
    if (round) {
      const dealt = viewer !== null && round.players.includes(viewer);
      const role = !dealt ? 'watching' : round.spies.includes(viewer) ? 'spy' : 'local';
      const resolved = round.stage === 'guess' || round.stage === 'reveal';
      roundView = {
        number: round.number,
        deal: round.deal,
        players: round.players.map((id) => ({
          id,
          name: state.seats[id]?.name ?? round.names[id] ?? 'Someone',
        })),
        starter: round.starter,
        stage: round.stage,
        deadline: round.deadline,
        role,
        location: role === 'local' ? round.location : null,
        spyCount: round.spies.length,
        readyCount: round.ready.length,
        readyIds: [...round.ready],
        meReady: viewer !== null && round.ready.includes(viewer),
        votedCount: Object.keys(round.votes).length,
        votedIds: Object.keys(round.votes),
        myVote: (viewer !== null && round.votes[viewer]) || null,
        votes: resolved ? { ...round.votes } : null,
        named: resolved ? [...round.named] : null,
        caught: resolved ? [...round.caught] : null,
        guessed: Object.keys(round.guesses),
        canGuess:
          round.stage === 'guess' &&
          viewer !== null &&
          round.caught.includes(viewer) &&
          !(viewer in round.guesses),
        result: round.stage === 'reveal' ? round.result : null,
        redealtAfter: round.redealtAfter,
      };
    }
    const playing = seatViews.filter((s) => s.playing).length;
    return {
      phase: state.phase,
      table: state.table,
      settings: state.settings,
      editions: pack.editions.map((e) => ({
        id: e.id,
        label: e.label,
        count: e.locations.length,
      })),
      locations: locationsFor(pack, state.settings.editions),
      seats: seatViews,
      me,
      totalRounds:
        state.phase === 'lobby'
          ? (state.settings.rounds ?? Math.min(playing, MAX_SEATS))
          : state.totalRounds,
      round: roundView,
      notice: state.notice,
      winners: state.winners,
    };
  }

  return {
    id: config.id,
    name: config.name,
    description: config.description,
    minPlayers: MIN_PLAYERS,
    maxPlayers: 30,
    ...(config.access ? { access: config.access } : {}),
    guide: config.guide,
    actionSchema,
    create,
    reduce,
    playerJoined,
    playerLeft,
    view,
    nextDeadline,
    onDeadline,
    insights: insightsFor(config.locationName ?? ((id) => id)),
  };
}
