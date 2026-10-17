import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { connect, testApp, token } from '../test/helpers.ts';

// Made-up questions only: real decks are private and never committed.
const DECK = {
  name: 'Odd Facts',
  description: 'Strange but true.',
  questions: [{ prompt: 'The made-up capital of Testland is ___.', answer: 'zebracorn' }],
};

describe('an admin session has the back room', () => {
  const cleanups: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    for (const fn of cleanups.reverse()) await fn();
    cleanups.length = 0;
  });

  async function start({ password = true } = {}) {
    const webDist = mkdtempSync(join(tmpdir(), 'vt-web-'));
    cleanups.push(() => rmSync(webDist, { recursive: true, force: true }));
    writeFileSync(join(webDist, 'index.html'), '<!doctype html>');
    mkdirSync(join(webDist, 'backroom-assets'));
    writeFileSync(join(webDist, 'backroom-assets', 'private.js'), 'export {};');
    const app = testApp({ webDist });
    cleanups.push(() => app.close());
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const url = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { password: 'hunter2' },
    });
    const admin = `vt_admin=${login.cookies.find((c) => c.name === 'vt_admin')!.value}`;
    if (password) {
      await app.inject({
        method: 'PUT',
        url: '/api/admin/backroom/password',
        headers: { cookie: admin },
        payload: { password: 'speakeasy' },
      });
    }
    const get = (path: string, cookie?: string) =>
      app.inject({ url: path, headers: cookie ? { cookie } : {} });
    const createRoom = (gameId: string, cookie?: string, n = 0) =>
      app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: cookie ? { cookie } : {},
        payload: { gameId, token: token(n) },
      });
    const socket = async (cookie?: string) => {
      const c = await connect(url, cookie);
      cleanups.push(() => void c.close());
      return c;
    };
    return { app, admin, get, createRoom, socket };
  }

  it('lists, creates, joins and plays back-room games without the password', async () => {
    const { admin, get, createRoom, socket } = await start();
    const status = await get('/api/backroom/status', admin);
    expect(status.json()).toEqual({
      open: true,
      unlocked: true,
      admin: true,
      versions: { games: expect.any(String) as string, manifests: expect.any(Object) as object },
    });

    const listed = (await get('/api/games', admin)).json<{ id: string }[]>().map((g) => g.id);
    expect(listed).toContain('reverie');
    expect(listed).toContain('hoodwink');

    const made = await createRoom('reverie', admin);
    expect(made.statusCode).toBe(200);
    const { roomId } = made.json<{ roomId: string }>();
    expect((await get(`/api/rooms/${roomId}`, admin)).json()).toEqual({
      id: roomId,
      gameId: 'reverie',
      versions: { games: expect.any(String) as string, manifests: expect.any(Object) as object },
    });

    const c = await socket(admin);
    expect(await c.call('room:join', { roomId, token: token(0), name: 'Admin' })).toEqual({
      ok: true,
    });
    expect(await c.call('game:action', { type: 'sit', playing: true })).toEqual({ ok: true });
  });

  it('opens even before a back-room password is set', async () => {
    const { admin, get, createRoom } = await start({ password: false });
    expect((await get('/api/backroom/status', admin)).json()).toEqual({
      open: false,
      unlocked: true,
      admin: true,
      versions: { games: expect.any(String) as string, manifests: expect.any(Object) as object },
    });
    expect((await createRoom('royal-post', admin)).statusCode).toBe(200);
  });

  it('reads deck summaries, code, manifests and art', async () => {
    const { app, admin, get } = await start();
    const deck = await app.inject({
      method: 'POST',
      url: '/api/admin/question-decks',
      headers: { cookie: admin },
      payload: DECK,
    });
    expect(deck.statusCode).toBe(201);
    const decks = await get('/api/backroom/question-decks/hoodwink', admin);
    expect(decks.statusCode).toBe(200);
    expect(decks.json<{ name: string }[]>().map((d) => d.name)).toEqual(['Odd Facts']);
    expect(decks.body).not.toContain('zebracorn');
    expect((await get('/backroom-assets/private.js', admin)).statusCode).toBe(200);
    // The art store answers 503 only because there is none in tests: the gate let the admin by.
    expect((await get('/api/backroom/manifest/reverie', admin)).statusCode).toBe(503);
    expect((await get('/api/backroom/assets/reverie/cards/001.jpg', admin)).statusCode).toBe(503);
  });

  it('changes nothing for anyone else', async () => {
    const { admin, get, createRoom, socket } = await start();
    expect((await get('/api/backroom/status')).json()).toEqual({
      open: true,
      unlocked: false,
      versions: { games: expect.any(String) as string },
    });
    const listed = (await get('/api/games')).json<{ id: string }[]>().map((g) => g.id);
    expect(listed).not.toContain('reverie');
    expect((await createRoom('reverie')).statusCode).toBe(400);
    for (const path of [
      '/api/backroom/question-decks/hoodwink',
      '/backroom-assets/private.js',
      '/api/backroom/manifest/reverie',
      '/api/backroom/assets/reverie/cards/001.jpg',
    ]) {
      expect((await get(path)).statusCode, path).toBe(404);
    }

    const { roomId } = (await createRoom('reverie', admin)).json<{ roomId: string }>();
    expect((await get(`/api/rooms/${roomId}`)).statusCode).toBe(403);
    const visitor = await socket();
    expect(
      await visitor.call('room:join', { roomId, token: token(1), name: 'Mallory' }),
    ).toMatchObject({ ok: false, error: { code: 'backroom-locked' } });
  });

  it('locks again once the admin signs out', async () => {
    const { app, admin, get, createRoom, socket } = await start();
    const { roomId } = (await createRoom('reverie', admin)).json<{ roomId: string }>();
    const c = await socket(admin);
    expect(await c.call('room:join', { roomId, token: token(0), name: 'Admin' })).toEqual({
      ok: true,
    });
    await app.inject({ method: 'POST', url: '/api/admin/logout', headers: { cookie: admin } });

    // The old cookie is revoked on the server, so it opens nothing any more.
    expect((await get('/api/backroom/status', admin)).json()).toEqual({
      open: true,
      unlocked: false,
      versions: { games: expect.any(String) as string },
    });
    expect(
      (await get('/api/games', admin)).json<{ id: string }[]>().map((g) => g.id),
    ).not.toContain('reverie');
    expect((await get('/api/backroom/question-decks/hoodwink', admin)).statusCode).toBe(404);
    expect((await get(`/api/rooms/${roomId}`, admin)).statusCode).toBe(403);
    expect(await c.call('game:action', { type: 'sit', playing: true })).toMatchObject({
      ok: false,
      error: { code: 'backroom-locked' },
    });
  });
});
