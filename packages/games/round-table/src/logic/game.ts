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
import { roundTableBot } from './bot.ts';
import { roundTableAwards } from './awards.ts';
import { guide } from './guide.ts';
import { insights } from './insights.ts';
import { ROLES, cardsFor, loyaltyOf, shownLoyalty, sortDeck } from './roles.ts';
import { deal, deckFor, knowledgeFor, presetById, questsFor, validateSetup } from './setup.ts';
import {
  type Game,
  type GameView,
  MAX_REJECTIONS,
  MAX_SEATS,
  MIN_PLAYERS,
  type MyRole,
  type Proposal,
  type QuestCard,
  type QuestResult,
  type RoundTableAction,
  type RoundTableState,
  type RoundTableView,
  type SeatView,
  type Settings,
  type Stage,
  actionSchema,
} from './types.ts';

type Ctx = ActionCtx;
type Result = RoundTableState | GameError;

// ---- Pure helpers (also used by the UI and tests) ----

/** Seated players, in seat order. */
export function seated(state: Pick<RoundTableState, 'seats'>): PlayerId[] {
  return Object.entries(state.seats).flatMap(([id, s]) => (s.playing ? [id] : []));
}

/** Played quests, from the state or a view: only where they went and whether they succeeded. */
type Played = { results: readonly Pick<QuestResult, 'slot' | 'success'>[] };

export const successes = (g: Played) => g.results.filter((r) => r.success).length;
export const failures = (g: Played) => g.results.filter((r) => !r.success).length;

/**
 * The quests the leader may send a team on. Without Targeting, the next one in order. With it, any
 * quest not yet attempted, except quest 5 until two quests have succeeded.
 */
export function legalSlots(g: Played & Pick<Game, 'targeting'>): number[] {
  const done = new Set(g.results.map((r) => r.slot));
  const open = [0, 1, 2, 3, 4].filter((s) => !done.has(s));
  if (!g.targeting) return open.slice(0, 1);
  return open.filter((s) => s !== 4 || successes(g) >= 2);
}

/** The player `steps` seats clockwise from `from`. */
export function seatAfter(players: readonly PlayerId[], from: PlayerId, steps = 1): PlayerId {
  const n = players.length;
  return players[(((players.indexOf(from) + steps) % n) + n) % n]!;
}

/** Who makes the round's last (fifth) proposal if every team before it is rejected. */
export const hammerOf = (g: Pick<Game, 'players' | 'leader' | 'rejections'>) =>
  seatAfter(g.players, g.leader, MAX_REJECTIONS - 1 - g.rejections);

/** Players the Lady's holder may check: anyone who has never held her. */
export const ladyTargets = (g: Pick<Game, 'players' | 'ladyState'>): PlayerId[] =>
  g.ladyState ? g.players.filter((p) => !g.ladyState!.holders.includes(p)) : [];

/** Who the table is waiting on right now. */
export function awaited(state: RoundTableState): PlayerId[] {
  const g = state.game;
  if (state.phase !== 'playing' || !g) return [];
  switch (state.stage) {
    case 'reveal':
      return g.players.filter((p) => !g.ready.includes(p));
    case 'propose':
    case 'discuss':
      return [g.leader];
    case 'vote':
      return g.players.filter((p) => !(p in g.votes));
    case 'quest':
      return g.team.filter((p) => !(p in g.cards));
    case 'lady':
      return g.ladyState ? [g.ladyState.holder] : [];
    case 'assassinate':
      return g.assassin ? [g.assassin] : [];
    default:
      return [];
  }
}

/** The cards `player` may play on the quest in progress. */
export function cardsOf(g: Game, player: PlayerId): QuestCard[] {
  const r = g.roles[player];
  if (!r) return [];
  return cardsFor(r, { played: g.results.length, slot: g.slot ?? 0 });
}

