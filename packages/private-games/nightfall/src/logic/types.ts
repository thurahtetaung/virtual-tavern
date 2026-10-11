import type { PlayerId } from '@vt/game-sdk';
import { z } from 'zod';
import {
  ARTIFACT_IDS,
  type ArtifactId,
  type HostileGroup,
  type MarkId,
  type NostraTeam,
  ROLE_IDS,
  type RoleId,
} from './roles.ts';
import type { StepId } from './plan.ts';
import {
  type BlobShape,
  MAX_WEIGHT,
  type OracleQuestion,
  type Ripple,
  type StepPick,
  WEIGHT_TABLES,
  type Weights,
} from './tables.ts';

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
  /** The host's changes to the narrator's random tables (Alien options); missing = defaults. */
  weights?: Weights;
}

/** The vote target that means "the app" (a ripple may allow it): nobody dies if it wins. */
export const VOTE_APP = '@app';

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
  /**
   * Who placed it, on a Mark of the Assassin the Apprentice Assassin placed herself (she found no
   * Assassin): she wins when its holder dies, wherever her card ends up.
   */
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
  /** Snatched by the Body Snatcher: an Alien card wherever it goes. */
  alienCard?: boolean;
  /** On a Nostradamus card (or a copy of it): the team announced for it. */
  foretold?: Foretold | null;
}

/**
 * The team announced for a Nostradamus card: the printed team of the last card he saw, and that
 * card (whose final role or holder decides it for copier and own-team cards).
 */
export interface Foretold {
  team: NostraTeam;
  card: number | null;
}

/** What the Oracle's answer did to her card. */
export type OracleMod = 'werewolf-card' | 'vampire-card' | 'alien-card' | 'aliens-win-only';

/** The Oracle's question, her answer and what came of it. */
export interface OracleState {
  question: OracleQuestion;
  /** The Oracle who answered (null: the narrator answered for her). */
  player?: PlayerId | null;
  /** Her answer ("yes", "even", "7"…), or the narrator's when her card is in the centre. */
  answer: string | null;
  /** The narrator's reply, as its narration key: "werewolf-team:yes", "number:wrong"… */
  outcome: string | null;
  mod: OracleMod | null;
  /** She failed the number question: she wins only by surviving, everyone else if she dies. */
  numberFail: boolean;
  /** Her card was in the centre, so the narrator answered for her. */
  centre: boolean;
  /** The aliens must swap cards tonight. */
  exchange: boolean;
  /** A ripple is guaranteed at the end of the night. */
  ripple: boolean;
}

/** Something the narrator says out loud for everyone (ruled public, like the app's lines). */
export type Announcement =
  | { kind: 'oracle-parity'; parity: 'even' | 'odd' }
  | { kind: 'oracle-view'; number: number; swapped: boolean }
  | { kind: 'oracle-number'; right: boolean }
  | { kind: 'nostradamus'; doppel: boolean; team: NostraTeam }
  | { kind: 'blob'; shape: BlobShape }
  | { kind: 'ripple'; ripple: Ripple };

/** An announcement, with the step it was made at (shown from that step on). */
export type PublicNote = Announcement & {
  step: number;
  /** When it was said (server clock), so every device can speak it at the same moment. */
  at: number;
};

