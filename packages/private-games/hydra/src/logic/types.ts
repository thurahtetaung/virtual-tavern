import type { PlayerId } from '@vt/game-sdk';
import { z } from 'zod';

export const MIN_PLAYERS = 5;
/** Players dealt in at most; anyone else in the room watches. */
export const MAX_SEATS = 10;
/** Blue policies that win the game for Blue. */
export const BLUE_TO_WIN = 5;
/** Red policies that win the game for Red. */
export const RED_TO_WIN = 6;
/** From this many red policies on, electing the Leader as Chancellor wins it for Red. */
export const LEADER_ZONE = 3;
/** From this many red policies on, the Chancellor may ask for a veto. */
export const VETO_ZONE = 5;
/** Failed governments in a row that make the people enact the top policy. */
export const TRACKER_MAX = 3;
/** How long the Leader check and the chaos top-deck play out before the game moves on. */
export const BEAT_MS = 2500;
export const CHAOS_MS = 3200;
export const CLAIM_SECONDS_OPTIONS = [20, 30, 45, 60, 90, 120] as const;
export const DEFAULT_CLAIM_SECONDS = 45;
export const MIN_TIMER_SECONDS = 15;
export const MAX_TIMER_SECONDS = 600;
export const MAX_NOTICES = 8;
/** A player can be nudged again after this long. */
export const NUDGE_MS = 15_000;

/** Teams, policies and party cards are all one of two colours. */
export type Team = 'blue' | 'red';
export type Policy = Team;
/** `leader` is on the red team (and shows red when investigated). */
export type Role = 'blue' | 'red' | 'leader';
export type Ballot = 'yes' | 'no';
export type Power = 'investigate' | 'special' | 'peek' | 'execute';
export type TimerMode = 'soft' | 'strict';

export interface Settings {
  /** The community rebalance for 6, 7 and 9 players (off by default). */
  rebalance: boolean;
  /** Skip the Leader check's dramatic pause. */
  quick: boolean;
  /** Mark claims that public information shows can't all be true. */
  flags: boolean;
  /** The claims' reminder timer: once it has run out, the host may skip a missing claim. */
  claimSeconds: number;
  /** Nominating, discarding, the veto answer and powers. Null: no timer. */
  pickSeconds: number | null;
  /** Voting. Null: no timer. */
  voteSeconds: number | null;
  /** Strict: a missing vote isn't counted and other turns are played at random. */
  timerMode: TimerMode;
}

export interface Seat {
  name: string;
  /** Seated players are dealt in at the next start; the rest watch. */
  playing: boolean;
}

/**
 * `reveal`: everyone reads their role. `nominate`: the Presidential Candidate picks a Chancellor.
 * `vote`: everyone alive votes. `leader-check`: a short pause before the table learns whether the
 * new Chancellor is the Leader. `legislate-president` / `legislate-chancellor`: the session.
 * `veto-response`: the President answers a veto request. `claim`: the government (or the
 * President after a power) says what they saw. `power`: the President uses a power. `chaos`: the
 * people enact the top policy.
 */
export type Stage =
  | 'reveal'
  | 'nominate'
  | 'vote'
  | 'leader-check'
  | 'legislate-president'
  | 'legislate-chancellor'
  | 'veto-response'
  | 'claim'
  | 'power'
  | 'chaos';

export type EndReason =
  /** Five blue policies. */
  | 'blue-policies'
  /** The Leader was executed. */
  | 'leader-executed'
  /** Six red policies. */
  | 'red-policies'
  /** The Leader was elected Chancellor in the danger zone. */
  | 'leader-elected';

export type ClaimKind = 'president' | 'chancellor' | 'investigate' | 'peek';

/** What a player says they saw. Free to lie; final once made. */
export interface Claim {
  by: PlayerId;
  kind: ClaimKind;
  /** President and Chancellor: how many blue cards (of 3 or 2). */
  blues?: number;
  /**
   * President: the colour they say they discarded. Required for new claims; claims made before it
   * existed have none ("not stated").
   */
  discarded?: Policy;
  /** Peek: the top three in order. */
  cards?: Policy[];
  /** Investigation: who, and the colour claimed. */
  target?: PlayerId;
  team?: Team;
  /** The host skipped it once the timer ran out (or the player had left). */
  skipped?: 'host' | 'left';
  at: number;
}

/** A claim the table is waiting for. */
export interface ClaimNeed {
  by: PlayerId;
  kind: ClaimKind;
  target?: PlayerId;
}

