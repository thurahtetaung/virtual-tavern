import type { PlayerId } from '@vt/game-sdk';
import { z } from 'zod';
import {
  CARD_COUNTS,
  type Pillar,
  POOL_IDS,
  type PoolId,
  SET_IDS,
  type SetId,
  THIRDS,
  type Third,
} from './cards.ts';

/** Official counts: the ghost plus 2 to 6 psychics. */
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 7;
export const HAND_SIZE = 7;
/** The clock: seven hours, then the connection is lost. */
export const HOURS = 7;
/** Clairvoyance tokens come back at the start of this hour. */
export const TOKENS_BACK_HOUR = 4;
/** How long the hour's verdicts stay up before the clock moves on (the ghost or host can skip). */
export const REVEAL_SECONDS = 12;
/** How long a psychic's device can be gone before their seat counts as empty. */
export const AWAY_SECONDS = 180;
/** Each stage of the final vote, when the host has a timer on. */
export const VOTE_SECONDS = 60;
export const TIMER_OPTIONS = [60, 120, 180, 300] as const;
export type TimerSeconds = (typeof TIMER_OPTIONS)[number];
export const DEFAULT_TIMER: TimerSeconds = 120;
export const MAX_NOTICES = 12;

/** The six psychics, by the colour of their sleeve; names and portraits come from the manifest. */
export const COLORS = ['blue', 'white', 'red', 'yellow', 'purple', 'brown'] as const;
export type PsychicColor = (typeof COLORS)[number];

export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export type GhostMode = 'random' | 'host' | 'volunteers';
export type TimerMode = 'soft' | 'strict';

export interface Settings {
  ghostMode: GhostMode;
  /** The host's choice in the `host` mode. */
  ghostPick: PlayerId | null;
  difficulty: Difficulty;
  sets: SetId[];
  /** Objects or stories as the third pillar. Optional so older rooms still load (objects). */
  third?: Third;
  /** Extra vision pools mixed into the deck. Optional so older rooms still load (none). */
  pools?: PoolId[];
  /** The extra suspects and places in the pillars. Optional so older rooms still load (off). */
  extras?: boolean;
  /** The interpretation timer once every vision is out; null: no timer. */
  timerSeconds: TimerSeconds | null;
  /** soft: a reminder (the host can lock in); strict: guesses lock at 0:00. */
  timerMode: TimerMode;
}

export interface Seat {
  name: string;
  /** Seated players are dealt in; the rest watch. */
  playing: boolean;
  /** "I'll be the ghost." */
  volunteer: boolean;
  /** The psychic this player would like to be (their sleeve colour). */
  color: PsychicColor | null;
}

export interface Vision {
  card: number;
  /** The hour it arrived. */
  hour: number;
}

export interface Psychic {
  id: PlayerId;
  name: string;
  color: PsychicColor;
  /** Their secret suspect, place and object (or story). Secret until found (or the end). */
  targets: [number, number, number];
  /** 0 suspect, 1 place, 2 object, 3 done. */
  step: number;
  /** The cards found so far, in pillar order. */
  found: number[];
  /** Vision cards in front of them for the current pillar. */
  visions: Vision[];
  /** Their guess this hour: a card on the table of their current pillar. */
  intuition: number | null;
  ready: boolean;
  /** Clairvoyance tokens left to play. */
  tokens: number;
  /** Clairvoyance level (the track). */
  level: number;
  /** The hour they found their last card, or null. */
  finishedHour: number | null;
  /** Left the room for good: anyone watching may take the seat. */
  gone: boolean;
  /**
   * The host retired the empty seat: it is out of the game (no visions, verdicts, line-up or
   * vote), and its found cards went back on the table. Optional so older games still load.
   */
  retired?: boolean;
  /** Since when their device has been gone (server clock), while it is. Optional, like below. */
  awaySince?: number | null;
  /**
   * Away for `AWAY_SECONDS`: the seat counts as empty (not waited on, sent visions or judged, no
   * vote) until they're back, when it is theirs again as it was.
   */
  absent?: boolean;
}

/** A clairvoyance token on another psychic's intuition: ✓ agrees, ✗ disagrees. */
export interface Mark {
  /** The psychic playing it, by seat colour (which survives a seat changing hands). */
  by: PsychicColor;
  /** The psychic it is played on. */
  target: PsychicColor;
  kind: 'yes' | 'no';
}

/** One vision the ghost sent: public, and the "what the ghost meant" recap at the end. */
export interface Send {
  hour: number;
  to: PsychicColor;
  step: number;
  cards: number[];
}

/** One psychic's verdict for one hour. */
export interface Verdict {
  hour: number;
  color: PsychicColor;
  step: number;
  guess: number | null;
  correct: boolean;
  /** Tokens on this guess, and who gained a level from them. */
  marks: Mark[];
}

