import type { PlayerId } from '@vt/game-sdk';
import { z } from 'zod';

export const MIN_PLAYERS = 5;
/** Players dealt in at most; anyone else in the room watches. */
export const MAX_SEATS = 10;
export const QUEST_COUNT = 5;
/** Rejected proposals in a row (within one round) that hand Evil the game. */
export const MAX_REJECTIONS = 5;
export const MIN_TIMER_SECONDS = 15;
export const MAX_TIMER_SECONDS = 600;

export type Loyalty = 'good' | 'evil';

/**
 * Every role id the engine knows. Later waves append to this list (and to `ROLES` in `roles.ts`);
 * ids never change, because saved rooms and stats events carry them.
 */
export const ROLE_IDS = [
  'merlin',
  'percival',
  'servant',
  'assassin',
  'morgana',
  'mordred',
  'oberon',
  'minion',
] as const;
export type RoleId = (typeof ROLE_IDS)[number];

/** Quest cards. Later waves add module cards here. */
export const QUEST_CARDS = ['success', 'fail'] as const;
export type QuestCard = (typeof QUEST_CARDS)[number];

export const PRESET_IDS = ['first', 'percival-morgana', 'classic-plus'] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export type TimerMode = 'soft' | 'strict';

export interface Settings {
  /** A ready-made line-up that follows the table size, or null for the host's own deck (`roles`). */
  preset: PresetId | null;
  /** The host's own deck: one role per player, used when `preset` is null. */
  roles: RoleId[];
  /** The Lady of the Lake: after quests 2, 3 and 4 her holder checks one player's loyalty. */
  lady: boolean;
  /** Targeting: the leader also picks which quest the team attempts. */
  targeting: boolean;
  /** The FAQ reading: Oberon is hidden from Merlin, and loyalty checks show him as Good. */
  oberonHidden: boolean;
  /** The leader's timer: proposing a team, the Lady's check and the assassination. Null: none. */
  pickSeconds: number | null;
  /** The vote and quest-card timer. Null: none. */
  voteSeconds: number | null;
  timerMode: TimerMode;
}

export interface Seat {
  name: string;
  /** Seated players are dealt in at the next start; the rest watch. */
  playing: boolean;
}

/**
 * `reveal`: everyone reads their role card. `propose`: the leader builds a team (and with
 * Targeting, picks the quest). `vote`: everyone approves or rejects it. `quest`: the team plays
 * cards. `lady`: the Lady's holder checks someone. `assassinate`: the Assassin names Merlin.
 */
export type Stage = 'reveal' | 'propose' | 'vote' | 'quest' | 'lady' | 'assassinate';

export type EndReason =
  /** Three quests succeeded and there was no Merlin to hunt. */
  | 'quests'
  /** Three quests succeeded and the Assassin named the wrong player. */
  | 'assassin-missed'
  /** Three quests succeeded but the Assassin found Merlin. */
  | 'assassin-hit'
  /** Three quests failed. */
  | 'fails'
  /** Five proposals in a row were rejected. */
  | 'rejections';

export interface Quest {
  /** Team size. */
  size: number;
  /** Fail cards it takes to fail (2 on quest 4 with 7 or more players). */
  failsNeeded: number;
}

/** One proposal, kept for the history once its vote is in. Votes are public once revealed. */
export interface Proposal {
  /** The round (1–5): how many quests had been played before it, plus one. */
  round: number;
  /** Which proposal of the round (1–5). */
  attempt: number;
  leader: PlayerId;
  /** Quest index (0–4) the team would attempt. */
  slot: number;
  team: PlayerId[];
  /** true: approve. Everyone who voted. */
  votes: Record<PlayerId, boolean>;
  approved: boolean;
  /** The team was filled in by the timer (or the host, for an absent leader). */
  auto: boolean;
  /** Players whose vote the timer or the host cast as Approve. */
  autoVotes: PlayerId[];
}

