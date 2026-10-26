import type { PlayerId } from '@vt/game-sdk';
import { z } from 'zod';
import type { HandCard } from './rules.ts';

export type { HandCard } from './rules.ts';

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 5;
/** Chips each player gets per round in a 2-player game (they pay for recruiting). */
export const TWO_PLAYER_CHIPS = 3;
export const MIN_TIMER_SECONDS = 15;
export const MAX_TIMER_SECONDS = 300;
export const DEFAULT_SECONDS = 60;
/** How long the table waits before playing for a player who left. */
export const LEFT_BEAT_MS = 3000;
/** Public log entries kept (older ones drop off). */
export const MAX_LOG = 80;
/** The most cards a hand can reach (a full deck), for the action schema. */
export const MAX_HAND = 45;

export type TimerMode = 'soft' | 'strict';

export interface Settings {
  /** Rounds: one each (the usual) or two each. */
  twoEach: boolean;
  /** Seconds for each turn and for the flip; null: no clock. */
  seconds: number | null;
  /** Soft: a reminder, and the host may act for the player. Strict: a safe move is made. */
  timerMode: TimerMode;
}

export interface Seat {
  name: string;
  playing: boolean;
  /** Watching only for want of a seat: sat down at the next game if there's room. */
  waiting?: boolean;
}

export interface PlayerState {
  /** The hand in its fixed order. */
  hand: HandCard[];
  /** Cards captured this round (1 point each). */
  captured: number;
  /** Chips this round: points earned (3–5 players), or chips left to pay with (2). */
  chips: number;
  /** The Recruit & Show marker is still unused this round (3–5 players). */
  marker: boolean;
  /** The flip choice (`flip` stage): null until made. Never sent to anyone else. */
  flip: boolean | null;
  /** Ready for the next round (`scores` stage). */
  ready: boolean;
  /** Cards recruited this round (ids), for the stats: a Show using one is worth a note. */
  recruited: string[];
}

/**
 * `flip`: everyone looks at their new hand and keeps it or turns it round, in secret. `play`:
 * turns. `scores`: the round's scores, until everyone is ready for the next.
 */
export type Stage = 'flip' | 'play' | 'scores';

/** Who made a move for whom: the strict timer, the host's Act for, or the table for a leaver. */
export type Auto = 'timer' | 'host' | 'left';

/** How a round ended: a hand emptied, a Show went unbeaten all round, or nobody could answer. */
export type EndHow = 'out' | 'unbeaten' | 'stuck';

export interface Table {
  cards: HandCard[];
  /** Who showed them (stays when they are all recruited away, for the round-end check). */
  owner: PlayerId;
}

export interface ScoreRow {
  id: PlayerId;
  captured: number;
  chips: number;
  hand: number;
  /** The hand counts against them (not for the round-ender of an unbeaten Show). */
  penalty: boolean;
  points: number;
}

export interface RoundResult {
  round: number;
  ender: PlayerId;
  how: EndHow;
  /** The Show nobody beat (`unbeaten`/`stuck`) or the one that emptied a hand (`out`), as played. */
  last: HandCard[];
  rows: ScoreRow[];
}

export interface Clock {
  key: string;
  since: number;
  reminded: boolean;
}

export interface Game {
  /** Seat order, clockwise. */
  order: PlayerId[];
  players: Record<PlayerId, PlayerState>;
  names: Record<PlayerId, string>;
  round: number;
  rounds: number;
  /** Who started this round. */
  starter: PlayerId;
  stage: Stage;
  current: PlayerId;
  /** Moves made this round (for the clock). */
  moves: number;
  table: Table | null;
  /** 2 players: the cards set aside for the next round. Never sent. */
  reserve: string[];
  results: RoundResult[];
  /** Players who left the room mid-game, with when: the table plays for them. */
  left: Record<PlayerId, number>;
  clock: Clock | null;
  /** The hands as they were when the last round ended (sent at the end only). */
  finalHands: Record<PlayerId, HandCard[]> | null;
  winners: PlayerId[];
}

