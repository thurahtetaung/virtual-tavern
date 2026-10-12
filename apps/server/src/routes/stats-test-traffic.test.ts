import type { CodenamesView } from '@vt/game-codenames/logic';
import type { RecentNight, RoomSnapshot, StatsOverview, StatsPlayers } from '@vt/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import type { ForgottenRoom } from '../stats/forget-room.ts';
import { playerIdFromToken } from '../rooms/ids.ts';
import { type TestClient, connect, testApp, token } from '../test/helpers.ts';

const TOKEN = 'live-check-token';
const DAY = '2026-10-10';
const view = (s: RoomSnapshot) => s.game as CodenamesView;

describe('test traffic and deleting a room’s stats', () => {
  const cleanups: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    for (const fn of cleanups.reverse()) await fn();
    cleanups.length = 0;
  });

  async function start(statsIgnoreToken: string | null = TOKEN) {
    let clock = Date.parse(`${DAY}T19:00:00Z`);
    const app = testApp({ statsIgnoreToken, now: () => clock });
    cleanups.push(() => app.close());
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const url = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { password: 'hunter2' },
    });
    const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    const get = async <T>(path: string) =>
      (
        await app.inject({ method: 'GET', url: `/api/admin/stats/${path}`, headers: { cookie } })
      ).json<T>();
    const forget = (roomId: string, query = '', headers: Record<string, string> = { cookie }) =>
      app.inject({ method: 'DELETE', url: `/api/admin/stats/rooms/${roomId}${query}`, headers });
    const tick = (ms: number) => {
      clock += ms;
    };
    return { app, url, get, forget, tick };
  }

  /**
   * Opens a Codenames room and seats four players. `create`/`join`: the headers the room is
   * created with and the sockets connect with.
   */
  async function room(
    ctx: Awaited<ReturnType<typeof start>>,
    first: number,
    headers: { create?: Record<string, string>; join?: Record<string, string> } = {},
  ) {
    const { roomId } = (
      await ctx.app.inject({
        method: 'POST',
        url: '/api/rooms',
        payload: { gameId: 'codenames', token: token(first) },
        headers: headers.create ?? {},
      })
    ).json<{ roomId: string }>();
    const clients: TestClient[] = [];
    for (const [i, name] of ['Host', 'Ana', 'Ben', 'Cy'].entries()) {
      const c = await connect(ctx.url, undefined, headers.join);
      cleanups.push(() => void c.close());
      const res = await c.call('room:join', { roomId, token: token(first + i), name });
      expect(res).toEqual({ ok: true });
      clients.push(c);
    }
    await Promise.all(clients.map((c) => c.until((s) => s.players.length === 4)));
    return { roomId, clients };
  }

  /** Plays a game to the end (the assassin), then the host wraps up the night. */
  async function playAndWrap([host, ana, ben, cy]: TestClient[]) {
    await host!.call('game:action', { type: 'join-team', team: 'red', role: 'spymaster' });
    await ana!.call('game:action', { type: 'join-team', team: 'red', role: 'operative' });
    await ben!.call('game:action', { type: 'join-team', team: 'blue', role: 'spymaster' });
    await cy!.call('game:action', { type: 'join-team', team: 'blue', role: 'operative' });
    expect(await host!.call('game:action', { type: 'start' })).toEqual({ ok: true });
    const playing = view(await host!.until((s) => view(s).phase === 'playing'));
    const [spy, op] = playing.turn!.team === 'red' ? [host!, ana!] : [ben!, cy!];
    await spy.call('game:action', { type: 'give-clue', word: 'hint', count: 1 });
    await op.until((s) => view(s).turn?.stage === 'guess');
    const assassin = playing.board.findIndex((c) => c.kind === 'assassin');
    expect(await op.call('game:action', { type: 'guess', card: assassin })).toEqual({ ok: true });
    await host!.until((s) => view(s).phase === 'over');
    return host!.call('room:wrap', 0);
  }

  const totals = async (ctx: Awaited<ReturnType<typeof start>>) =>
    (await ctx.get<StatsOverview>('overview?range=today')).totals;
  const dry = async (ctx: Awaited<ReturnType<typeof start>>, roomId: string) =>
    (await ctx.forget(roomId, '?dryRun=1')).json<ForgottenRoom>();

  it('records nothing for a room opened and played by test traffic', async () => {
    const ctx = await start();
    const test = { 'x-vt-test': TOKEN };
    const { roomId, clients } = await room(ctx, 0, { create: test, join: test });
    expect(await playAndWrap(clients)).toMatchObject({
      ok: false,
      error: { code: 'nothing-to-wrap' },
    });
    expect(await totals(ctx)).toMatchObject({ roomsCreated: 0, gamesStarted: 0, uniquePlayers: 0 });
    expect((await ctx.get<StatsPlayers>('players')).players).toEqual([]);
    expect((await ctx.get<{ nights: RecentNight[] }>('nights')).nights).toEqual([]);
    expect((await dry(ctx, roomId)).deleted.stats_events).toBe(0);
    // The recap's own usage counts are skipped as well.
    await clients[0]!.call('room:recap', { scope: 'night', opened: true });
    expect((await dry(ctx, roomId)).deleted.stats_events).toBe(0);
  });

  it('still records a normal room, with its recap night', async () => {
    const ctx = await start();
    const { roomId, clients } = await room(ctx, 0);
    expect(await playAndWrap(clients)).toEqual({ ok: true });
    expect(await totals(ctx)).toMatchObject({ roomsCreated: 1, gamesStarted: 1, uniquePlayers: 4 });
    expect((await ctx.get<{ nights: RecentNight[] }>('nights')).nights).toHaveLength(1);
    expect((await dry(ctx, roomId)).deleted.stats_events).toBeGreaterThan(5);
  });

  it('marks a room as test traffic when a test socket joins it', async () => {
    const ctx = await start();
    const { roomId } = await room(ctx, 0, { join: { 'x-vt-test': TOKEN } });
    // Only the room's opening (a plain request) was recorded; none of the socket joins were.
    const res = await dry(ctx, roomId);
    expect(res.deleted.stats_events).toBe(1);
    // Only that event names the creator; nobody was sighted joining.
    const players = (await ctx.get<StatsPlayers>('players')).players;
    expect(players.map((p) => [p.id, p.aliases])).toEqual([[playerIdFromToken(token(0)), []]]);
  });

  it('ignores the header when the token is wrong or no token is set', async () => {
    for (const [serverToken, header] of [
      [TOKEN, 'not-the-token'],
      [null, TOKEN],
      [null, ''],
    ] as const) {
      const ctx = await start(serverToken);
      const h = { 'x-vt-test': header };
      const { clients } = await room(ctx, 0, { create: h, join: h });
      expect(await playAndWrap(clients)).toEqual({ ok: true });
      expect(await totals(ctx)).toMatchObject({ roomsCreated: 1, gamesStarted: 1 });
      expect((await ctx.get<{ nights: RecentNight[] }>('nights')).nights).toHaveLength(1);
    }
  });

  it('lets an admin delete a room’s stats, with a dry run first', async () => {
    const ctx = await start();
    const keep = await room(ctx, 0);
    expect(await playAndWrap(keep.clients)).toEqual({ ok: true });
    ctx.tick(60_000);
    // The second room seats players 10-13; 12 and 13 have also joined a third room.
    const { roomId, clients } = await room(ctx, 10);
    expect(await playAndWrap(clients)).toEqual({ ok: true });
    await room(ctx, 12);

    const before = await totals(ctx);
    expect(before).toMatchObject({ roomsCreated: 3, gamesStarted: 2, gamesFinished: 2 });
    const playersBefore = (await ctx.get<StatsPlayers>('players')).players.length;

    // Admin only, and only real room ids.
    expect((await ctx.forget(roomId, '', {})).statusCode).toBe(401);
    expect((await ctx.forget('not a room')).statusCode).toBe(400);

    const preview = await dry(ctx, roomId);
    expect(preview).toMatchObject({ roomId, dryRun: true, days: [DAY], rebuiltDays: [] });
    expect(preview.deleted).toMatchObject({ recap_nights: 1, stats_players: 2 });
    expect(preview.deleted.stats_events).toBeGreaterThan(5);
    expect(preview.playersRemoved.sort()).toEqual(
      [playerIdFromToken(token(10)), playerIdFromToken(token(11))].sort(),
    );
    // Nothing changed.
    expect(await totals(ctx)).toEqual(before);
    expect((await ctx.get<{ nights: RecentNight[] }>('nights')).nights).toHaveLength(2);

    const res = await ctx.forget(roomId);
    expect(res.statusCode).toBe(200);
    expect(res.json<ForgottenRoom>()).toEqual({ ...preview, dryRun: false });
    expect(await totals(ctx)).toMatchObject({
      roomsCreated: 2,
      gamesStarted: 1,
      gamesFinished: 1,
    });
    const players = (await ctx.get<StatsPlayers>('players')).players;
    expect(players).toHaveLength(playersBefore - 2);
    const ids = new Set(players.map((p) => p.id));
    for (const n of [0, 1, 2, 3, 12, 13]) expect(ids.has(playerIdFromToken(token(n)))).toBe(true);
    const nights = (await ctx.get<{ nights: RecentNight[] }>('nights')).nights;
    expect(nights.map((n) => n.roomId)).toEqual([keep.roomId]);
    // Deleting again finds nothing.
    expect((await dry(ctx, roomId)).deleted.stats_events).toBe(0);
  });
});
