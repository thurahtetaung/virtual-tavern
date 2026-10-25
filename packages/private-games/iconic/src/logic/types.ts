import type { PlayerId, WordListSummary } from '@vt/game-sdk';
import { z } from 'zod';
import { ICON_COUNT } from './board.ts';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 12;

/**
 * The clue sets: `main` (the green "?", always placed first) and four sub-sets (blue, red, yellow
 * and black "!"). Each is one marker and its cubes.
 */
export const SETS = ['main', 'sub1', 'sub2', 'sub3', 'sub4'] as const;
export type SetId = (typeof SETS)[number];

/** Cubes per set, as in the box: 10 green, 8 of each other colour. */
export const CUBE_CAP: Record<SetId, number> = { main: 10, sub1: 8, sub2: 8, sub3: 8, sub4: 8 };

export const LEVELS = ['easy', 'hard', 'challenging'] as const;
export type Level = (typeof LEVELS)[number];
export const LEVEL_LABELS: Record<Level, string> = {
  easy: 'Easy',
  hard: 'Hard',
  challenging: 'Challenging',
};
/** Extra points for both the guesser and the clue givers with the difficulty bonus on. */
export const LEVEL_BONUS: Record<Level, number> = { easy: 0, hard: 1, challenging: 2 };

/** A card holds three words of each level. */
export const WORDS_PER_LEVEL = 3;
/** Longest word or phrase a card may hold. */
export const MAX_WORD_LENGTH = 40;
export const MAX_GUESS_LENGTH = 60;
/** Most guesses kept in one round. */
export const MAX_GUESSES = 200;
/** Words drawn into the game's deck for each level at the start (refilled as they run out). */
export const DECK_SIZE = 150;
/** The usual game ends once this many words have been guessed. */
export const WORDS_TO_END = 12;

export const CHOOSE_MS = 45_000;
/** How long a "right" mark can be taken back before it counts. */
export const UNDO_MS = 5_000;
/** How long a round's result shows before the next clue givers choose. */
export const REVEAL_MS = 5_000;
export const ROUND_MINUTES = [3, 5, 8] as const;
export type RoundMinutes = (typeof ROUND_MINUTES)[number];
/** Rounds kept for the end screen. */
export const MAX_HISTORY = 60;

export type Givers = 'auto' | 1 | 2;
export type Length = 'twelve' | 'each' | 'endless';
export type TimerMode = 'soft' | 'strict';

export interface Settings {
  /** Clue givers per word: one, two, or `auto` (two from 5 players). */
  givers: Givers;
  /** Twelve words guessed, one word guessed for each player, or until the host ends it. */
  length: Length;
  /** Points on (the printed scoring) or off (just a count of words guessed). */
  scoring: boolean;
  /** +1 for Hard words and +2 for Challenging ones, to the guesser and each clue giver. */
  bonus: boolean;
  /** The round clock in minutes; null: none. */
  roundMinutes: RoundMinutes | null;
  /** Soft: a reminder. Strict: the word is abandoned when time runs out. */
  timerMode: TimerMode;
  /** The word lists drawn from for each level. */
  lists: Record<Level, string[]>;
}

export interface Seat {
  name: string;
  playing: boolean;
  /** Joined during a game: sits down at the next round if there is room. */
  waiting?: boolean;
}

/** One cube or a stack of them on an icon. */
export interface Cubes {
  icon: number;
  n: number;
}

export interface ClueSet {
  /** The icon the marker is on; null while it is off the board. */
  marker: number | null;
  /** Cubes in the order they were first placed. */
  cubes: Cubes[];
}

export type Board = Record<SetId, ClueSet>;

export type Mark = 'wrong' | 'close';

export interface Guess {
  id: number;
  by: PlayerId;
  text: string;
  at: number;
  mark: Mark | null;
}

export interface CardWord {
  word: string;
  level: Level;
}

export type Stage = 'choose' | 'clue' | 'reveal';

/** How a round ended. */
export type How = 'right' | 'pass' | 'gave-up' | 'timer' | 'left';

export interface RoundResult {
  outcome: 'guessed' | 'abandoned';
  how: How;
  word: string;
  level: Level;
  guesser: PlayerId | null;
  /** The guess that was awarded. */
  guess: string | null;
  /** Points scored this round, by player. */
  points: Record<PlayerId, number>;
  /** From the first clue to the award (or the end). */
  ms: number;
  /** When the next round starts. */
  until: number;
}

export interface Round {
  no: number;
  givers: PlayerId[];
  stage: Stage;
  /** When the stage began (the choosing reminder runs from here). */
  since: number;
  /** The nine words to choose from; secret to the clue givers until the reveal. */
  card: CardWord[];
  rerolled: boolean;
  /** A pair's proposed word, waiting for the partner. */
  proposal: { by: PlayerId; index: number } | null;
  vetoes: number;
  /** After a veto only this clue giver may propose. */
  picker: PlayerId | null;
  answer: CardWord | null;
  board: Board;
  guesses: Guess[];
  gaveUp: PlayerId[];
  helper: PlayerId | null;
  /** A "right" mark waiting out its undo window. */
  award: { guess: number; by: PlayerId; until: number } | null;
  /** The soft clock has nudged the table. */
  reminded: boolean;
  /** When the clue givers started placing (the round clock runs from here). */
  clueAt: number | null;
  /** Set when the round ends. */
  result: RoundResult | null;
  /** The host chose the word for an absent clue giver. */
  auto?: boolean;
}

