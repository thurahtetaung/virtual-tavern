import { afterEach, describe, expect, it } from 'vitest';
import { testApp, token } from '../test/helpers.ts';

type App = ReturnType<typeof testApp>;

describe('versioned game and word lists', () => {
  const apps: App[] = [];
  afterEach(async () => {
    for (const a of apps.splice(0)) await a.close();
  });
  const make = (version = 'test') => {
    const app = testApp({ version });
    apps.push(app);
    return app;
  };

  async function admin(app: App) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { password: 'hunter2' },
    });
    return `vt_admin=${res.cookies.find((c) => c.name === 'vt_admin')!.value}`;
  }
  /** Opens the back room and returns an unlocked browser's cookie. */
  async function unlocked(app: App) {
    await app.inject({
      method: 'PUT',
      url: '/api/admin/backroom/password',
      headers: { cookie: await admin(app) },
      payload: { password: 'speakeasy' },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/backroom/unlock',
      payload: { password: 'speakeasy' },
    });
    return `vt_backroom=${res.cookies.find((c) => c.name === 'vt_backroom')!.value}`;
  }
  const get = (app: App, url: string, headers: Record<string, string> = {}) =>
    app.inject({ method: 'GET', url, headers });
  const gamesVersion = async (app: App, cookie = '') =>
    (await get(app, '/api/backroom/status', { cookie })).json<{ versions: { games: string } }>()
      .versions.games;
  const ids = (res: { json: <T>() => T }) => res.json<{ id: string }[]>().map((g) => g.id);

  it('keeps a current version for a day and revalidates anything else', async () => {
    const app = make();
    const v = await gamesVersion(app);
    const kept = await get(app, `/api/games?v=${v}`);
    expect(kept.statusCode).toBe(200);
    expect(kept.headers['cache-control']).toBe('private, max-age=86400');
    expect(kept.headers.vary).toBe('Cookie');
    const etag = kept.headers.etag as string;
    expect(etag).toMatch(/^"[\w-]+"$/);
    for (const url of ['/api/games', '/api/games?v=old']) {
      const res = await get(app, url);
      expect(res.headers['cache-control'], url).toBe('private, no-cache');
      expect(res.headers.etag, url).toBe(etag);
    }
    expect((await get(app, '/api/games', { 'if-none-match': etag })).statusCode).toBe(304);
    // The admin session carries the same version.
    expect(
      (await get(app, '/api/admin/session')).json<{ versions: { games: string } }>().versions,
    ).toEqual({ games: v });
  });

  it('switches the game list at once on unlock and on lock, both ways', async () => {
    const app = make();
    const locked = await gamesVersion(app);
    const cookie = await unlocked(app);
    const open = await gamesVersion(app, cookie);
    expect(open).not.toBe(locked);
    const lockedList = await get(app, `/api/games?v=${locked}`);
    const lockedTag = lockedList.headers.etag as string;
    expect(lockedList.json<{ private: boolean }[]>().some((g) => g.private)).toBe(false);

    // Unlocked: a cached locked list's tag never gets a 304; the private games come at once.
    const opened = await get(app, `/api/games?v=${open}`, { cookie, 'if-none-match': lockedTag });
    expect(opened.statusCode).toBe(200);
    expect(opened.headers['cache-control']).toBe('private, max-age=86400');
    expect(ids(opened)).toContain('reverie');
    const openTag = opened.headers.etag as string;

    // Locked again (here, the admin's "Sign everyone out", which leaves the cookie as it was):
    // the status names the locked version, and the unlocked tag gets the locked list.
    await app.inject({
      method: 'POST',
      url: '/api/admin/backroom/sign-out-all',
      headers: { cookie: await admin(app) },
    });
    expect(await gamesVersion(app, cookie)).toBe(locked);
    const shut = await get(app, `/api/games?v=${open}`, { cookie, 'if-none-match': openTag });
    expect(shut.statusCode).toBe(200);
    expect(shut.headers['cache-control']).toBe('private, no-cache');
    expect(ids(shut)).not.toContain('reverie');
    expect(shut.headers.etag).toBe(lockedTag);
  });

  it('is a new version after an admin’s title or word-list edit, and after a deploy', async () => {
    const app = make();
    const cookie = await unlocked(app);
    const before = await gamesVersion(app, cookie);
    await app.inject({
      method: 'PUT',
      url: '/api/admin/game-titles/nightfall',
      headers: { cookie: await admin(app) },
      payload: { title: 'Moonlit Village' },
    });
    const after = await gamesVersion(app, cookie);
    expect(after).not.toBe(before);
    expect(
      (await get(app, `/api/games?v=${after}`, { cookie }))
        .json<{ id: string; title?: string }[]>()
        .find((g) => g.id === 'nightfall')?.title,
    ).toBe('Moonlit Village');

    // Word lists: the room lookup names the version of its game's lists.
    const room = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      payload: { gameId: 'codenames', token: token(1) },
    });
    const roomId = room.json<{ roomId: string }>().roomId;
    const lookup = async () =>
      (await get(app, `/api/rooms/${roomId}`)).json<{
        versions: { games: string; wordLists: string };
      }>().versions;
    const lists = (await lookup()).wordLists;
    const url = (v: string) => `/api/word-lists?game=codenames&v=${v}`;
    const first = await get(app, url(lists));
    expect(first.headers['cache-control']).toBe('private, max-age=86400');
    const [list] = first.json<{ id: string; name: string }[]>();
    await app.inject({
      method: 'PATCH',
      url: `/api/admin/word-lists/${list!.id}`,
      headers: { cookie: await admin(app) },
      payload: { enabled: false },
    });
    const edited = (await lookup()).wordLists;
    expect(edited).not.toBe(lists);
    const fresh = await get(app, url(edited));
    expect(fresh.json<{ id: string }[]>().map((l) => l.id)).not.toContain(list!.id);
    // The old version is no longer kept.
    expect((await get(app, url(lists))).headers['cache-control']).toBe('private, no-cache');

    // A deploy (another build) is a new version of the same lists.
    expect(await gamesVersion(make('next'))).not.toBe(await gamesVersion(make('test')));
  });
});
