/**
 * Tavern night recap: what the server sends over a member's own socket. Every `text` may carry
 * placeholders the browser resolves: `{p:<playerId>}` (a name), `{role:<id>}`, `{loc:<id>}` and
 * `{card:<id>}` (names from a back-room game's private manifest, for unlocked members only).
 */

export type RecapTone = 'cheeky' | 'wholesome';
export type RecapValence = 'glory' | 'chaos' | 'gentle';

export interface RecapLine {
  awardId: string;
  emoji: string;
  title: string;
  /** "{p:…} shook hands with the assassin". */
  text: string;
  players: string[];
  gameNo?: number;
  valence: RecapValence;
}

/** One finished game of the night: its strip, who won, and its rounds ("Past rounds"). */
export interface GameRecap {
  gameNo: number;
  gameId: string;
  startedAt: number;
  durationMs: number;
  players: string[];
  winners: string[];
  /** The end-screen strip (2–3 lines). */
  lines: RecapLine[];
  /** One line per round, oldest first. */
  history: string[];
}

export interface RoomRecap {
  /** Stable id of the night: its first game's start event. Empty when nothing was played. */
  nightKey: string;
  status: 'live' | 'wrapped';
  tone: RecapTone;
  startedAt: number;
  endedAt: number;
  /** Games still being played (they show up once they end). */
  running: number;
  /** Games that ended early (back to the lobby, too few players). */
  abandoned: number;
  games: GameRecap[];
  /** Everyone named on the card. `left`: no longer in the room. */
  players: { id: string; name: string; played: number; left?: boolean }[];
  /** Members who watched every game. */
  audience: { id: string; name: string }[];
  moment?: RecapLine;
  mvp?: RecapLine;
  awards: RecapLine[];
  nuggets: { emoji: string; text: string }[];
  /** The host's clock offset (minutes, as `Date#getTimezoneOffset`), for the card's date. */
  tzOffsetMin?: number;
}

/** A successful reply carrying data, or the usual error. */
export type AckWith<T> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export interface RecapQuery {
  /** `game`: the latest finished game's strip only. `night`: the whole card. */
  scope: 'game' | 'night';
  /** The viewer opened the recap sheet (counted as a view). */
  opened?: boolean;
}

/** What the snapshot says about the room's game and recaps, so the shell stays game-agnostic. */
export interface RoomMeta {
  phase: 'lobby' | 'playing' | 'over';
  /** Games started in this room. */
  gameNo: number;
  /** Night recaps are switched on (admin kill switch). */
  recap: boolean;
  /** The room's recap tone, as the host set it. */
  tone: RecapTone;
}
