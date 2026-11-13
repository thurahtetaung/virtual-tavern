import { z } from 'zod';
import type { GameCategory } from './game-settings.ts';
import type { Patch } from './patch.ts';
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
import type { PlayerColor } from '@vt/game-sdk';
import type { StagePresence } from '@vt/game-sdk/show';

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

export {
  PLAYER_COLOR_NAMES,
  PLAYER_COLORS,
  type PlayerColor,
  colorsOf,
  playerColor,
} from '@vt/game-sdk';

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
  /** The game's categories, in the admin's order (none for a game that is off). */
  categories: GameCategory[];
  /**
   * The admin switched the game off: it leaves the game lists and new rooms are refused, while
   * rooms already open play on until their game ends.
   */
  off?: true;
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
  /** An admin playtest room (only ever sent to a signed-in admin, or its table screen). */
  playtest?: true;
  versions?: ListVersions;
}

// ---- Table screen ----

/** Characters of a table-screen pairing code: no 0/O, 1/I/L or U/V, so it reads out loud. */
export const STAGE_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTWXYZ23456789';
export const STAGE_CODE_LENGTH = 6;

/** A pairing code the host's phone shows; the table screen types it in on `/stage`. */
export interface StageCode {
  code: string;
  /** Server time it stops working. */
  expiresAt: number;
}

export const stagePairBody = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .transform((c) => c.replace(/[\s-]/g, ''))
    .pipe(z.string().length(STAGE_CODE_LENGTH, 'Codes are six characters.')),
});

/** A paired table screen: the room its pass is for. */
export interface StagePaired {
  roomId: string;
}

/** `GET /api/stage`: the room this screen is paired with, or null when it isn't. */
export interface StageStatus {
  roomId: string | null;
}

// ---- Linked phone ----

/**
 * Letters of a phone-link code: no I/L/O/U/V (they read as 1, 0 or each other), and no digits, so
 * four of them are easy to type on a phone.
 */
export const LINK_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTWXYZ';
export const LINK_CODE_LENGTH = 4;
/** How long a phone-link code works (the pairing card asks for a new one by itself). */
export const LINK_CODE_MS = 2 * 60_000;

/** A code a player's PC shows; their phone types it (or opens `/link#CODE`) to become a second key. */
export interface LinkCode {
  code: string;
  /** Server time it stops working. */
  expiresAt: number;
}

const linkCode = z
  .string()
  .trim()
  .toUpperCase()
  .transform((c) => c.replace(/[\s-]/g, ''))
  .pipe(z.string().length(LINK_CODE_LENGTH, 'Codes are four letters.'));

/**
 * `POST /api/link/check` and `POST /api/link`: the code, and this phone's own keys (its player
 * token, and the linked keys it holds), so a phone already in the room as someone else is refused.
 */
export const linkBody = z.object({
  code: linkCode,
  token: playerToken,
  links: z.array(playerToken).max(50).default([]),
});

/** What the phone confirms before it links: the table and the player it will play as. */
export interface LinkPreview {
  /** The game's name (a back-room game's title only for a valid code). */
  game: string;
  gameId: string;
  /** Who hosts, and how many play. */
  host: string;
  players: number;
  /** The player the phone joins as. */
  name: string;
  color: PlayerColor;
  /** Linking also opens the back room on this phone (it doesn't have it yet). */
  opensBackroom: boolean;
}

/**
 * `POST /api/link/check`: what the phone shows next. `expired`: the code ran out or was used;
 * `wrong`: no PC shows it; `other-seat`: this phone already plays someone else in that room (its
 * own room, so it may know it: `seat` is who it plays, `name` who the code is for).
 */
export type LinkCheck =
  | { status: 'ok'; preview: LinkPreview }
  | { status: 'expired' | 'wrong' }
  | { status: 'other-seat'; roomId: string; seat: string; host: string; name: string };

/** A redeemed code: the room, and the phone's new key for it (sent to this phone only). */
export interface LinkRedeemed {
  roomId: string;
  key: string;
}

/**
 * A player's devices, in their own snapshot while a phone is linked: whether the phone is online,
 * whether the PC (any of the player's own browsers) is, and whether a PC shows the table screen.
 */
export interface LinkStatus {
  phone: boolean;
  pc: boolean;
  show: boolean;
}

/**
 * The current versions of `/api/games` (for this browser), a game's `/api/word-lists` and the
 * back-room manifests,
 * sent on responses every page load fetches anyway, so pages can ask for URLs (`?v=`) the
 * browser may keep for a day.
 */
