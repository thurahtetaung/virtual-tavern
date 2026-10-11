import type { StatsTimeseriesMetric, WordKind } from '@vt/protocol';
import type { Db } from '../db/index.ts';
import { Agg, aggregate, key, split } from './aggregate.ts';
import * as report from './report.ts';
import type { PlayerInfo, ReportContext } from './report.ts';
import type {
  OpenGame,
  PlayerSighting,
  RecapSource,
  RoomPeople,
  StatsEvent,
  StatsQueries,
  StatsStore,
  Window,
} from './types.ts';

export interface SqliteStatsOptions {
  /** Registered game ids, in display order. */
  gameIds: readonly string[];
  gameName?: (id: string) => string;
  /** Display label for a setting value; the value itself when undefined. */
  label?: (key: string, value: string) => string | undefined;
}

interface EventRow {
  id: string;
  ts: number;
  day: string;
  type: string;
  game_id: string;
  room_id: string;
  player_id: string | null;
  props: string;
}

const toEvent = (r: EventRow): StatsEvent => ({
  id: r.id,
  ts: r.ts,
  day: r.day,
  type: r.type,
  gameId: r.game_id,
  roomId: r.room_id,
  playerId: r.player_id,
  props: JSON.parse(r.props) as Record<string, unknown>,
});

const EXPORT_PAGE = 1000;

/** What a forgotten player's id becomes in other players' events. */
export const FORGOTTEN = 'forgotten';

const TABLES = [
  'stats_events',
  'stats_players',
  'stats_player_names',
  'stats_rollups',
  'stats_daily',
  'stats_daily_players',
  'stats_daily_words',
  'stats_daily_settings',
] as const;

/** What a query needs besides the daily counters. */
interface Parts {
  players?: boolean;
  words?: boolean;
  settings?: boolean;
}

/** Stats in the app's SQLite database: raw events, daily rollups, and the queries over both. */
export class SqliteStatsStore implements StatsStore, StatsQueries, RecapSource {
  private readonly sql: Db['$client'];
  private readonly ctx: ReportContext;

  constructor(db: Db, opts: SqliteStatsOptions) {
    this.sql = db.$client;
    const name = opts.gameName ?? ((id: string) => id);
    const label = opts.label ?? (() => undefined);
    this.ctx = {
      gameIds: opts.gameIds,
      gameName: name,
      label: (k, v) => label(k, v) ?? settingLabel(k, v),
      players: (ids) => this.playerInfo(ids),
    };
  }

  // ---- Write side ----