export interface Final {
  /** The line-up: group i is this psychic's three found cards. */
  groups: PsychicColor[];
  /** The ghost's pick (a group index). Secret until the end. */
  culprit: number | null;
  /** The shared vision, in the (shuffled) order it is revealed. */
  shared: number[];
  /** What the ghost meant by each shared card, privately. */
  tags: (Pillar | null)[];
  /** How many shared cards are face up; voters of this stage vote now (0 before the vision). */
  revealed: number;
  /** Each psychic's vote (a group index), null for an abstention. Secret until all are in. */
  votes: Partial<Record<PsychicColor, number | null>>;
}

export type EndHow = 'culprit' | 'wrong' | 'clock' | 'no-votes';

export interface Result {
  win: boolean;
  how: EndHow;
  /** The group the vote picked. */
  chosen: number | null;
  culprit: number | null;
  /** Votes per group. */
  tally: number[];
  /** Whose vote broke a tie, if one did. */
  tieBreaker: PsychicColor | null;
  winners: PlayerId[];
}

export interface Notice {
  id: number;
  text: string;
  at: number;
}

export type Stage = 'visions' | 'reveal' | 'shared' | 'vote' | 'done';

/** What ended the hour: the ghost's reveal, the host's lock or a strict timer. */
export type LockHow = 'ghost' | 'host' | 'timer';

export interface Game {
  /** The ghost now (null while the seat is empty). */
  ghost: PlayerId | null;
  /** Ghosts who were replaced: they watch. */
  formerGhosts: PlayerId[];
  /** Psychics in seat order. */
  psychics: Psychic[];
  difficulty: Difficulty;
  /** What the third pillar is played with; games saved before it have none (objects). */
  third?: Third;
  /** Clairvoyance tokens and the track are in play (4+ players). */
  clairvoyance: boolean;
  tokensEach: number;
  hour: number;
  stage: Stage;
  /** Cards still on the table, per pillar (found cards leave it). */
  table: Record<Pillar, number[]>;
  /** The ghost's hand. Secret. */
  hand: number[];
  /** The vision draw pile. Never sent. */
  deck: number[];
  discard: number[];
  /** Psychics (by colour) who have had their vision this hour. */
  sent: PsychicColor[];
  ravensUsed: number;
  /** The hour of the last raven (Easy allows one per hour). */
  ravenHour: number | null;
  /** This hour's clairvoyance tokens. */
  marks: Mark[];
  /** The interpretation timer, the reveal hold or a vote stage's timer. */
  deadline: number | null;
  /** What ended the last hour (rooms saved before it have none). */
  lockedHow?: LockHow | null;
  sends: Send[];
  verdicts: Verdict[];
  final: Final | null;
  result: Result | null;
  notices: Notice[];
  startedAt: number;
}

export interface SeanceState {
  phase: 'lobby' | 'playing' | 'over';
  settings: Settings;
  /** Hidden randomness for deadlines and leavers, which come without an rng. Never sent. */
  seed: number;
  /** A random id for this room's table, so private marks never mix rooms up. */
  table: number;
  /** Insertion-ordered by join time: the seating order. */
  seats: Record<PlayerId, Seat>;
  game: Game | null;
  gamesPlayed: number;
  noticeSeq: number;
}

// ---- Actions ----

const id = z.string().min(1).max(128);
const vision = z.number().int().min(1).max(CARD_COUNTS.vision);
const card = z
  .number()
  .int()
  .min(1)
  .max(Math.max(CARD_COUNTS.suspect, CARD_COUNTS.place, CARD_COUNTS.object, CARD_COUNTS.story));
