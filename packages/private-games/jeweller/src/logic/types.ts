import type { PlayerId } from '@vt/game-sdk';
import { z } from 'zod';

/** The five gem colours, in the order costs are read. Gold is the wild piece. */
export const GEMS = ['white', 'blue', 'green', 'red', 'black'] as const;
export type Gem = (typeof GEMS)[number];
export const TOKENS = [...GEMS, 'gold'] as const;
export type Token = (typeof TOKENS)[number];
export const LEVELS = [1, 2, 3] as const;
export type Level = (typeof LEVELS)[number];

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;
/** Cards face up per level. */
export const MARKET_SIZE = 4;
/** Pieces a player may hold at the end of their turn, gold included. */
export const TOKEN_LIMIT = 10;
export const MAX_RESERVED = 3;
/** Taking two of one colour needs at least this many in that pile first. */
export const DOUBLE_MIN = 4;
export const GOLD_PIECES = 5;
/** Gem pieces per colour, by player count. */
export const GEMS_FOR: Record<number, number> = { 2: 4, 3: 5, 4: 7 };
/** The points that end the game: 15 by default, a host option up to 21. */
export const DEFAULT_TARGET = 15;
export const MIN_TARGET = 15;
export const MAX_TARGET = 21;
export const MIN_TIMER_SECONDS = 15;
export const MAX_TIMER_SECONDS = 300;
/** How long the table waits before playing the turn of a player who left. */
export const LEFT_BEAT_MS = 3000;
/** Public log entries kept (older ones drop off). */
export const MAX_LOG = 80;

export type TimerMode = 'soft' | 'strict';

export interface Settings {
  /** The points that end the game (15–21). */
  target: number;
  /** Reserved cards face up for everyone (officially they are kept in hand). */
  showReserved: boolean;
  /** Seconds for each turn; null: no clock. */
  seconds: number | null;
  /** Soft: a reminder, and the host may act for the player. Strict: a safe move is made. */
  timerMode: TimerMode;
}

export interface Seat {
  name: string;
  /** Seated players play; the rest watch. */
  playing: boolean;
  /** Watching only for want of a seat: sat down at the next game if there's room. */
  waiting?: boolean;
}

export type Pieces = Record<Token, number>;

export interface Reserved {
  card: string;
  /** Taken face down from the top of a deck (nobody else ever saw it). */
  blind: boolean;
}

export interface PlayerState {
  tokens: Pieces;
  /** Bought cards, in the order bought. */
  cards: string[];
  /** Reserved cards: their hand. */
  reserved: Reserved[];
  nobles: string[];
}

/**
 * `action`: the current player picks one of the four actions. `return`: they hold more than 10
 * pieces and hand some back. `noble`: more than one noble would visit, and they pick one.
 */
export type Stage = 'action' | 'return' | 'noble';

/** Who made a move for whom: the strict timer, the host's Act for, or the table for a leaver. */
export type Auto = 'timer' | 'host' | 'left';

export interface Clock {
  key: string;
  since: number;
  reminded: boolean;
}

export interface Game {
  /** Turn order: the first player first. */
  order: PlayerId[];
  players: Record<PlayerId, PlayerState>;
  /** Names kept for players who have left. */
  names: Record<PlayerId, string>;
  /** Each level's deck, top first. Never sent: only its count. */
  decks: Record<Level, string[]>;
  /** Each level's four face-up cards; null for a space left empty by an empty deck. */
  market: Record<Level, (string | null)[]>;
  /** Nobles still on the table. */
  nobles: string[];
  bank: Pieces;
  current: PlayerId;
  stage: Stage;
  /** Turns finished so far. */
  turns: number;
  /** Nobles the current player may pick from (the `noble` stage). */
  nobleChoice: string[];
  /** Who reached the target first: the round is finished, then the game ends. */
  finalBy: PlayerId | null;
  /** Players who left the room mid-game, with when: the table plays their turns. */
  left: Record<PlayerId, number>;
  clock: Clock | null;
  winners: PlayerId[];
}

