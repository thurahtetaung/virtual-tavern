import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CodenamesView } from '@vt/game-codenames/logic';
import { type RoundTableView, roundTableBot } from '@vt/game-round-table/logic';
import { createRng } from '@vt/game-sdk';
import type {
  LiveStats,
  PlaytestCreated,
  PlaytestGame,
  PlaytestStatus,
  RecapLine,
  RecentNight,
  RoomSnapshot,
} from '@vt/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { playerIdFromToken } from '../rooms/ids.ts';
import { type TestClient, connect, testApp, token } from '../test/helpers.ts';
import type { ForgottenRoom } from '../stats/forget-room.ts';

const DAY = '2026-10-12';

describe('admin playtests', () => {
  const cleanups: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    for (const fn of cleanups.reverse()) await fn();
    cleanups.length = 0;
  });

  async function start(extra: Parameters<typeof testApp>[0] = {}) {
    let clock = Date.parse(`${DAY}T19:00:00Z`);
    const app = testApp({ now: () => clock, ...extra });
    cleanups.push(() => app.close());
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const url = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
    const login = async () => {
      clock += 1;
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/login',
        payload: { password: 'hunter2' },
      });
      return `vt_admin=${res.cookies.find((c) => c.name === 'vt_admin')!.value}`;
    };
    const admin = await login();
    const as = (cookie?: string) => (cookie ? { cookie } : {});
    /** `cookie: null` sends no admin session. */
    /** A name ending in "*" is a bot seat. */
    const create = (gameId: string, names: string[], cookie: string | null = admin) =>
      app.inject({
        method: 'POST',
        url: '/api/admin/playtests',
        headers: as(cookie ?? undefined),
        payload: {
          gameId,
          seats: names.map((name) =>
            name.endsWith('*') ? { name: name.slice(0, -1), bot: true } : { name },
          ),
        },
      });
    const made = async (gameId: string, names: string[]) => {
      const res = await create(gameId, names);
      expect(res.statusCode).toBe(200);
      return res.json<PlaytestCreated>();
    };
    /** Opens a seat tab: a socket with the admin's cookie, joined with the seat's token. */
    const seat = async (
      roomId: string,
      s: { token?: string; name: string },
      cookie: string | undefined = admin,
    ) => {
      const c = await connect(url, cookie);
      cleanups.push(() => void c.close());
      const res = await c.call('room:join', { roomId, token: s.token!, name: s.name });
      return { c, res };
    };
    const tick = (ms: number) => {
      clock += ms;
    };
    return { app, url, admin, login, create, made, seat, tick, as };
  }

  it('is for admins only', async () => {
    const { app, create } = await start();
    expect((await create('codenames', ['Ana', 'Ben', 'Cy', 'Dee'], null)).statusCode).toBe(401);
    for (const [method, url] of [
      ['GET', '/api/admin/playtest/games'],
      ['GET', '/api/admin/playtests/amber-otter-lantern-7k3q'],
      ['DELETE', '/api/admin/playtests/amber-otter-lantern-7k3q'],
    ] as const) {
      expect((await app.inject({ method, url })).statusCode).toBe(401);
    }
  });

  it('lists every game, back-room ones included, with how many seats a playtest takes', async () => {
    const { app, admin } = await start();
    const games = (
      await app.inject({ url: '/api/admin/playtest/games', headers: { cookie: admin } })
    ).json<PlaytestGame[]>();
    expect(games.find((g) => g.id === 'codenames')).toEqual({
      id: 'codenames',
      name: 'Codenames',
      private: false,
      minPlayers: 4,
      maxSeats: 16,
      bots: 'none',
    });
    expect(games.find((g) => g.id === 'round-table')).toMatchObject({ bots: 'all' });
    const inquest = games.find((g) => g.id === 'inquest')!;
    expect(inquest.bots).toBe('some');
    expect(inquest.botNote).toMatch(/Forensic Scientist must be human/);
    expect(games.find((g) => g.id === 'royal-post')).toMatchObject({ private: true });
    expect(games.length).toBeGreaterThanOrEqual(11);
  });

  it('checks the seats', async () => {
    const { create } = await start();
    const bad = async (gameId: string, names: string[], code: string) => {
      const res = await create(gameId, names);
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: { code: string } }>().error.code).toBe(code);
    };
    await bad('codenames', ['Ana', 'Ben', 'Cy'], 'bad-seats');
    await bad('nope', ['Ana', 'Ben', 'Cy', 'Dee'], 'bad-request');
    await bad('codenames', ['Ana', 'Ben', 'Cy', ' ana '], 'bad-seats');
    await bad('codenames', ['Ana', 'Ben', 'Cy', ''], 'bad-request');
    await bad(
      'codenames',
      Array.from({ length: 17 }, (_, i) => `P${i}`),
      'bad-request',
    );
  });

  it('seats everyone up front, each with their own secret, and each tab gets only its own view', async () => {
    const { app, admin, made, seat } = await start();
    const names = ['Ana', 'Ben', 'Cy', 'Dee', 'Eli'];
    const pt = await made('round-table', names);
    expect(pt.seats.map((s) => s.name)).toEqual(names);
    for (const s of pt.seats) {
      expect(s.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(s.playerId).toBe(playerIdFromToken(s.token!));
    }
    const status = (
      await app.inject({ url: `/api/admin/playtests/${pt.roomId}`, headers: { cookie: admin } })
    ).json<PlaytestStatus>();
    expect(status).toMatchObject({
      roomId: pt.roomId,
      gameId: 'round-table',
      phase: 'lobby',
      playtest: { speed: 'normal', paused: false, bots: 0 },
    });
    expect(status.players.map((p) => [p.name, p.connected])).toEqual(names.map((n) => [n, false]));

    const tabs: TestClient[] = [];
    for (const s of pt.seats) {
      const { c, res } = await seat(pt.roomId, s);
      expect(res).toEqual({ ok: true });
      tabs.push(c);
    }
    const first = await tabs[0]!.until((s) => s.players.every((p) => p.connected));
    // Seat 1 hosts, and the join order is the seat order.
    expect(first.hostId).toBe(pt.seats[0]!.playerId);
    expect(first.meta).toMatchObject({ recap: false, playtest: { bots: 0 } });
    expect(await tabs[0]!.call('game:action', { type: 'start' })).toEqual({ ok: true });
    const views = await Promise.all(
      tabs.map((c) =>
        c
          .until((s) => (s.game as RoundTableView).role !== null)
          .then((s) => ({
            you: s.you,
            role: (s.game as RoundTableView).role,
          })),
      ),
    );
    expect(views.map((v) => v.you)).toEqual(pt.seats.map((s) => s.playerId));
    // Every seat sees its own card only: Good and Evil both dealt, never the same card to all.
    expect(new Set(views.map((v) => v.role?.loyalty)).size).toBe(2);
  });

  it('seats bots with ids nobody can join as, never as host, only for games that have them', async () => {
    const { app, admin, create, made, seat, as } = await start();
    const bad = async (gameId: string, names: string[], code: string) => {
      const res = await create(gameId, names);
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: { code: string } }>().error.code).toBe(code);
    };
    await bad('codenames', ['Ana', 'Ben*', 'Cy*', 'Dee*'], 'no-bots');
    await bad('round-table', ['Ana*', 'Ben*', 'Cy*', 'Dee*', 'Eli*'], 'bad-seats');

    // The first human seat hosts, even when a bot is listed first.
    const pt = await made('round-table', ['Ben*', 'Ana', 'Cy*', 'Dee*', 'Eli*']);
    const bots = pt.seats.filter((s) => s.bot);
    expect(bots.map((s) => s.name)).toEqual(['Ben', 'Cy', 'Dee', 'Eli']);
    expect(bots.every((s) => s.token === undefined)).toBe(true);
    const ana = pt.seats.find((s) => s.name === 'Ana')!;
    const tab = await seat(pt.roomId, ana);
    const snap = await tab.c.until((s) => s.players.length === 5);
    expect(snap.hostId).toBe(ana.playerId);
    expect(snap.players.filter((p) => p.bot).map((p) => [p.name, p.connected])).toEqual(
      bots.map((b) => [b.name, true]),
    );
    expect(snap.meta?.playtest).toMatchObject({ bots: 4, paused: false, speed: 'normal' });

    // Speed, pause, and bot seats in the lobby.
    const patch = (body: object) =>
      app.inject({
        method: 'PATCH',
        url: `/api/admin/playtests/${pt.roomId}`,
        headers: as(admin),
        payload: body,
      });
    expect((await patch({ speed: 'fast', paused: true })).statusCode).toBe(200);
    await tab.c.until((s) => s.meta?.playtest?.speed === 'fast' && s.meta.playtest.paused);
    const added = (await patch({ addBot: 'Fay' })).json<PlaytestStatus>();
    const fay = added.players.find((p) => p.name === 'Fay')!;
    expect(fay).toMatchObject({ bot: true, connected: true });
    expect((await patch({ removeBot: fay.id })).json<PlaytestStatus>().players).toHaveLength(5);
    expect((await patch({ removeBot: ana.playerId })).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: '/api/admin/playtests/amber-otter-lantern-7k3q',
          headers: as(admin),
          payload: { paused: false },
        })
      ).statusCode,
    ).toBe(404);

    // Inquest keeps the Forensic Scientist with the human host.
    const iq = await made('inquest', ['Ana', 'Ben*', 'Cy*', 'Dee*']);
    const host = await seat(iq.roomId, iq.seats[0]!);
    const view = (await host.c.until((s) => s.players.length === 4)).game as {
      settings: { fsMode: string; fsPick: string | null };
    };
    expect(view.settings).toMatchObject({ fsMode: 'host', fsPick: iq.seats[0]!.playerId });
  });

  it('looks like a dead link to anyone but the admin, link and all', async () => {
    const { app, url, made, seat } = await start();
    const pt = await made('codenames', ['Ana', 'Ben', 'Cy', 'Dee']);
    // The room lookup: 404 to a visitor, the playtest flag to the admin.
    expect((await app.inject({ url: `/api/rooms/${pt.roomId}` })).statusCode).toBe(404);
    // A leaked seat secret is useless without the admin session.
    const visitor = await connect(url);
    cleanups.push(() => void visitor.close());
    expect(
      await visitor.call('room:join', { roomId: pt.roomId, token: pt.seats[1]!.token, name: 'X' }),
    ).toMatchObject({ ok: false, error: { code: 'no-room' } });
    expect(
      await visitor.call('room:join', { roomId: pt.roomId, token: token(9), name: 'Mallory' }),
    ).toMatchObject({ ok: false, error: { code: 'no-room' } });
    expect((await seat(pt.roomId, pt.seats[0]!)).res).toEqual({ ok: true });
  });

  it('lets the admin play a back-room game with no unlock, in playtests only', async () => {
    const webDist = mkdtempSync(join(tmpdir(), 'vt-web-'));
    cleanups.push(() => rmSync(webDist, { recursive: true, force: true }));
    writeFileSync(join(webDist, 'index.html'), '<!doctype html>');
    mkdirSync(join(webDist, 'backroom-assets'));
    writeFileSync(join(webDist, 'backroom-assets', 'private.js'), 'export {};');
    const { app, admin, made, seat, as } = await start({ webDist });
    await app.inject({
      method: 'PUT',
      url: '/api/admin/backroom/password',
      headers: as(admin),
      payload: { password: 'speakeasy' },
    });
    const pt = await made('royal-post', ['Ana', 'Ben']);
    const room = await app.inject({ url: `/api/rooms/${pt.roomId}`, headers: as(admin) });
    expect(room.json()).toEqual({ id: pt.roomId, gameId: 'royal-post', playtest: true });
    expect((await seat(pt.roomId, pt.seats[0]!)).res).toEqual({ ok: true });

    // The game's code and art reach the admin without the unlock (the art store answers 503
    // here only because there is none in tests), and still reach nobody else.
    const code = '/backroom-assets/private.js';
    expect((await app.inject({ url: code, headers: as(admin) })).statusCode).toBe(200);
    expect((await app.inject({ url: code })).statusCode).toBe(404);
    const manifest = '/api/backroom/manifest/royal-post';
    expect((await app.inject({ url: manifest, headers: as(admin) })).statusCode).toBe(503);
    expect((await app.inject({ url: manifest })).statusCode).toBe(404);
    // The question decks and the game list stay unlock-only.
    expect(
      (await app.inject({ url: '/api/backroom/question-decks/hoodwink', headers: as(admin) }))
        .statusCode,
    ).toBe(404);
    const listed = (await app.inject({ url: '/api/games', headers: as(admin) })).json<
      { id: string }[]
    >();
    expect(listed.some((g) => g.id === 'royal-post')).toBe(false);

    // A normal back-room room still needs the unlock, admin or not.
    const unlock = await app.inject({
      method: 'POST',
      url: '/api/backroom/unlock',
      payload: { password: 'speakeasy' },
    });
    const backroom = `vt_backroom=${unlock.cookies.find((c) => c.name === 'vt_backroom')!.value}`;
    const normal = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: as(backroom),
      payload: { gameId: 'royal-post', token: token(1) },
    });
    const { roomId } = normal.json<{ roomId: string }>();
    const lookup = await app.inject({ url: `/api/rooms/${roomId}`, headers: as(admin) });
    expect(lookup.statusCode).toBe(403);
    const { res } = await seat(roomId, { token: token(2), name: 'Admin' });
    expect(res).toMatchObject({ ok: false, error: { code: 'backroom-locked' } });
    // And an unlocked visitor still can't get into the playtest.
    const { res: theirs } = await seat(pt.roomId, pt.seats[1]!, backroom);
    expect(theirs).toMatchObject({ ok: false, error: { code: 'no-room' } });
  });

  it('leaves "Sign everyone out" as it was for back-room rooms (test rooms too), but not for playtests', async () => {
    const { app, url, admin, made, seat, as } = await start({ statsIgnoreToken: 'probe' });
    await app.inject({
      method: 'PUT',
      url: '/api/admin/backroom/password',
      headers: as(admin),
      payload: { password: 'speakeasy' },
    });
    const unlock = await app.inject({
      method: 'POST',
      url: '/api/backroom/unlock',
      payload: { password: 'speakeasy' },
    });
    const backroom = `vt_backroom=${unlock.cookies.find((c) => c.name === 'vt_backroom')!.value}`;
    const test = { 'x-vt-test': 'probe' };
    const { roomId } = (
      await app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: { ...test, cookie: backroom },
        payload: { gameId: 'reverie', token: token(0) },
      })
    ).json<{ roomId: string }>();
    const member = await connect(url, backroom, test);
    cleanups.push(() => void member.close());
    expect(await member.call('room:join', { roomId, token: token(0), name: 'In' })).toEqual({
      ok: true,
    });
    const pt = await made('reverie', ['Ana', 'Ben', 'Cy']);
    const tab = await seat(pt.roomId, pt.seats[0]!);
    expect(tab.res).toEqual({ ok: true });
    const locked = new Promise<void>((resolve) => member.once('room:locked', () => resolve()));
    let tabLocked = false;
    tab.c.once('room:locked', () => (tabLocked = true));
    await app.inject({
      method: 'POST',
      url: '/api/admin/backroom/sign-out-all',
      headers: as(admin),
    });
    // Turned away at once, with no further move needed, exactly as before.
    await locked;
    expect(await tab.c.call('game:action', { type: 'sit', playing: true })).toEqual({ ok: true });
    expect(tabLocked).toBe(false);
  });

  it('locks the seats of a signed-out admin session at the next change', async () => {
    const { app, login, made, seat } = await start();
    const pt = await made('codenames', ['Ana', 'Ben', 'Cy', 'Dee']);
    const first = await login();
    const second = await login();
    const a = await seat(pt.roomId, pt.seats[0]!, first);
    const b = await seat(pt.roomId, pt.seats[1]!, second);
    expect([a.res, b.res]).toEqual([{ ok: true }, { ok: true }]);
    const locked = new Promise<void>((resolve) => a.c.once('room:locked', () => resolve()));
    await app.inject({ method: 'POST', url: '/api/admin/logout', headers: { cookie: first } });
    expect(
      await b.c.call('game:action', { type: 'join-team', team: 'red', role: 'spymaster' }),
    ).toEqual({ ok: true });
    await locked;
    expect(
      await a.c.call('game:action', { type: 'join-team', team: 'red', role: 'operative' }),
    ).toMatchObject({ ok: false, error: { code: 'not-joined' } });
  });

  it('ends on demand: every tab hears it, and the room is gone', async () => {
    const { app, admin, made, seat } = await start();
    const pt = await made('codenames', ['Ana', 'Ben', 'Cy', 'Dee']);
    const tabs = await Promise.all(pt.seats.slice(0, 2).map((s) => seat(pt.roomId, s)));
    const closed = tabs.map(
      ({ c }) => new Promise<void>((resolve) => c.once('room:closed', () => resolve())),
    );
    const del = () =>
      app.inject({
        method: 'DELETE',
        url: `/api/admin/playtests/${pt.roomId}`,
        headers: { cookie: admin },
      });
    expect((await del()).statusCode).toBe(200);
    await Promise.all(closed);
    expect((await del()).statusCode).toBe(404);
    expect(
      (await app.inject({ url: `/api/rooms/${pt.roomId}`, headers: { cookie: admin } })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ url: `/api/admin/playtests/${pt.roomId}`, headers: { cookie: admin } }))
        .statusCode,
    ).toBe(404);
  });

  it('leaves every stat, the live view, the recap and the hall of fame exactly as they were', async () => {
    const ctx = await start();
    const { app, url, admin, made, seat } = ctx;
    const get = async <T>(path: string) =>
      (
        await app.inject({
          method: 'GET',
          url: `/api/admin/stats/${path}`,
          headers: { cookie: admin },
        })
      ).json<T>();
    const view = (s: RoomSnapshot) => s.game as CodenamesView;
    /** Seats four players and plays to the assassin; returns the host's end snapshot. */
    const play = async (clients: TestClient[]) => {
      const [host, ana, ben, cy] = clients as [TestClient, TestClient, TestClient, TestClient];
      await host.call('game:action', { type: 'join-team', team: 'red', role: 'spymaster' });
      await ana.call('game:action', { type: 'join-team', team: 'red', role: 'operative' });
      await ben.call('game:action', { type: 'join-team', team: 'blue', role: 'spymaster' });
      await cy.call('game:action', { type: 'join-team', team: 'blue', role: 'operative' });
      expect(await host.call('game:action', { type: 'start' })).toEqual({ ok: true });
      const playing = view(await host.until((s) => view(s).phase === 'playing'));
      const [spy, op] = playing.turn!.team === 'red' ? [host, ana] : [ben, cy];
      await spy.call('game:action', { type: 'give-clue', word: 'hint', count: 1 });
      await op.until((s) => view(s).turn?.stage === 'guess');
      const assassin = playing.board.findIndex((c) => c.kind === 'assassin');
      expect(await op.call('game:action', { type: 'guess', card: assassin })).toEqual({ ok: true });
      return host.until((s) => view(s).phase === 'over');
    };

    // A real night first, so there is something to stay unchanged.
    const { roomId: real } = (
      await app.inject({
        method: 'POST',
        url: '/api/rooms',
        payload: { gameId: 'codenames', token: token(0) },
      })
    ).json<{ roomId: string }>();
    const crew: TestClient[] = [];
    for (const [i, name] of ['Host', 'Kim', 'Lee', 'Mo'].entries()) {
      const c = await connect(url);
      cleanups.push(() => void c.close());
      expect(await c.call('room:join', { roomId: real, token: token(i), name })).toEqual({
        ok: true,
      });
      crew.push(c);
    }
    await play(crew);
    expect(await crew[0]!.call('room:wrap', 0)).toEqual({ ok: true });

    const snapshot = async () => {
      const live = await get<LiveStats>('live');
      return {
        overview: await get('overview?range=today'),
        games: await get('games?range=today'),
        players: await get('players'),
        words: await get('words?range=today'),
        fun: await get('fun?range=today'),
        nights: await get<{ nights: RecentNight[] }>('nights'),
        live: {
          sockets: live.sockets,
          playersOnline: live.playersOnline,
          playersRecent: live.playersRecent,
          rooms: live.rooms.map((r) => r.id),
          byGame: live.byGame,
          playtests: live.playtests,
        },
      };
    };
    const before = await snapshot();
    expect(before.nights.nights).toHaveLength(1);
    expect(before.live).toMatchObject({ sockets: 4, playersOnline: 4, playtests: 0 });

    // The playtest: four seat tabs play a whole game, then the admin ends it.
    const pt = await made('codenames', ['Ana', 'Ben', 'Cy', 'Dee']);
    const tabs: TestClient[] = [];
    for (const s of pt.seats) {
      const { c, res } = await seat(pt.roomId, s);
      expect(res).toEqual({ ok: true });
      tabs.push(c);
    }
    const preview = new Promise<RecapLine[]>((resolve) =>
      tabs[1]!.once('room:playtestAwards', resolve),
    );
    const end = await play(tabs);
    expect(end.meta).toMatchObject({ phase: 'over', recap: false });
    // The award strip is previewed in memory for the end screen…
    const lines = await preview;
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.awardId.startsWith('codenames.'))).toBe(true);
    // …and a seat that reopens on the end screen still gets it.
    const again = await seat(pt.roomId, pt.seats[2]!);
    const reopened = await new Promise<RecapLine[]>((resolve) => {
      again.c.once('room:playtestAwards', resolve);
      void again.c.call('room:join', { roomId: pt.roomId, token: pt.seats[2]!.token, name: 'Cy' });
    });
    expect(reopened).toEqual(lines);
    // Mid-playtest, the live view counts it only as a playtest.
    expect((await snapshot()).live).toEqual({ ...before.live, playtests: 1 });
    // Recap requests answer as for any test room: nothing to show, nothing to wrap.
    expect(await tabs[0]!.call('room:wrap', 0)).toMatchObject({ ok: false });

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/admin/playtests/${pt.roomId}`,
      headers: { cookie: admin },
    });
    expect(del.statusCode).toBe(200);
    // Each seat tab drops its connection when it hears the playtest ended.
    for (const c of [...tabs, again.c]) c.close();
    await expect.poll(async () => (await get<LiveStats>('live')).sockets).toBe(4);
    expect(await snapshot()).toEqual(before);
    // Nothing of it was ever stored: no events, no players, no nights, awards or records.
    const dry = (
      await app.inject({
        method: 'DELETE',
        url: `/api/admin/stats/rooms/${pt.roomId}?dryRun=1`,
        headers: { cookie: admin },
      })
    ).json<ForgottenRoom>();
    expect(Object.values(dry.deleted).every((n) => n === 0)).toBe(true);
    expect(dry.playersRemoved).toEqual([]);
  });
});

describe('a playtest with bots', () => {
  const cleanups: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    for (const fn of cleanups.reverse()) await fn();
    cleanups.length = 0;
  });

  it('plays a whole Round Table game with four bots, and the stats never hear of it', async () => {
    const app = testApp({ botDelay: () => 5 });
    cleanups.push(() => app.close());
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const url = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { password: 'hunter2' },
    });
    const cookie = `vt_admin=${login.cookies.find((c) => c.name === 'vt_admin')!.value}`;
    const get = async <T>(path: string) =>
      (await app.inject({ url: `/api/admin/stats/${path}`, headers: { cookie } })).json<T>();
    const snapshot = async () => ({
      overview: await get('overview?range=today'),
      players: await get('players'),
      nights: await get('nights'),
      live: (({ rooms, playersOnline, byGame }) => ({ rooms, playersOnline, byGame }))(
        await get<LiveStats>('live'),
      ),
    });
    const before = await snapshot();

    const pt = (
      await app.inject({
        method: 'POST',
        url: '/api/admin/playtests',
        headers: { cookie },
        payload: {
          gameId: 'round-table',
          seats: [
            { name: 'Ana' },
            ...['Ben', 'Cy', 'Dee', 'Eli'].map((name) => ({ name, bot: true })),
          ],
        },
      })
    ).json<PlaytestCreated>();
    const me = pt.seats[0]!;
    const tab = await connect(url, cookie);
    cleanups.push(() => void tab.close());
    const awards = new Promise<RecapLine[]>((resolve) => tab.once('room:playtestAwards', resolve));
    expect(
      await tab.call('room:join', { roomId: pt.roomId, token: me.token, name: 'Ana' }),
    ).toEqual({ ok: true });
    // The human seat: starts the game, then plays its own turns as a bot would.
    expect(await tab.call('game:action', { type: 'start' })).toEqual({ ok: true });
    const rng = createRng(3);
    const done = (s: RoomSnapshot) => (s.game as RoundTableView).phase === 'over';
    // The bots' pace is capped at three moves a second, so a game takes a while.
    const until = Date.now() + 50_000;
    while (Date.now() < until && !done(tab.latest()!)) {
      const move = roundTableBot(tab.latest()!.game as RoundTableView, {
        me: me.playerId,
        now: Date.now(),
        rng,
        words: () => [],
      });
      if (move) await tab.call('game:action', move);
      else await new Promise((r) => setTimeout(r, 50));
    }
    expect(done(tab.latest()!)).toBe(true);
    expect((await awards).length).toBeGreaterThan(0);
    expect(await snapshot()).toEqual(before);
    const dry = (
      await app.inject({
        method: 'DELETE',
        url: `/api/admin/stats/rooms/${pt.roomId}?dryRun=1`,
        headers: { cookie },
      })
    ).json<ForgottenRoom>();
    expect(Object.values(dry.deleted).every((n) => n === 0)).toBe(true);
    // About 10 s alone, nearly all of it CPU, so it slows with a busy machine.
  }, 120_000);
});
