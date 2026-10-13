import type { PlayerId } from '@vt/game-sdk';
import { z } from 'zod';
import { type EventKind, ITEMS_PER_TILE, MAX_CARD, MAX_TILE, SLOT_COUNT } from './content.ts';

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 12;
/** With the Allies expansion on. */
export const ALLIES_MAX_PLAYERS = 14;
/** The Accomplice and the Witness can join from this many players. */
export const EXTRA_ROLES_MIN = 6;
export const HAND_SIZES = [3, 4, 5] as const;
export type HandSize = (typeof HAND_SIZES)[number];
export const DEFAULT_HAND = 4;
/** The Murderer's 60 s to choose the crime. */
export const NIGHT_SECONDS = 60;
/** The Reversal: the Murderer and Accomplice have 60 s to name the Witness. */
export const REVERSAL_SECONDS = 60;
/** Each step of the Allies Phase (the Lab Technician's check, the Inside Man's pick). */
export const ALLIES_STEP_SECONDS = 45;
/** A player's turn in an event (flipping a Clue card, the Witness's pick). */
export const EVENT_TURN_SECONDS = 30;
export const PRESENT_SECONDS_OPTIONS = [20, 30, 45, 60, 90] as const;
export type PresentSeconds = (typeof PRESENT_SECONDS_OPTIONS)[number];
export const DEFAULT_PRESENT_SECONDS: PresentSeconds = 30;
/**
 * The talk between the last bullet and the presentations, every round: a soft timer (nothing
 * happens at 0; the Forensic Scientist starts the presentations), or 0 for none.
 */
export const DISCUSS_SECONDS_OPTIONS = [0, 60, 120, 180, 300] as const;
export type DiscussSeconds = (typeof DISCUSS_SECONDS_OPTIONS)[number];
export const DEFAULT_DISCUSS_SECONDS: DiscussSeconds = 120;
export const ROUNDS = 3;
/** Bullets in the first round: one per tile. */
export const FIRST_ROUND_BULLETS = SLOT_COUNT;
/** Useful Clue: how many scene tiles the Forensic Scientist chooses from. */
export const USEFUL_CLUE_OPTIONS = 5;
export const MAX_NOTICES = 12;

export type RoleId =
  | 'forensic'
  | 'murderer'
  | 'accomplice'
  | 'witness'
  | 'investigator'
  | 'lab-technician'
  | 'inside-man'
  | 'protective-detail';
export const ROLE_IDS: readonly RoleId[] = [
  'forensic',
  'murderer',
  'accomplice',
  'witness',
  'investigator',
  'lab-technician',
  'inside-man',
  'protective-detail',
];
/** The Allies expansion's roles. */
export const ALLIES_ROLES: readonly RoleId[] = [
  'lab-technician',
  'inside-man',
  'protective-detail',
];

/** How the Forensic Scientist is chosen. */
export type FsMode = 'host' | 'random' | 'volunteers' | 'host-volunteers';
export const FS_MODES: readonly FsMode[] = ['host', 'random', 'volunteers', 'host-volunteers'];

export type TimerMode = 'soft' | 'hard';

export interface Settings {
  fsMode: FsMode;
  /** The host's choice in the `host` and `host-volunteers` modes. */
  fsPick: PlayerId | null;
  accomplice: boolean;
  /** Needs the Accomplice. */
  witness: boolean;
  /** Event tiles are shuffled into the pile after round 1. */
  events: boolean;
  hand: HandSize;
  presentSeconds: PresentSeconds;
  presentMode: TimerMode;
  /** Rooms saved before the discussion step have none: read it with `discussSecondsOf`. */
  discussSeconds?: DiscussSeconds;
  /**
   * Presentations after each round's discussion (the printed rules). Off by default: the
   * discussion carries the round. Older rooms have none: read it with `presentationsOf`.
   */
  presentations?: boolean;
  /**
   * The table rule: after the last round everyone with a badge accuses in turn, in public. On by
   * default; off is the printed ending (the Murderer's side wins). Read it with `finalOf`.
   */
  finalAccusations?: boolean;
  /**
   * The Allies expansion: its cards, tiles and event, up to 14 players, and the roles switched on
   * below. Off by default; older rooms have none of these. Read them with `alliesOf`.
   */
  allies?: boolean;
  labTech?: boolean;
  insideMan?: boolean;
  /** Needs the Witness. */
  protective?: boolean;
  /** The Allies expansion's single Location tile replaces the four. */
  unknownLocation?: boolean;
}

