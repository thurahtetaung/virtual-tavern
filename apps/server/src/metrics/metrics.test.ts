import { mkdirSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { StatsEvent } from '../stats/types.ts';
import { connect, tempDb, testApp, token } from '../test/helpers.ts';
import { Registry } from './registry.ts';
import { serveMetrics } from './server.ts';
import { TavernMetrics } from './tavern.ts';

/** The value of one sample line, e.g. `vt_live_rooms{game="echo"}`. */
function sample(text: string, series: string): number | undefined {
  const line = text.split('\n').find((l) => l.startsWith(`${series} `));
  return line === undefined ? undefined : Number(line.slice(series.length + 1));
}

const event = (type: string, gameId: string, props: Record<string, unknown> = {}): StatsEvent => ({
  id: 'x',
  ts: 0,
  day: '2026-01-01',
  type,
  gameId,
  roomId: 'room',
  playerId: null,
  props,
});

describe('metrics registry', () => {
  it('writes counters, histograms and gauges in the Prometheus text format', () => {
    const r = new Registry();
    const c = r.counter('t_total', 'A counter.');
    c.inc({ code: 'a"b\\c\nd' });
    c.inc({ code: 'a"b\\c\nd' }, 2);
    const h = r.histogram('t_seconds', 'A histogram.', [1, 5]);
    h.observe({ game: 'echo' }, 0.5);
    h.observe({ game: 'echo' }, 3);
    h.observe({ game: 'echo' }, 9);
    r.gauge('t_gauge', 'A gauge.', () => [[{}, 7]]);
    r.gauge('t_empty', 'Left out when it has nothing.', () => []);
    expect(r.render()).toBe(
      [
        '# HELP t_total A counter.',
        '# TYPE t_total counter',
        't_total{code="a\\"b\\\\c\\nd"} 3',
        '# HELP t_seconds A histogram.',
        '# TYPE t_seconds histogram',
        't_seconds_bucket{game="echo",le="1"} 1',
        't_seconds_bucket{game="echo",le="5"} 2',
        't_seconds_bucket{game="echo",le="+Inf"} 3',
        't_seconds_sum{game="echo"} 12.5',
        't_seconds_count{game="echo"} 3',
        '# HELP t_gauge A gauge.',
        '# TYPE t_gauge gauge',
        't_gauge 7',
        '',
      ].join('\n'),
    );
  });

  it('leaves out a metric that fails, and reports it', () => {
    const failed: string[] = [];
    const r = new Registry((name) => failed.push(name));
    r.gauge('t_broken', 'Throws.', () => {
      throw new Error('nope');
    });
    r.gauge('t_fine', 'Works.', () => [[{}, 1]]);
    expect(r.render()).toContain('t_fine 1');
    expect(failed).toEqual(['t_broken']);
  });
});

describe('tavern metrics', () => {
  const cleanups: (() => unknown)[] = [];
  afterEach(async () => {
    for (const fn of cleanups.reverse()) await fn();
    cleanups.length = 0;
  });

  function metrics() {
    const m = new TavernMetrics();
    cleanups.push(() => m.close());
    return m;
  }

  it('counts games, moves and active play time per game', () => {
    const m = metrics();
    m.attach({
      version: '1.2.3',
      gameIds: ['echo', 'codenames'],
      liveRooms: () => [],
      sockets: () => 0,
      playtests: () => 0,
      databasePath: ':memory:',
      offsiteStatusPath: null,
      now: Date.now,
    });
    m.event(event('game.started', 'echo'));
    m.event(event('action', 'echo'));
    m.event(event('action', 'echo'));
    m.event(event('game.ended', 'echo', { finished: true, durationMs: 400_000 }));
    m.event(event('game.started', 'echo'));
    m.event(event('game.ended', 'echo', { finished: false, durationMs: 0, reason: 'swept' }));
    m.event(event('player.joined', 'echo'));
    const text = m.render();
    expect(sample(text, 'vt_build_info{version="1.2.3"}')).toBe(1);
    expect(sample(text, 'vt_games_started_total{game="echo"}')).toBe(2);
    expect(sample(text, 'vt_games_started_total{game="codenames"}')).toBe(0);
    expect(sample(text, 'vt_game_actions_total{game="echo"}')).toBe(2);
    expect(sample(text, 'vt_games_ended_total{game="echo",outcome="finished"}')).toBe(1);
    expect(sample(text, 'vt_games_ended_total{game="echo",outcome="abandoned"}')).toBe(1);
    expect(sample(text, 'vt_game_active_seconds_bucket{game="echo",le="600"}')).toBe(2);
    expect(sample(text, 'vt_game_active_seconds_bucket{game="echo",le="300"}')).toBe(1);
    expect(sample(text, 'vt_game_active_seconds_sum{game="echo"}')).toBe(400);
  });

  it('keeps refusal codes to short words', () => {
    const m = metrics();
    m.refusal('echo', 'not-your-turn');
    m.refusal('echo', 'Some <weird> code from somewhere');
    const text = m.render();
    expect(sample(text, 'vt_game_refusals_total{game="echo",code="not-your-turn"}')).toBe(1);
    expect(sample(text, 'vt_game_refusals_total{game="echo",code="other"}')).toBe(1);
  });

  it('reads the database size and the off-site backup result when scraped', () => {
    const db = tempDb();
    cleanups.push(db.cleanup);
    const app = testApp({ databasePath: db.path, offsiteStatusPath: null });
    cleanups.push(() => app.close());
    const status = join(db.path, '..', 'backups', 'offsite-status.json');
    mkdirSync(join(status, '..'), { recursive: true });
    writeFileSync(
      status,
      JSON.stringify({ at: '2026-10-18T20:40:00.000Z', ok: true, bytes: 1234, totalBytes: 5678 }),
    );
    const m = metrics();
    m.attach({
      version: 'test',
      gameIds: [],
      liveRooms: () => [],
      sockets: () => 0,
      playtests: () => 0,
      databasePath: db.path,
      offsiteStatusPath: status,
      now: Date.now,
    });
    const text = m.render();
    expect(sample(text, 'vt_sqlite_file_bytes{file="main"}')).toBeGreaterThan(0);
    expect(sample(text, 'vt_offsite_backup_recorded')).toBe(1);
    expect(sample(text, 'vt_offsite_backup_ok')).toBe(1);
    expect(sample(text, 'vt_offsite_backup_bytes')).toBe(1234);
    expect(sample(text, 'vt_offsite_backup_total_bytes')).toBe(5678);
    expect(sample(text, 'vt_offsite_backup_last_run_timestamp_seconds')).toBe(
      Date.parse('2026-10-18T20:40:00.000Z') / 1000,
    );
    expect(sample(text, 'process_resident_memory_bytes')).toBeGreaterThan(0);
  });

  it('follows a live room, its broadcasts and refused moves, on the metrics port only', async () => {
    const m = metrics();
    const app = testApp({ metrics: m });
    cleanups.push(() => app.close());
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const url = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
    const server: Server = await serveMetrics(m, 0, '127.0.0.1');
    cleanups.push(() => new Promise((resolve) => server.close(resolve)));
    const metricsAddr = server.address();
    const metricsUrl =
      typeof metricsAddr === 'object' && metricsAddr ? `http://127.0.0.1:${metricsAddr.port}` : '';

    const { roomId } = (
      await app.inject({
        method: 'POST',
        url: '/api/rooms',
        payload: { gameId: 'codenames', token: token(0) },
      })
    ).json<{ roomId: string }>();
    const c = await connect(url);
    cleanups.push(() => c.close());
    expect(await c.call('room:join', { roomId, token: token(0), name: 'Ana' })).toEqual({
      ok: true,
    });
    const refused = await c.call('game:action', { type: 'no-such-move' });
    expect(refused.ok).toBe(false);

    const res = await fetch(`${metricsUrl}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const text = await res.text();
    expect(sample(text, 'vt_live_rooms{game="codenames"}')).toBe(1);
    expect(sample(text, 'vt_live_players{game="codenames"}')).toBe(1);
    expect(sample(text, 'vt_live_sockets')).toBe(1);
    expect(sample(text, 'vt_game_refusals_total{game="codenames",code="bad-action"}')).toBe(1);
    expect(sample(text, 'vt_room_state_broadcast_seconds_count')).toBeGreaterThan(0);
    expect(sample(text, 'vt_room_state_bytes_count')).toBeGreaterThan(0);
    expect(sample(text, 'vt_http_responses_total{status="2xx"}')).toBeGreaterThan(0);
    // Nothing about rooms or players is ever a label.
    expect(text).not.toContain(roomId);
    expect(text).not.toContain('Ana');

    expect((await fetch(`${metricsUrl}/`)).status).toBe(404);
    expect((await fetch(`${metricsUrl}/metrics`, { method: 'POST' })).status).toBe(404);
  });

  it('never serves metrics on the app port', async () => {
    const app = testApp({ metrics: metrics() });
    cleanups.push(() => app.close());
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('vt_');
  });

  it('leaves test traffic out', async () => {
    const m = metrics();
    const app = testApp({ metrics: m, statsIgnoreToken: 'tt' });
    cleanups.push(() => app.close());
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const url = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
    const { roomId } = (
      await app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: { 'x-vt-test': 'tt' },
        payload: { gameId: 'codenames', token: token(0) },
      })
    ).json<{ roomId: string }>();
    const c = await connect(url, undefined, { 'x-vt-test': 'tt' });
    cleanups.push(() => c.close());
    expect(await c.call('room:join', { roomId, token: token(0), name: 'Ana' })).toEqual({
      ok: true,
    });
    await c.call('game:action', { type: 'no-such-move' });
    const text = m.render();
    expect(sample(text, 'vt_live_rooms{game="codenames"}')).toBe(0);
    expect(sample(text, 'vt_live_sockets')).toBe(0);
    expect(text).not.toContain('vt_game_refusals_total{');
  });
});
