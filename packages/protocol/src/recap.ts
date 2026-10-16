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
  /** The game it came from (night awards have none). */
  gameId?: string;
  valence: RecapValence;
}

/** A "by the numbers" fact. `record`: it beat the room's stored record ("🆕 Room record"). */
export interface RecapNugget {
  emoji: string;
  text: string;
  record?: boolean;
}

/** One finished game of the night: its strip, who won, and its rounds ("Past rounds"). */
export interface GameRecap {
  gameNo: number;
  gameId: string;
  /** The game's name (a back-room game's code name). */
  name?: string;
  /** Played at a linked table ("Same crew, new game"), not in this room. */
  elsewhere?: boolean;
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
  nuggets: RecapNugget[];
  /** The host's clock offset (minutes, as `Date#getTimezoneOffset`), for the card's date. */
  tzOffsetMin?: number;
  /** Frozen when the night was wrapped up or the next one began: it never changes again. */
  frozen?: boolean;
  /** The room's earlier frozen nights, newest first (for "Previous nights"). */
  previous?: NightSummary[];
}

/** One frozen night, as listed in the Hall of fame. */
export interface NightSummary {
  nightKey: string;
  startedAt: number;
  endedAt: number;
  games: number;
  /** Each game played and how often, most played first. */
  mix: { gameId: string; name: string; count: number }[];
  /** The night's MVP, by name. */
  mvp?: string;
}

/** A frozen night anywhere in the tavern, for the admin's "Recent tavern nights". */
export interface RecentNight extends NightSummary {
  roomId: string;
}

/** The room's Hall of fame, built from its frozen nights. */
export interface HallOfFame {
  /** Nights the room has had, tonight included once it has a finished game. */
  nights: number;
  /** Most nights as MVP, best first. */
  mvps: { playerId: string; name: string; count: number }[];
  /** Each player's most-won award (at least twice). */
  favourites: {
    playerId: string;
    name: string;
    awardId: string;
    emoji: string;
    title: string;
    count: number;
  }[];
  /** Room records from the night cards' numbers, with when they were set. */
  records: { id: string; emoji: string; text: string; at: number }[];
  previous: NightSummary[];
}

/** "Same crew, new game": a new table someone here opened for the same night. */
export interface NextTable {
  roomId: string;
  gameId: string;
  /** Who opened it (a player id in this room). */
  by: string;
}

/** A successful reply carrying data, or the usual error. */
export type AckWith<T> =
  { ok: true; data: T } | { ok: false; error: { code: string; message: string } };

export interface RecapQuery {
  /**
   * `game`: the latest finished game's strip only. `night`: the whole card (with `nightKey`, an
   * earlier frozen night, read-only). `hall`: the room's Hall of fame.
   */
  scope: 'game' | 'night' | 'hall';
  nightKey?: string;
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
  /** An admin playtest room (never recorded): its bot settings, for the TEST bar. */
  playtest?: PlaytestMeta;
}

export type PlaytestSpeed = 'fast' | 'normal' | 'slow';

/** What every seat of a playtest sees about it. */
export interface PlaytestMeta {
  /** How fast the bots play. */
  speed: PlaytestSpeed;
  /** The bots are paused. */
  paused: boolean;
  /** The bot runner paused them itself: they kept making moves without getting anywhere. */
  stuck?: true;
  /** How many seats are bots. */
  bots: number;
}
