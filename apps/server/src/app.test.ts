import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { isLocalAddress } from './app.ts';
import { dbHealthy, openDb } from './db/index.ts';
import { MIGRATIONS, tempDb, testApp, token } from './test/helpers.ts';

describe('http api', () => {
  let app = testApp();
  afterEach(async () => {
    await app.close();
    app = testApp();
  });

  it('reports health with the running version', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', version: 'test' });
  });

  it('reports a database that no longer answers', () => {
    const db = openDb(':memory:', MIGRATIONS);
    expect(dbHealthy(db)).toBe(true);
    db.$client.close();
    expect(dbHealthy(db)).toBe(false);
  });

  it('answers malformed JSON with the shared error shape', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: { 'content-type': 'application/json' },
      payload: '{"gameId": ',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: { code: 'bad-request', message: expect.stringContaining('JSON') as string },
    });
  });

  it('hides the cause of server errors from the browser', async () => {
    const secret = 'R2 403 for reverie/cards/001.jpg';
    app.get('/api/boom', () => {
      throw new Error(secret);
    });
    const res = await app.inject({ method: 'GET', url: '/api/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: 'server-error', message: 'Something went wrong.' },
    });
    expect(res.body).not.toContain('R2');
  });

  it('lists games and the seeded starter word list', async () => {
    const games = (await app.inject({ method: 'GET', url: '/api/games' })).json<
      { id: string; wordLists: boolean }[]
    >();
    expect(games.map((g) => [g.id, g.wordLists])).toEqual([
      ['codenames', true],
      ['enigma', true],
      ['echo', true],
    ]);
    const lists = (await app.inject({ method: 'GET', url: '/api/word-lists' })).json<unknown>();
    expect(lists).toEqual([
      expect.objectContaining({
        name: 'Starter',
        wordCount: 451,
        games: ['codenames', 'enigma', 'echo'],
      }),
    ]);
  });

  it('creates rooms and looks them up', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { gameId: 'codenames', token: token(1) },
    });
    const { roomId } = res.json<{ roomId: string }>();
    expect(roomId).toMatch(/^[a-z]+-[a-z]+-[a-z]+-[a-z0-9]{4}$/);
    const found = await app.inject({ method: 'GET', url: `/api/rooms/${roomId}` });
    expect(found.json()).toEqual({ id: roomId, gameId: 'codenames' });
    expect((await app.inject({ method: 'GET', url: '/api/rooms/nope' })).statusCode).toBe(404);
    const bad = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { gameId: 'chess', token: token(1) },
    });
    expect(bad.statusCode).toBe(400);
  });
});

