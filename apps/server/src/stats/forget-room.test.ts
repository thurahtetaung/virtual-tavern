import { describe, expect, it } from 'vitest';
import { openDb } from '../db/index.ts';
import { MIGRATIONS } from '../test/helpers.ts';
import { dayOf, resolveWindow } from './days.ts';
import { PrunedDaysError, forgetRoomStats } from './forget-room.ts';
import { ulid } from './recorder.ts';
import { SqliteStatsStore } from './sqlite-store.ts';
import type { StatsEvent, Window } from './types.ts';

const D1 = '2026-10-01';
const D2 = '2026-10-02';
const D3 = '2026-10-03';
const at = (day: string, hour: number) => Date.parse(`${day}T${String(hour).padStart(2, '0')}:00Z`);
const win = (from: string, to: string) =>
  resolveWindow({ range: 'custom', from, to, bucket: 'day' }, D3, null) as Window;

function ev(
  ts: number,
  type: string,
  roomId: string,
  playerId: string | null = null,
  props: Record<string, unknown> = {},
): StatsEvent {
  return { id: ulid(ts), ts, day: dayOf(ts), type, gameId: 'codenames', roomId, playerId, props };
}

/** A room's game: opened, joined by everyone, started and finished. */
function game(roomId: string, day: string, players: string[]): StatsEvent[] {
  const t = at(day, 18);
  return [
    ev(t, 'room.created', roomId, players[0]),
    ...players.map((p) => ev(t + 1, 'player.joined', roomId, p, { name: p })),
    ev(t + 2, 'game.started', roomId, null, { players }),
    ev(t + 600_000, 'game.ended', roomId, null, {
      finished: true,
      durationMs: 600_000,
      players,
      winners: [],
    }),
  ];
}

function setup() {
  const db = openDb(':memory:', MIGRATIONS);
  const store = new SqliteStatsStore(db, { gameIds: ['codenames'] });
  const events = [
    ...game('real', D1, ['ana', 'ben']),
    ...game('check', D1, ['bot', 'ben']),
    ...game('check', D2, ['bot']),
  ];
  store.append(events);
  const sightings = events
    .filter((e) => e.type === 'player.joined')
    .map((e) => ({ playerId: e.playerId!, name: e.playerId!, now: e.ts, joinedRoom: true }));
  store.upsertPlayers(
    sightings,
    new Map([
      ['bot', 2],
      ['ben', 2],
      ['ana', 1],
    ]),
  );
  store.rollupDay(D1, at(D3, 1));
  store.rollupDay(D2, at(D3, 1));
  const totals = () => store.overview(win(D1, D2)).totals;
  const count = (sql: string, ...args: unknown[]) =>
    db.$client
      .prepare(sql)
      .pluck()
      .get(...args) as number;
  return { db, store, totals, count };
}

describe('forgetRoomStats', () => {
  it('deletes a room and rebuilds the rollups of the days it touched', () => {
    const { db, store, totals, count } = setup();
    expect(totals()).toMatchObject({ roomsCreated: 3, gamesStarted: 3, uniquePlayers: 3 });

    const dry = forgetRoomStats(db, store, 'check', { dryRun: true, now: at(D3, 2) });
    expect(dry).toEqual({
      roomId: 'check',
      dryRun: true,
      deleted: {
        stats_events: 9,
        recap_nights: 0,
        recap_awards: 0,
        recap_records: 0,
        stats_players: 1,
        stats_player_names: 1,
      },
      days: [D1, D2],
      rebuiltDays: [D1, D2],
      playersRemoved: ['bot'],
    });
    expect(totals()).toMatchObject({ roomsCreated: 3, gamesStarted: 3, uniquePlayers: 3 });
    expect(count('select count(*) from stats_events')).toBe(14);

    const res = forgetRoomStats(db, store, 'check', { dryRun: false, now: at(D3, 2) });
    expect(res).toEqual({ ...dry, dryRun: false });
    expect(totals()).toMatchObject({ roomsCreated: 1, gamesStarted: 1, uniquePlayers: 2 });
    // D2 had nothing else: its rollup is gone, not left behind.
    expect(count('select count(*) from stats_daily where day = ?', D2)).toBe(0);
    expect(count('select count(*) from stats_rollups where day = ?', D1)).toBe(1);
    // Ben also played in the real room: kept, with that room's totals only.
    expect(count("select games_played from stats_players where player_id = 'ben'")).toBe(1);
    expect(count("select rooms_joined from stats_players where player_id = 'ben'")).toBe(1);
    expect(count("select count(*) from stats_players where player_id = 'bot'")).toBe(0);
  });

  it('refuses a room whose days are only left as rollups', () => {
    const { db, store, totals, count } = setup();
    // Every raw event of D1 is pruned; only the room's recap night still says it played then.
    store.prune(D2);
    db.$client
      .prepare(
        `insert into recap_nights (room_id, night_key, started_at, ended_at, games, tone, card)
         values ('check', 'k', ?, ?, 1, 'cheeky', '{}')`,
      )
      .run(at(D1, 18), at(D1, 19));
    let err: unknown;
    try {
      forgetRoomStats(db, store, 'check', { dryRun: false, now: at(D3, 2) });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(PrunedDaysError);
    expect((err as PrunedDaysError).days).toEqual([D1]);
    expect(totals()).toMatchObject({ roomsCreated: 3, gamesStarted: 3 });
    expect(count("select count(*) from stats_events where room_id = 'check'")).toBe(4);
  });
});