/** One government, kept for the history (public). */
export interface Round {
  /** 1, 2, 3… one per nomination. */
  n: number;
  president: PlayerId;
  chancellor: PlayerId | null;
  /** The President came from a special election. */
  special: boolean;
  /** Everyone's vote, once all are in. Players whose vote wasn't counted are in `missing`. */
  votes: Record<PlayerId, Ballot>;
  missing: PlayerId[];
  elected: boolean | null;
  /** The election tracker after this round's vote or veto. */
  tracker: number;
  /** The session, once it has happened. */
  session: {
    enacted: Policy | null;
    vetoed: boolean;
    /** The two cards the Chancellor got were shuffled (always true; it drives the notice). */
    shuffled: true;
  } | null;
  /** The people enacted the top policy after this round. */
  chaos: Policy | null;
  power: { kind: Power; target: PlayerId | null; auto: boolean } | null;
  claims: Claim[];
  /** The Chancellor was confirmed not to be the Leader. */
  cleared: boolean;
  /** Turns the timer, the host or the autopilot played for someone ("nomination", "vote"…). */
  autos: { who: PlayerId; what: string }[];
}

/** What really happened in a session or power (private until the end). */
export interface Truth {
  round: number;
  drawn: Policy[] | null;
  presidentDiscard: Policy | null;
  /** The two the Chancellor got, in the shuffled order they saw. */
  chancellorHand: Policy[] | null;
  chancellorDiscard: Policy | null;
  enacted: Policy | null;
  vetoed: boolean;
  peek: Policy[] | null;
  investigate: { target: PlayerId; team: Team } | null;
}

/** What a player learnt privately (shown only to them). */
export type Memory =
  | { kind: 'hand'; round: number; as: 'president' | 'chancellor'; cards: Policy[] }
  | { kind: 'investigate'; round: number; target: PlayerId; team: Team }
  | { kind: 'peek'; round: number; cards: Policy[] };

export interface Notice {
  id: number;
  text: string;
  at: number;
}

export interface Game {
  /** Dealt-in players in seat (clockwise) order. */
  players: PlayerId[];
  names: Record<PlayerId, string>;
  roles: Record<PlayerId, Role>;
  /** Which portrait each player's role card shows (per colour). */
  art: Record<PlayerId, number>;
  /** Fixed at the start: the rebalance, the timers and the toggles. */
  rebalance: boolean;
  quick: boolean;
  flags: boolean;
  ready: PlayerId[];
  dead: PlayerId[];
  /** Players who left for good: the game plays their turns. */
  left: PlayerId[];
  /** Top first. Never sent. */
  deck: Policy[];
  /** Never sent, only counted. */
  discard: Policy[];
  /** Cards in the deck at the start (17, or 16 with a rebalance). */
  total: number;
  enacted: Record<Team, number>;
  tracker: number;
  /** The Presidential Candidate (and President once elected). */
  president: PlayerId;
  /** Where the regular rotation stands: the next President is the next living player after it. */
  rotation: PlayerId;
  /** A special election's pick, President next round. */
  specialNext: PlayerId | null;
  /** The President of this round came from a special election. */
  special: boolean;
  /** The nominee, then the Chancellor. */
  chancellor: PlayerId | null;
  /** Term limits: the last elected pair (cleared by chaos). */
  lastElected: { president: PlayerId; chancellor: PlayerId } | null;
  /** Secret until every vote is in. */
  votes: Record<PlayerId, Ballot>;
  /** Votes the timer or the host gave up on: they aren't counted. */
  abstain: PlayerId[];
  /** The cards in the session (3 for the President, then the Chancellor's 2). */
  hand: Policy[];
  vetoRequested: boolean;
  vetoRefused: boolean;
  /** The power the President must use. */
  power: Power | null;
  /** Peek: the cards the President is looking at (also in `hand`-style secrecy). */
  peek: Policy[] | null;
  investigated: PlayerId[];
  /** Chancellors confirmed not to be the Leader. */
  cleared: PlayerId[];
  /** The claims the table waits for, and when the reminder runs out. */
  needs: ClaimNeed[];
  claimDeadline: number | null;
  /** What happens once the claims are in: a power, chaos, or the next nomination. */
  after: 'power' | 'chaos' | 'next';
  memories: Record<PlayerId, Memory[]>;
  rounds: Round[];
  truth: Truth[];
  notices: Notice[];
  noticeSeq: number;
  /** When each player was last nudged (someone tapped their waiting-on chip). */
  nudges: Record<PlayerId, number>;
  /** A strict timer's deadline, a soft reminder's, or a beat's end. */
  deadline: number | null;
  winner: Team | null;
  reason: EndReason | null;
  startedAt: number;
}

export interface HydraState {
  phase: 'lobby' | 'playing' | 'over';
  stage: Stage | null;
  settings: Settings;
  /** Hidden randomness for deadlines and leavers, which come without an rng. Never sent. */
  seed: number;
  /** A random id for this room's table, so each browser's private marks never mix rooms up. */
  table: number;
  /** Insertion-ordered by join time: the seating order. */
  seats: Record<PlayerId, Seat>;
  game: Game | null;
  gamesPlayed: number;
}

// ---- Actions ----

