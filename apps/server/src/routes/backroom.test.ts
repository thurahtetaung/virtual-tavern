import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { R2Assets } from '../r2.ts';
import { testApp, token } from '../test/helpers.ts';

const R2 = {
  accountId: 'acct123',
  accessKeyId: 'AKIDTEST',
  secretAccessKey: 'secret',
  bucket: 'vt-private',
};

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);

/** A stand-in for the private bucket: signed GETs under /vt-private/<key>, with ranges. */
async function fakeBucket() {
  const objects = new Map([
    ['reverie/cards/001.jpg', { body: JPEG, type: 'image/jpeg' }],
    // A font uploaded by hand, without a proper type.
    ['reverie/fonts/display.woff2', { body: JPEG, type: 'application/octet-stream' }],
  ]);
  const hits: string[] = [];
  const server = createServer((req, res) => {
    const key = decodeURIComponent(req.url!.replace(/^\/vt-private\//, ''));
    hits.push(
      `${req.headers.authorization?.startsWith('AWS4-HMAC-SHA256') ? 'signed' : 'unsigned'} ${key}`,
    );
    const object = objects.get(key);
    if (!object) return res.writeHead(404).end();
    const body = object.body;
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range ?? '');
    const [start, end] = range ? [Number(range[1]), Number(range[2])] : [0, body.length - 1];
    res.writeHead(range ? 206 : 200, {
      'content-type': object.type,
      'content-length': end - start + 1,
      ...(range ? { 'content-range': `bytes ${start}-${end}/${body.length}` } : {}),
      etag: '"abc"',
    });
    res.end(body.subarray(start, end + 1));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const endpoint = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
  return { endpoint, hits, close: () => server.close() };
}

describe('back room over HTTP', () => {
  const apps: ReturnType<typeof testApp>[] = [];
  afterEach(async () => {
    for (const a of apps.splice(0)) await a.close();
  });
  const make = (extra = {}) => {
    const app = testApp({ r2: R2, ...extra });
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
      versions: { games: expect.any(String) as string },
    });
    expect((await unlock(app)).res.statusCode).toBe(503);
    const forbidden = await app.inject({
      method: 'PUT',
      url: '/api/admin/backroom/password',
      payload: { password: 'x' },
    });
    expect(forbidden.statusCode).toBe(401);
  });

  it('turns away repeated knocking in the bouncer’s voice, saying when to try again', async () => {
    const app = make();
    await open(app);
    for (let i = 0; i < 5; i++) expect((await unlock(app, 'nope')).res.statusCode).toBe(401);
    const { res } = await unlock(app);
    expect(res.statusCode).toBe(429);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.json()).toEqual({
      error: {
        code: 'rate-limited',
        message: expect.stringMatching(
          /^The bouncer's had enough knocking.*Try again in /,
        ) as string,
      },
    });
  });

  it('hides private games from locked players and shows them once unlocked', async () => {
    const app = make();
    await open(app);
    const ids = async (cookie = '') =>
      (await app.inject({ method: 'GET', url: '/api/games', headers: { cookie } }))
        .json<{ id: string }[]>()
        .map((g) => g.id);
    expect(await ids()).toEqual(['codenames', 'enigma', 'echo', 'masquerade', 'round-table']);
    expect((await unlock(app, 'nope')).res.statusCode).toBe(401);
    const { cookie } = await unlock(app);
    expect(await ids(cookie)).toEqual([
      'codenames',
      'enigma',
      'echo',
      'masquerade',
      'round-table',
      'reverie',
      'hoodwink',
      'royal-post',
      'masquerade-originals',
      'nightfall',
      'inquest',
      'seance',
      'hydra',
      'hogwarts',
      'tavern-brawl',
      'short-fuse',
      'starlight',
      'thorns',
      'iconic',
      'stampede',
      'jeweller',
      'going-once',
      'sketchy',
      'mosaic',
      'encore',
      'mission-control',
      'skyfire',
      'conveyor',
      'defuse',
      'cliffhanger',
    ]);
  });

  it('only lets unlocked players create or look up private rooms', async () => {
    const app = make();
    await open(app);
    const create = (cookie = '') =>
      app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: { cookie },
        payload: { gameId: 'reverie', token: token(1) },
      });
    expect((await create()).statusCode).toBe(400);
    const { cookie } = await unlock(app);
    const { roomId } = (await create(cookie)).json<{ roomId: string }>();
    const locked = await app.inject({ method: 'GET', url: `/api/rooms/${roomId}` });
    expect(locked.statusCode).toBe(403);
    expect(locked.body).not.toContain('reverie');
    expect(
      (
        await app.inject({ method: 'GET', url: `/api/rooms/${roomId}`, headers: { cookie } })
      ).json(),
    ).toEqual({
      id: roomId,
      gameId: 'reverie',
      versions: { games: expect.any(String) as string, manifests: expect.any(Object) as object },
    });
  });

  it('streams art to unlocked players, cached privately for good, and gives nobody else anything', async () => {
    const bucket = await fakeBucket();
    const app = make({ r2: { ...R2, endpoint: bucket.endpoint } });
    await open(app);
    const url = '/api/backroom/assets/reverie/cards/001.jpg';
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(404);
    expect(bucket.hits, 'locked requests never reach the bucket').toEqual([]);
    const { cookie } = await unlock(app);
    const res = await app.inject({ method: 'GET', url, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['etag']).toBe('"abc"');
    expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    expect(res.rawPayload.equals(JPEG)).toBe(true);
    // Only the server talks to the bucket, and it signs every request.
    expect(bucket.hits).toEqual(['signed reverie/cards/001.jpg']);
    // Partial fetches pass through.
    const part = await app.inject({ method: 'GET', url, headers: { cookie, range: 'bytes=2-5' } });
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 2-5/${JPEG.length}`);
    expect(part.rawPayload.equals(JPEG.subarray(2, 6))).toBe(true);
    // Missing objects, escapes and public games get nothing.
    const missing = await app.inject({
      method: 'GET',
      url: '/api/backroom/assets/reverie/cards/999.jpg',
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(404);
    const evil = await app.inject({
      method: 'GET',
      url: '/api/backroom/assets/reverie/..%2F..%2Fx',
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
    expect(bucket.hits).toHaveLength(3);
    // A display font stored without a type still goes out as a font.
    const font = await app.inject({
      method: 'GET',
      url: '/api/backroom/assets/reverie/fonts/display.woff2',
      headers: { cookie },
    });
    expect(font.statusCode).toBe(200);
    expect(font.headers['content-type']).toBe('font/woff2');
    expect(font.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    bucket.close();
  });

  it('never lets a cache keep an art refusal, whatever the reason', async () => {
    const bucket = await fakeBucket();
    const app = make({ r2: { ...R2, endpoint: bucket.endpoint } });
    await open(app);
    const { cookie } = await unlock(app);
    const refusals: [string, string, number][] = [
      ['locked', '/api/backroom/assets/reverie/manifest.json', 404],
      ['locked manifest', '/api/backroom/manifest/reverie', 404],
      ['unknown game', '/api/backroom/assets/nope/x.png', 404],
      ['public game', '/api/backroom/assets/codenames/x.png', 404],
      ['missing file', '/api/backroom/assets/reverie/cards/999.jpg', 404],
      ['bad path', '/api/backroom/assets/reverie/..%2F..%2Fx', 400],
      ['no route', '/api/backroom/assets/reverie', 404],
    ];
    for (const [why, url, status] of refusals) {
      const res = await app.inject({
        method: 'GET',
        url,
        headers: why.startsWith('locked') ? {} : { cookie },
      });
      expect(res.statusCode, why).toBe(status);
      expect(res.headers['cache-control'], why).toBe('private, no-store');
    }
    bucket.close();

    // Without asset storage, and when the bucket fails.
    const bare = make({ r2: null });
    await open(bare);
    const res = await bare.inject({
      method: 'GET',
      url: '/api/backroom/assets/reverie/cards/001.jpg',
      headers: { cookie: (await unlock(bare)).cookie },
    });
    expect(res.statusCode).toBe(503);
    expect(res.headers['cache-control']).toBe('private, no-store');
    const broken = make({ r2: { ...R2, endpoint: 'http://127.0.0.1:1' } });
    await open(broken);
    const failed = await broken.inject({
      method: 'GET',
      url: '/api/backroom/assets/reverie/cards/001.jpg',
      headers: { cookie: (await unlock(broken)).cookie },
    });
    expect(failed.statusCode).toBe(500);
    expect(failed.headers['cache-control']).toBe('private, no-store');
  });

  it('gives up on a bucket that never answers, without saying why', async () => {
    const stalled = createServer(() => {
      /* never replies */
    });
    await new Promise<void>((resolve) => stalled.listen(0, '127.0.0.1', resolve));
    const addr = stalled.address();
    const endpoint = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
    const r2 = { ...R2, endpoint, timeoutMs: 200 };
    await expect(new R2Assets(r2).object('reverie/cards/001.jpg')).rejects.toThrow(/timed out/);

    const app = make({ r2 });
    await open(app);
    const { cookie } = await unlock(app);
    const res = await app.inject({
      method: 'GET',
      url: '/api/backroom/manifest/reverie',
      headers: { cookie },
    });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: 'server-error', message: 'Something went wrong.' },
    });
    stalled.closeAllConnections();
    await new Promise((resolve) => stalled.close(resolve));
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
      versions: { games: expect.any(String) as string },
    });
  });

  it('serves private game code only to unlocked players, never to shared caches', async () => {
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
    expect(res.headers['cache-control']).toBe('private, max-age=31536000, immutable');
    const missing = await app.inject({
      method: 'GET',
      url: '/backroom-assets/gone.js',
      headers: { cookie },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['cache-control']).toBe('private, no-store');
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('the edge pass', () => {
  const apps: ReturnType<typeof testApp>[] = [];
  afterEach(async () => {
    for (const a of apps.splice(0)) await a.close();
  });
  const SECRET = 'edge-test-secret';
  let clock = 1_700_000_000_000;
  const make = (edgeSecret: string | null = SECRET) => {
    const app = testApp({ edgeSecret, now: () => clock });
    apps.push(app);
    return app;
  };
  const mac = (unlock: string) => createHmac('sha256', SECRET).update(unlock).digest('base64url');
  const cookieOf = (
    res: { cookies: { name: string; value: string; maxAge?: number }[] },
    name: string,
  ) => res.cookies.find((c) => c.name === name);

  async function setup(app: ReturnType<typeof testApp>) {
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { password: 'hunter2' },
    });
    const admin = `vt_admin=${cookieOf(login, 'vt_admin')!.value}`;
    await app.inject({
      method: 'PUT',
      url: '/api/admin/backroom/password',
      headers: { cookie: admin },
      payload: { password: 'speakeasy' },
    });
    return admin;
  }
  const unlock = (app: ReturnType<typeof testApp>) =>
    app.inject({ method: 'POST', url: '/api/backroom/unlock', payload: { password: 'speakeasy' } });

  it('comes with every unlock, signed over the unlock’s version and time, for as long', async () => {
    const app = make();
    await setup(app);
    const res = await unlock(app);
    const pass = cookieOf(res, 'vt_edge')!;
    expect(pass.value).toBe(`1.${clock}.${mac(`1.${clock}`)}`);
    expect(pass).toMatchObject({
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60,
    });
  });

  it('is never issued without an edge secret, and the version endpoint is not there', async () => {
    const app = make(null);
    await setup(app);
    expect(cookieOf(await unlock(app), 'vt_edge')).toBeUndefined();
    expect(
      (await app.inject({ method: 'GET', url: '/api/edge/backroom-version' })).statusCode,
    ).toBe(404);
  });

  it('tops up a browser unlocked before it existed, and only one with a current unlock', async () => {
    const app = make();
    await setup(app);
    const res = await unlock(app);
    const backroom = `vt_backroom=${cookieOf(res, 'vt_backroom')!.value}`;
    const pass = `vt_edge=${cookieOf(res, 'vt_edge')!.value}`;
    clock += 60_000;
    const get = (cookie: string, url = '/api/backroom/status') =>
      app.inject({ method: 'GET', url, headers: { cookie } });

    const topped = cookieOf(await get(backroom), 'vt_edge')!;
    expect(topped.value).toBe(cookieOf(res, 'vt_edge')!.value);
    // It lapses with the unlock, not a month from now.
    expect(topped.maxAge).toBe(30 * 24 * 60 * 60 - 60);
    expect(cookieOf(await get(`${backroom}; ${pass}`), 'vt_edge')).toBeUndefined();
    expect(
      cookieOf(await get(`${backroom}; vt_edge=1.2.forged`, '/api/games'), 'vt_edge'),
    ).toBeDefined();
    // No unlock, a bare pass, or an admin session alone get nothing.
    expect(cookieOf(await get(pass), 'vt_edge')).toBeUndefined();
    expect(cookieOf(await get(''), 'vt_edge')).toBeUndefined();

    // Once every unlock is signed out, the old one tops up nothing.
    const admin = await setup(app);
    expect(cookieOf(await get(admin), 'vt_edge')).toBeUndefined();
    expect(cookieOf(await get(backroom), 'vt_edge')).toBeUndefined();
  });

  it('goes when the back room is locked again', async () => {
    const app = make();
    await setup(app);
    const res = await unlock(app);
    const cookie = `vt_backroom=${cookieOf(res, 'vt_backroom')!.value}`;
    const lock = await app.inject({
      method: 'POST',
      url: '/api/backroom/lock',
      headers: { cookie },
    });
    const pass = cookieOf(lock, 'vt_edge')!;
    expect(pass.value).toBe('');
    expect(lock.headers['set-cookie']).toHaveLength(2);
  });

  it('tells the Worker the current version, uncached', async () => {
    const app = make();
    const version = () => app.inject({ method: 'GET', url: '/api/edge/backroom-version' });
    expect((await version()).json()).toEqual({ version: 0, open: false });
    const admin = await setup(app);
    const res = await version();
    expect(res.json()).toEqual({ version: 1, open: true });
    expect(res.headers['cache-control']).toBe('no-store');
    await app.inject({
      method: 'POST',
      url: '/api/admin/backroom/sign-out-all',
      headers: { cookie: admin },
    });
    expect((await version()).json()).toMatchObject({ version: 2 });
  });
});
