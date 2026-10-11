import type { PlayerId } from '@vt/game-sdk';
import { z } from 'zod';
import { ARTIFACT_IDS, type ArtifactId, type MarkId, ROLE_IDS, type RoleId } from './roles.ts';
import type { StepId } from './plan.ts';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 10;
/** Cards in the centre, besides the centre werewolf slot. */
export const CENTER_CARDS = 3;

export const DEFAULT_STEP_SECONDS = 12;
export const MIN_STEP_SECONDS = 3;
export const MAX_STEP_SECONDS = 60;
export const DEFAULT_DAY_SECONDS = 300;
export const MIN_DAY_SECONDS = 30;
export const MAX_DAY_SECONDS = 1200;
export const VOTE_SECONDS = 60;
/** The quiet moment between "close your eyes" and the first step. */
export const NIGHT_INTRO_MS = 4000;
/** Private notes kept per player, and timeline entries kept per night. */
export const MAX_NOTES = 60;
export const MAX_TIMELINE = 200;

export type NarrationMode = 'off' | 'host' | 'all';

export interface Settings {
  /** The cards in play, one entry per card: players + 3, plus one for the centre werewolf. */
  roles: RoleId[];
  stepSeconds: number;
  daySeconds: number;
  narration: NarrationMode;
  /** Background music on the devices that narrate (when the manifest has some). */
  music: boolean;
  /** A lone werewolf may look at one centre card. */
  loneWolf: boolean;
  /** Artifacts the Curator may draw. */
  artifacts: ArtifactId[];
}

export interface Seat {
  name: string;
  /** Seated players play; the rest watch. */
  playing: boolean;
}

/** A centre slot: the three centre cards, then the centre werewolf when the Alpha Wolf is in. */
export type CenterKind = 'center' | 'wolf';

/** Where a card is: in front of a player, or a centre slot by index. */
export type Slot = { player: PlayerId } | { center: number };

/**
 * A Mark in front of a player (Vampire set). Marks belong to players, not cards: a card that moves
 * leaves its holder's Mark behind. Giving a Mark sends the old one back to the board, unseen.
 */
export interface MarkToken {
  id: MarkId;
  /** One of the Doppelgänger's own Marks (looks different; works the same). */
  doppel: boolean;
  /** Who placed it, for the Assassin's Mark (the Apprentice Assassin's own win). */
  by?: PlayerId;
}

/** One physical card. Tokens on it (shield, artifact) and what it became travel with it. */
export interface Card {
  /** Physical card number, stable for the game. */
  id: number;
  role: RoleId;
  faceUp: boolean;
  shield: 'normal' | 'doppel' | null;
  artifact: ArtifactId | null;
  /** On the Doppelgänger's or Copycat's card: the role it copied. */
  copied: RoleId | null;
  /** On the P.I.'s card (or a Doppelgänger's copy of it): the role it stopped on. */
  became: RoleId | null;
}

/**
 * Something one player learned or did at night. Private: only the player it belongs to sees
 * it, and the timeline shows all of them at the reveal.
 */