const newSeed = (rng: Rng) => rng.int(2 ** 32);
const hiddenRng = (state: RoundTableState, now: number) =>
  createRng((state.seed ^ now ^ ((state.game?.proposals.length ?? 0) << 8)) >>> 0);

const withGame = (state: RoundTableState, patch: Partial<Game>): RoundTableState => ({
  ...state,
  game: { ...state.game!, ...patch },
});

/** When the clock for `stage` runs out, or null without a timer for it. */
function deadlineFor(settings: Settings, stage: Stage, now: number): number | null {
  const s =
    stage === 'vote' || stage === 'quest'
      ? settings.voteSeconds
      : stage === 'reveal'
        ? null
        : settings.pickSeconds;
  return s === null ? null : now + s * 1000;
}

const atStage = (state: RoundTableState, stage: Stage, now: number): RoundTableState => ({
  ...state,
  stage,
  game: { ...state.game!, deadline: deadlineFor(state.settings, stage, now) },
});

// ---- Flow ----

/** The leader starts building a team for the next quest (or, with Targeting, any open quest). */
function beginProposal(state: RoundTableState, now: number): RoundTableState {
  const g = state.game!;
  const next = withGame(state, {
    draft: [],
    slot: legalSlots(g)[0] ?? null,
    team: [],
    votes: {},
    autoVotes: [],
    autoTeam: false,
  });
  return atStage(next, 'propose', now);
}

function endGame(
  state: RoundTableState,
  winner: 'good' | 'evil',
  reason: Game['reason'],
): RoundTableState {
  return {
    ...state,
    phase: 'over',
    stage: null,
    game: { ...state.game!, winner, reason, deadline: null, cards: {}, votes: {} },
  };
}

/** The leader announces the team: the table talks it over before the leader calls the vote. */
function announce(
  state: RoundTableState,
  team: PlayerId[],
  slot: number,
  auto: boolean,
  now: number,
): RoundTableState {
  return atStage(
    withGame(state, { team, slot, draft: team, votes: {}, autoVotes: [], autoTeam: auto }),
    'discuss',
    now,
  );
}

/** Everyone has voted: a strict majority approves (a tie rejects). Five rejections: Evil wins. */
function resolveVote(state: RoundTableState, now: number): RoundTableState {
  const g = state.game!;
  const approves = Object.values(g.votes).filter(Boolean).length;
  const approved = approves * 2 > g.players.length;
  const proposal: Proposal = {
    round: g.results.length + 1,
    attempt: g.rejections + 1,
    leader: g.leader,
    slot: g.slot!,
    team: [...g.team],
    votes: Object.fromEntries(g.players.map((p) => [p, g.votes[p] === true])),
    approved,
    auto: g.autoTeam,
    autoVotes: [...g.autoVotes],
  };
  const proposals = [...g.proposals, proposal];
  if (approved) {
    return atStage(
      withGame(state, { proposals, votes: {}, cards: {}, autoPlayed: [] }),
      'quest',
      now,
    );
  }
  const rejections = g.rejections + 1;
  const next = withGame(state, { proposals, rejections, votes: {} });
  if (rejections >= MAX_REJECTIONS) return endGame(next, 'evil', 'rejections');
  return beginProposal(withGame(next, { leader: seatAfter(g.players, g.leader) }), now);
}

/** Every card is in: count the Fails (never who played them), then move on. */
function resolveQuest(state: RoundTableState, now: number): RoundTableState {
  const g = state.game!;
  const slot = g.slot!;
  const fails = Object.values(g.cards).filter((c) => c === 'fail').length;
  const result: QuestResult = {
    round: g.results.length + 1,
    slot,
    team: [...g.team],
    fails,
    success: fails < g.quests[slot]!.failsNeeded,
    autoPlayed: [...g.autoPlayed],
  };
  const results = [...g.results, result];
  const next = withGame(state, {
    results,
    cards: {},
    autoPlayed: [],
    rejections: 0,
    leader: seatAfter(g.players, g.leader),
  });
  const ng = next.game!;
  if (failures(ng) >= 3) return endGame(next, 'evil', 'fails');
  if (successes(ng) >= 3) {
    const merlin = Object.values(g.roles).includes('merlin');
    if (merlin && g.assassin) return atStage(next, 'assassinate', now);
    return endGame(next, 'good', 'quests');
  }
  // The Lady of the Lake, after the second, third and fourth quests.
  if (ng.ladyState && results.length >= 2 && results.length <= 4 && ladyTargets(ng).length > 0)
    return atStage(next, 'lady', now);
  return beginProposal(next, now);
}

