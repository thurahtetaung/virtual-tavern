import type { PlayerId } from '@vt/game-sdk';
import { z } from 'zod';
import { type Card, MULTI_MODES, type MultiMode, type Rank, type Suit } from './cards.ts';
import { CLUE_COLOURS, type ClueColour, type Knowledge } from './clues.ts';

export type { Card, MultiMode, Rank, Suit } from './cards.ts';
export type { ClueColour, Knowledge } from './clues.ts';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;
export const CLUE_TOKENS = 8;
/** The third fuse ends the show. */
export const FUSES = 3;
export const MIN_TIMER_SECONDS = 15;
export const MAX_TIMER_SECONDS = 300;
export const DEFAULT_SECONDS = 60;
/** How long the table waits before moving for a player who left. */
export const LEFT_BEAT_MS = 3000;
/** Public log entries kept (older ones drop off). */
export const MAX_LOG = 120;
/** Turns kept for the end replay (a game never gets near it). */
export const MAX_REPLAY = 400;
/** Reactions kept. */
export const MAX_REACTIONS = 12;
/** The fixed reactions players may send after an action: there is no chat during a game. */
export const REACTIONS = ['👏', '🎆', '😬', '🙈', '🤔', '😂'] as const;
export type Reaction = (typeof REACTIONS)[number];

export type TimerMode = 'soft' | 'strict';

/**
 * How much the app remembers for you: `marks` (each card shows the clues that touched it and what
 * it is known not to be), `full` (what each card can still be, counting every card you can see)
 * or `memory` (no marks: you remember, as at the table).
 */
export const MEMORY_MODES = ['marks', 'full', 'memory'] as const;
export type MemoryMode = (typeof MEMORY_MODES)[number];

export interface Settings {
  multi: MultiMode;
  /** The black powder suit, played 5 down to 1. */
  black: boolean;
  /** The expert ending: a perfect show or nothing. */
  expert: boolean;
  /** Clues that touch no card ("you have no red") are allowed. */
  zeroClues: boolean;
  memory: MemoryMode;
  /** Seconds for each turn; null: no clock. */
  seconds: number | null;
  /** Soft: a reminder, and the host may act for the player. Strict: the safe move is made. */
  timerMode: TimerMode;
}

export interface Seat {
  name: string;
  playing: boolean;
  /** Watching only for want of a seat: sat down at the next game if there's room. */
  waiting?: boolean;
}

/** Who made a move for whom: the strict timer, the host's Act for, or the table for a leaver. */
export type Auto = 'timer' | 'host' | 'left';

/**
 * How the show ended: `perfect` (every firework finished), `deck` (the last round was played),
 * `fuses` (the third fuse), `lost-card` (expert ending: the last copy of a needed card is gone),
 * `no-cards` (expert ending: a player starts a turn with no cards) or `ended` (the host ended it).
 */
export type EndHow = 'perfect' | 'deck' | 'fuses' | 'lost-card' | 'no-cards' | 'ended';

export interface Result {
  how: EndHow;
  /** The score that counts: 0 for a lost show, the full score for a perfect one. */
  score: number;
  /** What the fireworks reached, however it ended. */
  reached: number;
  max: number;
  /** A perfect show: the only win. */
  win: boolean;
  /** The lost card (`lost-card`), or the player with no cards (`no-cards`). */
  card?: Card;
  player?: PlayerId;
}

export interface Clock {
  key: string;
  since: number;
  reminded: boolean;
}

/** The table after one turn, for the end replay. */
export interface Snapshot {
  hands: Record<PlayerId, string[]>;
  clues: number;
  fuses: number;
  fireworks: Partial<Record<Suit, number>>;
  deck: number;
  discards: number;
}

export interface TurnRecord {
  turn: number;
  by: PlayerId;
  kind: 'clue' | 'play' | 'discard';
  /** The card played or discarded. */
  card?: string;
  ok?: boolean;
  to?: PlayerId;
  colour?: ClueColour;
  rank?: Rank;
  touched?: string[];
  auto?: Auto;
  after: Snapshot;
}

export interface Game {
  /** Seat order: everyone who started. */
  order: PlayerId[];
  names: Record<PlayerId, string>;
  /** Every card of the game by id. Ids are dealing positions, so they say nothing of the card. */
  cards: Record<string, Card>;
  /** Draw pile, top first. Never sent. */
  deck: string[];
  /** Each hand, left to right: new cards arrive on the left. */
  hands: Record<PlayerId, string[]>;
  /** What the clues said about each card in a hand. */
  know: Record<string, Knowledge>;
  /** Who last clued each card, for the stats. Never sent. */
  cluedBy: Record<string, { by: PlayerId; turn: number }>;
  /** Oldest first. */
  discards: string[];
  /** Each firework's height (cards on it), for the suits in play. */
  fireworks: Partial<Record<Suit, number>>;
  clues: number;
  fuses: number;
  current: PlayerId;
  /** Turns taken. */
  turn: number;
  /** Last round: turns left once the deck ran out (everyone one more, the drawer last). */
  finalTurns: number | null;
  /** Players who left the room mid-game, with when: the table moves for them. */
  left: Record<PlayerId, number>;
  clock: Clock | null;
  result: Result | null;
  /** The deal, then the table after each turn (sent at the end only). */
  start: Snapshot;
  turns: TurnRecord[];
}