/** One quest's result. The cards are a count: who played which is never kept. */
export interface QuestResult {
  round: number;
  slot: number;
  team: PlayerId[];
  fails: number;
  success: boolean;
  /** Team members whose card the timer or the host played (their only or Success card). */
  autoPlayed: PlayerId[];
}

/** A loyalty check. The result goes to the checker only, until the end. */
export interface LadyCheck {
  /** Quests played when it happened (2, 3 or 4). */
  round: number;
  holder: PlayerId;
  target: PlayerId;
  loyalty: Loyalty;
  auto: boolean;
}

export interface Lady {
  holder: PlayerId;
  /** Everyone who has held the Lady (the first holder included): they can't be checked. */
  holders: PlayerId[];
  checks: LadyCheck[];
}

export interface Game {
  /** Dealt-in players, in seat (clockwise) order. */
  players: PlayerId[];
  /** Kept so the game can still name players who leave. */
  names: Record<PlayerId, string>;
  roles: Record<PlayerId, RoleId>;
  /** Who names Merlin at the end: the Assassin, or an Evil player told they act as one. */
  assassin: PlayerId | null;
  /** The assassin was designated because there was no Assassin card. */
  designated: boolean;
  /** Lady, Targeting and the Oberon reading, fixed when the game started. */
  lady: boolean;
  targeting: boolean;
  oberonHidden: boolean;
  quests: Quest[];
  /** Who has read their role card. */
  ready: PlayerId[];
  leader: PlayerId;
  firstLeader: PlayerId;
  /** Rejected proposals in a row this round. */
  rejections: number;
  /** The leader's team so far: everyone sees it change live. */
  draft: PlayerId[];
  /** The quest the leader is building a team for (Targeting), else the next one. */
  slot: number | null;
  /** Secret until every player has voted; then the proposal goes to `proposals`. */
  votes: Record<PlayerId, boolean>;
  /** The team being voted on, or on its quest. */
  team: PlayerId[];
  /** Secret quest cards, cleared as soon as the quest resolves. */
  cards: Record<PlayerId, QuestCard>;
  autoPlayed: PlayerId[];
  autoVotes: PlayerId[];
  autoTeam: boolean;
  proposals: Proposal[];
  results: QuestResult[];
  ladyState: Lady | null;
  /** The assassination's target, once named. */
  target: PlayerId | null;
  autoTarget: boolean;
  /** Players who left for good: the game plays their turns for them. */
  left: PlayerId[];
  deadline: number | null;
  winner: Loyalty | null;
  reason: EndReason | null;
}

export interface RoundTableState {
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

const id = z.string().min(1).max(128);
const seconds = z.number().int().min(MIN_TIMER_SECONDS).max(MAX_TIMER_SECONDS).nullable();

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    preset: z.enum(PRESET_IDS).nullable().optional(),
    roles: z.array(z.enum(ROLE_IDS)).max(MAX_SEATS).optional(),
    lady: z.boolean().optional(),
    targeting: z.boolean().optional(),
    oberonHidden: z.boolean().optional(),
    pickSeconds: seconds.optional(),
    voteSeconds: seconds.optional(),
    timerMode: z.enum(['soft', 'strict']).optional(),
  }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('ready') }),
  /** The leader taps a player on or off the team. */
  z.object({ type: z.literal('pick'), player: id }),
  /** Targeting: the leader picks the quest. */
  z.object({ type: z.literal('target'), slot: z.number().int().min(0).max(4) }),
  /** The leader sends the team (the draft, or the one given) to the vote. */
  z.object({
    type: z.literal('propose'),
    team: z.array(id).max(MAX_SEATS).optional(),
    slot: z.number().int().min(0).max(4).optional(),
  }),
  z.object({ type: z.literal('vote'), approve: z.boolean() }),
  z.object({ type: z.literal('play'), card: z.enum(QUEST_CARDS) }),
  z.object({ type: z.literal('lady'), target: id }),
  z.object({ type: z.literal('assassinate'), target: id }),
  /** Host: act for a player who is holding the table up (as a strict timer would). */
  z.object({ type: z.literal('skip'), player: id }),
  z.object({ type: z.literal('back-to-lobby') }),
]);