function checkLoyalty(
  state: RoundTableState,
  target: PlayerId,
  auto: boolean,
  now: number,
): RoundTableState {
  const g = state.game!;
  const lady = g.ladyState!;
  const check = {
    round: g.results.length,
    holder: lady.holder,
    target,
    loyalty: shownLoyalty(g.roles[target]!, { oberonHidden: g.oberonHidden }),
    auto,
  };
  return beginProposal(
    withGame(state, {
      ladyState: {
        holder: target,
        holders: [...lady.holders, target],
        checks: [...lady.checks, check],
      },
    }),
    now,
  );
}

function assassinate(state: RoundTableState, target: PlayerId, auto: boolean): RoundTableState {
  const g = state.game!;
  const hit = g.roles[target] === 'merlin';
  return endGame(
    withGame(state, { target, autoTarget: auto }),
    hit ? 'evil' : 'good',
    hit ? 'assassin-hit' : 'assassin-missed',
  );
}

/**
 * Acts for `player` the way a strict timer does: a missing vote approves, a missing quest card is
 * Success (or the only legal card), an announced team goes to the vote, and the leader's team, the
 * Lady's check and the assassination are picked at random. Returns the state unchanged if the table isn't waiting on them.
 */
function actFor(state: RoundTableState, player: PlayerId, now: number, rng: Rng): RoundTableState {
  const g = state.game;
  if (!g || !awaited(state).includes(player)) return state;
  switch (state.stage) {
    case 'reveal': {
      const next = withGame(state, { ready: [...g.ready, player] });
      return next.game!.ready.length >= g.players.length ? beginProposal(next, now) : next;
    }
    case 'propose': {
      const slot = g.slot ?? legalSlots(g)[0]!;
      const size = g.quests[slot]!.size;
      const team = g.draft.slice(0, size);
      const rest = rng.shuffle(g.players.filter((p) => !team.includes(p)));
      while (team.length < size) team.push(rest.shift()!);
      return announce(state, team, slot, true, now);
    }
    case 'discuss':
      return atStage(state, 'vote', now);
    case 'vote': {
      const next = withGame(state, {
        votes: { ...g.votes, [player]: true },
        autoVotes: [...g.autoVotes, player],
      });
      return g.players.every((p) => p in next.game!.votes) ? resolveVote(next, now) : next;
    }
    case 'quest': {
      const legal = cardsOf(g, player);
      const card: QuestCard = legal.includes('success') ? 'success' : legal[0]!;
      const next = withGame(state, {
        cards: { ...g.cards, [player]: card },
        autoPlayed: [...g.autoPlayed, player],
      });
      return g.team.every((p) => p in next.game!.cards) ? resolveQuest(next, now) : next;
    }
    case 'lady': {
      const options = ladyTargets(g);
      return checkLoyalty(state, options[rng.int(options.length)]!, true, now);
    }
    case 'assassinate': {
      const options = g.players.filter((p) => p !== player);
      return assassinate(state, options[rng.int(options.length)]!, true);
    }
    default:
      return state;
  }
}

/** Plays every turn the table is waiting on from players who have left for good. */
function autopilot(state: RoundTableState, now: number): RoundTableState {
  let next = state;
  for (let i = 0; i < 200; i++) {
    const g = next.game;
    if (next.phase !== 'playing' || !g || g.left.length === 0) return next;
    const gone = awaited(next).find((p) => g.left.includes(p));
    if (!gone) return next;
    next = actFor(next, gone, now, hiddenRng(next, now + i));
  }
  return next;
}

