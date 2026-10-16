import { z } from 'zod';
import type {
  AckWith,
  GameRecap,
  HallOfFame,
  NextTable,
  PlaytestMeta,
  RecapLine,
  RecapQuery,
  RecapTone,
  RoomMeta,
  RoomRecap,
} from './recap.ts';

export const MAX_NAME_LENGTH = 24;
export const ROOM_ID_PATTERN = /^[a-z]+-[a-z]+-[a-z]+-[a-z0-9]{4}$/;

export const playerName = z
  .string()
  .trim()
  .min(1, 'Pick a name')
  .max(MAX_NAME_LENGTH, `Names are at most ${MAX_NAME_LENGTH} characters`);

/** Random secret that identifies a browser. The public player id is derived from it server-side. */
export const playerToken = z.string().regex(/^[A-Za-z0-9_-]{32,64}$/);

export const roomId = z.string().regex(ROOM_ID_PATTERN);

// ---- REST ----

export interface GameSummary {
  id: string;
  name: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  /** Back-room game, only listed for players who have unlocked it. */
  private?: boolean;
  /** Whether the game draws words from word lists (and so can be picked under "Used by"). */
  wordLists: boolean;
  /** Whether the game draws questions from question decks. */
  questionDecks: boolean;
  /** A private game's display title, set by the admin (only sent to unlocked browsers). */
  title?: string;
}

/** A night recap's key (the ULID of the night's first game start). */
export const nightKey = z.string().regex(/^[0-9A-HJKMNP-TV-Z]{26}$/, 'Not a night.');

export const createRoomBody = z.object({
  gameId: z.string(),
  token: playerToken,
  /** "Same crew, new game": the night this room continues (its recap merges with it). */
  nightKey: nightKey.optional(),
});
export type CreateRoomBody = z.infer<typeof createRoomBody>;
export interface CreateRoomResponse {
  roomId: string;
}

export interface RoomInfo {
  id: string;
  gameId: string;
  /** A private game's display title, set by the admin (only sent to unlocked browsers). */
  title?: string;
  /** An admin playtest room (only ever sent to a signed-in admin). */
  playtest?: true;
}

// ---- Playtests (admin only) ----

export const MAX_PLAYTEST_SEATS = 16;

/** A game the admin can play-test, with what its bots can do. */
export interface PlaytestGame {
  id: string;
  /** The game's name, or a private game's admin-set title. */
  name: string;
  private: boolean;
  minPlayers: number;
  /** Most seats a playtest may have (the game's own maximum, capped). */
  maxSeats: number;
  /** Which seats bots can take: every seat, all but some roles, or none. */
  bots: 'all' | 'some' | 'none';
  /** What the setup should know, e.g. "The Forensic Scientist must be human". */
  botNote?: string;
}

export const playtestSeat = z.object({ name: playerName, bot: z.boolean().default(false) });

export const createPlaytestBody = z.object({
  gameId: z.string().min(1).max(60),
  seats: z.array(playtestSeat).min(1).max(MAX_PLAYTEST_SEATS),
});
export type CreatePlaytestBody = z.input<typeof createPlaytestBody>;

/** One seat of a new playtest. `token` is the seat's secret: it only goes in the seat link. */
export interface PlaytestSeatInfo {
  name: string;
  playerId: string;
  /** The seat's secret token (human seats only). */
  token?: string;
  bot?: true;
}

export interface PlaytestCreated {
  roomId: string;
  gameId: string;
  seats: PlaytestSeatInfo[];
}

/** A running playtest, as the admin page and the TEST bar see it. */
export interface PlaytestStatus {
  roomId: string;
  gameId: string;
  phase: RoomMeta['phase'];
  playtest: PlaytestMeta;
  players: { id: string; name: string; connected: boolean; bot?: true }[];
}

export const updatePlaytestBody = z
  .object({
    paused: z.boolean(),
    speed: z.enum(['fast', 'normal', 'slow']),
    /** A new bot seat, in the lobby. */
    addBot: playerName,
    /** A bot seat to remove (its player id). */
    removeBot: z.string().min(1).max(64),
  })
  .partial();
export type UpdatePlaytestBody = z.input<typeof updatePlaytestBody>;

export interface WordListSummary {
  id: string;
  name: string;
  description: string;
  wordCount: number;
  updatedAt: number;
  /** Ids of the games that offer this list. */
  games: string[];
  /** Disabled lists are hidden from hosts and rooms; only admins see them. */
  enabled: boolean;
}