export type NoteBody =
  /** `blind`: she copied a Copycat, so she is now whatever it copied, without knowing what. */
  | { kind: 'copied'; target: PlayerId; role: RoleId; blind?: boolean }
  | { kind: 'copied-centre'; center: number; role: RoleId }
  | { kind: 'saw'; slot: Slot; role: RoleId }
  | { kind: 'saw-own'; role: RoleId }
  | {
      kind: 'group';
      group: 'werewolves' | 'masons' | 'vampires' | 'lovers' | 'assassins' | 'apprentices';
      players: PlayerId[];
      thumbs?: PlayerId[];
    }
  | { kind: 'thumbs'; of: 'werewolves' | 'tanner' | 'seers' | 'touched'; players: PlayerId[] }
  | { kind: 'robbed'; target: PlayerId; role: RoleId }
  | { kind: 'swapped'; a: Slot; b: Slot }
  | { kind: 'took-center'; center: number }
  | { kind: 'witched'; center: number; target: PlayerId }
  | { kind: 'shielded'; target: PlayerId }
  | { kind: 'tapped'; target: PlayerId; side: 'left' | 'right' }
  | { kind: 'was-tapped'; side: 'left' | 'right' }
  | { kind: 'moved-all'; side: 'left' | 'right' }
  | { kind: 'revealed'; target: PlayerId; role: RoleId; stayed: boolean }
  | { kind: 'artifact-placed'; target: PlayerId }
  | { kind: 'became'; role: RoleId }
  | { kind: 'blocked'; reason: 'shielded' | 'no-target' }
  | { kind: 'passed' }
  | { kind: 'artifact'; artifact: ArtifactId }
  /** A Mark you gave (Vampires, Count, Diseased, Cupid, Instigator, Priest, Assassins). */
  | { kind: 'marked'; mark: MarkId; targets: PlayerId[] }
  /** Renfield: the vampires, the player they point at, and the Bat he took. */
  | { kind: 'saw-vampires'; players: PlayerId[]; target: PlayerId | null }
  /** Your own Mark, seen at dusk. */
  | { kind: 'mark'; mark: MarkId; doppel?: boolean }
  /** The Marksman's look at another player's Mark. */
  | { kind: 'saw-mark'; target: PlayerId; mark: MarkId }
  /** The Pickpocket's swap, and the Mark he got. */
  | { kind: 'pickpocketed'; target: PlayerId; mark: MarkId }
  /** The Gremlin's swap of two players' Marks, unseen. */
  | { kind: 'swapped-marks'; a: PlayerId; b: PlayerId };

export type Note = NoteBody & {
  id: number;
  /** Plan index of the step it happened in (-1 for daybreak). */
  step: number;
  /** Chosen for you when time ran out. */
  auto?: boolean;
};

/** One line of the public night timeline, shown at the reveal. */
export interface TimelineEntry {
  step: number;
  stepId: StepId;
  /** Who did it; null for a step nobody acted in. */
  by: PlayerId | null;
  /** What happened, as the actor's note (with the faces of every card involved). */
  note: NoteBody | { kind: 'nobody' };
  auto?: boolean;
  /** Cards moved in this entry, with their faces, for the timeline. */
  moved?: { slot: Slot; role: RoleId; card: number }[];
  /** Marks given or moved in this entry: who held which Mark just before. */
  marks?: { player: PlayerId; mark: MarkId | null }[];
}

export interface GamePlayer {
  name: string;
  /** The card dealt to this player (its physical id). */
  cardId: number;
  /** The role dealt. */
  dealt: RoleId;
  /** The role the player wakes as: the dealt role, or what a Doppelgänger copied. */
  night: RoleId;
  ready: boolean;
  readyToVote: boolean;
  vote: PlayerId | null;
  /** Left the room mid-game: their card stays, but they no longer vote. */
  left: boolean;
  /** Acts as the Doppelgänger (dealt it, or a Copycat who copied it). */
  asDoppel?: boolean;
  /** Never wakes for a role again (a Doppelgänger who copied the Copycat). */
  dormant?: boolean;
}

/** Working memory of the step in progress, per actor. Never sent to anyone else. */
export interface StepWork {
  stage: string;
  /** Picks so far (for multi-part actions). */
  picks: PlayerId[];
  centre: number[];
  /** Whether the actor has done (or skipped) everything for this step. */
  done: boolean;
  /** For a Doppelgänger: the role she acts as now. */
  as?: RoleId;
}

export type Choice = 'marks' | 'cards';

export interface NightState {
  plan: StepId[];
  /** -1 during the intro, then the plan index. */
  index: number;
  deadline: number;
  /** Who acts in the current step. */
  actors: PlayerId[];
  work: Record<PlayerId, StepWork>;
  /** Players who have looked at or moved a card so far (for the Aura Seer). */
  touched: PlayerId[];
  /** Werewolves seen in the werewolves' step (for the Alpha Wolf's targets). */
  knownWolves: PlayerId[];
  /** Artifacts still in the Curator's bag. */
  bag: ArtifactId[];
  /** The players who woke in the vampires' step, and who they gave the Mark of the Vampire. */
  vampires?: PlayerId[];
  vampireTarget?: PlayerId | null;
  timeline: TimelineEntry[];
}

export type DeathCause = 'vote' | 'hunter' | 'love';

