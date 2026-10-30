import { type PlayerId, type TableVolumes, tableVolumeAction } from '@vt/game-sdk';
import { z } from 'zod';
import type { Card, Category, PackSummary } from './content.ts';
import type { DeckKind, Each, FilmGoal, Goal, GoalId, ModeId, StyleId } from './genres.ts';

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 16;
/** Room capacity: up to `MAX_PLAYERS` play, the rest watch. */
export const ROOM_CAPACITY = 30;
/** Each team needs a describer and at least one guesser. */
export const MIN_TEAM = 2;

export const ANSWER_SECONDS = [10, 15, 20] as const;
export const TURN_SECONDS = [30, 45, 60] as const;
/** The 3-2-1 before every face-off flip and every team turn. */
export const COUNTDOWN_MS = 3_000;
/** Placing cards on the squares, then placed automatically. */
export const PLACE_MS = 15_000;
/** The first answer must come this soon after the flip (the opening clock setting). */
export const OPENING_MS = 15_000;
/** The look back at a team's turn before the other team's 3-2-1. */
export const RECAP_MS = 3_000;
/** The soft decision steps: the trailing team's category pick, the 3-for-1 steal. */
export const DECIDE_MS = 15_000;
/** A Got it can be taken back this soon after. */
export const UNDO_MS = 3_000;
/** Cards and categories remembered per room, so the packs are used up before anything repeats. */
export const MAX_USED = 1500;
export const MAX_LOG = 40;

export type TeamId = 'a' | 'b';
export const TEAMS: readonly TeamId[] = ['a', 'b'];
export const other = (t: TeamId): TeamId => (t === 'a' ? 'b' : 'a');
/** The teams' names on every screen. */
export const TEAM_NAMES: Record<TeamId, string> = { a: 'Popcorn', b: 'Nachos' };
export type TimerMode = 'soft' | 'strict';
/**
 * Where the clock and stings play: nowhere, the host's device, every device (on a call), or the
 * table screen. Phones keep their own buzz either way.
 */
export type SoundMode = 'off' | 'host' | 'all' | 'stage';
export const SOUND_MODES: readonly SoundMode[] = ['off', 'host', 'all', 'stage'];
export type AnswerSeconds = (typeof ANSWER_SECONDS)[number];
export type TurnSeconds = (typeof TURN_SECONDS)[number];

export interface Settings {
  deck: DeckKind;
  /** The last film preset picked; alone (rooms saved before the genre picks) it is the goal. */
  goal: FilmGoal;
  /** The genres to collect, per deck (unset: the preset's, or the TV eight). */
  filmGenres?: string[];
  tvGenres?: string[];
  /** Cards of each genre to collect (unset: the preset's). */
  each?: Each;
  mode: ModeId;
  /** Mix: the styles the host ticked (3, or 3–4 dealt fresh each round). */
  mixStyles: StyleId[];
  mixFresh: boolean;
  /** Chosen packs of every kind. */
  packIds: string[];
  answerSeconds: AnswerSeconds;
  turnSeconds: TurnSeconds;
  /** Extra rules: shown as text, the table enforces them. */
  noSequels: boolean;
  newWordsOnly: boolean;
  /** Each face-off player picks 3 of 5 instead of the winner keeping the easy three. */
  noAdvantage: boolean;
  /** The trailing team's face-off player picks the category from two. */
  comebackPick: boolean;
  /** With both teams one genre away, the face-off decides the game. */
  suddenDeath: boolean;
  /** The first face-off answer must come within 15 s of the flip. */
  openingClock: boolean;
  /** The category pick and the 3-for-1 steal: a reminder, or time's up decides. */
  timerMode: TimerMode;
  sound: SoundMode;
  /** The host picked the sound: until then it follows the table (see `soundModeIn`). */
  soundChosen: boolean;
  /** The table screen's volumes, from the host's sliders (the table has no input). */
  tableVolumes: TableVolumes;
}

/**
 * Where the sound plays: the host's choice once made; before that a paired table screen, else
 * every device on a call and the host's device in a room.
 */
export function soundModeIn(
  settings: Pick<Settings, 'sound' | 'soundChosen' | 'mode'>,
  stagePresent: boolean,
): SoundMode {
  if (settings.soundChosen) return settings.sound;
  if (stagePresent) return 'stage';
  return settings.mode === 'video' || settings.mode === 'voice' ? 'all' : 'host';
}

export interface Seat {
  name: string;
  /** null = watching. */
  team: TeamId | null;
  /** On a voice call: Act It squares become Describe It Badly on this player's turn. */
  onCall: boolean;
}