/** What the ripples did to the day and the vote. */
export interface DayRules {
  /** Players may vote for the app: if it gets the most votes, nobody dies. */
  voteApp?: boolean;
  /** These players vote with both hands: two votes each. */
  twoVotes?: PlayerId[];
  /** Players who may only say "I am an alien", must face away, or may not speak. */
  restrictions?: { kind: 'i-am-alien' | 'face-away' | 'no-speak'; players: PlayerId[] }[];
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
      group:
        | 'werewolves'
        | 'masons'
        | 'vampires'
        | 'lovers'
        | 'assassins'
        | 'apprentices'
        | 'aliens'
        | 'groob-zerb';
      players: PlayerId[];
      thumbs?: PlayerId[];
    }
  | {
      kind: 'thumbs';
      of: 'werewolves' | 'tanner' | 'seers' | 'touched' | 'aliens' | 'groob-zerb' | 'cow';
      players: PlayerId[];
    }
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
  /** `role`: the role that had nobody to choose (the Robber: no one to rob). */
  | { kind: 'blocked'; reason: 'shielded' | 'no-target'; role?: RoleId }
  /** The Mark of Fear kept you asleep through your turn (learned at daybreak). */
  | { kind: 'feared'; role: RoleId }
  | { kind: 'passed' }
  | { kind: 'artifact'; artifact: ArtifactId }
  /** A Mark you gave (Vampires, Count, Diseased, Cupid, Instigator, Priest, Assassins). */
  | {
      kind: 'marked';
      mark: MarkId;
      targets: PlayerId[];
      /** The vampires choose together: the fellow vampire whose pick it was. */
      chosenBy?: PlayerId;
    }
  /** Renfield: the vampires, the player they point at, and the Bat he took. */
  | { kind: 'saw-vampires'; players: PlayerId[]; target: PlayerId | null }
  /** Your own Mark, seen at dusk. */
  | { kind: 'mark'; mark: MarkId; doppel?: boolean }
  /** The Marksman's look at another player's Mark. */
  | { kind: 'saw-mark'; target: PlayerId; mark: MarkId }
  /** The Pickpocket's swap, and the Mark he got. */
  | { kind: 'pickpocketed'; target: PlayerId; mark: MarkId }
  /** The Gremlin's swap of two players' Marks, unseen. */
  | { kind: 'swapped-marks'; a: PlayerId; b: PlayerId }
  /** What the narrator told you to do this step (the Alien set's random instructions). */
  | { kind: 'told'; pick: StepPick; watching?: boolean }
  /** The Cow: whether an alien tipped your fist. */
  | { kind: 'tipped'; tipped: boolean }
  /** You put out a fist for the aliens: tapped (now an alien, or their helper) or not. */
  | { kind: 'fist'; tapped: boolean; helper: boolean }
  /** The aliens tapped a fist: that player is now an alien (or their helper). */
  | { kind: 'recruited'; target: PlayerId; helper: boolean; chosenBy?: PlayerId }
  /** The aliens passed their cards round, unseen. */
  | { kind: 'passed-card'; side: 'left' | 'right'; to: PlayerId | null }
  /** You swapped your card with another and looked at your new one (a Rascal, a ripple). */
  | { kind: 'took'; slot: Slot; role: RoleId }
  /** The Body Snatcher's new card (now an Alien card). */
  | { kind: 'snatched'; slot: Slot; role: RoleId }
  /** A card you looked at and then gave to a player (the Rascal, a ripple's Witch). */
  | { kind: 'gave'; from: Slot; to: PlayerId }
  /** The Exposer's centre card, turned face up. */
  | { kind: 'exposed'; center: number; role: RoleId }
  /** The Empath's question: where you pointed (null: at nobody). */
  | { kind: 'pointed'; target: PlayerId | null }
  /** The Empath: where a player pointed. */
  | { kind: 'saw-point'; from: PlayerId; target: PlayerId | null }
  /** Nostradamus: the team your last look put you on. */
  | { kind: 'foretold'; team: NostraTeam }
  /** The Oracle's question, her answer and the narrator's reply. */
  | { kind: 'oracle'; question: OracleQuestion; answer: string; outcome: string }
  /** Only pretending to look (the Mortician, the Body Snatcher). */
  | { kind: 'pretended' }
  /** Eyes open (the Oracle's number, a time loop): who woke in a step and what they touched. */
  | { kind: 'watched'; stepId: StepId; awake: PlayerId[]; touched: Slot[]; marks: PlayerId[] }
  /** A ripple's shuffle: both cards seen, then shuffled between the two of you. */
  | { kind: 'shuffled'; with: PlayerId; mine: RoleId; theirs: RoleId };

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
  note: NoteBody | { kind: 'nobody' } | { kind: 'announced'; announcement: Announcement };
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
  /** The second hand, for a player a ripple lets vote twice. */
  vote2?: PlayerId | null;
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