export interface WordListDetail extends WordListSummary {
  words: string[];
}

export const MAX_WORDS_PER_LIST = 5000;
export const MAX_WORD_LENGTH = 40;

export const wordListBody = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).default(''),
  words: z.array(z.string().trim().min(1).max(MAX_WORD_LENGTH)).max(MAX_WORDS_PER_LIST),
  /**
   * Games that offer the list. Omitted means every game that uses word lists. The server checks
   * the ids against its registered word-list games.
   */
  games: z.array(z.string().min(1).max(40)).min(1).max(10).optional(),
  /** Omitted means enabled for a new list, and unchanged on an update. */
  enabled: z.boolean().optional(),
});
export type WordListBody = z.input<typeof wordListBody>;

/** Switches a word list on or off without resending its words. */
export const wordListEnabledBody = z.object({ enabled: z.boolean() });

export const adminLoginBody = z.object({ password: z.string().min(1).max(200) });

export interface ApiError {
  error: { code: string; message: string };
}

// ---- Socket.IO ----

export interface RoomPlayer {
  id: string;
  name: string;
  connected: boolean;
  /**
   * Server time the player's last connection closed, while they are away. Missing when they are
   * connected, or have not been seen since the server started.
   */
  awaySince?: number;
  /** A playtest bot (always shown as connected). */
  bot?: true;
}

export interface RoomSnapshot<View = unknown> {
  id: string;
  gameId: string;
  hostId: string;
  you: string;
  players: RoomPlayer[];
  /**
   * While the host is offline: when the role passes to someone online (server epoch ms), so
   * everyone can see "Ana (host) is away. Someone takes over in 1:45". Null otherwise.
   */
  hostAwayUntil?: number | null;
  game: View;
  /** Server clock at send time, so clients can correct countdowns for clock skew. */
  serverNow: number;
  /** The game's coarse phase and the room's recap settings. */
  meta?: RoomMeta;
}

/**
 * Why a back-room room turned a player away: the shared word changed (a new password, or everyone
 * was signed out), the admin session they came in with ended, or there was no current unlock.
 */
export type LockReason = 'changed' | 'signed-out' | 'none';

export type Ack =
  { ok: true } | { ok: false; error: { code: string; message: string; reason?: LockReason } };

export const joinRoomPayload = z.object({ roomId, token: playerToken, name: playerName });
export type JoinRoomPayload = z.infer<typeof joinRoomPayload>;

export interface ClientToServerEvents {
  'room:join': (payload: JoinRoomPayload, ack: (res: Ack) => void) => void;
  'room:rename': (name: string, ack: (res: Ack) => void) => void;
  'room:leave': (ack: (res: Ack) => void) => void;
  'room:kick': (playerId: string, ack: (res: Ack) => void) => void;
  'room:make-host': (playerId: string, ack: (res: Ack) => void) => void;
  'game:action': (action: unknown, ack: (res: Ack) => void) => void;
  /** The night recap (members only). */
  'room:recap': (
    query: RecapQuery,
    ack: (res: AckWith<GameRecap | RoomRecap | HallOfFame | null>) => void,
  ) => void;
  /** Host only: freezes the night and opens the recap on every device. `tz` as getTimezoneOffset. */
  'room:wrap': (tz: number, ack: (res: Ack) => void) => void;
  /** Host only: the room's recap tone. */
  'room:recap-tone': (tone: RecapTone, tz: number, ack: (res: Ack) => void) => void;
  /** The viewer copied or shared the recap (counted, nothing else). */
  'room:recap-shared': (how: 'copy' | 'share' | 'image', ack: (res: Ack) => void) => void;
}

export interface ServerToClientEvents {
  'room:state': (snapshot: RoomSnapshot) => void;
  'room:kicked': () => void;
  /** The back-room unlock this connection joined with is no longer valid; it has left the room. */
  'room:locked': (reason: LockReason) => void;
  /** The host wrapped up the night: every device opens the recap. */
  'room:wrapped': (nightKey: string) => void;
  /** Someone here opened a new table for the same night ("Same crew, new game"). */
  'room:next': (next: NextTable) => void;
  /** The admin ended this playtest: the room is gone. */
  'room:closed': () => void;
  /** A playtest's finished game: its award strip, computed in memory and never saved. */
  'room:playtestAwards': (lines: RecapLine[]) => void;
}
export * from './questions.ts';
export * from './recap.ts';
export * from './stats.ts';
