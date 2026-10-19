import type { PlayerId } from '@vt/game-sdk';
import { z } from 'zod';

/**
 * The discs. These plain words are the ids in code; what the table calls them (and their art)
 * comes from the private manifest, with "Rose" and "Thorn" as the placeholders.
 */
export const DISCS = ['rose', 'thorn', 'chance'] as const;
/** `chance`: the Last Chance disc, a known rose lent for one round (a host option). */
export type Disc = (typeof DISCS)[number];

/** Every player starts with these four discs. */
export const START_DISCS: readonly Disc[] = ['rose', 'rose', 'rose', 'thorn'];

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 6;
/** Points that win the game: a won challenge turns your mat over, a second one wins. */
export const POINTS_TO_WIN = 2;
export const MIN_TIMER_SECONDS = 10;
export const MAX_TIMER_SECONDS = 300;
/** How long a round's result stays on the table before the next round starts. */
export const RESULT_MS = 5000;
/** How long a Challenger knocked out by their own thorn has to name who starts. */
export const STARTER_MS = 30_000;
/** Public log entries kept (older ones drop off). */
export const MAX_LOG = 80;

export type TimerMode = 'soft' | 'strict';

export interface Settings {
  /** Seconds for each decision; null: no clock. */
  seconds: number | null;
  /** Soft: a reminder, and the host may act for the player. Strict: a safe move is made. */
  timerMode: TimerMode;
  /** The Last Chance disc (on by default; missing in rooms made before it existed: on). */
  lastChance?: boolean;
}

export interface Seat {
  name: string;
  /** Seated players play; the rest watch. */
  playing: boolean;
  /** Watching only for want of a seat: sat down at the next game if there's room. */
  waiting?: boolean;
}

export interface PlayerState {
  /** Every disc they still own. A lost disc leaves this at once; hand and stack follow next round. */
  discs: Disc[];
  /** Discs in hand this round. */
  hand: Disc[];
  /** The stack on the mat, bottom first: the last is the top. */
  stack: Disc[];
  /** Discs lost for good. Only their owner knows which. */
  lost: Disc[];
  points: number;
  out: boolean;
}

/**
 * `place`: everyone puts their first disc down at once. `turns`: in turn, add a disc or bid.
 * `bid`: in turn, raise or pass. `flip`: the challenger turns discs over. `lose`: a challenger who
 * hit their own thorn picks the disc they lose. `starter`: a challenger knocked out by their own
 * thorn names who starts next. `result`: the round's result shows for a moment.
 */
export type Stage = 'place' | 'turns' | 'bid' | 'flip' | 'lose' | 'starter' | 'result';

export interface Flip {
  owner: PlayerId;
  disc: Disc;
}

export interface Bid {
  by: PlayerId;
  amount: number;
}

export type RoundOutcome = 'won' | 'failed' | 'void';

export interface RoundResult {
  outcome: RoundOutcome;
  challenger: PlayerId | null;
  bid: number;
  /** Whose thorn stopped the challenge. */
  thornBy: PlayerId | null;
  /** Whether the challenger lost a disc (always after a failed challenge). */
  lostDisc: boolean;
  /** Whether that knocked them out. */
  eliminated: boolean;
  /** Who starts the next round (null while the challenger is still choosing). */
  next: PlayerId | null;
  /** When the next round starts. */
  until: number;
}

export interface Round {
  number: number;
  starter: PlayerId;
  stage: Stage;
  /** Whose turn it is (turns and bid), or the challenger (flip, lose, starter). */
  current: PlayerId | null;
  /** Every bid this round, in order: the last is the one standing. */
  bids: Bid[];
  passed: PlayerId[];
  challenger: PlayerId | null;
  /** Discs turned over, in order. */
  flips: Flip[];
  result: RoundResult | null;
  /** Players who chose to show their stack after a failed challenge. */
  shown: PlayerId[];
  /** Moves made this round, so the decision clock restarts on every one. */
  moves: number;
}

/** Who made a move for whom: the strict timer, the host's Act for, or the table for a leaver. */
export type Auto = 'timer' | 'host' | 'left';

export interface Clock {
  key: string;
  since: number;
  reminded: boolean;
}

export interface Game {
  /** Seating order: everyone who started. */
  order: PlayerId[];
  players: Record<PlayerId, PlayerState>;
  /** Names kept for players who have left. */
  names: Record<PlayerId, string>;
  /** Players the host removed after they left the room (out for good). */
  left: PlayerId[];
  /**
   * Players who left the room and haven't been removed: skipped when placing and bidding (a
   * skipped bidder has passed), their discs still on the mat. They carry on if they come back.
   */
  away: PlayerId[];
  round: Round;
  clock: Clock | null;
  /** Who holds the Last Chance disc, and for which round. */
  chance: { holder: PlayerId; round: number } | null;
  /** Everyone who has had it this game (once each). */
  hadChance: PlayerId[];
  winners: PlayerId[];
  /** How the game was won: two points, or the last one standing. */
  how: 'points' | 'last' | null;
}