export interface Death {
  player: PlayerId;
  cause: DeathCause;
  /** The Hunter whose shot it was, or the lover whose death took this one along. */
  by?: PlayerId;
  /** In an epic battle: first or second most votes (the Most Votes tokens). */
  place?: 1 | 2;
}

export type TeamResultId =
  'village' | 'werewolf' | 'vampire' | 'tanner' | 'assassin' | 'apprentice-assassin';

export interface TeamResult {
  team: TeamResultId;
  won: boolean;
  /** Players on the team at the end. */
  players: PlayerId[];
}

/** Who each player was at the end, after copies, investigations, artifacts and conversions. */
export interface FinalIdentity {
  role: RoleId;
  team: TeamResultId;
  /** The artifact that changed the role, if any. */
  artifact?: ArtifactId;
  /** Turned by a Werewolf's (or a Vampire's) vote: the Cursed. */
  converted?: 'werewolf' | 'vampire';
  traitor?: boolean;
  /** The Mark in front of the player at the end. */
  mark?: MarkId;
  /** A Vampire through the Mark of the Vampire. */
  vampireMark?: boolean;
}

export interface VoteResult {
  votes: Record<PlayerId, PlayerId | null>;
  tally: Record<PlayerId, number>;
  /** Players the vote couldn't kill. */
  protectedPlayers: PlayerId[];
  deaths: Death[];
  identities: Record<PlayerId, FinalIdentity>;
  teams: TeamResult[];
  winners: PlayerId[];
  /** Three or more sides in play: the two-place vote. */
  epic: boolean;
  /** Voters who can't win: they voted for the Mark of Disease or the Diseased. */
  disqualified?: PlayerId[];
}

export interface GameRound {
  number: number;
  /** Seat order: "left" is the next seat. */
  order: PlayerId[];
  players: Record<PlayerId, GamePlayer>;
  cards: Record<PlayerId, Card>;
  center: { kind: CenterKind; card: Card }[];
  night: NightState | null;
  notes: Record<PlayerId, Note[]>;
  /** Notes held back until daybreak (a tap on the shoulder), per player. */
  dawn: Record<PlayerId, NoteBody[]>;
  dayDeadline: number | null;
  voteDeadline: number | null;
  result: VoteResult | null;
  /** What everyone was dealt, kept for the reveal. */
  deal: { players: Record<PlayerId, RoleId>; center: RoleId[] };
  /** Each player's Mark, when the game uses Marks (Vampire set); null otherwise. */
  marks?: Record<PlayerId, MarkToken> | null;
  /** A Seer's (or copy's) look at a player's card, checked at the end for the stats. */
  seerLooks: { by: PlayerId; target: PlayerId; cardId: number }[];
  loneWolf: PlayerId | null;
  /** When the night began, the day broke and the vote opened (for the stats). */
  times: { night: number | null; dawn: number | null; vote: number | null };
}

export type Phase = 'lobby' | 'ready' | 'night' | 'day' | 'vote' | 'reveal';
/** Where the game is. The view calls this its phase. */
export type Stage = Phase;

export interface NightfallState {
  /** Coarse, for the stats: `playing` from the deal to the vote, `over` at the reveal. */
  phase: 'lobby' | 'playing' | 'over';
  stage: Stage;
  settings: Settings;
  /** Hidden randomness for deadlines and leavers, which come without an rng. Never sent. */
  seed: number;
  /** Insertion-ordered by join time: this is the seating order. */
  seats: Record<PlayerId, Seat>;
  round: GameRound | null;
  /** Last note id handed out. */
  seq: number;
  gamesPlayed: number;
}

// ---- Actions ----

