import type { PlayerId } from '@vt/game-sdk';
import { z } from 'zod';

export const BOARD_SIZE = 25;
export const STARTING_TEAM_AGENTS = 9;
export const OTHER_TEAM_AGENTS = 8;
export const ASSASSINS = 1;
export const MIN_TIMER_SECONDS = 10;
export const MAX_TIMER_SECONDS = 600;
export const MAX_CLUE_LENGTH = 32;

export type Team = 'red' | 'blue';
export type Role = 'spymaster' | 'operative';
export type CardKind = Team | 'bystander' | 'assassin';
/** How many cards a clue points at (1–9). Operatives get one extra guess on top. */
export type ClueCount = number;

export interface Settings {
  wordListIds: string[];
  /** Seconds the spymaster has to give a clue; null disables the timer. */
  clueSeconds: number | null;
  /** Seconds the operatives have to guess; null disables the timer. */
  guessSeconds: number | null;
  /**
   * What happens when a timer runs out: `soft` only shows that time is up (the default);
   * `strict` passes the turn automatically. Optional because older saved rooms lack it.
   */
  timerMode?: TimerMode;
}

export type TimerMode = 'soft' | 'strict';

export interface Seat {
  name: string;
  /** null = spectator. */
  team: Team | null;
  role: Role;
}

export interface Card {
  word: string;
  kind: CardKind;
  revealed: boolean;
}

export interface Clue {
  word: string;
  count: ClueCount;
}

export interface Turn {
  team: Team;
  stage: 'clue' | 'guess';
  clue: Clue | null;
  guessesMade: number;
  /** Epoch ms when the current stage times out, or null if untimed. */
  deadline: number | null;
}

export type EndTurnReason = 'passed' | 'wrong-guess' | 'out-of-guesses' | 'timeout';
export type WinReason = 'all-agents' | 'assassin';

export type LogEntry =
  | { type: 'clue'; team: Team; by: PlayerId; word: string; count: ClueCount }
  | { type: 'guess'; team: Team; by: PlayerId; word: string; kind: CardKind }
  | { type: 'end-turn'; team: Team; reason: EndTurnReason }
  | { type: 'game-over'; winner: Team; reason: WinReason };

export interface CodenamesState {
  phase: 'lobby' | 'playing' | 'over';
  settings: Settings;
  /** Insertion-ordered by join time. */
  seats: Record<PlayerId, Seat>;
  /** Team that starts the next (or current) game. */
  startingTeam: Team;
  board: Card[];
  turn: Turn | null;
  /** Card index -> players on the guessing team who marked it. Cleared each turn. */
  suggestions: Record<number, PlayerId[]>;
  log: LogEntry[];
  winner: Team | null;
  winReason: WinReason | null;
  gamesPlayed: number;
}

const timerSeconds = z.number().int().min(MIN_TIMER_SECONDS).max(MAX_TIMER_SECONDS).nullable();
const team = z.enum(['red', 'blue']);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    wordListIds: z.array(z.string().min(1)).min(1).max(20).optional(),
    clueSeconds: timerSeconds.optional(),
    guessSeconds: timerSeconds.optional(),
    timerMode: z.enum(['soft', 'strict']).optional(),
  }),
  z.object({
    type: z.literal('join-team'),
    team: team.nullable(),
    role: z.enum(['spymaster', 'operative']),
  }),
  z.object({ type: z.literal('randomize-teams') }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('back-to-lobby') }),
  z.object({
    type: z.literal('give-clue'),
    word: z.string().trim().min(1).max(MAX_CLUE_LENGTH),
    count: z.number().int().min(1).max(9),
  }),
  z.object({
    type: z.literal('toggle-suggestion'),
    card: z
      .number()
      .int()
      .min(0)
      .max(BOARD_SIZE - 1),
  }),
  z.object({
    type: z.literal('guess'),
    card: z
      .number()
      .int()
      .min(0)
      .max(BOARD_SIZE - 1),
  }),
  z.object({ type: z.literal('end-turn') }),
]);

export type CodenamesAction = z.infer<typeof actionSchema>;

export interface ViewCard {
  word: string;
  /** Hidden (null) for unrevealed cards unless the viewer is a spymaster or the game is over. */
  kind: CardKind | null;
  revealed: boolean;
  /** Teammates' marks; only shown to members of the guessing team. */
  suggestedBy: PlayerId[];
}

export interface CodenamesView {
  phase: CodenamesState['phase'];
  settings: Settings;
  seats: Array<Seat & { id: PlayerId }>;
  me: (Seat & { id: PlayerId }) | null;
  startingTeam: Team;
  board: ViewCard[];
  turn: Turn | null;
  remaining: Record<Team, number>;
  log: LogEntry[];
  winner: Team | null;
  winReason: WinReason | null;
}
