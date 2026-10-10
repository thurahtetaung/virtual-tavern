import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { testApp, token } from '../test/helpers.ts';

const R2 = {
  accountId: 'acct123',
  accessKeyId: 'AKIDTEST',
  secretAccessKey: 'secret',
  bucket: 'vt-private',
};

describe('back room over HTTP', () => {
  const apps: ReturnType<typeof testApp>[] = [];
  afterEach(async () => {
    for (const a of apps.splice(0)) await a.close();
  });
  const make = (extra = {}) => {
    const app = testApp({ demoPrivateGame: true, r2: R2, ...extra });
    apps.push(app);
    return app;
  };

  async function adminCookie(app: ReturnType<typeof testApp>) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { password: 'hunter2' },
    });
    return `vt_admin=${res.cookies.find((c) => c.name === 'vt_admin')!.value}`;
  }
  async function unlock(app: ReturnType<typeof testApp>, password = 'speakeasy') {
    const res = await app.inject({
      method: 'POST',
      url: '/api/backroom/unlock',
      payload: { password },
    });
    const c = res.cookies.find((x) => x.name === 'vt_backroom');
    return { res, cookie: c ? `vt_backroom=${c.value}` : '' };
  }
  async function open(app: ReturnType<typeof testApp>, password = 'speakeasy') {
    await app.inject({
      method: 'PUT',
      url: '/api/admin/backroom/password',
      headers: { cookie: await adminCookie(app) },
      payload: { password },
    });
  }

  it('stays closed until the admin sets a password', async () => {
    const app = make();
    expect((await app.inject({ method: 'GET', url: '/api/backroom/status' })).json()).toEqual({
      open: false,
      unlocked: false,
    });
    expect((await unlock(app)).res.statusCode).toBe(503);
    const forbidden = await app.inject({
      method: 'PUT',
      url: '/api/admin/backroom/password',
      payload: { password: 'x' },
    });
    expect(forbidden.statusCode).toBe(401);
  });

  it('hides private games from locked players and shows them once unlocked', async () => {
    const app = make();
    await open(app);
    const ids = async (cookie = '') =>
      (await app.inject({ method: 'GET', url: '/api/games', headers: { cookie } }))
        .json<{ id: string }[]>()
        .map((g) => g.id);
    expect(await ids()).toEqual(['codenames', 'enigma']);
    expect((await unlock(app, 'nope')).res.statusCode).toBe(401);
    const { cookie } = await unlock(app);
    expect(await ids(cookie)).toEqual(['codenames', 'enigma', 'backroom-demo']);
  });

  it('only lets unlocked players create or look up private rooms', async () => {
    const app = make();
    await open(app);
    const create = (cookie = '') =>
      app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: { cookie },
        payload: { gameId: 'backroom-demo', token: token(1) },
      });
    expect((await create()).statusCode).toBe(400);
    const { cookie } = await unlock(app);
    const { roomId } = (await create(cookie)).json<{ roomId: string }>();
    const locked = await app.inject({ method: 'GET', url: `/api/rooms/${roomId}` });
    expect(locked.statusCode).toBe(403);
    expect(locked.body).not.toContain('backroom-demo');
    expect(
      (
        await app.inject({ method: 'GET', url: `/api/rooms/${roomId}`, headers: { cookie } })
      ).json(),
    ).toEqual({
      id: roomId,
      gameId: 'backroom-demo',
    });
  });

  it('hands unlocked players a short-lived signed R2 link, and nobody else anything', async () => {
    const app = make();
    await open(app);
    const url = '/api/backroom/assets/backroom-demo/cards/001.webp';
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
    const { cookie } = await unlock(app);
    const res = await app.inject({ method: 'GET', url, headers: { cookie } });
    expect(res.statusCode).toBe(302);
    const target = new URL(res.headers.location!);
    expect(target.host).toBe('acct123.r2.cloudflarestorage.com');
    expect(target.pathname).toBe('/vt-private/backroom-demo/cards/001.webp');
    expect(target.searchParams.get('X-Amz-Expires')).toBe('600');
    expect(target.searchParams.get('X-Amz-Signature')).toMatch(/^[0-9a-f]{64}$/);
    expect(res.headers['cache-control']).toBe('private, max-age=300');
    // Escapes and public games get nothing.
    const evil = await app.inject({
      method: 'GET',
      url: '/api/backroom/assets/backroom-demo/..%2F..%2Fx',
      headers: { cookie },
    });
    expect(evil.statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/backroom/assets/codenames/x.png',
          headers: { cookie },
        })
      ).statusCode,
    ).toBe(404);
  });

  it('signs everyone out when the admin asks', async () => {
    const app = make();
    await open(app);
    const { cookie } = await unlock(app);
    await app.inject({
      method: 'POST',
      url: '/api/admin/backroom/sign-out-all',
      headers: { cookie: await adminCookie(app) },
    });
    expect(
      (
        await app.inject({ method: 'GET', url: '/api/backroom/status', headers: { cookie } })
      ).json(),
    ).toEqual({
      open: true,
      unlocked: false,
    });
  });

  it('serves private game code only to unlocked players, never cacheably', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vt-web-'));
    mkdirSync(join(dir, 'backroom-assets'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>t</title>');
    writeFileSync(join(dir, 'backroom-assets', 'private-abc.js'), 'secret()');
    const app = make({ webDist: dir });
    await open(app);
    const url = '/backroom-assets/private-abc.js';
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
    const { cookie } = await unlock(app);
    const res = await app.inject({ method: 'GET', url, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    rmSync(dir, { recursive: true, force: true });
  });
});