export interface AlliesSettings {
  on: boolean;
  labTech: boolean;
  insideMan: boolean;
  protective: boolean;
  unknownLocation: boolean;
}

type AlliesInput = Pick<
  Settings,
  'accomplice' | 'witness' | 'allies' | 'labTech' | 'insideMan' | 'protective' | 'unknownLocation'
>;

/** The Allies settings in force: everything is off without the expansion. */
export const alliesOf = (s: AlliesInput): AlliesSettings => {
  const on = s.allies ?? false;
  return {
    on,
    labTech: on && (s.labTech ?? false),
    insideMan: on && (s.insideMan ?? false),
    protective: on && (s.protective ?? false) && s.accomplice && s.witness,
    unknownLocation: on && (s.unknownLocation ?? false),
  };
};

export const maxPlayersOf = (s: AlliesInput) => (alliesOf(s).on ? ALLIES_MAX_PLAYERS : MAX_PLAYERS);

export const discussSecondsOf = (s: Settings): DiscussSeconds =>
  s.discussSeconds ?? DEFAULT_DISCUSS_SECONDS;
export const presentationsOf = (s: Settings): boolean => s.presentations ?? false;
export const finalOf = (s: Settings): boolean => s.finalAccusations ?? true;

export interface Seat {
  name: string;
  /** Seated players are dealt in; the rest watch. */
  playing: boolean;
  /** "I'll be the Forensic Scientist." */
  volunteer: boolean;
}

/** A dealt-in player. */
export interface Player {
  id: PlayerId;
  name: string;
  role: RoleId;
  clue: number[];
  means: number[];
  /** Clue cards flipped over by Ruled Out Evidence. */
  ruledOut: number[];
  /** Solve attempts left. */
  badges: number;
  /** Left the room for good: cards stay, no more turns. */
  gone: boolean;
}

export interface Slot {
  tile: number;
  /** The item (0–5) the bullet marks, or null until it's placed. */
  bullet: number | null;
}

export interface Bullet {
  /** 1, 2, 3… in the order they were placed (a moved bullet gets a new number). */
  seq: number;
  slot: number;
  tile: number;
  item: number;
  round: number;
  at: number;
  /**
   * Milliseconds since the previous bullet (or since the round's tiles were laid). Kept for old
   * records, but never shown: the table talks between bullets, so the gaps measure the talk.
   */
  gapMs: number;
  /** Erroneous Information moved this bullet from another item. */
  movedFrom?: number;
}

export type ActiveEvent =
  | { kind: 'useful-clue'; tile: number; options: number[] }
  | { kind: 'ruled-out'; tile: number; order: PlayerId[]; index: number; deadline: number }
  | { kind: 'erroneous'; tile: number }
  | { kind: 'countdown'; tile: number; drawn: number[] }
  | { kind: 'testimony'; tile: number; deadline: number };

/** What the Forensic Scientist does next in a collection phase. */
export type CollectStep =
  /** Round 1: choose one of the Location tiles. */
  | { kind: 'pick-location' }
  /** Place a bullet on every tile that has none. */
  | { kind: 'bullets' }
  /** Put the drawn tile in place of one of the scene tiles. */
  | { kind: 'replace'; drawn: number }
  /** An event is being resolved (see `event`). */
  | { kind: 'event' };

export interface Presentation {
  order: PlayerId[];
  index: number;
  /** When the speaker's time is up (soft: a reminder; hard: the turn passes). */
  deadline: number;
}

export interface Attempt {
  by: PlayerId;
  target: PlayerId;
  clue: number;
  means: number;
  correct: boolean;
  round: number;
  at: number;
  /** Made in turn during the final accusations. */
  final?: boolean;
}