// ---- Actions ----

const requireHost = (ctx: Ctx) =>
  ctx.isHost ? null : new GameError('not-host', 'Only the host can do that.');

function updateSettings(
  state: RoundTableState,
  action: Extract<RoundTableAction, { type: 'update-settings' }>,
  ctx: Ctx,
): Result {
  const err = requireHost(ctx);
  if (err) return err;
  if (state.phase === 'playing')
    return new GameError('in-progress', 'Settings can only change between games.');
  const settings = { ...state.settings };
  if (action.roles !== undefined) {
    settings.roles = sortDeck(action.roles);
    settings.preset = null;
  }
  if (action.preset !== undefined) {
    settings.preset = action.preset;
    if (action.preset === null) settings.roles = deckFor(state.settings, seated(state).length);
    else {
      const lady = presetById(action.preset).lady;
      if (lady) settings.lady = lady(seated(state).length);
    }
  }
  if (action.lady !== undefined) settings.lady = action.lady;
  if (action.targeting !== undefined) settings.targeting = action.targeting;
  if (action.oberonHidden !== undefined) settings.oberonHidden = action.oberonHidden;
  if (action.pickSeconds !== undefined) settings.pickSeconds = action.pickSeconds;
  if (action.voteSeconds !== undefined) settings.voteSeconds = action.voteSeconds;
  if (action.timerMode !== undefined) settings.timerMode = action.timerMode;
  return { ...state, settings };
}

function start(state: RoundTableState, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  if (state.phase === 'playing') return new GameError('in-progress', 'A game is already running.');
  const players = seated(state).slice(0, MAX_SEATS);
  const deck = deckFor(state.settings, players.length);
  const check = validateSetup(deck, players.length);
  if (check.errors.length) return new GameError('bad-setup', check.errors[0]!);
  const d = deal(players, deck, ctx.rng);
  const s = state.settings;
  const game: Game = {
    players: d.players,
    names: Object.fromEntries(players.map((p) => [p, state.seats[p]!.name])),
    roles: d.roles,
    assassin: d.assassin,
    designated: d.designated,
    lady: s.lady,
    targeting: s.targeting,
    oberonHidden: s.oberonHidden,
    quests: questsFor(players.length),
    ready: [],
    leader: d.leader,
    firstLeader: d.leader,
    rejections: 0,
    draft: [],
    slot: null,
    votes: {},
    team: [],
    cards: {},
    autoPlayed: [],
    autoVotes: [],
    autoTeam: false,
    proposals: [],
    results: [],
    ladyState: s.lady ? { holder: d.ladyHolder, holders: [d.ladyHolder], checks: [] } : null,
    target: null,
    autoTarget: false,
    left: [],
    deadline: null,
    winner: null,
    reason: null,
  };
  return {
    ...state,
    phase: 'playing',
    stage: 'reveal',
    seed: newSeed(ctx.rng),
    game,
    gamesPlayed: state.gamesPlayed + 1,
  };
}

/** The game in play, if `by` is dealt in and it's at `stage`. */
function gameAt(state: RoundTableState, by: PlayerId, stage: Stage): Game | GameError {
  const g = state.game;
  if (state.phase !== 'playing' || !g) return new GameError('not-playing', 'No game in play.');
  if (!g.players.includes(by))
    return new GameError('watching', 'You’re watching this game. You can play in the next one.');
  if (state.stage !== stage) {
    const msg: Record<Stage, string> = {
      reveal: 'Everyone has already seen their role.',
      propose: 'It’s not time to choose a team.',
      discuss: 'There’s no announced team to talk over.',
      vote: 'There’s no team to vote on right now.',
      quest: 'No quest is under way.',
      lady: 'It’s not time for the Lady of the Lake.',
      assassinate: 'It’s not time for the assassination.',
    };
    return new GameError('wrong-stage', msg[stage]);
  }
  return g;
}