export interface FaceOff {
  /** When the category turned over. */
  flippedAt: number;
  /** Who must answer next (null: before the first answer, either may). */
  on: PlayerId | null;
  /** The answer clock (or the opening clock), null when untimed. */
  deadline: number | null;
  answers: number;
  /** Who gave the latest answer. */
  last: PlayerId | null;
  firstAt: number | null;
  /** Categories swapped before the first answer. */
  swaps: number;
}

export interface Hand {
  team: TeamId;
  /** The cards to choose from (6 or 5) or to place (3). */
  offered: Card[];
  /** How many to keep: 3. */
  slots: (string | null)[];
  deadline: number;
}

export interface Slot {
  style: StyleId;
  card: Card;
  /** The team that guessed it (its own team, or the other by stealing). */
  got: TeamId | null;
  gotAt: number | null;
}

export interface Turn {
  team: TeamId;
  describer: PlayerId;
  startedAt: number;
  endsAt: number;
  /** The card being described now. */
  focus: string | null;
  /** Got its own three: the other team's cards are open to steal. */
  stealOpen: boolean;
  /** Card ids got this turn, in order. */
  gots: string[];
}

export type RoundStage =
  'pick-category' | 'countdown' | 'faceoff' | 'keep' | 'turn' | 'recap' | 'steal';

export interface FaceOffResult {
  winner: PlayerId;
  loser: PlayerId;
  how: 'time';
  answers: number;
  /** From the first answer to the end. */
  ms: number;
}

export interface TurnResult {
  team: TeamId;
  describer: PlayerId;
  /** Titles got, with whether each was stolen. */
  got: { card: Card; style: StyleId; steal: boolean; ms: number }[];
  missed: Card[];
}

export interface Round {
  number: number;
  stage: RoundStage;
  /** Face-off players, one per team; they describe in the turns. */
  pair: Record<TeamId, PlayerId>;
  styles: StyleId[];
  /** The hard clock of the countdown, keep, recap (and its follow-on). */
  stageEnds: number | null;
  /** What the countdown leads to. */
  after: 'faceoff' | 'turn' | null;
  suddenDeath: boolean;
  /** The trailing team's pick between two categories. */
  pick: { by: PlayerId; options: Category[]; deadline: number } | null;
  category: Category | null;
  faceoff: FaceOff | null;
  faceoffResult: FaceOffResult | null;
  hands: Partial<Record<PlayerId, Hand>>;
  board: Partial<Record<TeamId, Slot[]>>;
  /** Face-off winner's team first. */
  order: TeamId[];
  turnNo: number;
  turn: Turn | null;
  results: TurnResult[];
  /** The 3-for-1 steal: teams still to be offered it, the current offer's deadline. */
  steal: { queue: TeamId[]; deadline: number } | null;
  steals: { team: TeamId; by: PlayerId; gave: string; took: Card }[];
}

export interface LogEntry {
  round: number;
  text: string;
}

export interface CliffhangerState {
  phase: 'lobby' | 'playing' | 'over';
  settings: Settings;
  seats: Record<PlayerId, Seat>;
  packs: PackSummary[];
  /** `tv`, or the film preset the game was set up from (for the stats). */
  goal: GoalId;
  /** What this game is won by, fixed at the start (unset in games started before the genre picks). */
  target?: Goal;
  /** Lobby only: titles per genre in the chosen packs of the current deck. */
  genreCounts?: Record<string, number>;
  /** Each team's face-off rotation and whose turn is next in it. */
  rotation: Record<TeamId, { order: PlayerId[]; next: number }>;
  collections: Record<TeamId, Card[]>;
  /** Never sent: the draw pile, top first, and the category pile. */
  deck: Card[];
  categories: Category[];
  discard: Card[];
  round: Round | null;
  /** The most genres each team has trailed by (for comebacks). */
  behind: Record<TeamId, number>;
  log: LogEntry[];
  usedCardIds: string[];
  usedCategoryIds: string[];
  /** Hidden seed for timed fallbacks. Never sent. */
  seed: number;
  gamesPlayed: number;
  winner: TeamId | null;
  endReason: 'won' | 'sudden-death' | 'too-few' | 'no-cards' | 'abandoned' | null;
}

