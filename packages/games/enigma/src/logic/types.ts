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
/** A keyword guess on the other team's sheet. */
export const MAX_NOTE_LENGTH = 40;
/** One item in the team's list of notes. */
export const MAX_NOTE_ITEM_LENGTH = 200;
export const MAX_NOTE_ITEMS = 40;
/** The id of the item that shows a room's old single notes field (see `TeamNotes.general`). */
export const LEGACY_NOTE_ID = 'earlier';
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

export interface NoteItem {
  id: string;
  /** Who wrote it; '' for the old notes field when nobody is on record. */
  by: PlayerId;
  text: string;
  at: number;
}

export interface TeamNotes {
  /** The team's guesses at the opponent's keywords 1–4. */
  guesses: string[];
  /** Who last changed each guess. Absent in rooms saved before it existed. */
  guessedBy?: (PlayerId | null)[];
  /**
   * The old single free-text field, which teammates kept overwriting. Never written any more:
   * a room saved with one shows it as the first item (`LEGACY_NOTE_ID`), and the next change to
   * the notes moves it into `items` and clears it.
   */
  general: string;
  /** Who last edited `general`. */
  editedBy: PlayerId | null;
  /** The team's notes, oldest first. Absent in rooms saved before notes became a list. */
  items?: NoteItem[];
  /** Makes note ids (`n1`, `n2`, …). Absent in rooms saved before notes became a list. */
  nextNoteId?: number;
}

/** What a player sees of their own team's notes. */
export interface NotesView {
  guesses: string[];
  items: NoteItem[];
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
  /** Rounds this team has played (kept for older saves; the rotation uses `encryptions`). */
  encryptorTurn: number;
}

export interface Transmission {
  team: Team;
  encryptor: PlayerId;
  code: Code;
  clues: string[] | null;
  /**
   * No clues are coming: the clue timer ran out (strict timers), or the team has nobody left
   * who could decode them. Counts as a miscommunication.
   */
  expired: boolean;
  /** The clues never came because the strict clue timer ran out. Absent in rooms saved before it existed. */
  timedOut?: boolean;
  /** The strict guess timer ran out before every side had agreed. */
  guessTimedOut?: boolean;
  decode: Record<PlayerId, Vote>;
  intercept: Record<PlayerId, Vote>;
  /**
   * Who must agree on each side, fixed when guessing starts so that latecomers don't stall a
   * vote; leavers are pruned. null until then.
   */
  decodeVoters: PlayerId[] | null;
  interceptVoters: PlayerId[] | null;
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
  /**
   * Which team's keywords each player has seen this game. Outlives their seat, so leaving and
   * rejoining can't be used to peek at the other team's words. Never sent to clients.
   * Optional only for rooms saved before the field existed.
   */
  seen?: Record<PlayerId, Team>;
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
  /**
   * How many times each player has been the Encryptor, across games, so the next one is whoever
   * has encrypted least (ties by seat order) even after people leave, rejoin or a rematch starts.
   * Optional because older saved rooms lack it.
   */
  encryptions?: Record<PlayerId, number>;
}

const timerSeconds = z.number().int().min(MIN_TIMER_SECONDS).max(MAX_TIMER_SECONDS).nullable();
const team = z.enum(['red', 'blue']);
const digit = z.number().int().min(0).max(KEYWORD_COUNT);
/** One line of text: trimmed, non-empty, no line breaks. */
const clue = z
  .string()
  .trim()
  .min(1)
  .max(MAX_CLUE_LENGTH)
  .refine((s) => !/[\r\n]/.test(s), 'A clue is a single line.');

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
    clues: z.array(clue).length(CODE_LENGTH),
  }),
  /** `team` is the sending team of the transmission being guessed. */
  z.object({ type: z.literal('set-guess'), team, draft: z.array(digit).length(CODE_LENGTH) }),
  z.object({ type: z.literal('lock-guess'), team }),
  z.object({ type: z.literal('unlock-guess'), team }),
  z.object({ type: z.literal('chat'), text: z.string().trim().min(1).max(MAX_CHAT_LENGTH) }),
  /**
   * Sets the team's guess at one of the other team's keywords. `base` is the value the editor
   * started from: if a teammate has changed it since, the change is refused instead of
   * overwriting theirs.
   */
  z.object({
    type: z.literal('set-note'),
    slot: z.number().int().min(1).max(KEYWORD_COUNT),
    /** Trimmed, so a whitespace-only guess clears the field. */
    text: z.string().trim().max(MAX_NOTE_LENGTH),
    base: z.string().max(MAX_NOTE_LENGTH),
  }),
  z.object({
    type: z.literal('add-note'),
    text: z.string().trim().min(1).max(MAX_NOTE_ITEM_LENGTH),
  }),
  z.object({ type: z.literal('remove-note'), id: z.string().min(1).max(20) }),
  z.object({ type: z.literal('next-round') }),
  /** Host: stop waiting for `player`'s vote on `team`'s transmission (an offline player, say). */
  z.object({ type: z.literal('skip-voter'), team, player: z.string().min(1).max(100) }),
]);

export type EnigmaAction = z.infer<typeof actionSchema>;

// ---- What each player is allowed to see ----

/** `waiting`: on a team but not voting on this transmission (round 1 interceptor, or joined mid-round). */
export type Role = 'encryptor' | 'decoder' | 'interceptor' | 'waiting' | 'spectator';

export interface TransmissionView {
  team: Team;
  encryptor: PlayerId;
  /** Only the Encryptor sees the code before the reveal, and only while the transmission is in play. */
  code: Code | null;
  clues: string[] | null;
  expired: boolean;
  /** No clues because the strict clue timer ran out (rather than nobody being left to decode). */
  timedOut: boolean;
  /** The strict guess timer ended the guessing; any side that hadn't agreed failed. */
  guessTimedOut: boolean;
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
  /** While guessing: everyone, on either side, who still has to lock in (the host may skip them). */
  waitingOn: PlayerId[];
  /** Nobody on the sending team could decode (it was down to its Encryptor). */
  noDecoders: boolean;
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
  /** Who encrypts for this team next round (whoever has encrypted least, then seat order). */
  nextEncryptor: PlayerId | null;
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
  /** Mid-game, the team whose keywords the viewer has seen: the only one they may rejoin. */
  lockedTo: Team | null;
  /** Own team's private chat; empty for spectators. */
  chat: ChatMessage[];
  /** Own team's shared notes about the opponent; null for spectators. */
  notes: NotesView | null;
  deadline: number | null;
  winner: Team | 'draw' | null;
}
