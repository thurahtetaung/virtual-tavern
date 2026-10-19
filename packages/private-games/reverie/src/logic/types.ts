import { PLAYER_COLORS, type PlayerColor, type PlayerId } from '@vt/game-sdk';
import { z } from 'zod';
import { CARD_SETS, LAST_CARD } from './cards.ts';

export { ALL_CARDS, CARD_SETS, type CardSet, LAST_CARD, cardsIn } from './cards.ts';

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

/**
 * A seat's colour is its player's colour in the room (`PlayerInfo.color`); without one (tests),
 * seats take the palette in seat order.
 */
export const SEAT_COLORS = PLAYER_COLORS;
export type SeatColor = PlayerColor;

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
  /** Who tells next, fixed when the turn starts so leavers can't reset the rotation. */
  nextStoryteller: PlayerId;
  phase: Phase;
  /** Cards each other player gives, fixed when the turn starts (2 with three players, else 1). */
  give: number;
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
  /** A strict timer skipped this storyteller just before this turn began. */
  skipped?: PlayerId | null;
  /** Players whose cards a strict timer gave for them this turn. */
  autoGiven?: PlayerId[];
  /** Players a strict timer left without a vote this turn. */
  missedVote?: PlayerId[];
  /** The draw pile ran out before this turn, so the used cards were shuffled back in. */
  reshuffled?: boolean;
}

/** Why the game ended: the target score was reached, or too few players were left to go on. */
export type EndReason = 'target' | 'too-few';

export interface ReverieState {
  phase: 'lobby' | 'playing' | 'over';
  settings: Settings;
  /**
   * Hidden randomness for moments that have no rng (leavers, deadlines). Never shown to players,
   * or a voter could replay a shuffle from the public clock.
   */
  seed: number;
  /** Insertion-ordered by join time: this is the seating order. */
  seats: Record<PlayerId, Seat>;
  draw: number[];
  discard: number[];
  turn: Turn | null;
  /** Everyone who finished on the winning score. */
  winners: PlayerId[];
  endReason: EndReason | null;
  gamesPlayed: number;
  /**
   * Scores of players who left the room during this game, so someone who comes back picks theirs
   * up again. Cleared when a new game starts. Absent in rooms saved before it existed.
   */
  departed?: Record<PlayerId, number>;
}

/** The most cards a table can hold: one from each of 8 players, or 5 with three players. */
export const MAX_TABLE_SIZE = MAX_PLAYERS;

const timerSeconds = z.number().int().min(MIN_TIMER_SECONDS).max(MAX_TIMER_SECONDS).nullable();
const card = z.number().int().min(0).max(LAST_CARD);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    sets: z
      .array(z.string().min(1))
      .min(1)
      .max(CARD_SETS.length)
      .refine((ids) => new Set(ids).size === ids.length, 'Card sets must be unique.')
      .optional(),
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
      .max(MAX_TABLE_SIZE - 1),
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
  /** The storyteller a strict timer skipped just before this turn, if any. */
  skipped: PlayerId | null;
  /** Players a strict timer gave cards for this turn. */
  autoGiven: PlayerId[];
  /** Players a strict timer left without a vote (filled at the reveal). */
  missedVote: PlayerId[];
  /** Who tells the next story (as things stand now). */
  nextStoryteller: PlayerId;
  /** The draw pile ran out before this turn, so the used cards were shuffled back in. */
  reshuffled: boolean;
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
  endReason: EndReason | null;
}