const id = z.string().min(1).max(128);
const seconds = z.number().int().min(MIN_TIMER_SECONDS).max(MAX_TIMER_SECONDS).nullable();
const policy = z.enum(['blue', 'red']);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    rebalance: z.boolean().optional(),
    quick: z.boolean().optional(),
    flags: z.boolean().optional(),
    claimSeconds: z.number().int().min(10).max(300).optional(),
    pickSeconds: seconds.optional(),
    voteSeconds: seconds.optional(),
    timerMode: z.enum(['soft', 'strict']).optional(),
  }),
  z.object({ type: z.literal('sit'), playing: z.boolean() }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('ready') }),
  z.object({ type: z.literal('nominate'), player: id }),
  z.object({ type: z.literal('vote'), ballot: z.enum(['yes', 'no']) }),
  /** The President discards one of three (by index). */
  z.object({ type: z.literal('discard'), index: z.number().int().min(0).max(2) }),
  /** The Chancellor enacts one of two (by index); the other is discarded. */
  z.object({ type: z.literal('enact'), index: z.number().int().min(0).max(1) }),
  z.object({ type: z.literal('veto') }),
  z.object({ type: z.literal('veto-answer'), agree: z.boolean() }),
  z.object({ type: z.literal('investigate'), player: id }),
  z.object({ type: z.literal('special'), player: id }),
  z.object({ type: z.literal('execute'), player: id }),
  z.object({ type: z.literal('peek-done') }),
  z.object({
    type: z.literal('claim'),
    blues: z.number().int().min(0).max(3).optional(),
    /** President: the colour discarded. */
    discarded: policy.optional(),
    cards: z.array(policy).length(3).optional(),
    team: policy.optional(),
  }),
  /** Host: a claim is still missing after the reminder ran out. */
  z.object({ type: z.literal('skip-claim'), player: id }),
  /** Anyone: buzz a player the table is waiting on. */
  z.object({ type: z.literal('nudge'), player: id }),
  /** Host: play an absent player's turn with a random legal move. */
  z.object({ type: z.literal('act-for'), player: id }),
  z.object({ type: z.literal('back-to-lobby') }),
]);

export type HydraAction = z.infer<typeof actionSchema>;

// ---- What each player may see ----

export interface SeatView {
  id: PlayerId;
  name: string;
  playing: boolean;
}

export interface PlayerView {
  id: PlayerId;
  name: string;
  dead: boolean;
  left: boolean;
}

/** Someone the viewer knows from the start: a teammate, by role. */
export interface Known {
  id: PlayerId;
  role: 'red' | 'leader';
}

export interface MyRole {
  role: Role;
  team: Team;
  /** Your portrait (per colour). */
  art: number;
  /** Sorted by seat. */
  known: Known[];
}

/** Why a seat can't be nominated (or targeted) right now. */
export type Ineligible =
  'self' | 'dead' | 'term-limit-chancellor' | 'term-limit-president' | 'investigated';

export interface GameView {
  players: PlayerView[];
  /** Cards in play this game (17 or 16) and the public composition. */
  total: number;
  totalBlue: number;
  deckCount: number;
  discardCount: number;
  enacted: Record<Team, number>;
  tracker: number;
  president: PlayerId;
  chancellor: PlayerId | null;
  special: boolean;
  /** Who would be the next Presidential Candidate, as things stand. */
  nextPresident: PlayerId;
  lastElected: { president: PlayerId; chancellor: PlayerId } | null;
  /** Every seat's reason it can't be Chancellor right now (nomination). */
  ineligible: Record<PlayerId, Ineligible>;
  ready: PlayerId[];
  /** Who has voted; never how, until everyone has. */
  voted: PlayerId[];
  myVote: Ballot | null;
  /** The cards in your hands right now (President's 3, Chancellor's 2; the President sees the 2 during a veto request). */
  hand: Policy[] | null;
  vetoRequested: boolean;
  vetoRefused: boolean;
  vetoUnlocked: boolean;
  power: Power | null;
  /** The President's peek, only to them during the power. */
  peek: Policy[] | null;
  investigated: PlayerId[];
  cleared: PlayerId[];
  needs: ClaimNeed[];
  claimDeadline: number | null;
  memories: Memory[];
  rounds: Round[];
  notices: Notice[];
  nudges: Record<PlayerId, number>;
  deadline: number | null;
  rebalance: boolean;
  quick: boolean;
  flags: boolean;
  /** Only at the end. */
  end: {
    winner: Team;
    reason: EndReason;
    roles: Record<PlayerId, Role>;
    art: Record<PlayerId, number>;
    truth: Truth[];
  } | null;
}

export interface HydraView {
  phase: HydraState['phase'];
  table: number;
  stage: Stage | null;
  settings: Settings;
  seats: SeatView[];
  me: SeatView | null;
  role: MyRole | null;
  game: GameView | null;
  gamesPlayed: number;
}
