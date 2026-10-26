import type { ContentPackDetail, ContentPackSummary } from '@vt/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { ContentPackRepo } from '../content-packs.ts';
import { openDb } from '../db/index.ts';
import { buildGames } from '../games/registry.ts';
import { MIGRATIONS, connect, testApp, token } from '../test/helpers.ts';

// Made-up content only: the real title groups and lines are private and never committed.
const SECRET = 'Zebracorn';
const groups = [
  { id: 'g1', titles: [SECRET, 'Unicorn', 'Zebra', 'Pony', 'Horse', 'Donkey', 'Mule'] },
  { id: 'g2', titles: ['Teapot', 'Kettle', 'Jug', 'Urn', 'Flask', 'Mug', 'Pitcher'] },
];
const lines = { someoneKnows: [`${SECRET} says {player} knows this one.`] };

describe('content packs api', () => {
  let app = testApp();
  afterEach(async () => {
    await app.close();
    app = testApp();
  });

  async function admin() {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { password: 'hunter2' },
    });
    const cookie = res.cookies.find((c) => c.name === 'vt_admin')!;
    return { cookie: `vt_admin=${cookie.value}` };
  }

  const post = async (headers: Record<string, string>, payload: object) =>
    app.inject({ method: 'POST', url: '/api/admin/content-packs', headers, payload });

  it('requires an admin for every route', async () => {
    const routes: [string, string][] = [
      ['GET', '/api/admin/content-packs'],
      ['GET', '/api/admin/content-packs/export'],
      ['POST', '/api/admin/content-packs'],
      ['GET', '/api/admin/content-packs/x'],
      ['PATCH', '/api/admin/content-packs/x'],
      ['PUT', '/api/admin/content-packs/x'],
      ['DELETE', '/api/admin/content-packs/x'],
    ];
    for (const [method, url] of routes) {
      const res = await app.inject({ method: method as 'GET', url, payload: {} });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });

  it('takes only private games that declare the kind, with data their schema accepts', async () => {
    const headers = await admin();
    const bad = async (payload: object, message: RegExp) => {
      const res = await post(headers, payload);
      expect(res.statusCode).toBe(400);
      expect(res.json<{ error: { message: string } }>().error.message).toMatch(message);
    };
    const pack = (o: object) => ({
      gameId: 'going-once',
      kind: 'groups',
      name: 'Mine',
      data: groups,
      ...o,
    });
    await bad(pack({ gameId: 'codenames' }), /not a back-room game that uses content packs/);
    await bad(pack({ gameId: 'thorns' }), /not a back-room game that uses content packs/);
    await bad(pack({ kind: 'cards' }), /not a kind of pack/);
    await bad(pack({ data: [{ id: 'x', titles: ['too', 'few'] }] }), /data: 0\.titles/);
    await bad(pack({ kind: 'lines', data: { nonsense: ['x'] } }), /data/);
    await bad(pack({ name: '' }), /name/);
    expect((await post(headers, pack({}))).statusCode).toBe(201);
    expect((await post(headers, pack({ kind: 'lines', data: lines }))).statusCode).toBe(201);
  });

  it('replaces a pack’s data in place, checked and with markup taken out', async () => {
    const headers = await admin();
    const created = (
      await post(headers, { gameId: 'going-once', kind: 'groups', name: 'Animals', data: groups })
    ).json<ContentPackDetail>();
    const put = (id: string, payload: object) =>
      app.inject({ method: 'PUT', url: `/api/admin/content-packs/${id}`, headers, payload });
    const marked = [
      {
        id: 'g1',
        titles: ['The movie <i>Speed</i>', 'Bus &amp; van', ...groups[0]!.titles.slice(2)],
      },
      groups[1]!,
    ];
    const res = await put(created.id, { data: marked });
    expect(res.statusCode).toBe(200);
    const after = res.json<ContentPackDetail>();
    expect(after.id).toBe(created.id);
    expect(after.name).toBe('Animals');
    expect((after.data as typeof groups)[0]!.titles.slice(0, 2)).toEqual([
      'The movie Speed',
      'Bus & van',
    ]);
    expect((await put(created.id, { data: [{ id: 'x', titles: ['few'] }] })).statusCode).toBe(400);
    expect((await put('nope', { data: groups })).statusCode).toBe(404);
    expect((await put(created.id, {})).statusCode).toBe(400);
  });

  it('lists, reads, switches, exports and deletes packs', async () => {
    const headers = await admin();
    const created = (
      await post(headers, { gameId: 'going-once', kind: 'groups', name: 'Animals', data: groups })
    ).json<ContentPackDetail>();
    expect(created).toMatchObject({
      gameId: 'going-once',
      kind: 'groups',
      entries: 2,
      enabled: true,
    });
    const list = await app.inject({ method: 'GET', url: '/api/admin/content-packs', headers });
    const summaries = list.json<ContentPackSummary[]>();
    expect(summaries.map((p) => p.name)).toEqual(['Animals']);
    expect(JSON.stringify(summaries)).not.toContain(SECRET);
    const one = await app.inject({
      method: 'GET',
      url: `/api/admin/content-packs/${created.id}`,
      headers,
    });
    expect(one.json<ContentPackDetail>().data).toEqual(groups);
    const off = await app.inject({
      method: 'PATCH',
      url: `/api/admin/content-packs/${created.id}`,
      headers,
      payload: { enabled: false },
    });
    expect(off.json<ContentPackSummary>().enabled).toBe(false);
    const exported = await app.inject({
      method: 'GET',
      url: '/api/admin/content-packs/export',
      headers,
    });
    expect(exported.json<ContentPackDetail[]>()[0]!.data).toEqual(groups);
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/admin/content-packs/${created.id}`,
      headers,
    });
    expect(del.statusCode).toBe(204);
    const gone = await app.inject({
      method: 'DELETE',
      url: `/api/admin/content-packs/${created.id}`,
      headers,
    });
    expect(gone.statusCode).toBe(404);
  });

  it('never returns pack data from any route but the admin’s, even to an unlocked browser', async () => {
    const headers = await admin();
    await post(headers, { gameId: 'going-once', kind: 'groups', name: SECRET, data: groups });
    await post(headers, { gameId: 'going-once', kind: 'lines', name: 'Lines', data: lines });
    await app.inject({
      method: 'PUT',
      url: '/api/admin/backroom/password',
      headers,
      payload: { password: 'speakeasy' },
    });
    const unlocked = await app.inject({
      method: 'POST',
      url: '/api/backroom/unlock',
      payload: { password: 'speakeasy' },
    });
    const backroom = `vt_backroom=${unlocked.cookies.find((c) => c.name === 'vt_backroom')!.value}`;
    const room = await app.inject({
      method: 'POST',
      url: '/api/rooms',
      headers: { cookie: backroom },
      payload: { gameId: 'going-once', token: token(1) },
    });
    expect(room.statusCode).toBeLessThan(300);
    const roomId = room.json<{ roomId: string }>().roomId;

    // Every GET route the server has, outside the admin's, with its parameters filled in.
    await app.ready();
    const urls = [...app.printRoutes({ commonPrefix: false }).matchAll(/(\/[^\s(]*) \(([^)]*)\)/g)]
      .filter(([, , methods]) => methods!.includes('GET'))
      .map(([, path]) => path!)
      .filter((path) => !path.startsWith('/api/admin'))
      .map((path) =>
        path
          .replace(/:gameId/g, 'going-once')
          .replace(/:(id|roomId)/g, roomId)
          .replace(/:\w+/g, 'x')
          .replace(/\*/g, 'manifest.json'),
      );
    expect(urls.length).toBeGreaterThan(10);
    expect(urls).toContain('/api/games');
    for (const url of urls)
      for (const cookie of [backroom, `${backroom}; ${headers.cookie}`]) {
        const res = await app.inject({ method: 'GET', url, headers: { cookie } });
        expect(res.body, url).not.toContain(SECRET);
      }

    // A player in the room sees how many groups there are, nothing more.
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const url = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
    const sock = await connect(url, backroom);
    expect(await sock.call('room:join', { roomId, token: token(1), name: 'Ana' })).toEqual({
      ok: true,
    });
    const snap = await sock.until((s) => s.game !== undefined);
    expect(JSON.stringify(snap)).not.toContain(SECRET);
    expect(JSON.stringify(snap)).toContain('"groupsAvailable":2');
    sock.close();
  });
});

describe('content pack repo', () => {
  it('gives a room only its own game’s enabled packs of a declared kind', () => {
    const db = openDb(':memory:', MIGRATIONS);
    const games = buildGames();
    const repo = new ContentPackRepo(db, games, () => 1);
    const a = repo.create({ gameId: 'going-once', kind: 'groups', name: 'A', data: groups });
    repo.create({ gameId: 'going-once', kind: 'lines', name: 'L', data: lines });
    const off = repo.create({ gameId: 'going-once', kind: 'groups', name: 'Off', data: groups });
    repo.setEnabled(off.id, false);
    const content = repo.forGame('going-once');
    expect(content.contentPacks('groups').map((p) => p.id)).toEqual([a.id]);
    expect(content.contentPacks('lines')).toHaveLength(1);
    expect(content.contentPacks('cards')).toEqual([]);
    expect(repo.forGame('thorns').contentPacks('groups')).toEqual([]);
  });
});