export type LogEntry = { id: number; round: number; auto?: Auto } & (
  | { kind: 'round'; starter: PlayerId }
  | { kind: 'placed'; by: PlayerId }
  | { kind: 'bid'; by: PlayerId; amount: number }
  | { kind: 'pass'; by: PlayerId }
  | { kind: 'challenge'; by: PlayerId; amount: number }
  | { kind: 'flip'; by: PlayerId; owner: PlayerId; disc: Disc }
  | { kind: 'won'; by: PlayerId; amount: number; points: number }
  | { kind: 'failed'; by: PlayerId; thornBy: PlayerId }
  | { kind: 'lost'; player: PlayerId; left: number; chose: boolean; chance?: boolean }
  | { kind: 'out'; player: PlayerId; cause: 'thorn' | 'lone' | 'left' }
  | { kind: 'chance'; player: PlayerId }
  | { kind: 'shown'; player: PlayerId }
  | { kind: 'starter'; by: PlayerId; starter: PlayerId }
  | { kind: 'void'; player: PlayerId }
  | { kind: 'away'; player: PlayerId }
  | { kind: 'back'; player: PlayerId }
  | { kind: 'end'; winners: PlayerId[]; how: 'points' | 'last' }
);

export interface ThornsState {
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

const disc = z.enum(DISCS);
const id = z.string().min(1).max(128);
const timerSeconds = z.number().int().min(MIN_TIMER_SECONDS).max(MAX_TIMER_SECONDS).nullable();

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    seconds: timerSeconds.optional(),
    timerMode: z.enum(['soft', 'strict']).optional(),
    lastChance: z.boolean().optional(),
  }),
  z.object({ type: z.literal('sit'), playing: z.boolean() }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('place'), disc }),
  z.object({ type: z.literal('bid'), amount: z.number().int().min(1).max(24) }),
  z.object({ type: z.literal('pass') }),
  z.object({ type: z.literal('flip'), owner: id }),
  z.object({ type: z.literal('lose'), disc }),
  z.object({ type: z.literal('starter'), player: id }),
  z.object({ type: z.literal('show') }),
  z.object({ type: z.literal('act-for'), player: id }),
  z.object({ type: z.literal('remove'), player: id }),
  z.object({ type: z.literal('play-again') }),
  z.object({ type: z.literal('back-to-lobby') }),
]);

export type ThornsAction = z.infer<typeof actionSchema>;

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
  /** Discs they still own (in hand and on the mat). */
  discs: number;
  hand: number;
  /** Discs on the mat, face down or turned over. */
  stack: number;
  /** Discs of this stack turned over this round, top first. */
  flipped: Disc[];
  /** Where the Last Chance disc sits in the stack (0 is the bottom), when it is shown. */
  chanceAt: number | null;
  /** The whole stack, top first, when its owner showed it after a failed challenge. */
  shown: Disc[] | null;
  points: number;
  out: boolean;
  /** Removed by the host after leaving. */
  left: boolean;
  /** Left the room and not (yet) removed: skipped, discs still on the mat. */
  away: boolean;
}

export interface RoundView {
  number: number;
  starter: PlayerId;
  stage: Stage;
  current: PlayerId | null;
  bids: Bid[];
  passed: PlayerId[];
  challenger: PlayerId | null;
  flips: Flip[];
  /** Discs on all the mats: the most anyone may bid. */
  total: number;
  /** In the first-disc stage: who has put theirs down. */
  placed: PlayerId[];
  result: RoundResult | null;
}

export interface ClockView {
  /** Who the table is waiting on. */
  who: PlayerId[];
  since: number;
  deadline: number | null;
  reminded: boolean;
}

export interface GameView {
  order: PlayerId[];
  players: PlayerView[];
  round: RoundView;
  clock: ClockView | null;
  chance: Game['chance'];
  winners: PlayerId[];
  how: Game['how'];
}

/** Only the viewer's own discs. */
export interface MineView {
  /** Every disc you still own. */
  discs: Disc[];
  hand: Disc[];
  /** Bottom first. */
  stack: Disc[];
  lost: Disc[];
}

/** Everything, once the game is over. */
export interface RevealView {
  id: PlayerId;
  discs: Disc[];
  hand: Disc[];
  stack: Disc[];
  lost: Disc[];
}

export interface ThornsView {
  phase: ThornsState['phase'];
  settings: Settings;
  seats: SeatView[];
  me: SeatView | null;
  game: GameView | null;
  mine: MineView | null;
  reveal: RevealView[] | null;
  log: LogEntry[];
}