export interface HistoryEntry {
  no: number;
  word: string;
  level: Level;
  outcome: 'guessed' | 'abandoned';
  how: How;
  givers: PlayerId[];
  guesser: PlayerId | null;
  helper: PlayerId | null;
  ms: number;
  pieces: number;
}

export interface Game {
  /** Seating order of everyone playing. */
  order: PlayerId[];
  /** Names kept for players who have left. */
  names: Record<PlayerId, string>;
  scores: Record<PlayerId, number>;
  /** Words each player guessed first. */
  guessed: Record<PlayerId, number>;
  /** Words each player gave clues for that were guessed. */
  given: Record<PlayerId, number>;
  wordsGuessed: number;
  /** Who gives the first clue next round. */
  next: PlayerId;
  /** Words not yet drawn, per level (secret). */
  deck: Record<Level, string[]>;
  /** Words drawn, per level, reshuffled back when a deck runs short (secret). */
  spent: Record<Level, string[]>;
  round: Round;
  history: HistoryEntry[];
  winners: PlayerId[];
}

export interface IconicState {
  phase: 'lobby' | 'playing' | 'over';
  settings: Settings;
  /** The word lists this room may pick from (`ctx.content`), kept fresh between games. */
  wordLists: WordListSummary[];
  /** Hidden randomness for deadlines, which come without an rng. Never sent. */
  seed: number;
  seats: Record<PlayerId, Seat>;
  game: Game | null;
  /** The last guess id handed out. */
  seq: number;
  gamesPlayed: number;
}

const id = z.string().min(1).max(128);
const set = z.enum(SETS);
const icon = z.number().int().min(1).max(ICON_COUNT);
const listIds = z
  .array(z.string().min(1).max(64))
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length, 'Word lists must be unique.');

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    givers: z.union([z.literal('auto'), z.literal(1), z.literal(2)]).optional(),
    length: z.enum(['twelve', 'each', 'endless']).optional(),
    scoring: z.boolean().optional(),
    bonus: z.boolean().optional(),
    roundMinutes: z
      .union([z.literal(3), z.literal(5), z.literal(8)])
      .nullable()
      .optional(),
    timerMode: z.enum(['soft', 'strict']).optional(),
    lists: z.object({ level: z.enum(LEVELS), ids: listIds }).optional(),
  }),
  z.object({ type: z.literal('sit'), playing: z.boolean() }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('pick'), index: z.number().int().min(0).max(8) }),
  z.object({ type: z.literal('agree') }),
  z.object({ type: z.literal('veto') }),
  z.object({ type: z.literal('reroll') }),
  z.object({ type: z.literal('place'), set, icon }),
  z.object({ type: z.literal('remove'), set, icon }),
  z.object({ type: z.literal('wipe') }),
  z.object({ type: z.literal('guess'), text: z.string().max(200) }),
  z.object({
    type: z.literal('mark'),
    guess: z.number().int().min(1),
    mark: z.enum(['wrong', 'close']).nullable(),
  }),
  z.object({ type: z.literal('award'), guess: z.number().int().min(1) }),
  z.object({ type: z.literal('undo') }),
  z.object({ type: z.literal('give-up'), on: z.boolean() }),
  z.object({ type: z.literal('pass') }),
  z.object({ type: z.literal('invite'), player: id }),
  z.object({ type: z.literal('act-for') }),
  z.object({ type: z.literal('end-game') }),
  z.object({ type: z.literal('play-again') }),
  z.object({ type: z.literal('back-to-lobby') }),
]);

export type IconicAction = z.infer<typeof actionSchema>;

// ---- What each player may see ----

export interface SeatView {
  id: PlayerId;
  name: string;
  playing: boolean;
  waiting?: boolean;
}

export interface PlayerView {
  id: PlayerId;
  name: string;
  score: number;
  guessed: number;
  given: number;
}

export interface RoundView {
  no: number;
  givers: PlayerId[];
  stage: Stage;
  since: number;
  /** The choosing reminder (soft). */
  chooseBy: number | null;
  /** The round clock's end, while the clue givers are placing. */
  clueBy: number | null;
  reminded: boolean;
  board: Board;
  guesses: Guess[];
  gaveUp: PlayerId[];
  helper: PlayerId | null;
  /** Whether a clue helper may be invited now. */
  helperOpen: boolean;
  result: RoundResult | null;
  auto: boolean;
  /** The card: to the clue givers while choosing, to everyone at the reveal. */
  card: CardWord[] | null;
  /** Clue givers (and a helper) only. */
  secret: {
    answer: CardWord | null;
    rerolled: boolean;
    proposal: { by: PlayerId; index: number } | null;
    vetoes: number;
    picker: PlayerId | null;
    /** Guesses whose words match the answer: flagged for the clue givers, never awarded. */
    looksRight: number[];
    award: { guess: number; by: PlayerId; until: number } | null;
  } | null;
}

export interface GameView {
  order: PlayerId[];
  players: PlayerView[];
  wordsGuessed: number;
  round: RoundView;
  history: HistoryEntry[];
  winners: PlayerId[];
}

export interface IconicView {
  phase: IconicState['phase'];
  settings: Settings;
  wordLists: WordListSummary[];
  seats: SeatView[];
  me: SeatView | null;
  game: GameView | null;
}