function leaderAt(
  state: RoundTableState,
  by: PlayerId,
  stage: Stage = 'propose',
): Game | GameError {
  const g = gameAt(state, by, stage);
  if (g instanceof GameError) return g;
  if (g.leader !== by) return new GameError('not-leader', 'Only the leader chooses the team.');
  return g;
}

function pick(state: RoundTableState, player: PlayerId, ctx: Ctx): Result {
  const g = leaderAt(state, ctx.by);
  if (g instanceof GameError) return g;
  if (!g.players.includes(player))
    return new GameError('bad-player', 'That player isn’t in this game.');
  if (g.draft.includes(player))
    return withGame(state, { draft: g.draft.filter((p) => p !== player) });
  const size = g.quests[g.slot!]!.size;
  if (g.draft.length >= size)
    return new GameError('team-full', `This quest takes ${size}: tap someone to take them off.`);
  return withGame(state, { draft: [...g.draft, player] });
}

function target(state: RoundTableState, slot: number, ctx: Ctx): Result {
  const g = leaderAt(state, ctx.by);
  if (g instanceof GameError) return g;
  if (!g.targeting) return new GameError('no-targeting', 'The quests go in order this game.');
  if (!legalSlots(g).includes(slot)) return new GameError('bad-quest', slotRefusal(g, slot));
  return withGame(state, { slot, draft: g.draft.slice(0, g.quests[slot]!.size) });
}

function slotRefusal(g: Game, slot: number): string {
  if (g.results.some((r) => r.slot === slot)) return `Quest ${slot + 1} has already been played.`;
  if (slot === 4) return 'Quest 5 opens once two quests have succeeded.';
  return `Quest ${g.results.length + 1} comes next.`;
}

function propose(
  state: RoundTableState,
  action: Extract<RoundTableAction, { type: 'propose' }>,
  ctx: Ctx,
): Result {
  const g = leaderAt(state, ctx.by);
  if (g instanceof GameError) return g;
  const slot = action.slot ?? g.slot;
  if (slot === null || !legalSlots(g).includes(slot))
    return new GameError('bad-quest', slotRefusal(g, slot ?? 0));
  const team = action.team ?? g.draft;
  const size = g.quests[slot]!.size;
  if (new Set(team).size !== team.length)
    return new GameError('duplicate', 'Pick each player only once.');
  if (team.some((p) => !g.players.includes(p)))
    return new GameError('bad-player', 'That player isn’t in this game.');
  if (team.length !== size)
    return new GameError('team-size', `Quest ${slot + 1} needs a team of ${size}.`);
  return announce(state, [...team], slot, false, ctx.now);
}

/** Back to building: the announced team becomes the draft again. */
function editTeam(state: RoundTableState, ctx: Ctx): Result {
  const g = leaderAt(state, ctx.by, 'discuss');
  if (g instanceof GameError) return g;
  return atStage(
    withGame(state, { draft: [...g.team], team: [], autoTeam: false }),
    'propose',
    ctx.now,
  );
}

function callVote(state: RoundTableState, ctx: Ctx): Result {
  const g = leaderAt(state, ctx.by, 'discuss');
  if (g instanceof GameError) return g;
  return atStage(state, 'vote', ctx.now);
}

function vote(state: RoundTableState, approve: boolean, ctx: Ctx): Result {
  const g = gameAt(state, ctx.by, 'vote');
  if (g instanceof GameError) return g;
  const next = withGame(state, {
    votes: { ...g.votes, [ctx.by]: approve },
    autoVotes: g.autoVotes.filter((p) => p !== ctx.by),
  });
  return g.players.every((p) => p in next.game!.votes) ? resolveVote(next, ctx.now) : next;
}

