import { z } from 'zod';

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

export const createRoomBody = z.object({ gameId: z.string(), token: playerToken });
export type CreateRoomBody = z.infer<typeof createRoomBody>;
export interface CreateRoomResponse {
  roomId: string;
}

export interface RoomInfo {
  id: string;
  gameId: string;
  /** A private game's display title, set by the admin (only sent to unlocked browsers). */
  title?: string;
}

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
}

export type Ack = { ok: true } | { ok: false; error: { code: string; message: string } };

export const joinRoomPayload = z.object({ roomId, token: playerToken, name: playerName });
export type JoinRoomPayload = z.infer<typeof joinRoomPayload>;

export interface ClientToServerEvents {
  'room:join': (payload: JoinRoomPayload, ack: (res: Ack) => void) => void;
  'room:rename': (name: string, ack: (res: Ack) => void) => void;
  'room:leave': (ack: (res: Ack) => void) => void;
  'room:kick': (playerId: string, ack: (res: Ack) => void) => void;
  'room:make-host': (playerId: string, ack: (res: Ack) => void) => void;
  'game:action': (action: unknown, ack: (res: Ack) => void) => void;
}

export interface ServerToClientEvents {
  'room:state': (snapshot: RoomSnapshot) => void;
  'room:kicked': () => void;
  /** The back-room unlock this connection joined with is no longer valid; it has left the room. */
  'room:locked': () => void;
}
export * from './questions.ts';
export * from './stats.ts';
