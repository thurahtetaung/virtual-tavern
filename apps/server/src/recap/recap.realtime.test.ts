import type { CodenamesView } from '@vt/game-codenames/logic';
import type { AckWith, GameRecap, RoomRecap, RoomSnapshot } from '@vt/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { type TestClient, connect, testApp, token } from '../test/helpers.ts';

const view = (s: RoomSnapshot) => s.game as CodenamesView;
type Recap = AckWith<RoomRecap | GameRecap | null>;

describe('night recap over the socket', () => {
  const cleanups: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    for (const fn of cleanups.reverse()) await fn();
    cleanups.length = 0;
  });

  async function room(names = ['Host', 'Ana', 'Ben', 'Cy']) {
    const app = testApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    cleanups.push(() => app.close());
    const addr = app.server.address();
    const url = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
    const { roomId } = (
      await app.inject({
        method: 'POST',
        url: '/api/rooms',
        payload: { gameId: 'codenames', token: token(0) },
      })
    ).json<{ roomId: string }>();
    const clients: TestClient[] = [];
    for (const [i, name] of names.entries()) {
      const c = await connect(url);
      cleanups.push(() => void c.close());
      expect(await c.call('room:join', { roomId, token: token(i), name })).toEqual({ ok: true });
      clients.push(c);
    }
    await Promise.all(clients.map((c) => c.until((s) => s.players.length === names.length)));
    const admin = async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/admin/login',
        payload: { password: 'hunter2' },
      });
      return `vt_admin=${res.cookies.find((c) => c.name === 'vt_admin')!.value}`;
    };
    return { app, url, roomId, clients, admin };
  }

  /** Seats four players and plays a game to the end: red's operative finds the assassin. */
  async function playToAssassin([host, ana, ben, cy]: TestClient[]) {
    await host!.call('game:action', { type: 'join-team', team: 'red', role: 'spymaster' });
    await ana!.call('game:action', { type: 'join-team', team: 'red', role: 'operative' });
    await ben!.call('game:action', { type: 'join-team', team: 'blue', role: 'spymaster' });
    await cy!.call('game:action', { type: 'join-team', team: 'blue', role: 'operative' });
    expect(await host!.call('game:action', { type: 'start' })).toEqual({ ok: true });
    const playing = view(await host!.until((s) => view(s).phase === 'playing'));
    const first = playing.turn!.team;
    const [spy, op] = first === 'red' ? [host!, ana!] : [ben!, cy!];
    await spy.call('game:action', { type: 'give-clue', word: 'hint', count: 1 });
    await op.until((s) => view(s).turn?.stage === 'guess');
    // Mid-game, nothing about this game is told.
    expect((await op.call('room:recap', { scope: 'game' })) as Recap).toEqual({
      ok: true,
      data: null,
    });
    const assassin = view(host!.latest()!).board.findIndex((c) => c.kind === 'assassin');
    expect(await op.call('game:action', { type: 'guess', card: assassin })).toEqual({ ok: true });
    await Promise.all([host, ana, ben, cy].map((c) => c!.until((s) => s.meta?.phase === 'over')));
    return { guesser: op.latest()!.you };
  }

  it('serves the finished game strip and the night card to members', async () => {
    const { clients } = await room();
    const [host, ana] = clients;
    expect(host!.latest()!.meta).toMatchObject({ phase: 'lobby', recap: true, tone: 'cheeky' });
    const { guesser } = await playToAssassin(clients);

    const game = (await ana!.call('room:recap', { scope: 'game' })) as Recap;
    expect(game.ok).toBe(true);
    const strip = (game as { data: GameRecap }).data;
    expect(strip.lines.length).toBeGreaterThan(0);
    expect(strip.lines.length).toBeLessThanOrEqual(3);
    // The assassin hit on the first guess makes the strip (as a speedrun or an assassin magnet).
    expect(strip.lines.find((l) => /speedrun|assassin-magnet/.test(l.awardId))?.players).toEqual([
      guesser,
    ]);
    expect(strip.lines.every((l) => /\{p:[\w-]+\}/.test(l.text) || l.players.length === 0)).toBe(
      true,
    );

    const night = (await host!.call('room:recap', { scope: 'night', opened: true })) as Recap;
    const card = (night as { data: RoomRecap }).data;
    expect(card.games).toHaveLength(1);
    expect(card.status).toBe('live');
    expect(card.players.map((p) => p.name).sort()).toEqual(['Ana', 'Ben', 'Cy', 'Host']);
    expect(card.games[0]!.history.length).toBeGreaterThan(0);
    // Everyone who played gets a line.
    const covered = new Set(
      [...card.awards, ...(card.mvp ? [card.mvp] : [])].flatMap((a) => a.players),
    );
    for (const p of card.players) expect(covered.has(p.id), p.name).toBe(true);
  });

  it('refuses a kicked player and leaves them off the card', async () => {
    const { clients } = await room();
    const [host, , , cy] = clients;
    await playToAssassin(clients);
    const cyId = cy!.latest()!.you;
    const kicked = new Promise<void>((resolve) => cy!.once('room:kicked', () => resolve()));
    expect(await host!.call('room:kick', cyId)).toEqual({ ok: true });
    await kicked;
    expect(await cy!.call('room:recap', { scope: 'night' })).toMatchObject({
      ok: false,
      error: { code: 'not-joined' },
    });
    const card = (
      (await host!.call('room:recap', { scope: 'night' })) as unknown as { data: RoomRecap }
    ).data;
    expect(JSON.stringify(card)).not.toContain(cyId);
  });

  it('only the host wraps up or changes the tone; a wrap reaches every device', async () => {
    const { clients } = await room();
    const [host, ana] = clients;
    // Nothing to wrap before a game has finished.
    expect(await host!.call('room:wrap', 0)).toMatchObject({
      ok: false,
      error: { code: 'nothing-to-wrap' },
    });
    await playToAssassin(clients);
    expect(await ana!.call('room:wrap', 0)).toMatchObject({
      ok: false,
      error: { code: 'not-host' },
    });
    expect(await ana!.call('room:recap-tone', 'wholesome', 0)).toMatchObject({
      ok: false,
      error: { code: 'not-host' },
    });

    expect(await host!.call('room:recap-tone', 'wholesome', -60)).toEqual({ ok: true });
    await ana!.until((s) => s.meta?.tone === 'wholesome');
    const gentle = (
      (await ana!.call('room:recap', { scope: 'night' })) as unknown as { data: RoomRecap }
    ).data;
    expect(gentle.tone).toBe('wholesome');

    const wrapped = Promise.all(
      clients.map((c) => new Promise<string>((resolve) => c.once('room:wrapped', resolve))),
    );
    expect(await host!.call('room:wrap', -60)).toEqual({ ok: true });
    const keys = await wrapped;
    expect(new Set(keys).size).toBe(1);
    const card = (
      (await ana!.call('room:recap', { scope: 'night' })) as unknown as { data: RoomRecap }
    ).data;
    expect(card.status).toBe('wrapped');
    expect(card.nightKey).toBe(keys[0]);
    expect(card.tzOffsetMin).toBe(-60);
  });

  it('the admin switch turns recaps off everywhere', async () => {
    const { app, clients, admin } = await room();
    const [host] = clients;
    const cookie = await admin();
    expect(
      (await app.inject({ method: 'GET', url: '/api/admin/recap', headers: { cookie } })).json(),
    ).toEqual({ enabled: true });
    expect((await app.inject({ method: 'GET', url: '/api/admin/recap' })).statusCode).toBe(401);
    const off = await app.inject({
      method: 'PUT',
      url: '/api/admin/recap',
      headers: { cookie },
      payload: { enabled: false },
    });
    expect(off.json()).toEqual({ enabled: false });
    expect(await host!.call('room:recap', { scope: 'night' })).toMatchObject({
      ok: false,
      error: { code: 'recap-off' },
    });
    // The next snapshot says so, and the shell hides the chip, the strip and the wrap-up.
    await host!.call('game:action', { type: 'join-team', team: 'red', role: 'spymaster' });
    await host!.until((s) => s.meta?.recap === false);
  });
});