/**
 * The final accusations: everyone with a badge accuses once, one by one, in seat order from the
 * left of the Forensic Scientist. Public, and kept after the end for the timeline.
 */
export interface FinalAccusations {
  order: PlayerId[];
  index: number;
  /** When the accuser's time is up (soft: a reminder; hard: the turn is skipped). */
  deadline: number;
  /** Turns that passed without an accusation (offline, skipped by the host, or timed out). */
  skipped: PlayerId[];
}

export type Side = 'investigators' | 'murderer';

export type AlliesStep = 'lab' | 'inside';

/** The Lab Technician's check: one card on the table, and whether it is part of the crime. */
export interface LabCheck {
  owner: PlayerId;
  deck: 'clue' | 'means';
  n: number;
  hit: boolean;
}

/**
 * The Allies Phase, once, between rounds 1 and 2: the Lab Technician checks a card, then the
 * Inside Man takes a badge. Kept after the phase for the end screen and the stats.
 */
export interface AlliesPhase {
  steps: AlliesStep[];
  /** The step now, or null once the phase is over. */
  step: AlliesStep | null;
  deadline: number;
  labDone: boolean;
  /** Secret: the Lab Technician's alone until the end. Null when skipped. */
  lab: LabCheck | null;
  /** Public: who lost a badge (never who took it). */
  lostBadge: PlayerId | null;
}

/** A Change of Heart: the Forensic Scientist peeked at `tile` and set it aside. Secret until the end. */
export interface PerfectCrime {
  by: PlayerId;
  /** The set-aside tile, or null when even the reshuffled discards had none. */
  tile: number | null;
  /** It was an event, so `by` now wins with the Murderer's side. */
  switched: boolean;
  round: number;
}
/** `final`: every final accusation was wrong. */
export type EndHow = 'solved' | 'time' | 'badges' | 'reversal' | 'final';

export interface Result {
  winner: Side;
  how: EndHow;
  /** Who named the right pair (even when the Reversal then turned it round). */
  solvedBy: PlayerId | null;
  /** The Reversal's pick, and whether it found the Witness. */
  reversalPick: PlayerId | null;
  witnessFound: boolean | null;
  winners: PlayerId[];
}

/** Something the whole table is told (handovers, events, timeouts). */
export interface Notice {
  id: number;
  text: string;
  at: number;
}

export interface Reversal {
  deadline: number;
  murdererTap: PlayerId | null;
  accompliceTap: PlayerId | null;
  /** Who named the right pair. */
  solvedBy: PlayerId;
  /** The Inside Man's tap (Allies expansion; older rooms have none). */
  insideTap?: PlayerId | null;
}

export interface Game {
  /** Dealt-in players in seat order. */
  players: Player[];
  /** The Forensic Scientist now (after a handover, the new one). */
  fs: PlayerId;
  /** Forensic Scientists who were replaced: they watch, knowing the answer. */
  formerFs: PlayerId[];
  /**
   * `discuss`: the table talks the evidence over, every round (then the presentations, if on).
   * `final`: the final accusations after the last round, when the host left them on.
   */
  stage: 'night' | 'collect' | 'discuss' | 'present' | 'allies' | 'final' | 'reversal' | 'done';
  round: number;
  /** The last round: 3, or the round a Countdown came up in. */
  finalRound: number;
  countdown: boolean;
  deadline: number | null;
  /** The crime: the Murderer's Key Evidence and Means. Secret until the end. */
  solution: { clue: number; means: number } | null;
  /** The night's pick was made by the timer. */
  autoCrime: boolean;
  slots: Slot[];
  /** Tiles taken off the table, with the bullet they had. */
  removed: Slot[];
  /** The draw pile, top first. Never sent. */
  pile: number[];
  /** Events that came up, in order. */
  events: EventKind[];
  /** Whether the events have been shuffled in (after round 1). */
  eventsIn: boolean;
  bullets: Bullet[];
  /** When the last bullet (or the round’s tiles) went down: the stored gaps (never shown). */
  lastMark: number;
  step: CollectStep | null;
  /** Whether this round's new tile has been drawn and placed (rounds 2 and 3). */
  roundTileDone: boolean;
  event: ActiveEvent | null;
  present: Presentation | null;
  /** Older rooms have none. */
  final?: FinalAccusations | null;
  /** The Allies Phase, once it has begun (Allies expansion). */
  allies?: AlliesPhase | null;
  /** Every Change of Heart peek so far (Allies expansion). */
  perfect?: PerfectCrime[];
  attempts: Attempt[];
  reversal: Reversal | null;
  result: Result | null;
  notices: Notice[];
  /** A Good Twist's extra badge went to this player. */
  twist: PlayerId | null;
  startedAt: number;
}

