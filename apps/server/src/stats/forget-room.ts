import type { Db } from '../db/index.ts';
import { dayOf } from './days.ts';
import type { StatsStore } from './types.ts';

/** What deleting one room's stats removes (or, in a dry run, would remove). */
export interface ForgottenRoom {
  roomId: string;
  dryRun: boolean;
  /** Rows removed per table. */
  deleted: Record<string, number>;
  /** UTC days the room had raw events on. */
  days: string[];
  /** Days whose rollups were rebuilt from the raw events that remain. */
  rebuiltDays: string[];
  /** Players who only ever appeared in this room: their records and names are gone. */
  playersRemoved: string[];
}

/** The room's stats reach days whose raw events were pruned: its rollups can't be rebuilt. */
export class PrunedDaysError extends Error {
  readonly days: string[];
  constructor(days: string[]) {
    super(`Raw events for ${days.join(', ')} are already pruned; those rollups can't be rebuilt.`);
    this.days = days;
  }
}

const DAILY = [
  'stats_daily',
  'stats_daily_players',
  'stats_daily_words',
  'stats_daily_settings',
] as const;
const RECAP = ['recap_nights', 'recap_awards', 'recap_records'] as const;

class DryRun extends Error {}

/**
 * Deletes a room's stats: its raw events, its frozen recap nights (with their awards and the
 * room's records), and the players who never appeared anywhere else. Every rolled-up day the room
 * touched is rolled up again from the raw events that remain, so totals drop with it. All of it
 * runs in one transaction; a dry run rolls that transaction back and reports the same counts.
 *
 * Raw events older than the retention are gone, and their days live only as rollups that can't
 * be split by room. A room with activity on such a day is refused with `PrunedDaysError`.
 */
export function forgetRoomStats(
  db: Db,
  stats: Pick<StatsStore, 'rollupDay'>,
  roomId: string,
  opts: { dryRun: boolean; now: number },
): ForgottenRoom {
  const sql = db.$client;
  let result: ForgottenRoom | undefined;
  try {
    sql.transaction(() => {
      result = run(sql, stats, roomId, opts);
      if (opts.dryRun) throw new DryRun();
    })();
  } catch (err) {
    if (!(err instanceof DryRun)) throw err;
  }
  return result!;
}

function run(
  sql: Db['$client'],
  stats: Pick<StatsStore, 'rollupDay'>,
  roomId: string,
  opts: { dryRun: boolean; now: number },
): ForgottenRoom {
  const pluck = <T>(text: string, ...args: unknown[]) =>
    sql
      .prepare(text)
      .pluck()
      .all(...args) as T[];
  const days = pluck<string>(
    'select distinct day from stats_events where room_id = ? order by day',
    roomId,
  );

  // Every day the room is known to have been active on, raw events or not.
  const activity = new Set(days);
  for (const ts of pluck<number>(
    `select started_at from recap_nights where room_id = ?
     union select ended_at from recap_nights where room_id = ?
     union select created_at from rooms where id = ?`,
    roomId,
    roomId,
    roomId,
  ))
    activity.add(dayOf(ts));
  const rolled = sql.prepare('select 1 from stats_rollups where day = ?').pluck();
  const hasRaw = sql.prepare('select 1 from stats_events where day = ? limit 1').pluck();
  const pruned = [...activity].filter((d) => rolled.get(d) && !hasRaw.get(d)).sort();
  if (pruned.length) throw new PrunedDaysError(pruned);

  // Everyone the room's events name, and how much of their running totals came from here.
  const games = new Map<string, number>();
  for (const id of pluck<string>(
    `select j.value from stats_events e, json_each(e.props, '$.players') j
     where e.room_id = ? and e.type = 'game.started' and j.type = 'text'`,
    roomId,
  ))
    games.set(id, (games.get(id) ?? 0) + 1);
  const joins = new Map<string, number>();
  for (const id of pluck<string>(
    `select player_id from stats_events
     where room_id = ? and type = 'player.joined' and player_id is not null`,
    roomId,
  ))
    joins.set(id, (joins.get(id) ?? 0) + 1);
  const candidates = new Set([
    ...games.keys(),
    ...joins.keys(),
    ...pluck<string>(
      `select player_id from stats_events where room_id = ? and player_id is not null
       union select j.value from stats_events e, json_each(e.props, '$.players') j
         where e.room_id = ? and e.type = 'game.ended' and j.type = 'text'
       union select player_id from recap_awards where room_id = ? and player_id != ''`,
      roomId,
      roomId,
      roomId,
    ),
  ]);

  const deleted: Record<string, number> = {};
  const count = (table: string, n: number) => {
    deleted[table] = (deleted[table] ?? 0) + n;
  };
  count(
    'stats_events',
    sql.prepare('delete from stats_events where room_id = ?').run(roomId).changes,
  );

  // Rolled-up days are rebuilt from what is left; a day with nothing left loses its rollup.
  const rebuiltDays: string[] = [];
  for (const day of days) {
    if (!rolled.get(day)) continue;
    for (const table of DAILY) sql.prepare(`delete from ${table} where day = ?`).run(day);
    sql.prepare('delete from stats_rollups where day = ?').run(day);
    if (hasRaw.get(day)) stats.rollupDay(day, opts.now);
    rebuiltDays.push(day);
  }

  for (const table of RECAP)
    count(table, sql.prepare(`delete from ${table} where room_id = ?`).run(roomId).changes);

  // A player stays if anything else still knows them: another room's events (as the actor or
  // named in them), a rollup of a pruned day, or another room's awards.
  const elsewhere = sql
    .prepare(
      `select exists(select 1 from stats_events where player_id = @id)
           or exists(select 1 from stats_events where instr(props, @id) > 0)
           or exists(select 1 from stats_daily_players where player_id = @id)
           or exists(select 1 from recap_awards where player_id = @id)`,
    )
    .pluck();
  const adjust = sql.prepare(
    `update stats_players set games_played = max(0, games_played - @games),
       rooms_joined = max(0, rooms_joined - @joins) where player_id = @id`,
  );
  const playersRemoved: string[] = [];
  count('stats_players', 0);
  count('stats_player_names', 0);
  for (const id of [...candidates].sort()) {
    if (elsewhere.get({ id })) {
      adjust.run({ id, games: games.get(id) ?? 0, joins: joins.get(id) ?? 0 });
      continue;
    }
    playersRemoved.push(id);
    for (const table of ['stats_players', 'stats_player_names'])
      count(table, sql.prepare(`delete from ${table} where player_id = ?`).run(id).changes);
  }

  return { roomId, dryRun: opts.dryRun, deleted, days, rebuiltDays, playersRemoved };
}
