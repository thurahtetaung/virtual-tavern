import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { tempDb, testApp, token } from './test/helpers.ts';

describe('http api', () => {
  let app = testApp();
  afterEach(async () => {
    await app.close();
    app = testApp();
  });

  it('reports health with the running version', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.json()).toEqual({ status: 'ok', version: 'test' });
  });

  it('lists games and the seeded starter word list', async () => {
    const games = (await app.inject({ method: 'GET', url: '/api/games' })).json<{ id: string }[]>();
    expect(games.map((g) => g.id)).toEqual(['codenames']);
    const lists = (await app.inject({ method: 'GET', url: '/api/word-lists' })).json<unknown>();
    expect(lists).toEqual([expect.objectContaining({ name: 'Starter', wordCount: 451 })]);
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
    expect((await login()).res.statusCode).toBe(429);
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