export interface InquestState {
  phase: 'lobby' | 'playing' | 'over';
  settings: Settings;
  /** Hidden randomness for deadlines and leavers, which come without an rng. Never sent. */
  seed: number;
  /** A random id for this room's table, so players' private marks never mix rooms up. */
  table: number;
  /** Insertion-ordered by join time: the seating order. */
  seats: Record<PlayerId, Seat>;
  game: Game | null;
  gamesPlayed: number;
  /** The room's last correct solver: A Good Twist gives them an extra badge (kept across games). */
  lastSolver: PlayerId | null;
  noticeSeq: number;
}

// ---- Actions ----

const id = z.string().min(1).max(128);
const slot = z
  .number()
  .int()
  .min(0)
  .max(SLOT_COUNT - 1);
const item = z
  .number()
  .int()
  .min(0)
  .max(ITEMS_PER_TILE - 1);
const card = z.number().int().min(1).max(MAX_CARD);
const tile = z.number().int().min(1).max(MAX_TILE);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    fsMode: z.enum(['host', 'random', 'volunteers', 'host-volunteers']).optional(),
    fsPick: id.nullable().optional(),
    accomplice: z.boolean().optional(),
    witness: z.boolean().optional(),
    events: z.boolean().optional(),
    hand: z.union([z.literal(3), z.literal(4), z.literal(5)]).optional(),
    presentSeconds: z
      .union([z.literal(20), z.literal(30), z.literal(45), z.literal(60), z.literal(90)])
      .optional(),
    presentMode: z.enum(['soft', 'hard']).optional(),
    discussSeconds: z
      .union([z.literal(0), z.literal(60), z.literal(120), z.literal(180), z.literal(300)])
      .optional(),
    presentations: z.boolean().optional(),
    finalAccusations: z.boolean().optional(),
    allies: z.boolean().optional(),
    labTech: z.boolean().optional(),
    insideMan: z.boolean().optional(),
    protective: z.boolean().optional(),
    unknownLocation: z.boolean().optional(),
  }),
  z.object({ type: z.literal('sit'), playing: z.boolean() }),
  z.object({ type: z.literal('volunteer'), on: z.boolean() }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('play-again') }),
  z.object({ type: z.literal('back-to-lobby') }),
  z.object({ type: z.literal('commit-crime'), clue: card, means: card }),
  z.object({ type: z.literal('pick-location'), tile }),
  z.object({ type: z.literal('place-bullet'), slot, item }),
  z.object({ type: z.literal('replace-tile'), slot }),
  z.object({ type: z.literal('useful-pick'), tile, slot }),
  z.object({ type: z.literal('rule-out'), clue: card }),
  z.object({ type: z.literal('move-bullet'), slot, item }),
  z.object({ type: z.literal('testify'), slot }),
  /** Ends the discussion: the presentations, the next round or the final accusations follow. */
  z.object({ type: z.literal('end-discussion') }),
  z.object({ type: z.literal('done-presenting') }),
  /** Skips the current speaker, or the current accuser in the final accusations. */
  z.object({ type: z.literal('skip-speaker') }),
  z.object({ type: z.literal('solve'), target: id, clue: card, means: card }),
  z.object({ type: z.literal('reversal-tap'), target: id }),
  /** The Lab Technician checks one card on the table (or skips the check). */
  z.object({
    type: z.literal('lab-check'),
    owner: id,
    deck: z.enum(['clue', 'means']),
    n: card,
  }),
  z.object({ type: z.literal('lab-skip') }),
  /** The Inside Man takes one badge. */
  z.object({ type: z.literal('inside-pick'), target: id }),
  z.object({ type: z.literal('reversal-confirm') }),
  z.object({ type: z.literal('hand-over') }),
]);