export type LogEntry = { id: number; turn: number; auto?: Auto } & (
  | { kind: 'start'; first: PlayerId }
  | { kind: 'take'; by: PlayerId; gems: Gem[] }
  | {
      kind: 'reserve';
      by: PlayerId;
      level: Level;
      /** The card: kept from viewers who may not see it (`view()` sends null). */
      card: string | null;
      blind: boolean;
      gold: boolean;
    }
  | {
      kind: 'buy';
      by: PlayerId;
      card: string;
      fromReserve: boolean;
      paid: Pieces;
    }
  | { kind: 'return'; by: PlayerId; tokens: Pieces }
  | { kind: 'noble'; by: PlayerId; noble: string }
  | { kind: 'pass'; by: PlayerId }
  | { kind: 'final'; by: PlayerId; points: number }
  | { kind: 'left'; player: PlayerId }
  | { kind: 'back'; player: PlayerId }
  | { kind: 'end'; winners: PlayerId[] }
);

export interface JewellerState {
  phase: 'lobby' | 'playing' | 'over';
  settings: Settings;
  /** Hidden randomness for deadlines and leavers, which come without an rng. Never sent. */
  seed: number;
  /** Insertion-ordered by join time. */
  seats: Record<PlayerId, Seat>;
  game: Game | null;
  log: LogEntry[];
  /** The last log id handed out; never reset. */
  seq: number;
  gamesPlayed: number;
}

const id = z.string().min(1).max(128);
const gem = z.enum(GEMS);
const count = z
  .number()
  .int()
  .min(0)
  .max(TOKEN_LIMIT + 3);
const timerSeconds = z.number().int().min(MIN_TIMER_SECONDS).max(MAX_TIMER_SECONDS).nullable();
const pieces = z.object({
  white: count.optional(),
  blue: count.optional(),
  green: count.optional(),
  red: count.optional(),
  black: count.optional(),
  gold: count.optional(),
});
const goldFor = z.object({
  white: count.optional(),
  blue: count.optional(),
  green: count.optional(),
  red: count.optional(),
  black: count.optional(),
});

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    target: z.number().int().min(MIN_TARGET).max(MAX_TARGET).optional(),
    showReserved: z.boolean().optional(),
    seconds: timerSeconds.optional(),
    timerMode: z.enum(['soft', 'strict']).optional(),
  }),
  z.object({ type: z.literal('sit'), playing: z.boolean() }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('take'), gems: z.array(gem).min(1).max(3) }),
  /** A face-up card (`card`), or the top of a deck (`level`). */
  z.object({
    type: z.literal('reserve'),
    card: id.optional(),
    level: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  }),
  /** `gold`: how many gold pieces stand in for each colour; left out, the app pays gems first. */
  z.object({ type: z.literal('buy'), card: id, gold: goldFor.optional() }),
  z.object({ type: z.literal('return'), tokens: pieces }),
  z.object({ type: z.literal('noble'), noble: id }),
  z.object({ type: z.literal('pass') }),
  z.object({ type: z.literal('act-for'), player: id }),
  z.object({ type: z.literal('play-again') }),
  z.object({ type: z.literal('back-to-lobby') }),
]);

export type JewellerAction = z.infer<typeof actionSchema>;

// ---- What each player may see ----

export interface SeatView {
  id: PlayerId;
  name: string;
  playing: boolean;
  waiting?: boolean;
}

/** A reserved card as others see it: its level, and its face only when shown. */
export interface ReservedView {
  level: Level;
  /** The card, for its owner, when the host shows reserved cards, or at the end. */
  card: string | null;
  blind: boolean;
}

export interface PlayerView {
  id: PlayerId;
  name: string;
  tokens: Pieces;
  cards: string[];
  reserved: ReservedView[];
  nobles: string[];
  points: number;
  bonuses: Record<Gem, number>;
  /** Left the room: the table plays their turns. */
  left: boolean;
}

export interface ClockView {
  who: PlayerId;
  since: number;
  deadline: number | null;
  reminded: boolean;
}

export interface GameView {
  order: PlayerId[];
  players: PlayerView[];
  /** Cards left in each level's deck. */
  decks: Record<Level, number>;
  market: Record<Level, (string | null)[]>;
  nobles: string[];
  bank: Pieces;
  current: PlayerId;
  stage: Stage;
  turns: number;
  /** The round number (every player has a turn each round). */
  round: number;
  nobleChoice: string[];
  finalBy: PlayerId | null;
  clock: ClockView | null;
  winners: PlayerId[];
}

export interface JewellerView {
  phase: JewellerState['phase'];
  settings: Settings;
  seats: SeatView[];
  me: SeatView | null;
  game: GameView | null;
  log: LogEntry[];
}