  append(events: readonly StatsEvent[]): void {
    if (!events.length) return;
    const insert = this.sql.prepare(
      `insert or ignore into stats_events (id, ts, day, type, game_id, room_id, player_id, props)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    this.sql.transaction(() => {
      for (const e of events)
        insert.run(
          e.id,
          e.ts,
          e.day,
          e.type,
          e.gameId,
          e.roomId,
          e.playerId,
          JSON.stringify(e.props),
        );
    })();
  }

  upsertPlayers(
    sightings: readonly PlayerSighting[],
    gamesPlayed: ReadonlyMap<string, number>,
  ): void {
    if (!sightings.length && !gamesPlayed.size) return;
    const player = this.sql.prepare(
      `insert into stats_players (player_id, first_seen, last_seen, last_name, games_played, rooms_joined)
       values (@id, @now, @now, @name, 0, @joined)
       on conflict (player_id) do update set
         last_seen = max(last_seen, excluded.last_seen),
         last_name = case when excluded.last_name = '' then last_name else excluded.last_name end,
         rooms_joined = rooms_joined + excluded.rooms_joined`,
    );
    const alias = this.sql.prepare(
      `insert into stats_player_names (player_id, name, first_seen, last_seen, uses)
       values (?, ?, ?, ?, 1)
       on conflict (player_id, name) do update set
         last_seen = max(last_seen, excluded.last_seen), uses = uses + 1`,
    );
    const games = this.sql.prepare(
      'update stats_players set games_played = games_played + ? where player_id = ?',
    );
    this.sql.transaction(() => {
      for (const s of sightings) {
        player.run({ id: s.playerId, now: s.now, name: s.name, joined: s.joinedRoom ? 1 : 0 });
        if (s.name) alias.run(s.playerId, s.name, s.now, s.now);
      }
      for (const [id, n] of gamesPlayed) games.run(n, id);
    })();
  }

  openGame(roomId: string): OpenGame | null {
    const row = this.sql
      .prepare(
        `select ts, game_id, type, props from stats_events
         where room_id = ? and type in ('game.started', 'game.ended')
         order by ts desc, id desc limit 1`,
      )
      .get(roomId) as { ts: number; game_id: string; type: string; props: string } | undefined;
    if (row?.type !== 'game.started') return null;
    return {
      ts: row.ts,
      gameId: row.game_id,
      props: JSON.parse(row.props) as Record<string, unknown>,
    };
  }

  rollupDay(day: string, now: number): void {
    this.sql.transaction(() => {
      const events = this.rawEvents(day, day, false);
      // Nothing raw left (already rolled up and pruned): the rollup is all there is, so keep it.
      if (!events.length) return;
      const agg = aggregate(events);
      for (const table of [
        'stats_daily',
        'stats_daily_players',
        'stats_daily_words',
        'stats_daily_settings',
      ])
        this.sql.prepare(`delete from ${table} where day = ?`).run(day);
      const write = (sqlText: string, map: Map<string, number>) => {
        const stmt = this.sql.prepare(sqlText);
        for (const [k, v] of map) stmt.run(...split(k), v);
      };
      write('insert into stats_daily (day, game_id, metric, value) values (?, ?, ?, ?)', agg.daily);
      write(
        'insert into stats_daily_players (day, game_id, player_id, metric, value) values (?, ?, ?, ?, ?)',
        agg.players,
      );
      write(
        'insert into stats_daily_words (day, game_id, kind, word, count) values (?, ?, ?, ?, ?)',
        agg.words,
      );
      write(
        'insert into stats_daily_settings (day, game_id, key, value, count) values (?, ?, ?, ?, ?)',
        agg.settings,
      );
      this.sql
        .prepare('insert or replace into stats_rollups (day, rolled_at) values (?, ?)')
        .run(day, now);
    })();
  }

  unrolledDays(today: string): string[] {
    return this.sql
      .prepare(
        `select distinct day from stats_events
         where day < ? and day not in (select day from stats_rollups) order by day`,
      )
      .pluck()
      .all(today) as string[];
  }

  prune(beforeDay: string): number {
    return this.sql
      .prepare('delete from stats_events where day < ? and day in (select day from stats_rollups)')
      .run(beforeDay).changes;
  }

  forgetPlayer(playerId: string): number {
    return this.sql.transaction(() => {
      let changes = 0;
      for (const table of [
        'stats_events',
        'stats_players',
        'stats_player_names',
        'stats_daily_players',
      ])
        changes += this.sql
          .prepare(`delete from ${table} where player_id = ?`)
          .run(playerId).changes;
      // Ids are long random hex, so a plain replace can't touch anything else.
      changes += this.sql
        .prepare(
          `update stats_events set props = replace(props, ?, '${FORGOTTEN}') where instr(props, ?) > 0`,
        )
        .run(playerId, playerId).changes;
      return changes;
    })();
  }

  *exportNdjson(from: string, to: string): Iterable<string> {
    // Page through with a keyset rather than one open cursor: the connection must stay free
    // for game writes while a slow download drains.
    const page = this.sql.prepare(
      `select * from stats_events where day between ? and ? and (ts > ? or (ts = ? and id > ?))
       order by ts, id limit ${EXPORT_PAGE}`,
    );
    let ts = -1;
    let id = '';
    for (;;) {
      const rows = page.all(from, to, ts, ts, id) as EventRow[];
      for (const r of rows) yield `${JSON.stringify(toEvent(r))}\n`;
      if (rows.length < EXPORT_PAGE) return;
      ts = rows.at(-1)!.ts;
      id = rows.at(-1)!.id;
    }
  }

  reset(): void {
    this.sql.transaction(() => {
      for (const table of TABLES) this.sql.prepare(`delete from ${table}`).run();
    })();
  }

  // ---- Recap reads (one room) ----

  lastGameStart(roomId: string, before = Number.MAX_SAFE_INTEGER): number | null {
    return (
      (this.sql
        .prepare(
          `select max(ts) from stats_events
           where room_id = ? and type = 'game.started' and ts < ?`,
        )
        .pluck()
        .get(roomId, before) as number | null) ?? null
    );
  }

  roomLink(roomId: string): string | null {
    const key = this.sql
      .prepare(
        `select json_extract(props, '$.nightKey') from stats_events
         where room_id = ? and type = 'room.created' order by ts desc, id desc limit 1`,
      )
      .pluck()
      .get(roomId);
    return typeof key === 'string' && key ? key : null;
  }

  nightRooms(keys: readonly string[]): string[] {
    if (!keys.length) return [];
    const out = new Set<string>();
    // Bounded by the caller (one room's night starts in a window), but keep each query small.
    for (let i = 0; i < keys.length; i += 200) {
      const chunk = keys.slice(i, i + 200);
      const marks = chunk.map(() => '?').join(',');
      const rows = this.sql
        .prepare(
          `select room_id from stats_events where type = 'game.started' and id in (${marks})
           union
           select room_id from stats_events
           where type = 'room.created' and json_extract(props, '$.nightKey') in (${marks})`,
        )
        .pluck()
        .all(...chunk, ...chunk) as string[];
      for (const r of rows) out.add(r);
    }
    return [...out];
  }

  gameStarts(roomId: string, sinceTs: number): string[] {
    return this.sql
      .prepare(
        `select id from stats_events where room_id = ? and type = 'game.started' and ts >= ?
         order by ts, id`,
      )
      .pluck()
      .all(roomId, sinceTs) as string[];
  }

  roomEvents(roomId: string, sinceTs: number): StatsEvent[] {
    const rows = this.sql
      .prepare('select * from stats_events where room_id = ? and ts >= ? order by ts, id')
      .all(roomId, sinceTs) as EventRow[];
    return rows.map(toEvent);
  }

  roomPeople(roomId: string): RoomPeople {
    const rows = this.sql
      .prepare(
        `select type, player_id, props from stats_events
         where room_id = ? and player_id is not null
           and type in ('player.joined', 'player.renamed', 'player.kicked')
         order by ts, id`,
      )
      .all(roomId) as { type: string; player_id: string; props: string }[];
    const names = new Map<string, string>();
    const kicked = new Set<string>();
    for (const r of rows) {
      if (r.type === 'player.kicked') {
        kicked.add(r.player_id);
        continue;
      }
      kicked.delete(r.player_id);
      const name = (JSON.parse(r.props) as { name?: unknown }).name;
      if (typeof name === 'string' && name) names.set(r.player_id, name);
    }
    return { names, kicked };
  }

  // ---- Read side ----

  firstDay(): string | null {
    const day = this.sql
      .prepare(
        `select min(day) from (
           select min(day) as day from stats_events
           union all select min(day) from stats_daily
           union all select min(day) from stats_daily_players)`,
      )
      .pluck()
      .get() as string | null;
    return day ?? null;
  }

  overview(w: Window) {
    return report.overview(this.load(w.previousFrom, w.to, { players: true }), w, this.ctx);
  }

  timeseries(metric: StatsTimeseriesMetric, w: Window, game?: string) {
    const agg = this.load(w.from, w.to, { players: metric === 'players_unique' });
    return report.timeseries(agg, w, metric, this.ctx, game);
  }

  games(w: Window) {
    return report.games(this.load(w.from, w.to, { players: true }), w, this.ctx);
  }

  game(gameId: string, w: Window) {
    const agg = this.load(w.from, w.to, { players: true, settings: true });
    return report.game(agg, w, gameId, this.ctx);
  }

  players(w: Window) {
    return report.players(this.load(w.from, w.to, { players: true }), w, this.ctx);
  }

  player(id: string, w: Window) {
    const agg = this.load(w.from, w.to, { players: true, words: true });
    return report.player(agg, w, id, this.ctx);
  }

  words(gameId: string, kind: WordKind, w: Window, limit: number) {
    return report.words(this.load(w.from, w.to, { words: true }), w, gameId, kind, limit);
  }

  settings(gameId: string, w: Window) {
    return report.settingsResponse(
      this.load(w.from, w.to, { settings: true }),
      w,
      gameId,
      this.ctx,
    );
  }

  heatmap(w: Window, game?: string) {
    return report.heatmap(this.load(w.from, w.to), w, game);
  }

  fun(w: Window) {
    return report.fun(this.load(w.from, w.to, { players: true, words: true }), w, this.ctx);
  }

  /** Rolled-up days from the daily tables plus the remaining days aggregated from raw events. */
  private load(from: string, to: string, parts: Parts = {}): Agg {
    const agg = new Agg();
    const fill = (table: string, cols: string, map: Map<string, number>) => {
      const rows = this.sql
        .prepare(`select ${cols} from ${table} where day between ? and ?`)
        .raw()
        .all(from, to) as (string | number)[][];
      for (const r of rows) map.set(key(...(r.slice(0, -1) as string[])), r.at(-1) as number);
    };
    fill('stats_daily', 'day, game_id, metric, value', agg.daily);
    if (parts.players)
      fill('stats_daily_players', 'day, game_id, player_id, metric, value', agg.players);
    if (parts.words) fill('stats_daily_words', 'day, game_id, kind, word, count', agg.words);
    if (parts.settings)
      fill('stats_daily_settings', 'day, game_id, key, value, count', agg.settings);
    return aggregate(this.rawEvents(from, to, true), agg);
  }

  private rawEvents(from: string, to: string, unrolledOnly: boolean): StatsEvent[] {
    const rows = this.sql
      .prepare(
        `select * from stats_events where day between ? and ?
         ${unrolledOnly ? 'and day not in (select day from stats_rollups)' : ''}
         order by ts, id`,
      )
      .all(from, to) as EventRow[];
    return rows.map(toEvent);
  }

  private playerInfo(ids: readonly string[]): Map<string, PlayerInfo> {
    const out = new Map<string, PlayerInfo>();
    if (!ids.length) return out;
    const player = this.sql.prepare(
      'select first_seen, last_seen, last_name from stats_players where player_id = ?',
    );
    const names = this.sql.prepare(
      `select name, uses, first_seen, last_seen from stats_player_names
       where player_id = ? order by uses desc, last_seen desc`,
    );
    for (const id of ids) {
      const p = player.get(id) as
        { first_seen: number; last_seen: number; last_name: string } | undefined;
      if (!p) continue;
      const used = names.all(id) as {
        name: string;
        uses: number;
        first_seen: number;
        last_seen: number;
      }[];
      out.set(id, {
        name: p.last_name,
        firstSeen: p.first_seen,
        lastSeen: p.last_seen,
        names: used.map((n) => ({
          name: n.name,
          uses: n.uses,
          firstSeen: n.first_seen,
          lastSeen: n.last_seen,
        })),
      });
    }
    return out;
  }
}

/** Default labels: timers in seconds, everything else as recorded. */
function settingLabel(key: string, value: string): string {
  if (/Seconds$/.test(key)) return value === 'off' ? 'Off' : `${value} s`;
  return value;
}