export type LogEntry = { id: number; turn: number; auto?: Auto } & (
  | { kind: 'start'; first: PlayerId }
  | {
      kind: 'clue';
      by: PlayerId;
      to: PlayerId;
      colour?: ClueColour;
      rank?: Rank;
      /** The cards it touched, left to right. */
      touched: string[];
    }
  | {
      kind: 'play';
      by: PlayerId;
      card: string;
      suit: Suit;
      rank: Rank;
      ok: boolean;
      /** Finished its firework. */
      completed?: boolean;
      /** A finished firework gave a clue back. */
      bonus?: boolean;
    }
  | { kind: 'discard'; by: PlayerId; card: string; suit: Suit; rank: Rank }
  | { kind: 'last-round'; by: PlayerId }
  | { kind: 'left'; player: PlayerId }
  | { kind: 'back'; player: PlayerId }
  | { kind: 'end'; how: EndHow; score: number; reached: number }
);

export interface ReactionEntry {
  by: PlayerId;
  emoji: Reaction;
  /** The log entry it answers. */
  to: number;
  at: number;
}

export interface SkyfireState {
  phase: 'lobby' | 'playing' | 'over';
  settings: Settings;
  /** Hidden randomness for deadlines and leavers, which come without an rng. Never sent. */
  seed: number;
  seats: Record<PlayerId, Seat>;
  game: Game | null;
  log: LogEntry[];
  /** The last log id handed out; never reset. */
  seq: number;
  reactions: ReactionEntry[];
  gamesPlayed: number;
  /** Who started the last game: the next seat starts the next one. */
  lastStarter: PlayerId | null;
}

const id = z.string().min(1).max(128);
const timerSeconds = z.number().int().min(MIN_TIMER_SECONDS).max(MAX_TIMER_SECONDS).nullable();

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    multi: z.enum(MULTI_MODES).optional(),
    black: z.boolean().optional(),
    expert: z.boolean().optional(),
    zeroClues: z.boolean().optional(),
    memory: z.enum(MEMORY_MODES).optional(),
    seconds: timerSeconds.optional(),
    timerMode: z.enum(['soft', 'strict']).optional(),
  }),
  z.object({ type: z.literal('sit'), playing: z.boolean() }),
  z.object({ type: z.literal('start') }),
  /** One colour or one number, to one other player. */
  z.object({
    type: z.literal('clue'),
    to: id,
    colour: z.enum(CLUE_COLOURS).optional(),
    rank: z.number().int().min(1).max(5).optional(),
  }),
  z.object({ type: z.literal('play'), card: id }),
  z.object({ type: z.literal('discard'), card: id }),
  /** Your own hand in a new order (the same cards), as everyone sees it. */
  z.object({ type: z.literal('reorder'), order: z.array(id).max(6) }),
  z.object({ type: z.literal('react'), emoji: z.enum(REACTIONS) }),
  z.object({ type: z.literal('act-for'), player: id }),
  /** The host ends the show as it stands. */
  z.object({ type: z.literal('end-game') }),
  z.object({ type: z.literal('play-again') }),
  z.object({ type: z.literal('back-to-lobby') }),
]);

export type SkyfireAction = z.infer<typeof actionSchema>;

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
  /** Left the room mid-game: the table moves for them. */
  left: boolean;
}

/** One card in a hand: its face (never for your own, until the end) and what clues said. */
export interface Slot {
  id: string;
  card: Card | null;
  /** Null when the room plays from memory. */
  know: Knowledge | null;
}

export interface ClockView {
  who: PlayerId;
  since: number;
  deadline: number | null;
  reminded: boolean;
}

export interface ReplayView {
  cards: Record<string, Card>;
  start: Snapshot;
  turns: TurnRecord[];
}

export interface GameView {
  order: PlayerId[];
  players: PlayerView[];
  hands: Record<PlayerId, Slot[]>;
  suits: Suit[];
  fireworks: Partial<Record<Suit, number>>;
  /** Oldest first. */
  discards: { id: string; card: Card }[];
  clues: number;
  fuses: number;
  deck: number;
  current: PlayerId;
  turn: number;
  /** In the last round: who still has a turn, in order. */
  lastTurns: PlayerId[] | null;
  max: number;
  clock: ClockView | null;
  result: Result | null;
  /** Everything, for the end replay. */
  replay: ReplayView | null;
}

export interface SkyfireView {
  phase: SkyfireState['phase'];
  settings: Settings;
  seats: SeatView[];
  me: SeatView | null;
  game: GameView | null;
  log: LogEntry[];
  reactions: ReactionEntry[];
}
