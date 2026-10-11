import type {
  GameStats,
  PlayerProfile,
  StatsFun,
  StatsGames,
  StatsHeatmap,
  StatsOverview,
  StatsPlayers,
  StatsSettings,
  StatsTimeseries,
  StatsTimeseriesMetric,
  StatsWords,
  WordKind,
} from '@vt/protocol';
import type { StatsWindow } from '@vt/protocol';

/** Raw events are kept this long; daily rollups forever. */
export const RAW_RETENTION_DAYS = 90;

/** One raw stats event, as stored and exported (one NDJSON line each). */
export interface StatsEvent {
  /** ULID: sortable by time, unique without coordination. */
  id: string;
  ts: number;
  /** 'YYYY-MM-DD' (UTC) of `ts`. */
  day: string;
  /**
   * `room.created`, `player.joined|renamed|left|kicked`, `host.changed`, `action`,
   * `game.started`, `game.ended`, `room.swept`, `room.wrapped`, `recap.viewed`, `recap.shared`,
   * or `insight.<type>` for a game's own events.
   */
  type: string;
  gameId: string;
  roomId: string;
  playerId: string | null;
  props: Record<string, unknown>;
}

/** A player seen joining a room under a name. */
export interface PlayerSighting {
  playerId: string;
  name: string;
  now: number;
  /** A room joined for the first time (not a rename). */
  joinedRoom: boolean;
}

/** The latest `game.started` in a room that has no `game.ended` after it. */
export interface OpenGame {
  ts: number;
  gameId: string;
  props: Record<string, unknown>;
}

/**
 * Write side of the stats store. SQLite today; a column store (ClickHouse) can implement the
 * same interface, with `exportNdjson` providing the backfill.
 */
export interface StatsStore {
  append(events: readonly StatsEvent[]): void;
  /** Records names and first/last seen; `gamesPlayed` adds to the player's running total. */
  upsertPlayers(
    sightings: readonly PlayerSighting[],
    gamesPlayed: ReadonlyMap<string, number>,
  ): void;
  openGame(roomId: string): OpenGame | null;
  /** Rolls one completed day's raw events into the daily tables (idempotent; a day with no raw events left is kept as it is). */
  rollupDay(day: string, now: number): void;
  /** Days before `today` that have raw events but no rollup yet. */
  unrolledDays(today: string): string[];
  /** Deletes raw events of rolled-up days before `beforeDay`; returns how many. */
  prune(beforeDay: string): number;
  /**
   * Forgets a player: deletes their events, names and per-player totals, and replaces their id
   * wherever other events mention it (a co-winner, a vote target). Anonymous day totals stay.
   * Returns how many rows were removed or scrubbed.
   */
  forgetPlayer(playerId: string): number;
  /** Raw events with `from <= day <= to`, in time order. */
  exportNdjson(from: string, to: string): Iterable<string>;
  /** Forgets every stat (events, rollups, players). */
  reset(): void;
}

/** A resolved query window (`StatsWindow` plus nothing else for now). */
export type Window = StatsWindow;

/** Read side. Routes only ever call these. */
export interface StatsQueries {
  /** The first day with any data, for `range=all`. */
  firstDay(): string | null;
  overview(w: Window): StatsOverview;
  timeseries(metric: StatsTimeseriesMetric, w: Window, game?: string): StatsTimeseries;
  games(w: Window): StatsGames;
  game(gameId: string, w: Window): GameStats;
  players(w: Window): StatsPlayers;
  player(id: string, w: Window): PlayerProfile | null;
  words(gameId: string, kind: WordKind, w: Window, limit: number): StatsWords;
  settings(gameId: string, w: Window): StatsSettings;
  heatmap(w: Window, game?: string): StatsHeatmap;
  fun(w: Window): StatsFun;
}

/** Who a room has seen: each player's latest name, and who was last removed by the host. */
export interface RoomPeople {
  names: Map<string, string>;
  /** Kicked, and not back since. */
  kicked: Set<string>;
}

/**
 * Narrow read side for night recaps: one room's raw events. Kept apart from `StatsQueries`
 * (window aggregates for the admin page); a column store answers it from its `(room_id, ts)` order.
 */
export interface RecapSource {
  /** The latest `game.started` in the room, or null. */
  lastGameStart(roomId: string): number | null;
  /** The room's events from `sinceTs` on, in the order they happened. */
  roomEvents(roomId: string, sinceTs: number): StatsEvent[];
  roomPeople(roomId: string): RoomPeople;
}