function play(state: RoundTableState, card: QuestCard, ctx: Ctx): Result {
  const g = gameAt(state, ctx.by, 'quest');
  if (g instanceof GameError) return g;
  if (!g.team.includes(ctx.by)) return new GameError('not-on-team', 'You’re not on this quest.');
  if (ctx.by in g.cards) return new GameError('played', 'You’ve already played your card.');
  if (!cardsOf(g, ctx.by).includes(card))
    return new GameError(
      'illegal-card',
      loyaltyOf(g.roles[ctx.by]!) === 'good'
        ? 'Loyal players can only play Success.'
        : 'You can’t play that card.',
    );
  const next = withGame(state, { cards: { ...g.cards, [ctx.by]: card } });
  return g.team.every((p) => p in next.game!.cards) ? resolveQuest(next, ctx.now) : next;
}

function lady(state: RoundTableState, who: PlayerId, ctx: Ctx): Result {
  const g = gameAt(state, ctx.by, 'lady');
  if (g instanceof GameError) return g;
  if (g.ladyState?.holder !== ctx.by)
    return new GameError('not-holder', 'Only the Lady’s holder checks someone.');
  if (who === ctx.by) return new GameError('self', 'Check someone else.');
  if (!g.players.includes(who))
    return new GameError('bad-player', 'That player isn’t in this game.');
  if (!ladyTargets(g).includes(who))
    return new GameError('former-holder', 'Someone who has held the Lady can’t be checked.');
  return checkLoyalty(state, who, false, ctx.now);
}

function assassinateAction(state: RoundTableState, who: PlayerId, ctx: Ctx): Result {
  const g = gameAt(state, ctx.by, 'assassinate');
  if (g instanceof GameError) return g;
  if (g.assassin !== ctx.by)
    return new GameError('not-assassin', 'Only the Assassin names Merlin.');
  if (who === ctx.by) return new GameError('self', 'Name someone else.');
  if (!g.players.includes(who))
    return new GameError('bad-player', 'That player isn’t in this game.');
  return assassinate(state, who, false);
}

function ready(state: RoundTableState, ctx: Ctx): Result {
  const g = gameAt(state, ctx.by, 'reveal');
  if (g instanceof GameError) return g;
  if (g.ready.includes(ctx.by)) return state;
  const next = withGame(state, { ready: [...g.ready, ctx.by] });
  return next.game!.ready.length >= g.players.length ? beginProposal(next, ctx.now) : next;
}

function skip(state: RoundTableState, player: PlayerId, ctx: Ctx): Result {
  const err = requireHost(ctx);
  if (err) return err;
  if (state.phase !== 'playing') return new GameError('not-playing', 'No game in play.');
  if (!awaited(state).includes(player))
    return new GameError('not-waiting', 'The table isn’t waiting on that player.');
  return actFor(state, player, ctx.now, ctx.rng);
}

function reduce(state: RoundTableState, action: RoundTableAction, ctx: Ctx): Result {
  const out = reduceOne(state, action, ctx);
  return out instanceof GameError ? out : autopilot(out, ctx.now);
}

function reduceOne(state: RoundTableState, action: RoundTableAction, ctx: Ctx): Result {
  switch (action.type) {
    case 'update-settings':
      return updateSettings(state, action, ctx);
    case 'start':
      return start(state, ctx);
    case 'ready':
      return ready(state, ctx);
    case 'pick':
      return pick(state, action.player, ctx);
    case 'target':
      return target(state, action.slot, ctx);
    case 'propose':
      return propose(state, action, ctx);
    case 'edit-team':
      return editTeam(state, ctx);
    case 'call-vote':
      return callVote(state, ctx);
    case 'vote':
      return vote(state, action.approve, ctx);
    case 'play':
      return play(state, action.card, ctx);
    case 'lady':
      return lady(state, action.target, ctx);
    case 'assassinate':
      return assassinateAction(state, action.target, ctx);
    case 'skip':
      return skip(state, action.player, ctx);
    case 'back-to-lobby': {
      const err = requireHost(ctx);
      if (err) return err;
      return { ...state, phase: 'lobby', stage: null, game: null };
    }
  }
}

