import type { PlayerId } from '@vt/game-sdk';
import { z } from 'zod';

export const KEYWORD_COUNT = 4;
export const CODE_LENGTH = 3;
export const MAX_ROUNDS = 8;
/** Interceptions needed to win, and miscommunications that lose. */
export const TOKENS_TO_END = 2;
/** Interception is only possible once there is some clue history to work from. */
export const FIRST_INTERCEPT_ROUND = 2;
export const MIN_TEAM_SIZE = 2;
export const MAX_CLUE_LENGTH = 40;
export const MAX_CHAT_LENGTH = 300;
export const MAX_CHAT_MESSAGES = 200;
export const MAX_NOTE_LENGTH = 40;
export const MAX_GENERAL_NOTE_LENGTH = 1000;
export const MIN_TIMER_SECONDS = 10;
export const MAX_TIMER_SECONDS = 600;

export type Team = 'red' | 'blue';
export type Flow = 'simultaneous' | 'alternating';
export type TimerMode = 'soft' | 'strict';
/** Three distinct digits from 1–4, e.g. [3, 1, 4]. */
export type Code = number[];

export interface Settings {
  wordListIds: string[];
  flow: Flow;
  clueSeconds: number | null;
  guessSeconds: number | null;
  timerMode?: TimerMode;
}

export interface Seat {
  name: string;
  /** null = spectator. */
  team: Team | null;
}

/** One player's guess at a code: a draft (digits 0 = empty) that only counts once locked in. */
export interface Vote {
  draft: number[];
  locked: boolean;
}

export interface ChatMessage {
  by: PlayerId;
  text: string;
  at: number;
}

export interface TeamNotes {
  /** The team's guesses at the opponent's keywords 1–4. */
  guesses: string[];
  general: string;
  editedBy: PlayerId | null;
}

/** A finished transmission, filed in the sending team's public clue history. */
export interface HistoryEntry {
  round: number;
  code: Code;
  /** null when the Encryptor ran out of time (strict timers). */
  clues: string[] | null;
  /** What the sending team agreed on, or null if it never agreed. */
  decodeGuess: Code | null;
  /** What the opposing team agreed on; null if it didn't agree or couldn't intercept yet. */
  interceptGuess: Code | null;
  decoded: boolean;
  intercepted: boolean;
}

export interface TeamState {
  keywords: string[];
  intercepts: number;
  misses: number;
  history: HistoryEntry[];
  chat: ChatMessage[];
  notes: TeamNotes;
  /** Rounds this team has played, used to rotate the Encryptor. */
  encryptorTurn: number;
}

export interface Transmission {
  team: Team;
  encryptor: PlayerId;
  code: Code;
  clues: string[] | null;
  /** Clue timer ran out before the clues were sent (strict timers only). */
  expired: boolean;
  decode: Record<PlayerId, Vote>;
  intercept: Record<PlayerId, Vote>;
  /** Agreed codes once each side has resolved; undefined while still voting. */
  decodeResult?: Code | null;
  interceptResult?: Code | null;
  revealed: boolean;
}

export type Stage = 'clue' | 'guess' | 'reveal';

export interface EnigmaState {
  phase: 'lobby' | 'playing' | 'over';
  settings: Settings;
  seats: Record<PlayerId, Seat>;
  /** Transmits first in round 1; alternates each round and each rematch. */
  startingTeam: Team;
  round: number;
  teams: Record<Team, TeamState>;
  /** This round's two transmissions, in play order. */
  transmissions: Transmission[];
  /** Indices of `transmissions` currently in play: both (simultaneous) or one (alternating). */
  active: number[];
  stage: Stage;
  /** Epoch ms when the current stage times out, or null if untimed. */
  deadline: number | null;
  winner: Team | 'draw' | null;
  gamesPlayed: number;
}

const timerSeconds = z.number().int().min(MIN_TIMER_SECONDS).max(MAX_TIMER_SECONDS).nullable();
const team = z.enum(['red', 'blue']);
const digit = z.number().int().min(0).max(KEYWORD_COUNT);

export const actionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-settings'),
    wordListIds: z.array(z.string().min(1)).min(1).max(20).optional(),
    flow: z.enum(['simultaneous', 'alternating']).optional(),
    clueSeconds: timerSeconds.optional(),
    guessSeconds: timerSeconds.optional(),
    timerMode: z.enum(['soft', 'strict']).optional(),
  }),
  z.object({ type: z.literal('join-team'), team: team.nullable() }),
  z.object({ type: z.literal('randomize-teams') }),
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('back-to-lobby') }),
  z.object({
    type: z.literal('give-clues'),
    clues: z.array(z.string().trim().min(1).max(MAX_CLUE_LENGTH)).length(CODE_LENGTH),
  }),
  /** `team` is the sending team of the transmission being guessed. */
  z.object({ type: z.literal('set-guess'), team, draft: z.array(digit).length(CODE_LENGTH) }),
  z.object({ type: z.literal('lock-guess'), team }),
  z.object({ type: z.literal('unlock-guess'), team }),
  z.object({ type: z.literal('chat'), text: z.string().trim().min(1).max(MAX_CHAT_LENGTH) }),
  z.object({
    type: z.literal('set-note'),
    slot: z.union([z.number().int().min(1).max(KEYWORD_COUNT), z.literal('general')]),
    text: z.string().max(MAX_GENERAL_NOTE_LENGTH),
  }),
  z.object({ type: z.literal('next-round') }),
]);

export type EnigmaAction = z.infer<typeof actionSchema>;

// ---- What each player is allowed to see ----

export type Role = 'encryptor' | 'decoder' | 'interceptor' | 'waiting' | 'spectator';

export interface TransmissionView {
  team: Team;
  encryptor: PlayerId;
  /** Only the Encryptor sees the code before the reveal. */
  code: Code | null;
  clues: string[] | null;
  expired: boolean;
  active: boolean;
  revealed: boolean;
  /** The viewer's part in this transmission right now. */
  role: Role;
  /** Teammates' votes on this transmission (decode for the sender's team, intercept for the other). */
  teamVotes: Record<PlayerId, Vote>;
  /** Who on the viewer's team still has to agree. */
  voters: PlayerId[];
  /** Everyone on the viewer's side locked in, but not on the same code. */
  disagree: boolean;
  /** The viewer's side has already agreed. */
  settled: boolean;
  /** After the reveal: what each side guessed and how it went. */
  result: Pick<HistoryEntry, 'decodeGuess' | 'interceptGuess' | 'decoded' | 'intercepted'> | null;
}

export interface TeamView {
  /** Own team's keywords (or everyone's once the game is over); null = hidden. */
  keywords: string[] | null;
  intercepts: number;
  misses: number;
  history: HistoryEntry[];
  members: PlayerId[];
}

export interface EnigmaView {
  phase: EnigmaState['phase'];
  settings: Settings;
  seats: Array<Seat & { id: PlayerId }>;
  me: (Seat & { id: PlayerId }) | null;
  round: number;
  maxRounds: number;
  stage: Stage;
  startingTeam: Team;
  teams: Record<Team, TeamView>;
  transmissions: TransmissionView[];
  /** Own team's private chat; empty for spectators. */
  chat: ChatMessage[];
  /** Own team's shared notes about the opponent; null for spectators. */
  notes: TeamNotes | null;
  deadline: number | null;
  winner: Team | 'draw' | null;
}
