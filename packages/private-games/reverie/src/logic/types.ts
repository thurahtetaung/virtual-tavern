import type { PlayerId } from '@vt/game-sdk';
import { z } from 'zod';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 8;
export const HAND_SIZE = 6;
/** With three players everyone holds one more card and gives two, so the table still has 5. */
export const HAND_SIZE_THREE = 7;
export const MAX_CLUE_LENGTH = 120;
export const TARGET_SCORES = [15, 20, 30] as const;
export type TargetScore = (typeof TARGET_SCORES)[number];
export const MIN_TIMER_SECONDS = 10;
export const MAX_TIMER_SECONDS = 600;

/** One colour per seat, in seat order. */
export const SEAT_COLORS = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'orange',
  'pink',
  'teal',
] as const;
export type SeatColor = (typeof SEAT_COLORS)[number];

/**
 * The card sets. The art lives in private storage as `cards/<n padded to 3>.jpg`; set *names* come
 * from the private manifest there, so the repo only knows ids and card numbers. The numbering has
 * a print-sheet quirk: eleven numbers were never used, so sets are 84-card blocks of the numbers
 * that exist rather than plain ranges.
 */
export interface CardSet {
  id: string;
  cards: number[];
}

export const LAST_CARD = 877;
const MISSING_CARDS = new Set([69, 139, 209, 279, 349, 419, 489, 559, 629, 699, 769]);
const SET_SIZE = 84;
const SET_IDS = [
  'base',
  'set-2',
  'set-3',
  'set-4',
  'set-5',
  'set-6',
  'set-7',
  'set-8',
  'set-9',
  'set-10',
  'extras',
];

export const ALL_CARDS: readonly number[] = Array.from(
  { length: LAST_CARD + 1 },
  (_, n) => n,
).filter((n) => !MISSING_CARDS.has(n));

export const CARD_SETS: readonly CardSet[] = SET_IDS.map((id, i) => ({
  id,
  cards: ALL_CARDS.slice(i * SET_SIZE, (i + 1) * SET_SIZE),
}));

export const cardsIn = (set: CardSet) => set.cards;

export type TimerMode = 'soft' | 'strict';

export interface Settings {
  sets: string[];
  targetScore: TargetScore;
  /** Seconds for the storyteller to choose a card and a clue; null disables the timer. */
  clueSeconds: number | null;
  /** Seconds for everyone else to give a card, and again to vote. */
  guessSeconds: number | null;
  timerMode?: TimerMode;
}

export interface Seat {
  name: string;
  color: SeatColor;
  /** Seated players play; the rest watch. */
  playing: boolean;
  score: number;
  hand: number[];
}

export type Phase = 'clue' | 'pick' | 'vote' | 'reveal';

export interface TableCard {
  card: number;
  owner: PlayerId;
}

/** How a player scored this turn, for the reveal. */
export interface TurnResult {
  points: number;
  foundIt: boolean;
  votesReceived: number;
}

export interface Turn {
  round: number;
  storyteller: PlayerId;
  phase: Phase;
  clue: string | null;
  /** The storyteller's card; secret until the reveal. */
  storyCard: number | null;
  /** Cards given by the other players; secret until the reveal. */
  submissions: Record<PlayerId, number[]>;
  /** Face-up cards in table order, built when every submission is in. */
  table: TableCard[];
  /** Table index each voter chose; secret until the reveal. */
  votes: Record<PlayerId, number>;
  deadline: number | null;
  results: Record<PlayerId, TurnResult> | null;
  /** Everyone found it, or nobody did (the storyteller scores nothing). */
  allOrNone: boolean | null;
}

export interface ReverieState {
  phase: 'lobby' | 'playing' | 'over';
  settings: Settings;
  /** Insertion-ordered by join time: this is the seating order. */
  seats: Record<PlayerId, Seat>;
  draw: number[];
  discard: number[];
  turn: Turn | null;
  /** Everyone who finished on the winning score. */
  winners: PlayerId[];
  gamesPlayed: number;
}

const timerSeconds = z.number().int().min(MIN_TIMER_SECONDS).max(MAX_TIMER_SECONDS).nullable();
const card = z.number().int().min(0).max(LAST_CARD);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    sets: z.array(z.string().min(1)).min(1).max(CARD_SETS.length).optional(),
    targetScore: z.union([z.literal(15), z.literal(20), z.literal(30)]).optional(),
    clueSeconds: timerSeconds.optional(),
    guessSeconds: timerSeconds.optional(),
    timerMode: z.enum(['soft', 'strict']).optional(),
  }),
  z.object({ type: z.literal('sit'), playing: z.boolean() }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('back-to-lobby') }),
  z.object({ type: z.literal('tell'), card, clue: z.string().trim().min(1).max(MAX_CLUE_LENGTH) }),
  z.object({ type: z.literal('give'), cards: z.array(card).min(1).max(2) }),
  z.object({
    type: z.literal('vote'),
    index: z
      .number()
      .int()
      .min(0)
      .max(MAX_PLAYERS * 2),
  }),
  z.object({ type: z.literal('next-turn') }),
]);

export type ReverieAction = z.infer<typeof actionSchema>;

// ---- What each player may see ----

export interface SeatView {
  id: PlayerId;
  name: string;
  color: SeatColor;
  playing: boolean;
  score: number;
  /** Whether this player has done what the phase needs from them. */
  done: boolean;
}

export interface TableCardView {
  card: number;
  /** Shown after the reveal. */
  owner: PlayerId | null;
  voters: PlayerId[];
  isStory: boolean;
  /** The viewer gave this card. */
  mine: boolean;
}

export interface TurnView {
  round: number;
  storyteller: PlayerId;
  phase: Phase;
  clue: string | null;
  /** The viewer's own storyteller pick, so the form can show it while waiting. */
  myStoryCard: number | null;
  /** The viewer's own submission. */
  myCards: number[];
  myVote: number | null;
  table: TableCardView[];
  results: Record<PlayerId, TurnResult> | null;
  allOrNone: boolean | null;
  deadline: number | null;
}

export interface ReverieView {
  phase: ReverieState['phase'];
  settings: Settings;
  seats: SeatView[];
  me: SeatView | null;
  /** Only the viewer's own cards. */
  hand: number[];
  /** How many cards each other player gives this turn (1, or 2 with three players). */
  cardsToGive: number;
  drawPile: number;
  turn: TurnView | null;
  winners: PlayerId[];
}