describe('admin api', () => {
  let app = testApp();
  afterEach(async () => {
    await app.close();
    app = testApp();
  });

  async function login(password = 'hunter2') {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { password },
    });
    const cookie = res.cookies.find((c) => c.name === 'vt_admin');
    return { res, cookie: cookie ? `vt_admin=${cookie.value}` : '' };
  }

  it('rejects wrong passwords and unauthenticated access', async () => {
    expect((await login('nope')).res.statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/admin/word-lists' })).statusCode).toBe(
      401,
    );
    const forged = await app.inject({
      method: 'GET',
      url: '/api/admin/word-lists',
      headers: { cookie: `vt_admin=${Date.now()}` },
    });
    expect(forged.statusCode).toBe(401);
  });

  it('rate-limits login attempts', async () => {
    for (let i = 0; i < 5; i++) await login('nope');
    const limited = await login();
    expect(limited.res.statusCode).toBe(429);
    expect(limited.res.json()).toEqual({
      error: { code: 'rate-limited', message: expect.stringContaining('retry') as string },
    });
  });

  it('ignores client-address headers from peers outside the local network', async () => {
    const attempt = (remoteAddress: string, headers: Record<string, string>) =>
      app.inject({
        method: 'POST',
        url: '/api/admin/login',
        remoteAddress,
        headers,
        payload: { password: 'nope' },
      });
    // Straight from the internet: a fresh cf-connecting-ip or x-forwarded-for on every request
    // does not buy a fresh rate-limit bucket.
    for (let i = 0; i < 5; i++) {
      const res = await attempt('203.0.113.9', {
        'cf-connecting-ip': `198.51.100.${i}`,
        'x-forwarded-for': `198.51.100.${i + 50}`,
      });
      expect(res.statusCode).toBe(401);
    }
    expect((await attempt('203.0.113.9', { 'cf-connecting-ip': '198.51.100.99' })).statusCode).toBe(
      429,
    );
    // Through the tunnel on the host (a local peer), each visitor gets their own bucket.
    for (let i = 0; i < 7; i++) {
      const res = await attempt('127.0.0.1', { 'cf-connecting-ip': `198.51.100.${i}` });
      expect(res.statusCode).toBe(401);
    }
    expect((await login()).res.statusCode).toBe(200);
  });

  it('keeps sessions across restarts but not across a password change', async () => {
    const { cookie } = await login();
    const headers = { cookie };
    const session = (a: typeof app) =>
      a
        .inject({ method: 'GET', url: '/api/admin/session', headers })
        .then((r) => r.json<unknown>());
    const restarted = testApp();
    expect(await session(restarted)).toEqual({ enabled: true, signedIn: true });
    await restarted.close();
    const changed = testApp({ adminPassword: 'hunter3' });
    expect(await session(changed)).toEqual({ enabled: true, signedIn: false });
    expect(
      (await changed.inject({ method: 'GET', url: '/api/admin/word-lists', headers })).statusCode,
    ).toBe(401);
    await changed.close();
  });

  it('manages word lists end to end', async () => {
    const { cookie } = await login();
    const headers = { cookie };
    expect(
      (await app.inject({ method: 'GET', url: '/api/admin/session', headers })).json(),
    ).toEqual({ enabled: true, signedIn: true });

    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/word-lists',
      headers,
      payload: { name: 'Pets', words: ['Dog', ' cat ', 'DOG', 'Hamster'] },
    });
    expect(created.statusCode).toBe(201);
    const list = created.json<{ id: string; words: string[]; wordCount: number }>();
    expect(list).toMatchObject({ words: ['Dog', 'cat', 'Hamster'], wordCount: 3 });

    const updated = await app.inject({
      method: 'PUT',
      url: `/api/admin/word-lists/${list.id}`,
      headers,
      payload: { name: 'Pets', description: 'Furry', words: ['Dog'] },
    });
    expect(updated.json()).toMatchObject({ description: 'Furry', words: ['Dog'] });

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/admin/word-lists/${list.id}`,
      headers,
    });
    expect(del.statusCode).toBe(204);
    const gone = await app.inject({
      method: 'GET',
      url: `/api/admin/word-lists/${list.id}`,
      headers,
    });
    expect(gone.statusCode).toBe(404);
  });

  it('tags word lists with the games that offer them', async () => {
    const { cookie } = await login();
    const headers = { cookie };
    const post = (payload: object) =>
      app.inject({ method: 'POST', url: '/api/admin/word-lists', headers, payload });
    const names = async (url: string) =>
      (await app.inject({ method: 'GET', url })).json<{ name: string }[]>().map((l) => l.name);

    const all = await post({ name: 'All', words: ['a'] });
    expect(all.json()).toMatchObject({ games: ['codenames', 'enigma', 'echo'] });
    const only = await post({ name: 'Enigma only', words: ['b'], games: ['enigma'] });
    expect(only.statusCode).toBe(201);
    expect(only.json()).toMatchObject({ games: ['enigma'] });

    expect(await names('/api/word-lists?game=enigma')).toEqual(['All', 'Enigma only', 'Starter']);
    expect(await names('/api/word-lists?game=codenames')).toEqual(['All', 'Starter']);
    expect(await names('/api/word-lists?game=chess')).toEqual([]);
    expect(await names('/api/word-lists')).toEqual(['All', 'Enigma only', 'Starter']);
    const echoOnly = await post({ name: 'Echo only', words: ['c'], games: ['echo'] });
    expect(echoOnly.statusCode).toBe(201);
    expect(await names('/api/word-lists?game=echo')).toEqual(['All', 'Echo only', 'Starter']);
    expect(await names('/api/word-lists?game=enigma')).toEqual(['All', 'Enigma only', 'Starter']);
    await app.inject({
      method: 'DELETE',
      url: `/api/admin/word-lists/${echoOnly.json<{ id: string }>().id}`,
      headers,
    });

    const id = only.json<{ id: string }>().id;
    const put = (payload: object) =>
      app.inject({ method: 'PUT', url: `/api/admin/word-lists/${id}`, headers, payload });
    expect((await put({ name: 'Mixed', words: ['b'], games: ['codenames'] })).json()).toMatchObject(
      {
        games: ['codenames'],
      },
    );
    // Omitting games on an update keeps the list's tags.
    expect((await put({ name: 'Mixed', words: ['c'] })).json()).toMatchObject({
      games: ['codenames'],
    });

    // Unknown games, games without word lists (the back-room game) and empty lists are refused.
    for (const games of [['chess'], ['codenames', 'reverie'], []]) {
      const res = await post({ name: 'Bad', words: ['x'], games });
      expect(res.statusCode, JSON.stringify(games)).toBe(400);
      expect((await put({ name: 'Bad', words: ['x'], games })).statusCode).toBe(400);
    }
    expect(await names('/api/word-lists')).toEqual(['All', 'Mixed', 'Starter']);
  });

  it('lets admins switch lists off and on, hiding disabled ones from players', async () => {
    const { cookie } = await login();
    const headers = { cookie };
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/word-lists',
      headers,
      payload: { name: 'Pets', words: ['Dog'] },
    });
    const id = created.json<{ id: string; enabled: boolean }>().id;
    expect(created.json()).toMatchObject({ enabled: true });
    const patch = (payload: object, h: Record<string, string> = headers, listId = id) =>
      app.inject({ method: 'PATCH', url: `/api/admin/word-lists/${listId}`, headers: h, payload });
    const names = async (url: string, h?: Record<string, string>) =>
      (await app.inject({ method: 'GET', url, headers: h }))
        .json<{ name: string; enabled: boolean }[]>()
        .map((l) => `${l.name}${l.enabled ? '' : ' (off)'}`);

    // Admin only, with the usual error shape.
    const anon = await patch({ enabled: false }, {});
    expect(anon.statusCode).toBe(401);
    expect(anon.json()).toEqual({ error: { code: 'unauthorized', message: 'Please sign in.' } });
    for (const bad of [{}, { enabled: 'no' }, { enabled: 0 }, []]) {
      const res = await patch(bad);
      expect(res.statusCode, JSON.stringify(bad)).toBe(400);
      expect(res.json()).toMatchObject({ error: { code: 'bad-request' } });
    }
    const missing = await patch({ enabled: false }, headers, 'missing');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ error: { code: 'not-found' } });

    const off = await patch({ enabled: false });
    expect(off.statusCode).toBe(200);
    expect(off.json()).toMatchObject({ id, name: 'Pets', enabled: false, wordCount: 1 });
    expect(await names('/api/word-lists')).toEqual(['Starter']);
    expect(await names('/api/word-lists?game=codenames')).toEqual(['Starter']);
    expect(await names('/api/admin/word-lists', headers)).toEqual(['Pets (off)', 'Starter']);
    const detail = await app.inject({ method: 'GET', url: `/api/admin/word-lists/${id}`, headers });
    expect(detail.json()).toMatchObject({ enabled: false, words: ['Dog'] });

    // A full update without `enabled` keeps the list switched off; with it, switches it.
    const put = (payload: object) =>
      app.inject({ method: 'PUT', url: `/api/admin/word-lists/${id}`, headers, payload });
    expect((await put({ name: 'Pets', words: ['Cat'] })).json()).toMatchObject({ enabled: false });
    expect((await put({ name: 'Pets', words: ['Cat'], enabled: true })).json()).toMatchObject({
      enabled: true,
    });
    expect((await patch({ enabled: false })).json()).toMatchObject({ enabled: false });
    expect((await patch({ enabled: true })).json()).toMatchObject({ enabled: true });
    expect(await names('/api/word-lists?game=enigma')).toEqual(['Pets', 'Starter']);
  });

  it('is disabled without a password', async () => {
    await app.close();
    app = testApp({ adminPassword: null });
    expect((await login()).res.statusCode).toBe(503);
    expect((await app.inject({ method: 'GET', url: '/api/admin/session' })).json()).toEqual({
      enabled: false,
      signedIn: false,
    });
  });
});

describe('web app caching', () => {
  const dir = tempDb();
  const webDist = join(dir.path, '..', 'web');
  mkdirSync(join(webDist, 'assets'), { recursive: true });
  writeFileSync(join(webDist, 'index.html'), '<!doctype html><title>tavern</title>');
  writeFileSync(join(webDist, 'assets', 'index-abc123.js'), 'console.log(1)');
  const app = testApp({ webDist });
  afterEach(() => app.close());

  it('caches hashed assets forever and revalidates HTML', async () => {
    const asset = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');

    for (const url of ['/', '/r/amber-fox-owl-1234']) {
      const page = await app.inject({ method: 'GET', url });
      expect(page.statusCode).toBe(200);
      expect(page.body).toContain('<title>tavern</title>');
      expect(page.headers['cache-control']).toBe('no-cache');
    }

    const missing = await app.inject({ method: 'GET', url: '/assets/index-gone.js' });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers['cache-control']).toBe('no-cache');
    dir.cleanup();
  });
});

describe('isLocalAddress', () => {
  it('recognises loopback, link-local and private ranges in both IP versions', () => {
    for (const ip of [
      '127.0.0.1',
      '::ffff:127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.1.1',
      '169.254.1.1',
      '::1',
      'fd7a:115c:a1e0::1',
      'fe80::1',
    ]) {
      expect(isLocalAddress(ip), ip).toBe(true);
    }
    for (const ip of [
      '203.0.113.9',
      '172.32.0.1',
      '11.0.0.1',
      '2606:4700::1',
      '',
      undefined,
      'x',
    ]) {
      expect(isLocalAddress(ip), String(ip)).toBe(false);
    }
  });
});