export const CHOICES = [
  'marks',
  'cards',
  'yes',
  'no',
  'even',
  'odd',
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  '11',
  '12',
] as const;
/** A choice: Marks or cards (the Gremlin), the Oracle's yes, no, even, odd or a number. */
export type Choice = (typeof CHOICES)[number];

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
  /** The players who woke in the aliens' step (the Body Snatcher's known aliens). */
  aliens?: PlayerId[];
  /** Groob and Zerb, when they saw each other (they show the Leader a thumb). */
  groobZerb?: PlayerId[];
  /** Each step's random instruction, by plan index. */
  picks?: Record<number, StepPick>;
  /** Where the time loop starts in the plan (a ripple sent the night round again). */
  loopFrom?: number;
  /** Tonight's ripple, once announced. */
  ripple?: Ripple;
  /** The aliens' joint pick this step (all-view, a New Alien), once made. */
  alienTarget?: PlayerId | null;
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
  | 'village'
  | 'werewolf'
  | 'vampire'
  | 'tanner'
  | 'assassin'
  | 'apprentice-assassin'
  | 'alien'
  | 'synthetic'
  | 'blob'
  | 'mortician'
  | 'groob'
  | 'zerb'
  | 'leader'
  | 'nostradamus';

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
  /**
   * The hostile group the player counts towards when it isn't their role's own: an Alien card,
   * a New Alien, the Oracle's answer, the Mark of the Vampire (null: none at all).
   */
  group?: HostileGroup | null;
  /** Why the player is on the alien side, when the role alone doesn't say. */
  alien?: 'card' | 'player' | 'helper' | 'oracle';
  /** The Oracle's answer made her card this. */
  oracle?: OracleMod;
  /** Nostradamus: the team announced, and the player holding the card that decides it. */
  foretold?: { team: NostraTeam; holder?: PlayerId };
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
  /** Second-hand votes (a ripple's two-hand vote). */
  votes2?: Record<PlayerId, PlayerId | null>;
  /** Votes for the app (a ripple allowed it): if it ties for most, nobody dies. */
  appVotes?: number;
  /** Every player on the alien side voted for the Leader: the aliens win, the village loses. */
  leaderRule?: boolean;
  /**
   * The Oracle failed the number question: `oracle` (she wins by surviving, the rest if she dies)
   * or `circle` (her card was in the centre: everyone wins only if nobody dies).
   */
  oracleRule?: 'oracle' | 'circle';
  /** Each Blob at the end, with its members (the Blob included) and whether it won. */
  blobs?: { player: PlayerId; members: PlayerId[] }[];
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
  /** Players a New Alien tap made aliens, or alien helpers (it stays with the player). */
  aliens?: { players: PlayerId[]; helpers: PlayerId[] };
  /** The Oracle's question and answer, when she is in the game. */
  oracle?: OracleState | null;
  /** The Blob's members, as announced. */
  blob?: BlobShape | null;
  /** What the narrator said out loud for everyone, in order. */
  announcements?: PublicNote[];
  /** Players with their eyes open for the rest of the night (they watch every step). */
  observers?: PlayerId[];
  /** The day's length in seconds, after the aliens' timer and the ripples. */
  daySeconds?: number;
  /** The ripples' rules for the day and the vote. */
  rules?: DayRules;
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
    /** The Alien options: per table, per entry. `{}` resets every table to the defaults. */
    weights: z
      .partialRecord(
        z.enum(WEIGHT_TABLES),
        z.record(z.string().max(40), z.number().min(0).max(MAX_WEIGHT)),
      )
      .optional(),
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
    /** A choice: the Gremlin's (swap Marks or cards), the Oracle's answer. */
    choice: z.enum(CHOICES).optional(),
    /** Skip an optional action. */
    pass: z.literal(true).optional(),
    /** The vampires: show the others who you have in mind, before anyone confirms. */
    point: z.literal(true).optional(),
  }),
  z.object({ type: z.literal('ready-to-vote'), ready: z.boolean() }),
  /** Host: open the vote without waiting for everyone to be ready (someone dropped out). */
  z.object({ type: z.literal('start-vote') }),
  /** `hand: 2` is the second vote of a player a ripple lets vote with both hands. */
  z.object({ type: z.literal('vote'), target: id, hand: z.literal(2).optional() }),
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
  /** The vampires' step: who each fellow vampire is pointing at so far. */
  team?: { player: PlayerId; pick: PlayerId | null }[];
  /** What the narrator told you to do this step (the Alien set's random instructions). */
  told?: StepPick;
  /** A ripple you were named in. */
  ripple?: Ripple;
  /** You act with your eyes closed: a fist out for the aliens (or the Cow's), or pointing. */
  eyes?: 'closed';
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
  /** Centre cards turned face up in the night (the Exposer). */
  centerUp?: { center: number; role: RoleId }[];
  /** The day's length in seconds (the aliens' timer and the ripples can shorten it). */
  seconds?: number;
  /** The ripples' rules for the day and the vote. */
  rules?: DayRules;
}

export interface VoteView {
  deadline: number | null;
  votedCount: number;
  myVote: PlayerId | null;
  /** Your second vote, when a ripple lets you vote with both hands. */
  mySecond?: PlayerId | null;
  /** How many votes you cast: 2 with a two-hand ripple. */
  hands?: 1 | 2;
  /** You may vote for the app. */
  app?: boolean;
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
  /** What the narrator said out loud for everyone tonight (the same for every viewer). */
  announcements: PublicNote[];
  reveal: RevealView | null;
  gamesPlayed: number;
}
