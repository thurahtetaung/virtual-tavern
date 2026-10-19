import { PLAYER_COLORS, type PlayerColor, type PlayerId, type WordListSummary } from '@vt/game-sdk';
import { CARD_SETS, LAST_CARD } from '@vt/private-reverie/cards';
import { z } from 'zod';

export { CARD_SETS, type CardSet, STELLAR_SET, cardsIn } from '@vt/private-reverie/cards';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;
export const ROUNDS = 4;
export const COLUMNS = 5;
export const ROWS = 3;
/** The grid: 3 lines of 5 cards, positions 0–4 the top line, 5–9 the middle, 10–14 the bottom. */
export const GRID = COLUMNS * ROWS;
/** Every player marks at least 1 and at most 10 cards. */
export const MIN_MARKS = 1;
export const MAX_MARKS = 10;
/** The line replaced after rounds I, II and III: bottom, then middle, then top. */
export const REPLACED_LINE = [2, 1, 0] as const;
/** Cards a game uses: the first grid and one new line after each of rounds I–III. */
export const CARDS_PER_GAME = GRID + (ROUNDS - 1) * COLUMNS;
export const MIN_TIMER_SECONDS = 10;
export const MAX_TIMER_SECONDS = 600;

export type SeatColor = PlayerColor;
export const SEAT_COLORS = PLAYER_COLORS;

export type TimerMode = 'soft' | 'strict';

export interface Settings {
  /** Picture card sets (Reverie's art). */
  sets: string[];
  /** Word lists the words are drawn from (admin lists tagged for this game). */
  wordListIds: string[];
  /** Seconds to mark your slate; null disables the timer. (Named for the shared timer picker.) */
  clueSeconds: number | null;
  /** Seconds for each Scout's choice; null disables the timer. */
  guessSeconds: number | null;
  timerMode: TimerMode;
}

export interface Seat {
  name: string;
  color: SeatColor;
  /** Seated players play; the rest watch. */
  playing: boolean;
  /** Points per round played this game. */
  rounds: number[];
}

/** One word card: the word on top, and the one printed upside down (absent for one-word lists). */
export type WordCard = [string] | [string, string];

/** A card a Scout showed and what came of it. */
export type ShowKind = 'spark' | 'super' | 'fall';

export interface Shown {
  /** Grid position. */
  pos: number;
  card: number;
  scout: PlayerId;
  /** Everyone who marked it, the Scout first, in seat order after them. */
  markers: PlayerId[];
  kind: ShowKind;
  /** Stars each marker filled for it (fallen markers fill none). */
  stars: Record<PlayerId, number>;
  /** A strict timer chose it for the Scout. */
  auto?: boolean;
}

/** `word`: the First Scout picks a two-word card's word (see `switch.ts`); then marking. */
export type Stage = 'word' | 'mark' | 'reveal' | 'done';

export interface RoundResult {
  stars: number;
  /** Spark and Super-Spark boxes: what a fallen player in the Dark loses one point for each of. */
  boxes: number;
  dark: boolean;
  fell: boolean;
  points: number;
}

export interface Round {
  /** 1–4. */
  no: number;
  /** Who holds the First Scout pawn this round. */
  first: PlayerId;
  /** Everyone playing this round, in seat order. */
  players: PlayerId[];
  /** Players who left the room mid-Reveal: their crosses still count for others, nothing else. */
  gone: PlayerId[];
  /** The card at each grid position. */
  board: number[];
  /** Positions new this round (the replaced line), for the table to point out. */
  fresh: number[];
  card: WordCard;
  /** Which word of the card is in play: 0 the top one, 1 the one printed upside down. */
  side: 0 | 1;
  stage: Stage;
  /** Each player's crosses (grid positions); secret until a card is shown. */
  marks: Record<PlayerId, number[]>;
  locked: PlayerId[];
  /** Crosses each player made, public from the Announce on. */
  counts: Record<PlayerId, number> | null;
  /** The player alone in the lead, if any. */
  dark: PlayerId | null;
  scout: PlayerId | null;
  shown: Shown[];
  fallen: PlayerId[];
  results: Record<PlayerId, RoundResult> | null;
  deadline: number | null;
  /** Players whose marks a strict timer locked. */
  autoLocked: PlayerId[];
}