const slotIds = z.array(z.string().min(1).max(200).nullable()).length(3);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    deck: z.enum(['films', 'tv']).optional(),
    goal: z.enum(['base', 'all', 'returns']).optional(),
    genres: z.array(z.string().min(1).max(40)).max(20).optional(),
    each: z.union([z.literal(1), z.literal(2)]).optional(),
    mode: z.enum(['room', 'video', 'voice', 'mix']).optional(),
    mixStyles: z
      .array(z.enum(['one-word', 'quote', 'act', 'describe-badly']))
      .max(4)
      .optional(),
    mixFresh: z.boolean().optional(),
    packIds: z.array(z.string().min(1).max(200)).max(100).optional(),
    answerSeconds: z.union([z.literal(10), z.literal(15), z.literal(20)]).optional(),
    turnSeconds: z.union([z.literal(30), z.literal(45), z.literal(60)]).optional(),
    noSequels: z.boolean().optional(),
    newWordsOnly: z.boolean().optional(),
    noAdvantage: z.boolean().optional(),
    comebackPick: z.boolean().optional(),
    suddenDeath: z.boolean().optional(),
    openingClock: z.boolean().optional(),
    timerMode: z.enum(['soft', 'strict']).optional(),
    sound: z.enum(['off', 'host', 'all', 'stage']).optional(),
  }),
  tableVolumeAction,
  z.object({ type: z.literal('team'), team: z.enum(['a', 'b']).nullable() }),
  z.object({ type: z.literal('shuffle-teams') }),
  z.object({ type: z.literal('on-call'), onCall: z.boolean() }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('back-to-lobby') }),
  z.object({ type: z.literal('pick-category'), id: z.string().min(1).max(200) }),
  z.object({ type: z.literal('new-category') }),
  z.object({ type: z.literal('said') }),
  z.object({ type: z.literal('arrange'), slots: slotIds }),
  z.object({ type: z.literal('lock'), slots: slotIds.optional() }),
  z.object({ type: z.literal('focus'), card: z.string().min(1).max(200) }),
  z.object({ type: z.literal('got'), card: z.string().min(1).max(200) }),
  z.object({ type: z.literal('undo'), card: z.string().min(1).max(200) }),
  z.object({
    type: z.literal('steal'),
    genre: z.string().min(1).max(40),
    card: z.string().min(1).max(200),
  }),
  z.object({ type: z.literal('pass') }),
  /** Host, once a soft step's time is up: take the safe choice for the slow ones. */
  z.object({ type: z.literal('skip') }),
]);

export type CliffhangerAction = z.infer<typeof actionSchema>;

// ---- What each player is allowed to see ----

/** A card on a square as a viewer sees it: the card itself only where they may see it. */
export interface SlotView {
  style: StyleId;
  /** The style the describer uses (Act It moves to Describe It Badly for a player on a call). */
  plays: StyleId;
  card: Card | null;
  got: TeamId | null;
}

export interface HandView {
  offered: Card[];
  slots: (string | null)[];
  deadline: number;
  /** Keep three of these (the rest go to the other player or are discarded). */
  choose: boolean;
}

export interface RoundView {
  number: number;
  stage: RoundStage;
  pair: Record<TeamId, PlayerId>;
  styles: StyleId[];
  stageEnds: number | null;
  after: Round['after'];
  suddenDeath: boolean;
  pick: { by: PlayerId; options: Category[] | null; deadline: number } | null;
  category: Category | null;
  faceoff: FaceOff | null;
  faceoffResult: FaceOffResult | null;
  /** The viewer's own hand while choosing or placing. */
  myHand: HandView | null;
  /** Who is still choosing or placing. */
  placing: PlayerId[];
  board: Partial<Record<TeamId, SlotView[]>>;
  order: TeamId[];
  turnNo: number;
  turn: Turn | null;
  results: TurnResult[];
  steal: { team: TeamId; deadline: number } | null;
  steals: Round['steals'];
}

export interface CliffhangerView {
  phase: CliffhangerState['phase'];
  settings: Settings;
  seats: Array<Seat & { id: PlayerId }>;
  me: (Seat & { id: PlayerId }) | null;
  myTeam: TeamId | null;
  packs: PackSummary[];
  goal: GoalId;
  /** What wins: the game's goal, or in the lobby the one the settings pick. */
  target: Goal;
  /** Lobby only: titles per genre in the chosen packs (for the shortage warnings). */
  genreCounts: Record<string, number> | null;
  rotation: Record<TeamId, PlayerId[]>;
  /** The next face-off pair, named while the round before plays. */
  nextPair: Record<TeamId, PlayerId> | null;
  collections: Record<TeamId, Card[]>;
  deckCount: number;
  round: RoundView | null;
  log: LogEntry[];
  winner: TeamId | null;
  endReason: CliffhangerState['endReason'];
}
