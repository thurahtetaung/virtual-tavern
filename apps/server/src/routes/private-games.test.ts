import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { effectiveMusic, manifestTracks, unknownTrack } from '../private-games.ts';
import { testApp, token } from '../test/helpers.ts';

const MANIFEST = {
  music: { night: ['music/a.ogg', 'music/b.ogg'], day: ['music/c.ogg'] },
  musicTracks: {
    a: { name: 'A', file: 'music/a.ogg', duration: 30 },
    b: { name: 'B', file: 'music/b.ogg', duration: 40 },
    c: { name: 'C', file: 'music/c.ogg', duration: 50 },
  },
};
const OGG = Buffer.from('OggS fake');

/** A stand-in for the private bucket holding a small Nightfall manifest and one track. */
async function fakeBucket() {
  const objects = new Map<string, [string, Buffer]>([
    ['nightfall/manifest.json', ['application/json', Buffer.from(JSON.stringify(MANIFEST))]],
    ['nightfall/music/a.ogg', ['audio/ogg', OGG]],
  ]);
  const server = createServer((req, res) => {
    const hit = objects.get(decodeURIComponent(req.url!.replace(/^\/vt-private\//, '')));
    if (!hit) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': hit[0], 'content-length': hit[1].length });
    res.end(hit[1]);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const endpoint = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
  return { endpoint, close: () => server.close() };
}

describe('music choices', () => {
  it('fall back to the manifest’s defaults phase by phase', () => {
    expect(effectiveMusic(MANIFEST.music, null)).toEqual(MANIFEST.music);
    expect(
      effectiveMusic(MANIFEST.music, { night: ['music/c.ogg'], lobby: ['music/a.ogg'] }),
    ).toEqual({
      night: ['music/c.ogg'],
      day: ['music/c.ogg'],
      lobby: ['music/a.ogg'],
    });
    expect(effectiveMusic(undefined, null)).toEqual({});
    expect(effectiveMusic({ night: 'nope', day: ['music/c.ogg', 3] }, null)).toEqual({
      day: ['music/c.ogg'],
    });
  });

  it('only accept the manifest’s tracks', () => {
    const tracks = manifestTracks(MANIFEST);
    expect(tracks).toEqual(['music/a.ogg', 'music/b.ogg', 'music/c.ogg']);
    expect(unknownTrack({ night: ['music/a.ogg'] }, tracks)).toBeNull();
    expect(unknownTrack({ vote: ['music/a.ogg', 'music/z.ogg'] }, tracks)).toBe('music/z.ogg');
    expect(manifestTracks(null)).toEqual([]);
  });
});

describe('private game settings over HTTP', () => {
  const cleanup: (() => unknown)[] = [];
  afterEach(async () => {
    for (const c of cleanup.splice(0)) await c();
  });

  async function setup(withAssets = true) {
    const bucket = await fakeBucket();
    cleanup.push(bucket.close);
    const app = testApp(
      withAssets
        ? {
            r2: {
              accountId: 'a',
              accessKeyId: 'k',
              secretAccessKey: 's',
              bucket: 'vt-private',
              endpoint: bucket.endpoint,
            },
          }
        : {},
    );
    cleanup.push(() => app.close());
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
    return { app, admin, backroom };
  }

  it('need the admin', async () => {
    const { app } = await setup();
    for (const [method, url] of [
      ['GET', '/api/admin/game-titles'],
      ['PUT', '/api/admin/game-titles/nightfall'],
      ['GET', '/api/admin/game-music/nightfall'],
      ['PUT', '/api/admin/game-music/nightfall'],
      ['GET', '/api/admin/backroom-assets/nightfall/music/a.ogg'],
    ] as const) {
      const res = await app.inject({ method, url, payload: method === 'PUT' ? {} : undefined });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('send a private game’s title only to unlocked browsers', async () => {
    const { app, admin, backroom } = await setup();
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/admin/game-titles/codenames',
          headers: { cookie: admin },
          payload: { title: 'X' },
        })
      ).statusCode,
    ).toBe(404);
    const set = await app.inject({
      method: 'PUT',
      url: '/api/admin/game-titles/nightfall',
      headers: { cookie: admin },
      payload: { title: 'The Real Title' },
    });
    expect(set.json()).toEqual({ gameId: 'nightfall', title: 'The Real Title' });
    const list = await app.inject({
      method: 'GET',
      url: '/api/admin/game-titles',
      headers: { cookie: admin },
    });
    expect(list.json()).toContainEqual({
      gameId: 'nightfall',
      name: 'Nightfall',
      title: 'The Real Title',
    });

    const games = (cookie = '') =>
      app.inject({ method: 'GET', url: '/api/games', headers: { cookie } });
    expect((await games()).body).not.toContain('The Real Title');
    expect((await games(backroom)).json()).toContainEqual(
      expect.objectContaining({ id: 'nightfall', name: 'Nightfall', title: 'The Real Title' }),
    );
    const { roomId } = (
      await app.inject({
        method: 'POST',
        url: '/api/rooms',
        headers: { cookie: backroom },
        payload: { gameId: 'nightfall', token: token(3) },
      })
    ).json<{ roomId: string }>();
    const locked = await app.inject({ method: 'GET', url: `/api/rooms/${roomId}` });
    expect(locked.statusCode).toBe(403);
    expect(locked.body).not.toContain('The Real Title');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/api/rooms/${roomId}`,
          headers: { cookie: backroom },
        })
      ).json(),
    ).toEqual({ id: roomId, gameId: 'nightfall', title: 'The Real Title' });
    // Clearing it falls back to the registry name.
    await app.inject({
      method: 'PUT',
      url: '/api/admin/game-titles/nightfall',
      headers: { cookie: admin },
      payload: { title: null },
    });
    const after = (await games(backroom)).json<{ id: string; title?: string }[]>();
    expect(after.find((g) => g.id === 'nightfall')).not.toHaveProperty('title');
  });

  it('name a titled private game by its title on the stats page, others by their code name', async () => {
    const { app, admin } = await setup();
    const named = async () =>
      new Map(
        (
          await app.inject({
            method: 'GET',
            url: '/api/admin/stats/overview',
            headers: { cookie: admin },
          })
        )
          .json<{ games: { id: string; name: string }[] }>()
          .games.map((g) => [g.id, g.name]),
      );
    expect((await named()).get('nightfall')).toBe('Nightfall');
    await app.inject({
      method: 'PUT',
      url: '/api/admin/game-titles/nightfall',
      headers: { cookie: admin },
      payload: { title: 'Moonlit Village' },
    });
    const games = await named();
    expect(games.get('nightfall')).toBe('Moonlit Village');
    expect(games.get('inquest')).toBe('Inquest');
    expect(games.get('codenames')).toBe('Codenames');
  });

  it('let the admin pick music from the manifest and preview it', async () => {
    const { app, admin, backroom } = await setup();
    const put = (music: unknown) =>
      app.inject({
        method: 'PUT',
        url: '/api/admin/game-music/nightfall',
        headers: { cookie: admin },
        payload: { music },
      });
    expect((await put({ night: ['music/nope.ogg'] })).statusCode).toBe(400);
    expect((await put({ dusk: ['music/a.ogg'] })).statusCode).toBe(400);
    expect((await put({ night: ['music/c.ogg'] })).json()).toEqual({
      override: { night: ['music/c.ogg'] },
    });
    const got = await app.inject({
      method: 'GET',
      url: '/api/admin/game-music/nightfall',
      headers: { cookie: admin },
    });
    expect(got.json()).toMatchObject({
      override: { night: ['music/c.ogg'] },
      defaults: MANIFEST.music,
      effective: { night: ['music/c.ogg'], day: ['music/c.ogg'] },
      tracks: MANIFEST.musicTracks,
    });
    // Unlocked rooms get the effective music with the manifest.
    const manifest = await app.inject({
      method: 'GET',
      url: '/api/backroom/manifest/nightfall',
      headers: { cookie: backroom },
    });
    expect(manifest.json()).toMatchObject({
      music: { night: ['music/c.ogg'], day: ['music/c.ogg'] },
    });
    // The admin previews tracks without the back-room cookie.
    const track = await app.inject({
      method: 'GET',
      url: '/api/admin/backroom-assets/nightfall/music/a.ogg',
      headers: { cookie: admin },
    });
    expect(track.statusCode).toBe(200);
    expect(track.headers['cache-control']).toBe('private, no-store');
    expect(track.rawPayload).toEqual(OGG);
    // Reset.
    expect((await put(null)).json()).toEqual({ override: null });
  });

  it('report no tracks when the server has no asset storage', async () => {
    const { app, admin } = await setup(false);
    const got = await app.inject({
      method: 'GET',
      url: '/api/admin/game-music/nightfall',
      headers: { cookie: admin },
    });
    expect(got.json()).toEqual({ override: null, defaults: null, effective: null, tracks: null });
  });
});