export type EndReason = 'rounds' | 'too-few';

export interface StarlightState {
  phase: 'lobby' | 'playing' | 'over';
  settings: Settings;
  /** The word lists this room may pick from (`ctx.content`), kept fresh between games. */
  wordLists: WordListSummary[];
  /** Hidden randomness for deadlines and leavers. Never shown. */
  seed: number;
  /** Insertion-ordered by join time: this is the seating order (clockwise). */
  seats: Record<PlayerId, Seat>;
  /** Cards still to come, top first. */
  pile: number[];
  /** Word cards still to come. */
  words: WordCard[];
  round: Round | null;
  winners: PlayerId[];
  endReason: EndReason | null;
  gamesPlayed: number;
  /** Round scores of players who left during this game, so a returning player picks them up. */
  departed: Record<PlayerId, number[]>;
}

export const cardSchema = z.number().int().min(0).max(LAST_CARD);
const timerSeconds = z.number().int().min(MIN_TIMER_SECONDS).max(MAX_TIMER_SECONDS).nullable();
const position = z
  .number()
  .int()
  .min(0)
  .max(GRID - 1);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    sets: z
      .array(z.string().min(1))
      .min(1)
      .max(CARD_SETS.length)
      .refine((ids) => new Set(ids).size === ids.length, 'Card sets must be unique.')
      .optional(),
    wordListIds: z
      .array(z.string().min(1))
      .min(1)
      .max(50)
      .refine((ids) => new Set(ids).size === ids.length, 'Word lists must be unique.')
      .optional(),
    clueSeconds: timerSeconds.optional(),
    guessSeconds: timerSeconds.optional(),
    timerMode: z.enum(['soft', 'strict']).optional(),
  }),
  z.object({ type: z.literal('sit'), playing: z.boolean() }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('back-to-lobby') }),
  /** Your crosses, all of them (the slate as it stands). */
  z.object({
    type: z.literal('mark'),
    positions: z
      .array(position)
      .max(MAX_MARKS)
      .refine((p) => new Set(p).size === p.length, 'Each card once.'),
  }),
  z.object({ type: z.literal('lock') }),
  z.object({ type: z.literal('unlock') }),
  /** The First Scout plays the card's top word (0) or the one upside down (1). */
  z.object({ type: z.literal('choose-word'), side: z.union([z.literal(0), z.literal(1)]) }),
  z.object({ type: z.literal('show'), pos: position }),
  z.object({ type: z.literal('next-round') }),
]);

export type StarlightAction = z.infer<typeof actionSchema>;

// ---- What each player may see ----

export interface SeatView {
  id: PlayerId;
  name: string;
  color: SeatColor;
  playing: boolean;
  /** Total so far. */
  score: number;
  rounds: number[];
}

export interface RoundView {
  no: number;
  first: PlayerId;
  players: PlayerId[];
  board: number[];
  fresh: number[];
  /** The word in play; null while the First Scout is still choosing it. */
  word: string | null;
  /** Both words, only to the First Scout while they choose. */
  choices: [string, string] | null;
  side: 0 | 1;
  stage: Stage;
  /** Only the viewer's own crosses. */
  myMarks: number[];
  locked: PlayerId[];
  gone: PlayerId[];
  counts: Record<PlayerId, number> | null;
  dark: PlayerId | null;
  scout: PlayerId | null;
  shown: Shown[];
  fallen: PlayerId[];
  /** Crosses each player has left to confirm (public from the Announce: counts minus shown). */
  left: Record<PlayerId, number> | null;
  /** Stars each player has filled this round so far. */
  stars: Record<PlayerId, number>;
  results: Record<PlayerId, RoundResult> | null;
  deadline: number | null;
  autoLocked: PlayerId[];
}

export interface StarlightView {
  phase: StarlightState['phase'];
  settings: Settings;
  wordLists: WordListSummary[];
  seats: SeatView[];
  me: SeatView | null;
  round: RoundView | null;
  winners: PlayerId[];
  endReason: EndReason | null;
}