const id = z.string().min(1).max(128);
const roleId = z.enum(ROLE_IDS);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    roles: z.array(roleId).max(40).optional(),
    stepSeconds: z.number().int().min(MIN_STEP_SECONDS).max(MAX_STEP_SECONDS).optional(),
    daySeconds: z.number().int().min(MIN_DAY_SECONDS).max(MAX_DAY_SECONDS).optional(),
    narration: z.enum(['off', 'host', 'all']).optional(),
    music: z.boolean().optional(),
    loneWolf: z.boolean().optional(),
    artifacts: z.array(z.enum(ARTIFACT_IDS)).max(ARTIFACT_IDS.length).optional(),
  }),
  z.object({ type: z.literal('sit'), playing: z.boolean() }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('ready') }),
  /** Host: begin the night without waiting for everyone to press Ready. */
  z.object({ type: z.literal('start-night') }),
  z.object({
    type: z.literal('night'),
    /** The plan index the action is meant for, so a late tap never lands on the next step. */
    step: z.number().int().min(0).max(200),
    players: z.array(id).max(4).optional(),
    center: z.array(z.number().int().min(0).max(4)).max(3).optional(),
    side: z.enum(['left', 'right']).optional(),
    /** The Gremlin's choice: swap Marks or cards. */
    choice: z.enum(['marks', 'cards']).optional(),
    /** Skip an optional action. */
    pass: z.literal(true).optional(),
  }),
  z.object({ type: z.literal('ready-to-vote'), ready: z.boolean() }),
  z.object({ type: z.literal('vote'), target: id }),
  z.object({ type: z.literal('play-again') }),
  z.object({ type: z.literal('back-to-lobby') }),
]);

export type NightfallAction = z.infer<typeof actionSchema>;
export type NightAction = Extract<NightfallAction, { type: 'night' }>;

// ---- What each player may see ----

export interface SeatView {
  id: PlayerId;
  name: string;
  playing: boolean;
}

export interface TablePlayerView {
  id: PlayerId;
  name: string;
  left: boolean;
}

/** What the acting player may do right now. */
export interface Prompt {
  /** Which part of the action this is (for the wording): "copy", "view", "swap"… */
  stage: string;
  /** The role the player acts as now. */
  as: RoleId;
  players: { ids: PlayerId[]; min: number; max: number } | null;
  center: { slots: number[]; min: number; max: number } | null;
  /** Players or centre cards, not both (the Seer). */
  either: boolean;
  sides: boolean;
  /** Pick one of these (the Gremlin: Marks or cards). */
  choices: Choice[] | null;
  /** If time runs out, the game chooses at random. */
  mandatory: boolean;
}

export interface ActingView {
  /** Your step: only the players acting in it are told which one it is. */
  step: StepId;
  as: RoleId;
  prompt: Prompt | null;
}

export interface NightView {
  /** -1 during the intro, then the step number; the same for everyone. */
  index: number;
  count: number;
  deadline: number;
  /** Null for everyone who isn't acting in this step. */
  acting: ActingView | null;
}

export interface DayView {
  deadline: number | null;
  readyCount: number;
  meReady: boolean;
  /** Cards turned face up in the night, for everyone to see. */
  faceUp: { player: PlayerId; role: RoleId }[];
  /** Players whose card carries a shield. */
  shields: PlayerId[];
  /** Players whose card carries a face-down artifact. */
  artifacts: PlayerId[];
  /** Whether the centre werewolf slot exists. */
  centerKinds: CenterKind[];
}

export interface VoteView {
  deadline: number | null;
  votedCount: number;
  myVote: PlayerId | null;
}

export interface RevealView {
  result: VoteResult;
  /** Every card at the end, with its tokens. */
  cards: Record<PlayerId, Card>;
  center: { kind: CenterKind; card: Card }[];
  deal: GameRound['deal'];
  /** Every player's Mark at the end (null without Marks). */
  marks: Record<PlayerId, MarkToken> | null;
  timeline: TimelineEntry[];
  plan: StepId[];
}

export interface NightfallView {
  phase: Phase;
  settings: Settings;
  seats: SeatView[];
  me: SeatView | null;
  /** The players in the game, in seat order (null in the lobby). */
  table: TablePlayerView[] | null;
  round: number;
  /** Your card as dealt: the role you play tonight. Null for watchers. */
  myRole: RoleId | null;
  readyCount: number;
  meReady: boolean;
  /**
   * Who the table is still waiting on, so the UI can name them: not Ready yet (ready), not
   * ready to vote (day), or not voted (vote). Empty in the other stages.
   */
  waitingOn: PlayerId[];
  night: NightView | null;
  day: DayView | null;
  vote: VoteView | null;
  /** Your private notes from the night. */
  notes: Note[];
  reveal: RevealView | null;
  gamesPlayed: number;
}
