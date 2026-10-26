import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type AckWith,
  type PlaytestCreated,
  type RoomSnapshot,
  STAGE_CODE_ALPHABET,
  type StageCode,
} from '@vt/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { STAGE_CODE_MS } from '../stage.ts';
import { type TestClient, connect, testApp, token } from '../test/helpers.ts';
import { STAGE_PAIR_LIMIT } from './stage.ts';

const R2 = { accountId: 'acct', accessKeyId: 'AKID', secretAccessKey: 'secret', bucket: 'vt' };

/** A stand-in for the private bucket: every key answers with a few bytes. */
async function fakeBucket() {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': 3 });
    res.end(Buffer.from([1, 2, 3]));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const endpoint = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
  return { endpoint, close: () => server.close() };
}

describe('the table screen', () => {
  const cleanups: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    for (const fn of cleanups.reverse()) await fn();
    cleanups.length = 0;
  });

  async function start() {
    let clock = Date.parse('2026-10-26T19:00:00Z');
    const bucket = await fakeBucket();
    cleanups.push(() => void bucket.close());
    const webDist = mkdtempSync(join(tmpdir(), 'vt-web-'));
    cleanups.push(() => rmSync(webDist, { recursive: true, force: true }));
    writeFileSync(join(webDist, 'index.html'), '<!doctype html>');
    mkdirSync(join(webDist, 'backroom-assets'));
    writeFileSync(join(webDist, 'backroom-assets', 'private.js'), 'export {};');
    const app = testApp({
      now: () => clock,
      webDist,
      r2: { ...R2, endpoint: bucket.endpoint },
    });
    cleanups.push(() => app.close());
    await app.listen({ port: 0, host: '127.0.0.1' });
    const addr = app.server.address();
    const url = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
    const cookieOf = (res: { cookies: { name: string; value: string }[] }, name: string) => {
      const c = res.cookies.find((x) => x.name === name);
      return c ? `${name}=${c.value}` : '';
    };
    const admin = cookieOf(
      await app.inject({
        method: 'POST',
        url: '/api/admin/login',
        payload: { password: 'hunter2' },
      }),
      'vt_admin',
    );
    await app.inject({
      method: 'PUT',
      url: '/api/admin/backroom/password',
      headers: { cookie: admin },
      payload: { password: 'speakeasy' },
    });
    const backroom = cookieOf(
      await app.inject({
        method: 'POST',
        url: '/api/backroom/unlock',
        payload: { password: 'speakeasy' },
      }),
      'vt_backroom',
    );
    const room = async (gameId: string) =>
      (
        await app.inject({
          method: 'POST',
          url: '/api/rooms',
          headers: { cookie: backroom },
          payload: { gameId, token: token(0) },
        })
      ).json<{ roomId: string }>().roomId;
    const client = async (cookie?: string) => {
      const c = await connect(url, cookie);
      cleanups.push(() => void c.close());
      return c;
    };
    /** A player in the room (seat `n`); seat 0 created it, so it hosts. */
    const player = async (roomId: string, n: number, name: string) => {
      const c = await client(backroom);
      expect(await c.call('room:join', { roomId, token: token(n), name })).toEqual({ ok: true });
      return c;
    };
    const code = async (host: TestClient) =>
      (await host.call('room:stage-code')) as unknown as AckWith<StageCode>;
    const pair = (c: string) =>
      app.inject({ method: 'POST', url: '/api/stage/pair', payload: { code: c } });
    /** Pairs a table screen with the host's room: its pass cookie. */
    const paired = async (host: TestClient) => {
      const minted = await code(host);
      if (!minted.ok) throw new Error(minted.error.message);
      const res = await pair(minted.data.code);
      expect(res.statusCode).toBe(200);
      return cookieOf(res, 'vt_stage');
    };
    const stage = async (roomId: string, cookie: string) => {
      const c = await client(cookie);
      return { c, res: await c.call('room:join', { roomId, role: 'stage' }) };
    };
    return {
      app,
      url,
      admin,
      backroom,
      room,
      client,
      player,
      code,
      pair,
      paired,
      stage,
      tick: (ms: number) => (clock += ms),
    };
  }

  it('pairs with a short, single-use code only the host can get', async () => {
    const t = await start();
    const roomId = await t.room('codenames');
    const host = await t.player(roomId, 0, 'Ana');
    const guest = await t.player(roomId, 1, 'Ben');
    expect(await t.code(guest)).toMatchObject({ ok: false, error: { code: 'not-host' } });
    const outsider = await t.client();
    expect(await t.code(outsider)).toMatchObject({ ok: false, error: { code: 'not-joined' } });

    const minted = await t.code(host);
    expect(minted.ok).toBe(true);
    const { code } = (minted as { data: StageCode }).data;
    expect(code).toHaveLength(6);
    expect([...code].every((ch) => STAGE_CODE_ALPHABET.includes(ch))).toBe(true);
    // Typed loosely on a TV: lower case and a space still work, once.
    const first = await t.pair(`${code.slice(0, 3).toLowerCase()} ${code.slice(3)}`);
    expect(first.statusCode).toBe(200);
    expect(first.json()).toEqual({ roomId });
    expect(first.cookies.find((c) => c.name === 'vt_stage')).toMatchObject({ httpOnly: true });
    expect((await t.pair(code)).statusCode).toBe(404);
    expect((await t.pair('ZZZZZZ')).statusCode).toBe(404);
    expect((await t.pair('abc')).statusCode).toBe(400);
  });

  it('refuses a code once it has expired, and caps the codes a room has open', async () => {
    const t = await start();
    const roomId = await t.room('codenames');
    const host = await t.player(roomId, 0, 'Ana');
    const old = (await t.code(host)) as { data: StageCode };
    t.tick(STAGE_CODE_MS);
    expect((await t.pair(old.data.code)).statusCode).toBe(404);
    for (let i = 0; i < 5; i++) expect((await t.code(host)).ok).toBe(true);
    expect(await t.code(host)).toMatchObject({ ok: false, error: { code: 'too-many-codes' } });
  });

  it('rate-limits pairing attempts', async () => {
    const t = await start();
    for (let i = 0; i < STAGE_PAIR_LIMIT; i++)
      expect((await t.pair('ZZZZZZ')).statusCode).toBe(404);
    expect((await t.pair('ZZZZZZ')).statusCode).toBe(429);
  });

  it('watches with the spectator view and is never a player', async () => {
    const t = await start();
    const roomId = await t.room('codenames');
    const host = await t.player(roomId, 0, 'Ana');
    const pass = await t.paired(host);
    const { c: tv, res } = await t.stage(roomId, pass);
    expect(res).toEqual({ ok: true });
    const seen = await tv.until((s) => s.role === 'stage');
    expect(seen).toMatchObject({ you: '', stage: { present: true } });
    expect(seen.players.map((p) => p.name)).toEqual(['Ana']);
    // The phones hear a table screen is here.
    await host.until((s) => s.stage?.present === true);
    expect(host.latest()!.role).toBeUndefined();

    // Nothing a player does is open to it.
    for (const [event, ...args] of [
      ['game:action', { type: 'join-team', team: 'red', role: 'spymaster' }],
      ['room:stage-code'],
      ['room:stage-remove'],
      ['room:rename', 'TV'],
      ['room:recap', { scope: 'night' }],
      ['room:leave'],
    ] as const)
      expect(await tv.call(event, ...args)).toMatchObject({
        ok: false,
        error: { code: 'not-joined' },
      });
    // A spymaster's key never reaches it: it sees what an unseated watcher sees.
    await host.call('game:action', { type: 'join-team', team: 'red', role: 'spymaster' });
    const after = await tv.until((s) => JSON.stringify(s).includes('spymaster'));
    const spymaster = host.latest()!;
    expect(JSON.stringify(after.game)).not.toBe(JSON.stringify(spymaster.game));
    // It leaves: the phones go back to their own show.
    tv.close();
    await host.until((s) => s.stage?.present === false);
  });

  it('is removed by the host, and replaced by a second pairing', async () => {
    const t = await start();
    const roomId = await t.room('codenames');
    const host = await t.player(roomId, 0, 'Ana');
    const guest = await t.player(roomId, 1, 'Ben');
    const first = await t.paired(host);
    const { c: tv } = await t.stage(roomId, first);
    await host.until((s) => s.stage?.present === true);
    // Pairing again: the old screen leaves at once, the new one is in.
    const firstLocked = new Promise<void>((resolve) => tv.once('room:locked', () => resolve()));
    const second = await t.paired(host);
    await firstLocked;
    expect((await t.stage(roomId, first)).res).toMatchObject({
      ok: false,
      error: { code: 'stage-unpaired' },
    });
    const { c: tv2 } = await t.stage(roomId, second);
    await tv2.until((s) => s.role === 'stage');
    expect(await guest.call('room:stage-remove')).toMatchObject({
      ok: false,
      error: { code: 'not-host' },
    });
    const locked = new Promise<void>((resolve) => tv2.once('room:locked', () => resolve()));
    expect(await host.call('room:stage-remove')).toEqual({ ok: true });
    await locked;
    await host.until((s) => s.stage?.present === false);
    expect((await t.stage(roomId, second)).res).toMatchObject({
      ok: false,
      error: { code: 'stage-unpaired' },
    });
    expect(
      (await t.app.inject({ url: '/api/stage', headers: { cookie: second } })).statusCode,
    ).toBe(404);
  });

  it("opens only its own back-room room, as that room's unlock and nothing more", async () => {
    const t = await start();
    const roomId = await t.room('royal-post');
    const other = await t.room('reverie');
    const host = await t.player(roomId, 0, 'Ana');
    const pass = await t.paired(host);
    const as = (url: string) => t.app.inject({ url, headers: { cookie: pass } });

    expect((await as('/api/stage')).json()).toEqual({ roomId });
    expect((await as(`/api/rooms/${roomId}`)).json()).toMatchObject({
      id: roomId,
      gameId: 'royal-post',
    });
    expect((await t.stage(roomId, pass)).res).toEqual({ ok: true });
    // Its own game's art and code, nothing of any other game's.
    expect((await as('/api/backroom/assets/royal-post/classic/guard.jpg')).statusCode).toBe(200);
    expect((await as('/backroom-assets/private.js')).statusCode).toBe(200);
    expect((await as('/api/backroom/assets/reverie/cards/001.jpg')).statusCode).toBe(404);
    expect((await as('/api/backroom/manifest/reverie')).statusCode).toBe(404);
    expect((await as('/api/backroom/question-decks/hoodwink')).statusCode).toBe(404);
    // No other room, no seat, no back room.
    expect((await as(`/api/rooms/${other}`)).statusCode).toBe(403);
    expect((await t.stage(other, pass)).res).toMatchObject({
      ok: false,
      error: { code: 'stage-unpaired' },
    });
    const tv = await t.client(pass);
    expect(await tv.call('room:join', { roomId, token: token(7), name: 'TV' })).toMatchObject({
      ok: false,
      error: { code: 'backroom-locked' },
    });
    expect((await as('/api/backroom/status')).json()).toMatchObject({ unlocked: false });
    expect((await as('/api/games')).json<{ private?: boolean }[]>().some((g) => g.private)).toBe(
      false,
    );
    expect((await as('/api/admin/session')).json()).toMatchObject({ signedIn: false });
  });

  it('dies with the back-room word', async () => {
    const t = await start();
    const roomId = await t.room('royal-post');
    const host = await t.player(roomId, 0, 'Ana');
    const pass = await t.paired(host);
    const { c: tv } = await t.stage(roomId, pass);
    await tv.until((s) => s.role === 'stage');
    const locked = new Promise<void>((resolve) => tv.once('room:locked', () => resolve()));
    await t.app.inject({
      method: 'POST',
      url: '/api/admin/backroom/sign-out-all',
      headers: { cookie: t.admin },
    });
    await locked;
    expect((await t.stage(roomId, pass)).res).toMatchObject({
      ok: false,
      error: { code: 'stage-unpaired' },
    });
    const art = await t.app.inject({
      url: '/api/backroom/assets/royal-post/classic/guard.jpg',
      headers: { cookie: pass },
    });
    expect(art.statusCode).toBe(404);
  });

  it('works in a playtest: the admin pairs it, or opens it with no code', async () => {
    const t = await start();
    const created = await t.app.inject({
      method: 'POST',
      url: '/api/admin/playtests',
      headers: { cookie: t.admin },
      payload: {
        gameId: 'codenames',
        seats: ['Ana', 'Ben', 'Cy', 'Dee'].map((name) => ({ name })),
      },
    });
    const pt = created.json<PlaytestCreated>();
    const seat = await t.client(t.admin);
    expect(
      await seat.call('room:join', { roomId: pt.roomId, token: pt.seats[0]!.token!, name: 'Ana' }),
    ).toEqual({ ok: true });
    // The admin's own browser needs no code.
    expect((await t.stage(pt.roomId, t.admin)).res).toEqual({ ok: true });
    // A code from the host seat pairs another screen, which still isn't an admin.
    const pass = await t.paired(seat);
    const { c: tv, res } = await t.stage(pt.roomId, pass);
    expect(res).toEqual({ ok: true });
    await tv.until((s: RoomSnapshot) => s.role === 'stage');
    expect(
      (await t.app.inject({ url: '/api/admin/playtest/games', headers: { cookie: pass } }))
        .statusCode,
    ).toBe(401);
    expect(
      await tv.call('room:join', { roomId: pt.roomId, token: pt.seats[1]!.token!, name: 'Ben' }),
    ).toMatchObject({ ok: false, error: { code: 'no-room' } });
    // Nobody without either gets in.
    expect((await t.stage(pt.roomId, t.backroom)).res).toMatchObject({
      ok: false,
      error: { code: 'stage-unpaired' },
    });
  });
});