export type RoundTableAction = z.infer<typeof actionSchema>;

// ---- What each player may see ----

export interface SeatView {
  id: PlayerId;
  name: string;
  playing: boolean;
}

export interface PlayerView {
  id: PlayerId;
  name: string;
  /** Left the room for good: the game plays their turns. */
  left: boolean;
}

/**
 * Someone the viewer learnt about at the start. `evil`: a fellow (or, for Merlin, a spotted) Evil
 * player, never with a role name. `magic`: one of the players Percival sees (Merlin or Morgana).
 */
export interface Known {
  id: PlayerId;
  as: 'evil' | 'magic';
}

export interface MyRole {
  role: RoleId;
  loyalty: Loyalty;
  /** Sorted by seat, so the order says nothing. */
  known: Known[];
  /** You name Merlin at the end. */
  assassin: boolean;
  /** You act as the Assassin although your card isn't the Assassin. */
  designated: boolean;
  /** The cards you may play on a quest. */
  cards: QuestCard[];
}

export interface VoteView {
  leader: PlayerId;
  slot: number;
  team: PlayerId[];
  /** Who has voted; never how, until everyone has. */
  voted: PlayerId[];
  myVote: boolean | null;
}

export interface QuestView {
  slot: number;
  team: PlayerId[];
  /** Who has played a card; never which. */
  played: PlayerId[];
  /** Your own card, if you're on the team and have played. */
  myCard: QuestCard | null;
}

export interface LadyView {
  holder: PlayerId;
  holders: PlayerId[];
  /** Every check, without its result (public). */
  checks: { round: number; holder: PlayerId; target: PlayerId; auto: boolean }[];
  /** Your own checks' results (the end reveal shows everyone's). */
  mine: { round: number; target: PlayerId; loyalty: Loyalty }[];
}

export interface EndView {
  winner: Loyalty;
  reason: EndReason;
  roles: Record<PlayerId, RoleId>;
  assassin: PlayerId | null;
  designated: boolean;
  target: PlayerId | null;
  autoTarget: boolean;
  /** What each player was shown at the start. */
  knowledge: Record<PlayerId, Known[]>;
  ladyChecks: LadyCheck[];
}

export interface GameView {
  players: PlayerView[];
  /** The roles in this game (public, as a sorted list: never who holds which). */
  deck: RoleId[];
  leader: PlayerId;
  /** Who would make the round's fifth (last) proposal if every team is rejected. */
  hammer: PlayerId;
  rejections: number;
  /** The round in play (1–5): quests played, plus one. */
  round: number;
  quests: Quest[];
  /** Whether quest 5 may be attempted yet (Targeting: once two quests have succeeded). */
  questFiveOpen: boolean;
  targeting: boolean;
  /** The Lady's options, fixed at the start (shown in the rules line). */
  lady: LadyView | null;
  oberonHidden: boolean;
  /** Who has read their role card (the reveal stage). */
  ready: PlayerId[];
  /** The leader's team as it is being built, and the quest it's for. */
  draft: PlayerId[];
  slot: number | null;
  vote: VoteView | null;
  quest: QuestView | null;
  proposals: Proposal[];
  results: QuestResult[];
  /** Who names Merlin (named publicly only at the assassination and the end). */
  assassin: PlayerId | null;
  deadline: number | null;
  end: EndView | null;
}

export interface RoundTableView {
  phase: RoundTableState['phase'];
  table: number;
  stage: Stage | null;
  settings: Settings;
  /** The deck the next game deals (the preset for this table size, or the host's own). */
  deck: RoleId[];
  /** Why the game can't start (lobby), and advice that doesn't stop it. */
  setup: { errors: string[]; notes: string[] };
  seats: SeatView[];
  me: SeatView | null;
  /** Your role card; null for watchers and in the lobby. */
  role: MyRole | null;
  game: GameView | null;
  gamesPlayed: number;
}
