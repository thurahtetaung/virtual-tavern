import type { AdminCategoriesResponse, GameSummary } from '@vt/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { testApp } from '../test/helpers.ts';

/** Made-up categories: the real ones live only in the database. */
const LOUD = { id: 'loud', name: 'Loud', emoji: '📣' };
const QUIET = { id: 'quiet', name: 'Quiet', emoji: '🤫' };
const SECRET = { id: 'zz-hidden', name: 'Zz hidden', emoji: '🗝️' };

describe('game categories', () => {
  const apps: ReturnType<typeof testApp>[] = [];
  afterEach(async () => {
    for (const app of apps.splice(0)) await app.close();
  });

  async function setup() {
    const app = testApp();
    apps.push(app);
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { password: 'hunter2' },
    });
    const admin = `vt_admin=${login.cookies.find((c) => c.name === 'vt_admin')!.value}`;
    await app.inject({
      method: 'PUT',
      url: '/api/admin/backroom/password',
      headers: { cookie: admin },
      payload: { password: 'speakeasy' },
    });
    const unlocked = await app.inject({
      method: 'POST',
      url: '/api/backroom/unlock',
      payload: { password: 'speakeasy' },
    });
    const backroom = `vt_backroom=${unlocked.cookies.find((c) => c.name === 'vt_backroom')!.value}`;
    const call = async (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: object) =>
      app.inject({ method, url, headers: { cookie: admin }, payload });
    const games = async (cookie?: string) =>
      (await app.inject({ url: '/api/games', headers: cookie ? { cookie } : {} })).json<
        GameSummary[]
      >();
    return { app, admin, backroom, call, games };
  }

  it('need the admin', async () => {
    const { app } = await setup();
    for (const [method, url] of [
      ['GET', '/api/admin/categories'],
      ['POST', '/api/admin/categories'],
      ['PUT', '/api/admin/categories/order'],
      ['PUT', '/api/admin/categories/loud'],
      ['DELETE', '/api/admin/categories/loud'],
      ['PUT', '/api/admin/game-categories/codenames'],
    ] as const) {
      const res = await app.inject({ method, url, payload: method === 'GET' ? undefined : {} });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('start empty: no categories anywhere until the admin adds some', async () => {
    const { call, games } = await setup();
    const admin = (await call('GET', '/api/admin/categories')).json<AdminCategoriesResponse>();
    expect(admin.categories).toEqual([]);
    expect(admin.games.find((g) => g.gameId === 'codenames')).toEqual({
      gameId: 'codenames',
      name: 'Codenames',
      private: false,
      categories: [],
    });
    expect((await games()).every((g) => g.categories.length === 0)).toBe(true);
  });

  it('add, rename, order, tick and delete categories', async () => {
    const { call, games } = await setup();
    expect((await call('POST', '/api/admin/categories', LOUD)).statusCode).toBe(200);
    // Without an id, one is made from the name.
    const made = (
      await call('POST', '/api/admin/categories', { name: 'Very Quiet!', emoji: '🤫' })
    ).json<AdminCategoriesResponse>();
    expect(made.categories.map((c) => c.id)).toEqual(['loud', 'very-quiet']);
    expect(
      (await call('POST', '/api/admin/categories', { ...QUIET, name: 'loud' })).json(),
    ).toEqual({ error: { code: 'taken', message: 'There is already a category called "loud".' } });
    expect((await call('POST', '/api/admin/categories', { ...LOUD, name: 'X' })).statusCode).toBe(
      400,
    );
    expect(
      (await call('POST', '/api/admin/categories', { name: 'Y', emoji: 'abc' })).statusCode,
    ).toBe(400);

    await call('PUT', '/api/admin/categories/very-quiet', { name: 'Quiet', emoji: '🔇' });
    await call('PUT', '/api/admin/game-categories/codenames', {
      categories: ['very-quiet', 'loud'],
    });
    await call('PUT', '/api/admin/game-categories/echo', { categories: ['very-quiet'] });
    expect(
      (await call('PUT', '/api/admin/game-categories/echo', { categories: ['nope'] })).statusCode,
    ).toBe(400);
    expect(
      (await call('PUT', '/api/admin/game-categories/nope', { categories: [] })).statusCode,
    ).toBe(404);

    let list = await games();
    expect(list.find((g) => g.id === 'codenames')!.categories).toEqual([
      { ...LOUD, order: 0 },
      { id: 'very-quiet', name: 'Quiet', emoji: '🔇', order: 1 },
    ]);

    // Reordering moves the chips; it must name every category once.
    expect((await call('PUT', '/api/admin/categories/order', { ids: ['loud'] })).statusCode).toBe(
      400,
    );
    await call('PUT', '/api/admin/categories/order', { ids: ['very-quiet', 'loud'] });
    list = await games();
    expect(list.find((g) => g.id === 'codenames')!.categories.map((c) => c.id)).toEqual([
      'very-quiet',
      'loud',
    ]);

    // Deleting takes the category off every game.
    const after = (
      await call('DELETE', '/api/admin/categories/very-quiet')
    ).json<AdminCategoriesResponse>();
    expect(after.categories).toEqual([LOUD]);
    expect(after.games.find((g) => g.gameId === 'codenames')!.categories).toEqual(['loud']);
    expect(after.games.find((g) => g.gameId === 'echo')!.categories).toEqual([]);
    expect((await call('DELETE', '/api/admin/categories/very-quiet')).statusCode).toBe(404);
    list = await games();
    expect(list.find((g) => g.id === 'echo')!.categories).toEqual([]);
  });

  it('never tell a locked browser about back-room games', async () => {
    const { call, games, backroom, admin } = await setup();
    for (const c of [LOUD, QUIET, SECRET]) await call('POST', '/api/admin/categories', c);
    await call('PUT', '/api/admin/game-categories/codenames', { categories: ['quiet'] });
    await call('PUT', '/api/admin/game-categories/reverie', { categories: ['zz-hidden', 'quiet'] });
    await call('PUT', '/api/admin/game-categories/hoodwink', { categories: ['loud'] });

    // Locked: only the public game's category, numbered among what it can see.
    const locked = await games();
    expect(locked.some((g) => g.private)).toBe(false);
    const lockedJson = JSON.stringify(locked);
    expect(lockedJson).not.toMatch(/zz|🗝/i);
    expect(lockedJson).not.toContain('Loud');
    expect(locked.find((g) => g.id === 'codenames')!.categories).toEqual([{ ...QUIET, order: 0 }]);

    // Unlocked (or the admin): every category its games use, in the admin's order.
    for (const cookie of [backroom, admin]) {
      const open = await games(cookie);
      expect(open.find((g) => g.id === 'reverie')!.categories).toEqual([
        { ...QUIET, order: 1 },
        { ...SECRET, order: 2 },
      ]);
      expect(open.find((g) => g.id === 'hoodwink')!.categories).toEqual([{ ...LOUD, order: 0 }]);
    }
  });

  it('change the game list’s version', async () => {
    const { app, call } = await setup();
    const version = async () =>
      (await app.inject({ url: '/api/backroom/status' })).json<{ versions: { games: string } }>()
        .versions.games;
    const before = await version();
    await call('POST', '/api/admin/categories', LOUD);
    expect(await version()).toBe(before);
    await call('PUT', '/api/admin/game-categories/codenames', { categories: ['loud'] });
    expect(await version()).not.toBe(before);
  });
});