export interface ListVersions {
  games: string;
  wordLists?: string;
  /** Back-room manifests by game id (only for a browser that has the back room). */
  manifests?: Record<string, string>;
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
  /** The game is switched off for players (the admin may still playtest it). */
  off?: true;
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
  players: { id: string; name: string; color: PlayerColor; connected: boolean; bot?: true }[];
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

/**
 * The nightly off-site database copy's last result, as the job wrote it next to the backups.
 * `stale` is set when the last success is too old to trust (the job may have stopped running).
 */
export type OffsiteBackupStatus =
  | { recorded: false }
  | {
      recorded: true;
      /** ISO time of the run. */
      at: string;
      ok: boolean;
      /** Object key of the uploaded copy. */
      key?: string;
      bytes?: number;
      /** Copies kept off-site, and their combined size. */
      copies?: number;
      totalBytes?: number;
      /** Why the run failed, when `ok` is false. */
      error?: string;
      stale: boolean;
    };

export interface ApiError {
  error: { code: string; message: string };
}

// ---- Socket.IO ----

export interface RoomPlayer {
  id: string;
  name: string;
  /** Their colour in this room: random when they join, theirs to change (`room:recolor`). */
  color: PlayerColor;
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
  /** The only colours this room offers, when its game uses fewer than all (`GameDefinition.colors`). */
  colors?: PlayerColor[];
  /** Whether a table screen is watching the room right now (phones go quiet). */
  stage?: StagePresence;
  /**
   * This snapshot is for the table screen itself: `game` is the spectator view and `you` is
   * empty, since the table screen is never a player.
   */
  role?: 'stage';
  /** The viewer has a linked phone: which of their devices are here (see `LinkStatus`). */
  link?: LinkStatus;
}

/**
 * Why a back-room room turned a player away: the shared word changed (a new password, or everyone
 * was signed out), the admin session they came in with ended, or there was no current unlock.
 */
export type LockReason = 'changed' | 'signed-out' | 'none';

export type Ack =
  { ok: true } | { ok: false; error: { code: string; message: string; reason?: LockReason } };

/** Set by browsers that rebuild the room from `room:patch` updates (older ones only take `room:state`). */
const takesPatches = z.literal(true).optional();
export const joinRoomPayload = z.object({
  roomId,
  token: playerToken,
  name: playerName,
  patch: takesPatches,
  /** `token` is a linked phone's key for this room, not a browser's own token. */
  link: z.literal(true).optional(),
});
export type JoinRoomPayload = z.infer<typeof joinRoomPayload>;
/** A table screen joins with its pass (a cookie), never as a player. */
export const stageJoinPayload = z.object({ roomId, role: z.literal('stage'), patch: takesPatches });
export type StageJoinPayload = z.infer<typeof stageJoinPayload>;
/**
 * A player's own PC showing the table screen: the spectator view, on the player's own token (a
 * member of the room), never a seat, a presence or the room's table screen.
 */
export const showJoinPayload = z.object({
  roomId,
  role: z.literal('show'),
  token: playerToken,
  patch: takesPatches,
});
export type ShowJoinPayload = z.infer<typeof showJoinPayload>;

export interface ClientToServerEvents {
  'room:join': (
    payload: JoinRoomPayload | StageJoinPayload | ShowJoinPayload,
    ack: (res: Ack) => void,
  ) => void;
  'room:rename': (name: string, ack: (res: Ack) => void) => void;
  /** Changes the player's colour; a colour someone here already has is refused. */
  'room:recolor': (color: PlayerColor, ack: (res: Ack) => void) => void;
  'room:leave': (ack: (res: Ack) => void) => void;
  'room:kick': (playerId: string, ack: (res: Ack) => void) => void;
  'room:make-host': (playerId: string, ack: (res: Ack) => void) => void;
  'game:action': (action: unknown, ack: (res: Ack) => void) => void;
  /** Host only: a new table-screen pairing code. */
  'room:stage-code': (ack: (res: AckWith<StageCode>) => void) => void;
  /** Host only: removes the table screen (its pass stops working at once). */
  'room:stage-remove': (ack: (res: Ack) => void) => void;
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
  /** A phone-link code for this player (a new one replaces the last). */
  'room:link-code': (ack: (res: AckWith<LinkCode>) => void) => void;
  /** Withdraws this player's open phone-link code. */
  'room:link-cancel': (ack: (res: Ack) => void) => void;
  /** Unlinks this player's phone (from the PC or the phone itself), in every table. */
  'room:unlink': (ack: (res: Ack) => void) => void;
  /** A `room:patch` didn't fit this browser's copy of the room: send the whole room again. */
  'room:resync': (ack: (res: Ack) => void) => void;
}

/**
 * What changed in the room since the update numbered `base` (each connection numbers its own
 * updates), sent only to browsers that joined with `patch: true`.
 */
export interface RoomPatch {
  seq: number;
  base: number;
  serverNow: number;
  ops: Patch;
}

export interface ServerToClientEvents {
  /** The whole room. `seq` (for browsers that take patches) numbers it for the patches after it. */
  'room:state': (snapshot: RoomSnapshot & { seq?: number }) => void;
  /** What changed since the last update (see `RoomPatch`). */
  'room:patch': (patch: RoomPatch) => void;
  'room:kicked': () => void;
  /** This phone's link ended (unlinked, replaced, or the player left): it has left the room. */
  'room:unlinked': () => void;
  /** The player's PC moved to the night's next table: this linked phone follows. */
  'room:follow': (roomId: string) => void;
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
  /**
   * The answer to a join sent with the connection itself (`auth` holding a `JoinRoomPayload`),
   * which goes out right after the room's state.
   */
  'room:joined': (res: Ack) => void;
  /**
   * The night recap as it stands, pushed with the state it belongs to (on joining, when a game
   * starts or ends, the tone changes or the host wraps up), so nobody has to ask for it.
   * `for` names that state: `<phase>:<gameNo>`.
   */
  'room:recap': (push: { recap: RoomRecap | null; for: string }) => void;
}
export * from './game-settings.ts';
export * from './patch.ts';
export * from './content-packs.ts';
export * from './questions.ts';
export * from './recap.ts';
export * from './stats.ts';
