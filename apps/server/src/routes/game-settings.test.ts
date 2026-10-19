import type { AdminGamesResponse, GameSummary } from '@vt/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '../db/index.ts';
import { appSettings } from '../db/schema.ts';
import { GameSettingsStore } from '../game-settings.ts';
import { buildGames } from '../games/registry.ts';
import { MIGRATIONS, testApp, token } from '../test/helpers.ts';

/** Made-up categories: the real ones live only in the database. */
const LOUD = { id: 'loud', name: 'Loud', emoji: '📣' };
const QUIET = { id: 'quiet', name: 'Quiet', emoji: '🤫' };
const SECRET = { id: 'zz-hidden', name: 'Zz hidden', emoji: '🗝️' };

describe('game settings', () => {
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

  it('start empty: no categories anywhere until the admin adds some', async () => {
    const { call, games } = await setup();
    const admin = (await call('GET', '/api/admin/games')).json<AdminGamesResponse>();
    expect(admin.categories).toEqual([]);
    // Each game carries only the settings that apply to it.
    expect(admin.games.find((g) => g.gameId === 'codenames')).toEqual({
      gameId: 'codenames',
      name: 'Codenames',
      private: false,
      settings: { enabled: true, categories: [] },
    });
    expect(admin.games.find((g) => g.gameId === 'reverie')).toEqual({
      gameId: 'reverie',
      name: 'Reverie',
      private: true,
      settings: { enabled: true, categories: [], title: null },
    });
    expect(admin.games.find((g) => g.gameId === 'nightfall')).toMatchObject({
      settings: { enabled: true, categories: [], title: null, music: null },
      musicPhases: expect.arrayContaining([{ id: 'night', label: 'Night' }]) as object,
    });
    expect(admin.games.filter((g) => g.musicPhases).map((g) => g.gameId)).toEqual(['nightfall']);
    expect((await games()).every((g) => g.categories.length === 0)).toBe(true);
  });

  it('add, rename, order, tick and delete categories', async () => {
    const { call, games } = await setup();
    expect((await call('POST', '/api/admin/games/categories', LOUD)).statusCode).toBe(200);
    // Without an id, one is made from the name.
    const made = (
      await call('POST', '/api/admin/games/categories', { name: 'Very Quiet!', emoji: '🤫' })
    ).json<AdminGamesResponse>();
    expect(made.categories.map((c) => c.id)).toEqual(['loud', 'very-quiet']);
    expect(
      (await call('POST', '/api/admin/games/categories', { ...QUIET, name: 'loud' })).json(),
    ).toEqual({ error: { code: 'taken', message: 'There is already a category called "loud".' } });
    expect(
      (await call('POST', '/api/admin/games/categories', { ...LOUD, name: 'X' })).statusCode,
    ).toBe(400);
    expect(
      (await call('POST', '/api/admin/games/categories', { name: 'Y', emoji: 'abc' })).statusCode,
    ).toBe(400);

    await call('PUT', '/api/admin/games/categories/very-quiet', { name: 'Quiet', emoji: '🔇' });
    await call('PUT', '/api/admin/games/codenames', {
      categories: ['very-quiet', 'loud'],
    });
    await call('PUT', '/api/admin/games/echo', { categories: ['very-quiet'] });
    expect((await call('PUT', '/api/admin/games/echo', { categories: ['nope'] })).statusCode).toBe(
      400,
    );
    expect((await call('PUT', '/api/admin/games/nope', { categories: [] })).statusCode).toBe(404);

    let list = await games();
    expect(list.find((g) => g.id === 'codenames')!.categories).toEqual([
      { ...LOUD, order: 0 },
      { id: 'very-quiet', name: 'Quiet', emoji: '🔇', order: 1 },
    ]);

    // Reordering moves the chips; it must name every category once.
    expect(
      (await call('PUT', '/api/admin/games/categories/order', { ids: ['loud'] })).statusCode,
    ).toBe(400);
    await call('PUT', '/api/admin/games/categories/order', { ids: ['very-quiet', 'loud'] });
    list = await games();
    expect(list.find((g) => g.id === 'codenames')!.categories.map((c) => c.id)).toEqual([
      'very-quiet',
      'loud',
    ]);

    // Deleting takes the category off every game.
    const after = (
      await call('DELETE', '/api/admin/games/categories/very-quiet')
    ).json<AdminGamesResponse>();
    expect(after.categories).toEqual([LOUD]);
    expect(after.games.find((g) => g.gameId === 'codenames')!.settings.categories).toEqual([
      'loud',
    ]);
    expect(after.games.find((g) => g.gameId === 'echo')!.settings.categories).toEqual([]);
    expect((await call('DELETE', '/api/admin/games/categories/very-quiet')).statusCode).toBe(404);
    list = await games();
    expect(list.find((g) => g.id === 'echo')!.categories).toEqual([]);
  });

  it('never tell a locked browser about back-room games', async () => {
    const { call, games, backroom, admin } = await setup();
    for (const c of [LOUD, QUIET, SECRET]) await call('POST', '/api/admin/games/categories', c);
    await call('PUT', '/api/admin/games/codenames', { categories: ['quiet'] });
    await call('PUT', '/api/admin/games/reverie', { categories: ['zz-hidden', 'quiet'] });
    await call('PUT', '/api/admin/games/hoodwink', { categories: ['loud'] });

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
    await call('POST', '/api/admin/games/categories', LOUD);
    expect(await version()).toBe(before);
    await call('PUT', '/api/admin/games/codenames', { categories: ['loud'] });
    expect(await version()).not.toBe(before);
  });

  it('switch a game off: off the lists and chips, no new rooms, open rooms still open', async () => {
    const { app, call, games, admin } = await setup();
    await call('POST', '/api/admin/games/categories', LOUD);
    await call('PUT', '/api/admin/games/codenames', { categories: ['loud'] });
    const room = async (gameId: string) =>
      app.inject({ method: 'POST', url: '/api/rooms', payload: { gameId, token: token(1) } });
    const open = (await room('codenames')).json<{ roomId: string }>().roomId;

    const off = (
      await call('PUT', '/api/admin/games/codenames', { enabled: false })
    ).json<AdminGamesResponse>();
    expect(off.games.find((g) => g.gameId === 'codenames')!.settings).toEqual({
      enabled: false,
      categories: ['loud'],
    });
    // Listed as off (the page leaves it out), with no category, so no chip either.
    expect((await games()).find((g) => g.id === 'codenames')).toMatchObject({
      off: true,
      categories: [],
    });
    expect((await games()).some((g) => g.categories.length)).toBe(false);
    const refused = await room('codenames');
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toEqual({
      error: {
        code: 'game-off',
        message:
          'Codenames isn’t available right now. Pick another game, or ask the tavern keeper.',
      },
    });
    // The room opened before still answers its link.
    expect((await app.inject({ url: `/api/rooms/${open}` })).statusCode).toBe(200);
    // The admin may still playtest it.
    const playtestGames = (
      await app.inject({ url: '/api/admin/playtest/games', headers: { cookie: admin } })
    ).json<{ id: string; off?: true }[]>();
    expect(playtestGames.find((g) => g.id === 'codenames')).toMatchObject({ off: true });
    expect(playtestGames.find((g) => g.id === 'echo')).not.toHaveProperty('off');

    await call('PUT', '/api/admin/games/codenames', { enabled: true });
    expect((await games()).find((g) => g.id === 'codenames')).not.toHaveProperty('off');
    expect((await room('codenames')).statusCode).toBe(200);
  });

  it('never tell a locked browser about a back-room game switched off', async () => {
    const { app, call, games, backroom } = await setup();
    const before = await app.inject({ url: '/api/games' });
    await call('POST', '/api/admin/games/categories', SECRET);
    await call('PUT', '/api/admin/games/reverie', { enabled: false, categories: ['zz-hidden'] });
    const after = await app.inject({ url: '/api/games' });
    expect(after.body).toBe(before.body);
    expect(after.headers.etag).toBe(before.headers.etag);
    // Creating one is still "Unknown game" for a locked browser, never "switched off".
    const res = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { gameId: 'reverie', token: token(2) },
    });
    expect(res.json()).toEqual({ error: { code: 'bad-request', message: 'Unknown game.' } });
    expect((await games(backroom)).find((g) => g.id === 'reverie')).toMatchObject({ off: true });
  });

  it('refuse settings that don’t apply to a game', async () => {
    const { call } = await setup();
    const put = async (gameId: string, body: object) =>
      (await call('PUT', `/api/admin/games/${gameId}`, body)).json<{
        error?: { message: string };
      }>().error?.message;
    expect(await put('codenames', { title: 'X' })).toBe('Only back-room games have a title.');
    expect(await put('reverie', { music: null })).toBe('This game has no music.');
    expect(await put('codenames', { colour: 'red' })).toBeDefined();
  });

  it('keep titles and music where the release before reads them, and read theirs', () => {
    const db = openDb(':memory:', MIGRATIONS);
    const store = new GameSettingsStore(db, buildGames());
    store.update('nightfall', { title: 'Moonlit' });
    store.update('codenames', { enabled: false });
    const row = (key: string) =>
      db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value;
    // The release before reads titles from here, and knows nothing else.
    expect(JSON.parse(row('private_game_titles')!)).toEqual({ nightfall: 'Moonlit' });
    expect(JSON.parse(row('game_settings')!)).toEqual({
      categories: [],
      games: { codenames: { enabled: false } },
    });
    // What the release before wrote reads straight back.
    db.insert(appSettings)
      .values({
        key: 'private_game_music',
        value: JSON.stringify({ nightfall: { day: ['m.ogg'] } }),
      })
      .run();
    expect(store.get('nightfall')).toEqual({
      enabled: true,
      categories: [],
      title: 'Moonlit',
      music: { day: ['m.ogg'] },
    });
    expect(store.enabled('codenames')).toBe(false);
    db.$client.close();
  });
});