describe('night recap in the back room', () => {
  it('is refused once the unlock is gone', async () => {
    const app = testApp();
    await app.listen({ port: 0, host: '127.0.0.1' });
    try {
      const addr = app.server.address();
      const url = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
      const login = await app.inject({
        method: 'POST',
        url: '/api/admin/login',
        payload: { password: 'hunter2' },
      });
      const adminCookie = `vt_admin=${login.cookies.find((c) => c.name === 'vt_admin')!.value}`;
      await app.inject({
        method: 'PUT',
        url: '/api/admin/backroom/password',
        headers: { cookie: adminCookie },
        payload: { password: 'speakeasy' },
      });
      const unlocked = await app.inject({
        method: 'POST',
        url: '/api/backroom/unlock',
        payload: { password: 'speakeasy' },
      });
      const cookie = `vt_backroom=${unlocked.cookies.find((c) => c.name === 'vt_backroom')!.value}`;
      const { roomId } = (
        await app.inject({
          method: 'POST',
          url: '/api/rooms',
          headers: { cookie },
          payload: { gameId: 'nightfall', token: token(0) },
        })
      ).json<{ roomId: string }>();
      const member = await connect(url, cookie);
      try {
        expect(await member.call('room:join', { roomId, token: token(0), name: 'In' })).toEqual({
          ok: true,
        });
        expect(await member.call('room:recap', { scope: 'night' })).toMatchObject({ ok: true });
        await app.inject({
          method: 'POST',
          url: '/api/admin/backroom/sign-out-all',
          headers: { cookie: adminCookie },
        });
        const res = await member.call('room:recap', { scope: 'night' });
        expect(res.ok).toBe(false);
        expect(['backroom-locked', 'not-joined']).toContain(
          (res as { error: { code: string } }).error.code,
        );
      } finally {
        member.close();
      }
    } finally {
      await app.close();
    }
  });
});