export type LogEntry = { id: number; round: number; auto?: Auto } & (
  | { kind: 'round'; starter: PlayerId; startCard: boolean }
  | {
      kind: 'show';
      by: PlayerId;
      cards: HandCard[];
      /** The set it beat, now captured (empty on an empty table). */
      beat: HandCard[];
      /** Part of Recruit & Show. */
      double?: boolean;
    }
  | {
      kind: 'recruit';
      by: PlayerId;
      /** The card as it lay on the table (where it went and which way up stay private). */
      card: HandCard;
      end: 'left' | 'right';
      owner: PlayerId;
      /** 2 players: a chip paid into the middle (else the owner gained one). */
      paid?: boolean;
      double?: boolean;
    }
  | { kind: 'end'; ender: PlayerId; how: EndHow; points: Record<PlayerId, number> }
  | { kind: 'left'; player: PlayerId }
  | { kind: 'back'; player: PlayerId }
  | { kind: 'over'; winners: PlayerId[] }
);

export interface EncoreState {
  phase: 'lobby' | 'playing' | 'over';
  settings: Settings;
  /** Hidden randomness for deadlines and leavers, which come without an rng. Never sent. */
  seed: number;
  seats: Record<PlayerId, Seat>;
  game: Game | null;
  log: LogEntry[];
  seq: number;
  gamesPlayed: number;
}

const index = z.number().int().min(0).max(MAX_HAND);
const end = z.enum(['left', 'right']);
const timerSeconds = z.number().int().min(MIN_TIMER_SECONDS).max(MAX_TIMER_SECONDS).nullable();

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    twoEach: z.boolean().optional(),
    seconds: timerSeconds.optional(),
    timerMode: z.enum(['soft', 'strict']).optional(),
  }),
  z.object({ type: z.literal('sit'), playing: z.boolean() }),
  z.object({ type: z.literal('start') }),
  /** The round-start choice: turn the whole hand round, or keep it. */
  z.object({ type: z.literal('flip'), flip: z.boolean() }),
  /** Show the cards from `from` to `to` (inclusive) in the hand. */
  z.object({ type: z.literal('show'), from: index, to: index }),
  /** Take an end card of the table, turn it if `flip`, and put it in at gap `at`. */
  z.object({ type: z.literal('recruit'), end, flip: z.boolean(), at: index }),
  /** Recruit, then Show (`from`/`to` in the hand with the recruited card in it): all or nothing. */
  z.object({
    type: z.literal('recruit-show'),
    end,
    flip: z.boolean(),
    at: index,
    from: index,
    to: index,
  }),
  z.object({ type: z.literal('ready') }),
  /** The host deals the next round without waiting for everyone to be ready. */
  z.object({ type: z.literal('next-round') }),
  z.object({ type: z.literal('act-for'), player: z.string().min(1).max(128) }),
  z.object({ type: z.literal('play-again') }),
  z.object({ type: z.literal('back-to-lobby') }),
]);

export type EncoreAction = z.infer<typeof actionSchema>;

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
  /** Cards in hand: public, as at the table. */
  hand: number;
  captured: number;
  chips: number;
  marker: boolean;
  /** Has made the flip choice (`flip` stage) or is ready (`scores` stage). */
  done: boolean;
  /** Total of the finished rounds. */
  total: number;
  left: boolean;
}

export interface ClockView {
  /** Who the clock times (the current player; null in the flip stage, which times everyone). */
  who: PlayerId | null;
  since: number;
  deadline: number | null;
  reminded: boolean;
}

export interface GameView {
  order: PlayerId[];
  players: PlayerView[];
  /** The viewer's own hand (watchers: null). */
  hand: HandCard[] | null;
  /** The viewer's own flip choice while it is secret. */
  myFlip: boolean | null;
  twoPlayer: boolean;
  round: number;
  rounds: number;
  starter: PlayerId;
  stage: Stage;
  current: PlayerId;
  table: Table | null;
  /** 2 players: cards waiting for the next round. */
  reserve: number;
  results: RoundResult[];
  clock: ClockView | null;
  /** Everyone's last hand, at the end of the game. */
  finalHands: Record<PlayerId, HandCard[]> | null;
  winners: PlayerId[];
}

export interface EncoreView {
  phase: EncoreState['phase'];
  settings: Settings;
  seats: SeatView[];
  me: SeatView | null;
  game: GameView | null;
  log: LogEntry[];
}
