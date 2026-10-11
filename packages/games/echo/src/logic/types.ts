import type { PlayerId } from '@vt/game-sdk';
import { z } from 'zod';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 7;
/** Words on each card; the guesser picks one of them blind. */
export const CARD_SIZE = 5;
export const DECK_SIZES = [8, 13, 20] as const;
export const DEFAULT_DECK_SIZE = 13;
export const MAX_CLUE_LENGTH = 32;
export const MAX_GUESS_LENGTH = 32;
/** Resolved cards kept for the end-of-game summary (a deck never holds more). */
export const MAX_HISTORY = 20;
export const MIN_TIMER_SECONDS = 10;
export const MAX_TIMER_SECONDS = 600;
/**
 * How long the clue writers get to judge a near miss before a host who is also the guesser may
 * settle it themselves (for when no clue writer is around to do it).
 */
export const JUDGE_GRACE_MS = 30_000;

export type DeckSize = (typeof DECK_SIZES)[number];
export type TimerMode = 'soft' | 'strict';

export interface Settings {
  wordListIds: string[];
  deckSize: DeckSize;
  /** Time to write clues. */
  clueSeconds: number | null;
  /** Time to pick a word, to guess, and to judge a near miss. */
  guessSeconds: number | null;
  timerMode: TimerMode;
}

export interface Seat {
  name: string;
  /** false = just watching. Seat order (insertion order) is the guessing order. */
  playing: boolean;
}

/** Up to `CARD_SIZE` words. A word is struck off if its guesser leaves after picking it. */
export type Card = string[];

export type Stage = 'pick' | 'clues' | 'guess' | 'judge' | 'reveal';
export type Outcome = 'right' | 'wrong' | 'pass';
export type CancelReason = 'duplicate';

export interface Turn {
  guesser: PlayerId;
  card: Card;
  pick: number | null;
  stage: Stage;
  /** Every seat id when the card was dealt, used to find the next guesser even after leavers. */
  seatOrder: PlayerId[];
  /** Who writes clues for this card: frozen as clue writing starts, pruned as players leave. */
  givers: PlayerId[];
  /** Clues each giver writes: 2 when only two players give clues, otherwise 1. */
  perGiver: number;
  /** Submitted clues, in submission order. */
  clues: Record<PlayerId, string[]>;
  /** Keyed `${giver}:${index}`. Filled when clue writing ends. */
  cancelled: Record<string, CancelReason>;
  guess: string | null;
  outcome: Outcome | null;
  /** The giver who pressed Count it on a near miss. */
  countedBy: PlayerId | null;
  /** Epoch ms when the current stage times out, or null if untimed. */
  deadline: number | null;
  /** The strict timer picked the word because the guesser ran out of time. */
  autoPicked?: boolean;
  /** Clue writers who had sent nothing when the strict clue timer ran out. */
  missed?: PlayerId[];
  /** The strict timer decided the outcome (no guess, or an undecided near miss). */
  timedOut?: boolean;
  /** Epoch ms when judging a near miss began. */
  judgeStarted?: number;
}

export interface ResolvedClue {
  by: PlayerId;
  name: string;
  text: string;
  cancelled: boolean;
}

export interface ResolvedCard {
  word: string;
  guesser: PlayerId;
  guesserName: string;
  guess: string | null;
  outcome: Outcome;
  countedBy: PlayerId | null;
  clues: ResolvedClue[];
  /** The strict timer decided the outcome. */
  timedOut?: boolean;
  /** Names of clue writers who sent nothing before the clue timer ran out. */
  missed?: string[];
}

export interface EchoState {
  phase: 'lobby' | 'playing' | 'over';
  settings: Settings;
  seats: Record<PlayerId, Seat>;
  /** Cards still to come, top first. Never sent to clients. */
  deck: Card[];
  turn: Turn | null;
  score: number;
  /** Cards not yet resolved, counting the one in play. */
  cardsLeft: number;
  history: ResolvedCard[];
  /** Hidden seed for choices the timer makes on a player's behalf. Never sent to clients. */
  seed: number;
  gamesPlayed: number;
  endReason: 'finished' | 'too-few' | null;
}

const timerSeconds = z.number().int().min(MIN_TIMER_SECONDS).max(MAX_TIMER_SECONDS).nullable();
/** One line of text: trimmed, non-empty, no line breaks. */
const line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !/[\r\n]/.test(s), 'Use a single line.');

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    wordListIds: z.array(z.string().min(1)).min(1).max(20).optional(),
    deckSize: z.union([z.literal(8), z.literal(13), z.literal(20)]).optional(),
    clueSeconds: timerSeconds.optional(),
    guessSeconds: timerSeconds.optional(),
    timerMode: z.enum(['soft', 'strict']).optional(),
  }),
  z.object({ type: z.literal('sit'), playing: z.boolean() }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('back-to-lobby') }),
  z.object({
    type: z.literal('pick'),
    index: z
      .number()
      .int()
      .min(0)
      .max(CARD_SIZE - 1),
  }),
  z.object({ type: z.literal('give-clues'), clues: z.array(line(MAX_CLUE_LENGTH)).min(1).max(2) }),
  z.object({ type: z.literal('guess'), word: line(MAX_GUESS_LENGTH) }),
  z.object({ type: z.literal('pass') }),
  z.object({ type: z.literal('count-it') }),
  z.object({ type: z.literal('continue') }),
  z.object({ type: z.literal('next-card') }),
]);

export type EchoAction = z.infer<typeof actionSchema>;

// ---- What each player is allowed to see ----

/** `waiting`: playing, but joined after this card's clue writing began. */
export type Role = 'guesser' | 'giver' | 'waiting' | 'spectator';

export interface ClueView {
  /** null when the viewer is the guesser and the card isn't revealed yet. */
  by: PlayerId | null;
  name: string | null;
  text: string;
  cancelled: boolean;
  /** Who else wrote a clue that cancelled this one. */
  sameAs: PlayerId[];
}

export interface TurnView {
  guesser: PlayerId;
  stage: Stage;
  /** How many face-down words the guesser can pick from. */
  cardSize: number;
  pick: number | null;
  /** The secret word: hidden from the guesser until the reveal. */
  word: string | null;
  givers: PlayerId[];
  perGiver: number;
  /** Givers who have sent their clues. */
  submitted: PlayerId[];
  /** The viewer's own clues, if they've sent any. */
  myClues: string[] | null;
  /**
   * Visible clues. While clues are being written: none. The guesser then sees only the surviving
   * clues, alphabetically and without authors; everyone else sees them all.
   */
  clues: ClueView[];
  cancelledCount: number;
  guess: string | null;
  outcome: Outcome | null;
  countedBy: PlayerId | null;
  deadline: number | null;
  /** The strict timer picked the word for the guesser. */
  autoPicked: boolean;
  /** Clue writers who sent nothing before the strict clue timer ran out. */
  missed: PlayerId[];
  /** The strict timer decided the outcome. */
  timedOut: boolean;
}

export interface EchoView {
  phase: EchoState['phase'];
  settings: Settings;
  seats: Array<Seat & { id: PlayerId }>;
  me: (Seat & { id: PlayerId }) | null;
  role: Role;
  turn: TurnView | null;
  score: number;
  cardsLeft: number;
  history: ResolvedCard[];
  endReason: EchoState['endReason'];
}