// ---- Players coming and going ----

export const DEFAULT_SETTINGS: Settings = {
  preset: 'first',
  roles: [],
  lady: false,
  targeting: false,
  oberonHidden: false,
  pickSeconds: null,
  voteSeconds: null,
  timerMode: 'soft',
};

function create(ctx: CreateCtx, players: readonly PlayerInfo[]): RoundTableState {
  let state: RoundTableState = {
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

/** Watchers waiting for a seat sit down, in join order, while there's room. */
function fillSeats(state: RoundTableState): RoundTableState {
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

/** Newcomers sit down while there's room (mid-game they watch until the next one). */
function playerJoined(state: RoundTableState, player: PlayerInfo): RoundTableState {
  const existing = state.seats[player.id];
  let next: RoundTableState;
  if (existing) {
    next = {
      ...state,
      seats: { ...state.seats, [player.id]: { ...existing, name: player.name } },
    };
  } else {
    const playing = seated(state).length < MAX_SEATS;
    next = {
      ...state,
      seats: { ...state.seats, [player.id]: { name: player.name, playing } },
    };
  }
  const g = next.game;
  if (g?.players.includes(player.id)) {
    // Back in their seat: they play their own turns again.
    next = withGame(next, {
      names: { ...g.names, [player.id]: player.name },
      left: g.left.filter((p) => p !== player.id),
    });
  }
  return next;
}

/**
 * Someone left for good. In the lobby a watcher takes their seat. Mid-game they keep their seat
 * and role, and the game plays their turns as a strict timer would (Approve, Success, random picks).
 */
function playerLeft(state: RoundTableState, playerId: PlayerId, now: number): RoundTableState {
  if (!state.seats[playerId]) return state;
  const seats = { ...state.seats };
  delete seats[playerId];
  let next = fillSeats({ ...state, seats });
  const g = next.game;
  if (next.phase === 'playing' && g?.players.includes(playerId) && !g.left.includes(playerId)) {
    next = withGame(next, { left: [...g.left, playerId] });
    next = autopilot(next, now);
  }
  return next;
}

// ---- Timers ----

function nextDeadline(state: RoundTableState): number | null {
  if (state.phase !== 'playing' || state.settings.timerMode !== 'strict') return null;
  return state.game?.deadline ?? null;
}

/** Strict timers: everyone the table is waiting on gets the fallback move. */
function onDeadline(state: RoundTableState, now: number): RoundTableState {
  const due = nextDeadline(state);
  if (due === null || now < due) return state;
  const stage = state.stage;
  let next = state;
  for (const p of awaited(state)) {
    if (next.stage !== stage) break;
    next = actFor(next, p, now, hiddenRng(next, now));
  }
  // Nothing to do (shouldn't happen): stop the clock rather than spin.
  if (next === state) return withGame(state, { deadline: null });
  return autopilot(next, now);
}

// ---- Views ----

function myRole(g: Game, viewer: PlayerId): MyRole | null {
  const r = g.roles[viewer];
  if (!r) return null;
  return {
    role: r,
    loyalty: ROLES[r].loyalty,
    known: knowledgeFor(g, viewer),
    assassin: g.assassin === viewer,
    designated: g.assassin === viewer && g.designated,
    cards: cardsOf(g, viewer),
  };
}

function gameView(state: RoundTableState, g: Game, viewer: PlayerId | null): GameView {
  const stage = state.stage;
  const over = state.phase === 'over';
  const lady = g.ladyState;
  return {
    players: g.players.map((id) => ({
      id,
      name: state.seats[id]?.name ?? g.names[id] ?? 'Someone',
      left: g.left.includes(id),
    })),
    deck: sortDeck(Object.values(g.roles)),
    leader: g.leader,
    hammer: hammerOf(g),
    rejections: g.rejections,
    round: Math.min(g.results.length + 1, 5),
    quests: g.quests,
    questFiveOpen: !g.targeting || successes(g) >= 2,
    targeting: g.targeting,
    oberonHidden: g.oberonHidden,
    lady: lady
      ? {
          holder: lady.holder,
          holders: [...lady.holders],
          checks: lady.checks.map((c) => ({
            round: c.round,
            holder: c.holder,
            target: c.target,
            auto: c.auto,
          })),
          mine: lady.checks
            .filter((c) => c.holder === viewer)
            .map((c) => ({ round: c.round, target: c.target, loyalty: c.loyalty })),
        }
      : null,
    ready: [...g.ready],
    draft: stage === 'propose' || stage === 'discuss' ? [...g.draft] : [],
    slot:
      stage === 'propose' || stage === 'discuss' || stage === 'vote' || stage === 'quest'
        ? g.slot
        : null,
    vote:
      stage === 'vote'
        ? {
            leader: g.leader,
            slot: g.slot!,
            team: [...g.team],
            voted: g.players.filter((p) => p in g.votes),
            myVote: viewer !== null && viewer in g.votes ? g.votes[viewer]! : null,
          }
        : null,
    quest:
      stage === 'quest'
        ? {
            slot: g.slot!,
            team: [...g.team],
            played: g.team.filter((p) => p in g.cards),
            myCard: (viewer !== null && g.cards[viewer]) || null,
          }
        : null,
    proposals: g.proposals.map(({ autoVotes, ...p }) => ({
      ...p,
      autoVoteCount: autoVotes.length,
      autoVotes: over ? [...autoVotes] : null,
    })),
    results: g.results.map(({ autoPlayed, ...r }) => ({
      ...r,
      autoPlayedCount: autoPlayed.length,
      autoPlayed: over ? [...autoPlayed] : null,
    })),
    assassin: stage === 'assassinate' || over ? g.assassin : null,
    deadline: state.phase === 'playing' ? g.deadline : null,
    end:
      over && g.winner && g.reason
        ? {
            winner: g.winner,
            reason: g.reason,
            roles: { ...g.roles },
            assassin: g.assassin,
            designated: g.designated,
            target: g.target,
            autoTarget: g.autoTarget,
            knowledge: Object.fromEntries(g.players.map((p) => [p, knowledgeFor(g, p)])),
            ladyChecks: lady ? [...lady.checks] : [],
          }
        : null,
  };
}

function view(state: RoundTableState, viewer: PlayerId | null): RoundTableView {
  const seats: SeatView[] = Object.entries(state.seats).map(([id, s]) => ({
    id,
    name: s.name,
    playing: s.playing,
  }));
  const me = viewer === null ? null : (seats.find((s) => s.id === viewer) ?? null);
  const n = seats.filter((s) => s.playing).length;
  const deck = deckFor(state.settings, n);
  const g = state.game;
  return {
    phase: state.phase,
    table: state.table,
    stage: state.stage,
    settings: state.settings,
    deck,
    setup:
      state.phase === 'playing'
        ? { errors: [], notes: [] }
        : validateSetup(deck, n, { lady: state.settings.lady }),
    seats,
    me,
    role: g && viewer !== null ? myRole(g, viewer) : null,
    game: g ? gameView(state, g, viewer) : null,
    gamesPlayed: state.gamesPlayed,
  };
}

export const roundTable: GameDefinition<RoundTableState, RoundTableAction, RoundTableView> = {
  id: 'round-table',
  name: 'Round Table',
  description: 'Loyal knights against hidden traitors: pick teams, vote, and protect Merlin.',
  minPlayers: MIN_PLAYERS,
  maxPlayers: 30,
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
  awards: roundTableAwards,
  bot: roundTableBot,
};