export type InquestAction = z.infer<typeof actionSchema>;

// ---- What each player may see ----

export interface SeatView {
  id: PlayerId;
  name: string;
  playing: boolean;
  volunteer: boolean;
}

export interface PlayerView {
  id: PlayerId;
  name: string;
  clue: number[];
  means: number[];
  ruledOut: number[];
  badges: number;
  gone: boolean;
  /** The Forensic Scientist now (their cards may still be on the table after a handover). */
  isFs: boolean;
  /** A replaced Forensic Scientist, watching. */
  formerFs: boolean;
  /** Only at the end (and your own). */
  role: RoleId | null;
}

/** The viewer's part: their dealt role, or `former-forensic` after a handover. */
export type MyRole = RoleId | 'former-forensic' | null;

export type EventView =
  | { kind: 'useful-clue'; tile: number; options: number[] | null }
  | {
      kind: 'ruled-out';
      tile: number;
      order: PlayerId[];
      index: number;
      current: PlayerId | null;
      deadline: number;
    }
  | { kind: 'erroneous'; tile: number }
  | { kind: 'countdown'; tile: number; drawn: number[] | null; left: number }
  | { kind: 'testimony'; tile: number; deadline: number };

export type StepView =
  | { kind: 'pick-location' }
  | { kind: 'bullets' }
  /** `drawn` only reaches the Forensic Scientist. */
  | { kind: 'replace'; drawn: number | null }
  | { kind: 'event' };

export interface GameView {
  stage: Game['stage'];
  round: number;
  finalRound: number;
  countdown: boolean;
  deadline: number | null;
  players: PlayerView[];
  fs: PlayerId;
  formerFs: PlayerId[];
  myRole: MyRole;
  /** Murderer, Accomplice and Forensic Scientists (current and former); everyone at the end. */
  solution: { murderer: PlayerId; clue: number; means: number } | null;
  /** The Murderer and the Accomplice see each other. */
  partner: PlayerId | null;
  /** The Witness sees the Murderer and the Accomplice, in no particular order. */
  witnessPair: PlayerId[] | null;
  /** Only to the Murderer: the timer chose the crime. */
  autoCrime: boolean;
  slots: Slot[];
  removed: Slot[];
  pileCount: number;
  bullets: Bullet[];
  step: StepView | null;
  event: EventView | null;
  events: EventKind[];
  present: Presentation | null;
  final: FinalAccusations | null;
  attempts: Attempt[];
  /** The Allies Phase: public, but `lab` only reaches the Lab Technician (everyone at the end). */
  allies: AlliesPhase | null;
  /** Change of Heart peeks: only the Forensic Scientist who peeked sees theirs (everyone at the end). */
  perfect: PerfectCrime[];
  /** The Protective Detail knows the Witness. */
  protectedWitness: PlayerId | null;
  /**
   * The Murderer's side, revealed to itself in the Reversal (the Inside Man joins it there):
   * the Murderer, the Accomplice and the Inside Man see each other. Everyone at the end.
   */
  team: { id: PlayerId; role: RoleId }[] | null;
  /** Taps only reach the Murderer's side. */
  reversal: {
    deadline: number;
    murdererTap: PlayerId | null;
    accompliceTap: PlayerId | null;
    insideTap: PlayerId | null;
  } | null;
  result: Result | null;
  notices: Notice[];
  twist: PlayerId | null;
  /** Everyone's roles: only at the end. */
  roles: Record<PlayerId, RoleId> | null;
}

export interface InquestView {
  phase: InquestState['phase'];
  table: number;
  gameNo: number;
  settings: Settings;
  seats: SeatView[];
  me: SeatView | null;
  game: GameView | null;
  lastSolver: PlayerId | null;
}