const unique = <T>(ids: T[]) => new Set(ids).size === ids.length;
const color = z.enum(COLORS);
const pillar = z.enum(['suspect', 'place', 'object']);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    ghostMode: z.enum(['random', 'host', 'volunteers']).optional(),
    ghostPick: id.nullable().optional(),
    difficulty: z.enum(DIFFICULTIES).optional(),
    sets: z
      .array(z.enum(SET_IDS))
      .min(1)
      .max(SET_IDS.length)
      .refine(unique, 'Card sets must be unique.')
      .optional(),
    third: z.enum(THIRDS).optional(),
    pools: z
      .array(z.enum(POOL_IDS))
      .max(POOL_IDS.length)
      .refine(unique, 'Vision pools must be unique.')
      .optional(),
    extras: z.boolean().optional(),
    timerSeconds: z
      .union([z.literal(60), z.literal(120), z.literal(180), z.literal(300)])
      .nullable()
      .optional(),
    timerMode: z.enum(['soft', 'strict']).optional(),
  }),
  z.object({ type: z.literal('sit'), playing: z.boolean() }),
  z.object({ type: z.literal('volunteer'), on: z.boolean() }),
  z.object({ type: z.literal('pick-color'), color }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('play-again') }),
  z.object({ type: z.literal('back-to-lobby') }),
  // The ghost.
  z.object({
    type: z.literal('send'),
    to: color,
    cards: z.array(vision).min(1).max(HAND_SIZE),
  }),
  z.object({ type: z.literal('raven'), cards: z.array(vision).min(1).max(HAND_SIZE) }),
  z.object({
    type: z.literal('shared'),
    group: z.number().int().min(0).max(5),
    cards: z.array(vision).length(3),
    tags: z.array(pillar.nullable()).length(3).optional(),
  }),
  z.object({ type: z.literal('continue') }),
  z.object({ type: z.literal('reveal') }),
  // The psychics.
  z.object({ type: z.literal('intuition'), card: card.nullable() }),
  z.object({ type: z.literal('mark'), target: color, kind: z.enum(['yes', 'no']).nullable() }),
  z.object({ type: z.literal('ready'), on: z.boolean() }),
  z.object({ type: z.literal('vote'), group: z.number().int().min(0).max(5) }),
  z.object({ type: z.literal('take-seat'), color }),
  z.object({ type: z.literal('retire-seat'), color }),
  // The host (and spectators taking the empty ghost seat).
  z.object({ type: z.literal('lock-now') }),
  z.object({ type: z.literal('hand-ghost'), to: id }),
  z.object({ type: z.literal('claim-ghost') }),
]);

export type SeanceAction = z.infer<typeof actionSchema>;

// ---- What each player may see ----

export interface SeatView {
  id: PlayerId;
  name: string;
  playing: boolean;
  volunteer: boolean;
  color: PsychicColor | null;
}

export interface PsychicView {
  id: PlayerId;
  name: string;
  color: PsychicColor;
  step: number;
  found: number[];
  visions: Vision[];
  intuition: number | null;
  ready: boolean;
  tokens: number;
  level: number;
  finishedHour: number | null;
  gone: boolean;
  /** The host retired the seat: out of the game. */
  retired: boolean;
  /** Away so long the seat counts as empty until they're back. */
  absent: boolean;
  /** When an away psychic's seat will count as empty (server clock), or null. */
  awayUntil: number | null;
  /** Their three cards: only to the ghost, and to everyone at the end. */
  targets: number[] | null;
  /** When they vote in the final (1–3 shared cards seen). */
  voteStage: number;
}

export type MyRole = 'ghost' | 'psychic' | 'former-ghost' | null;

export interface FinalView {
  groups: PsychicColor[];
  /** The ghost's pick: the ghost, and everyone at the end. */
  culprit: number | null;
  /** The face-up shared cards (all of them for the ghost and at the end). */
  shared: number[];
  /** How many cards the shared vision holds (0 until the ghost sends it). */
  sharedCount: number;
  /** The ghost's tags: the ghost, and everyone at the end. */
  tags: (Pillar | null)[] | null;
  revealed: number;
  /** Who has voted (or abstained) so far. */
  voted: PsychicColor[];
  /** Everyone's votes: only at the end. */
  votes: Partial<Record<PsychicColor, number | null>> | null;
  /** The viewer's own vote. */
  myVote: number | null | undefined;
}

export interface GameView {
  stage: Stage;
  hour: number;
  difficulty: Difficulty;
  third: Third;
  clairvoyance: boolean;
  tokensEach: number;
  ghost: PlayerId | null;
  formerGhosts: PlayerId[];
  myRole: MyRole;
  /** The viewer's psychic colour, if they are one. */
  me: PsychicColor | null;
  psychics: PsychicView[];
  table: Record<Pillar, number[]>;
  /** Only the ghost. */
  hand: number[] | null;
  handCount: number;
  deckCount: number;
  sent: PsychicColor[];
  ravensUsed: number;
  ravenHour: number | null;
  /** Ravens the ghost may still use (Easy: this hour). */
  ravensLeft: number;
  marks: Mark[];
  deadline: number | null;
  /** What ended the last hour: shown with the verdicts. */
  lockedHow: LockHow | null;
  /** Every vision is out and every psychic still searching is Ready: the ghost may reveal. */
  canReveal: boolean;
  sends: Send[];
  verdicts: Verdict[];
  final: FinalView | null;
  result: Result | null;
  notices: Notice[];
}

export interface SeanceView {
  phase: SeanceState['phase'];
  table: number;
  gameNo: number;
  settings: Settings;
  seats: SeatView[];
  me: SeatView | null;
  game: GameView | null;
}
