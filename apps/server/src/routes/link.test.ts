import type { CodenamesView } from '@vt/game-codenames/logic';
import {
  type AckWith,
  LINK_CODE_ALPHABET,
  LINK_CODE_LENGTH,
  LINK_CODE_MS,
  type LinkCheck,
  type LinkCode,
  type RoomRecap,
  type RoomSnapshot,
} from '@vt/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { HOST_AWAY_MS } from '../rooms/manager.ts';
import { type TestClient, connect, testApp, token } from '../test/helpers.ts';
import { LINK_LIMIT } from './link.ts';

const view = (s: RoomSnapshot) => s.game as CodenamesView;

describe('linking a phone to a player', () => {
  const cleanups: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    for (const fn of cleanups.reverse()) await fn();
    cleanups.length = 0;
  });

  async function start() {
    let clock = Date.parse('2026-11-13T19:00:00Z');
    const app = testApp({ now: () => clock });
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
    const setPassword = (password: string) =>
      app.inject({
        method: 'PUT',
        url: '/api/admin/backroom/password',
        headers: { cookie: admin },
        payload: { password },
      });
    await setPassword('speakeasy');
    const unlock = async () =>
      cookieOf(
        await app.inject({
          method: 'POST',
          url: '/api/backroom/unlock',
          payload: { password: 'speakeasy' },
        }),
        'vt_backroom',
      );
    const backroom = await unlock();
    const room = async (gameId: string, cookie = backroom) =>
      (
        await app.inject({
          method: 'POST',
          url: '/api/rooms',
          headers: { cookie },
          payload: { gameId, token: token(0) },
        })
      ).json<{ roomId: string }>().roomId;
    const client = async (cookie?: string) => {
      const c = await connect(url, cookie);
      cleanups.push(() => void c.close());
      return c;
    };
    /** A player in the room (seat `n`); seat 0 created it, so it hosts. */
    const player = async (roomId: string, n: number, name: string, cookie = backroom) => {
      const c = await client(cookie);
      expect(await c.call('room:join', { roomId, token: token(n), name })).toEqual({ ok: true });
      return c;
    };
    const mint = async (pc: TestClient) => {
      const res = (await pc.call('room:link-code')) as unknown as AckWith<LinkCode>;
      if (!res.ok) throw new Error(res.error.message);
      return res.data;
    };
    /** The phone's own browser token (never a member unless a test seats it). */
    const phoneToken = token(50);
    const check = (code: string, cookie?: string, own = phoneToken, links: string[] = []) =>
      app.inject({
        method: 'POST',
        url: '/api/link/check',
        payload: { code, token: own, links },
        ...(cookie && { headers: { cookie } }),
      });
    const redeem = (code: string, cookie?: string, own = phoneToken, links: string[] = []) =>
      app.inject({
        method: 'POST',
        url: '/api/link',
        payload: { code, token: own, links },
        ...(cookie && { headers: { cookie } }),
      });
    /** Links a phone to the PC's player: its key. */
    const link = async (pc: TestClient, cookie?: string) => {
      const { code } = await mint(pc);
      const res = await redeem(code, cookie);
      expect(res.statusCode).toBe(200);
      return res.json<{ roomId: string; key: string }>().key;
    };
    /** The phone in the room on its key. */
    const phone = async (roomId: string, key: string, cookie?: string) => {
      const c = await client(cookie);
      const res = await c.call('room:join', { roomId, token: key, name: 'Phone', link: true });
      return { c, res };
    };
    return {
      app,
      url,
      admin,
      backroom,
      unlock,
      setPassword,
      room,
      client,
      player,
      mint,
      check,
      redeem,
      link,
      phone,
      cookieOf,
      tick: (ms: number) => {
        clock += ms;
      },
    };
  }

  it('codes are four letters from the plain alphabet, one per player, single use, two minutes', async () => {
    const t = await start();
    const roomId = await t.room('codenames');
    const pc = await t.player(roomId, 0, 'Ana');
    const first = await t.mint(pc);
    expect(first.code).toHaveLength(LINK_CODE_LENGTH);
    for (const ch of first.code) expect(LINK_CODE_ALPHABET).toContain(ch);
    expect(LINK_CODE_ALPHABET).not.toMatch(/[ILOUV0-9]/);

    // A new code replaces the last one, which then reads as run out.
    const second = await t.mint(pc);
    expect((await t.check(first.code)).json<LinkCheck>()).toEqual({ status: 'expired' });
    expect((await t.check(second.code)).json<LinkCheck>()).toMatchObject({
      status: 'ok',
      preview: { name: 'Ana', host: 'Ana', players: 1, gameId: 'codenames' },
    });

    // Used once, it's spent.
    expect((await t.redeem(second.code)).statusCode).toBe(200);
    const again = await t.redeem(second.code, undefined, token(51));
    expect(again.statusCode).toBe(409);
    expect(again.json()).toMatchObject({ error: { code: 'expired' } });

    // Two minutes, then it has run out; one no PC showed is wrong.
    const third = await t.mint(pc);
    t.tick(LINK_CODE_MS);
    expect((await t.check(third.code, undefined, token(52))).json<LinkCheck>()).toEqual({
      status: 'expired',
    });
    const unknown = [...LINK_CODE_ALPHABET.slice(0, LINK_CODE_LENGTH)].join('');
    const known = [first.code, second.code, third.code];
    if (!known.includes(unknown))
      expect((await t.check(unknown)).json<LinkCheck>()).toEqual({ status: 'wrong' });

    // Cancelled from the card, it's spent too.
    const fourth = await t.mint(pc);
    expect(await pc.call('room:link-cancel')).toEqual({ ok: true });
    expect((await t.check(fourth.code, undefined, token(53))).json<LinkCheck>()).toEqual({
      status: 'expired',
    });
  });

  it('checks and redeems are rate-limited per address', async () => {
    const t = await start();
    for (let i = 0; i < LINK_LIMIT; i++) expect((await t.check('ABCD')).statusCode).toBe(200);
    expect((await t.check('ABCD')).statusCode).toBe(429);
    for (let i = 0; i < LINK_LIMIT; i++) expect((await t.redeem('ABCD')).statusCode).toBe(409);
    expect((await t.redeem('ABCD')).statusCode).toBe(429);
  });

  it('the phone is a second key of the same player: one seat, one presence, the key only to the phone', async () => {
    const t = await start();
    const roomId = await t.room('codenames');
    const pc = await t.player(roomId, 0, 'Ana');
    const ben = await t.player(roomId, 1, 'Ben');
    const { code } = await t.mint(pc);
    // The check reveals no key.
    expect(JSON.stringify((await t.check(code)).json())).not.toMatch(/key/);
    const res = await t.redeem(code);
    expect(res.statusCode).toBe(200);
    const { key, roomId: linkedRoom } = res.json<{ roomId: string; key: string }>();
    expect(linkedRoom).toBe(roomId);
    expect(res.headers['cache-control']).toBe('no-store');

    const { c: phone, res: joined } = await t.phone(roomId, key);
    expect(joined).toEqual({ ok: true });
    const ps = await phone.until((s) => s.link?.phone === true);
    // Same player, same name: the phone's join never renames or adds anyone.
    expect(ps.you).toBe(pc.latest()!.you);
    expect(ps.players.map((p) => p.name)).toEqual(['Ana', 'Ben']);
    expect(ps.link).toEqual({ phone: true, pc: true, show: false });
    await pc.until((s) => s.link?.phone === true);
    // Nobody else sees the link, and no snapshot carries the key.
    expect(ben.latest()!.link).toBeUndefined();
    for (const c of [pc, ben, phone]) expect(JSON.stringify(c.latest())).not.toContain(key);

    // The phone acts as the player.
    expect(
      await phone.call('game:action', { type: 'join-team', team: 'red', role: 'spymaster' }),
    ).toEqual({ ok: true });
    const seated = view(await pc.until((s) => view(s).me?.role === 'spymaster')).me;
    expect(seated).toMatchObject({ id: pc.latest()!.you, team: 'red' });

    // Online while either device is: the PC goes, the phone keeps the seat and the host role.
    pc.close();
    const alone = await phone.until((s) => s.link?.pc === false);
    expect(alone.players.find((p) => p.id === alone.you)!.connected).toBe(true);
    expect(alone.hostAwayUntil ?? null).toBeNull();
    phone.close();
    const gone = await ben.until((s) => !s.players.find((p) => p.name === 'Ana')!.connected);
    expect(gone.hostAwayUntil).toBeGreaterThan(0);
    expect(gone.hostAwayUntil! - gone.serverNow).toBeLessThanOrEqual(HOST_AWAY_MS);
  });

  it("the PC's table screen gets the spectator view and counts for nobody", async () => {
    const t = await start();
    const roomId = await t.room('codenames');
    const pc = await t.player(roomId, 0, 'Ana');
    const ben = await t.player(roomId, 1, 'Ben');
    await t.link(pc);
    const show = await t.client();
    expect(await show.call('room:join', { roomId, role: 'show', token: token(0) })).toEqual({
      ok: true,
    });
    const s = await show.until(() => true);
    expect(s.you).toBe('');
    expect(s.role).toBe('stage');
    expect(s.stage).toEqual({ present: false });
    expect(s.link).toBeUndefined();
    await pc.until((x) => x.link?.show === true);
    expect(ben.latest()!.players).toHaveLength(2);
    // Only a member's own token opens it.
    const stranger = await t.client();
    expect(
      await stranger.call('room:join', { roomId, role: 'show', token: token(9) }),
    ).toMatchObject({ ok: false, error: { code: 'not-in-room' } });
    show.close();
    await pc.until((x) => x.link?.show === false);
  });

  it('unlinking from either device, a new phone, or leaving ends the link', async () => {
    const t = await start();
    const roomId = await t.room('codenames');
    const pc = await t.player(roomId, 0, 'Ana');
    await t.player(roomId, 1, 'Ben');

    // From the PC: the phone hears it and its key opens nothing any more.
    let key = await t.link(pc);
    let { c: phone } = await t.phone(roomId, key);
    let told = new Promise((r) => phone.once('room:unlinked', () => r(true)));
    expect(await pc.call('room:unlink')).toEqual({ ok: true });
    expect(await told).toBe(true);
    await pc.until((s) => s.link === undefined);
    expect((await t.phone(roomId, key)).res).toMatchObject({
      ok: false,
      error: { code: 'unlinked' },
    });

    // From the phone itself.
    key = await t.link(pc);
    ({ c: phone } = await t.phone(roomId, key));
    await pc.until((s) => s.link?.phone === true);
    told = new Promise((r) => phone.once('room:unlinked', () => r(true)));
    expect(await phone.call('room:unlink')).toEqual({ ok: true });
    expect(await told).toBe(true);
    await pc.until((s) => s.link === undefined);

    // A new phone replaces the old one.
    key = await t.link(pc);
    ({ c: phone } = await t.phone(roomId, key));
    told = new Promise((r) => phone.once('room:unlinked', () => r(true)));
    const second = await t.link(pc);
    expect(await told).toBe(true);
    expect((await t.phone(roomId, key)).res).toMatchObject({ ok: false });
    expect((await t.phone(roomId, second)).res).toEqual({ ok: true });

    // A phone can't make codes of its own.
    const { c: other } = await t.phone(roomId, second);
    expect(await other.call('room:link-code')).toMatchObject({
      ok: false,
      error: { code: 'link-from-pc' },
    });

    // The player leaves: the phone goes with them, and the key is gone.
    told = new Promise((r) => other.once('room:unlinked', () => r(true)));
    expect(await pc.call('room:leave')).toEqual({ ok: true });
    expect(await told).toBe(true);
    expect((await t.phone(roomId, second)).res).toMatchObject({ ok: false });
  });

  it('a removed player’s phone hears it was removed', async () => {
    const t = await start();
    const roomId = await t.room('codenames');
    const host = await t.player(roomId, 0, 'Host');
    const ana = await t.player(roomId, 1, 'Ana');
    const key = await t.link(ana);
    const { c: phone } = await t.phone(roomId, key);
    const kicked = new Promise((r) => phone.once('room:kicked', () => r(true)));
    expect(await host.call('room:kick', ana.latest()!.you)).toEqual({ ok: true });
    expect(await kicked).toBe(true);
    expect((await t.phone(roomId, key)).res).toMatchObject({ ok: false });
  });

  it('a phone already in the room as someone else is refused', async () => {
    const t = await start();
    const roomId = await t.room('codenames');
    const pc = await t.player(roomId, 0, 'Ana');
    // The phone's own browser sits in the room as Kim.
    await t.player(roomId, 7, 'Kim');
    const { code } = await t.mint(pc);
    expect((await t.check(code, undefined, token(7))).json<LinkCheck>()).toEqual({
      status: 'other-seat',
      roomId,
      seat: 'Kim',
      host: 'Ana',
      name: 'Ana',
    });
    const res = await t.redeem(code, undefined, token(7));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: { code: 'other-seat' } });

    // Or it holds a link to someone else here.
    const ben = await t.player(roomId, 2, 'Ben');
    const bensKey = await t.link(ben);
    const again = await t.mint(pc);
    expect(
      (await t.check(again.code, undefined, token(60), [bensKey])).json<LinkCheck>(),
    ).toMatchObject({ status: 'other-seat', seat: 'Ben' });
  });

  it('the back room comes along only from a PC that has it, and only at the current word', async () => {
    const t = await start();
    const roomId = await t.room('royal-post');
    const pc = await t.player(roomId, 0, 'Ana');

    // A fresh phone: the check says linking opens the back room, and the redeem sets the unlock.
    const { code } = await t.mint(pc);
    expect((await t.check(code)).json<LinkCheck>()).toMatchObject({
      status: 'ok',
      preview: { opensBackroom: true },
    });
    const res = await t.redeem(code);
    expect(res.statusCode).toBe(200);
    const unlock = t.cookieOf(res, 'vt_backroom');
    expect(unlock).not.toBe('');
    const { key } = res.json<{ key: string }>();
    // The key alone opens nothing: every door still asks for the back room.
    expect((await t.phone(roomId, key)).res).toMatchObject({
      ok: false,
      error: { code: 'backroom-locked' },
    });
    const status = await t.app.inject({
      method: 'GET',
      url: '/api/backroom/status',
      headers: { cookie: unlock },
    });
    expect(status.json()).toMatchObject({ unlocked: true });
    const { c: phone, res: joined } = await t.phone(roomId, key, unlock);
    expect(joined).toEqual({ ok: true });

    // A new word revokes the phone's unlock like anyone's.
    const locked = new Promise((r) => phone.once('room:locked', () => r(true)));
    await t.setPassword('another');
    expect(await locked).toBe(true);
    expect((await t.phone(roomId, key, unlock)).res).toMatchObject({
      ok: false,
      error: { code: 'backroom-locked' },
    });
  });

  it('a code made before the word changed carries no back room', async () => {
    const t = await start();
    const roomId = await t.room('royal-post');
    const pc = await t.player(roomId, 0, 'Ana', t.admin);
    const { code } = await t.mint(pc);
    // Everyone is signed out after the code was made: it brings nothing, and the phone can't enter.
    await t.app.inject({
      method: 'POST',
      url: '/api/admin/backroom/sign-out-all',
      headers: { cookie: t.admin },
    });
    expect((await t.check(code)).json<LinkCheck>()).toEqual({ status: 'expired' });
    const res = await t.redeem(code);
    expect(res.statusCode).toBe(409);
    expect(t.cookieOf(res, 'vt_backroom')).toBe('');
  });

  it('a PC without the back room carries none (public table)', async () => {
    const t = await start();
    const roomId = await t.room('codenames', '');
    const pc = await t.player(roomId, 0, 'Ana', '');
    const { code } = await t.mint(pc);
    expect((await t.check(code)).json<LinkCheck>()).toMatchObject({
      preview: { opensBackroom: false },
    });
    const res = await t.redeem(code);
    expect(res.statusCode).toBe(200);
    expect(t.cookieOf(res, 'vt_backroom')).toBe('');
  });

  it('the link follows the player into the night’s next table, never before their PC', async () => {
    const t = await start();
    const roomId = await t.room('codenames');
    const names = ['Host', 'Ana', 'Ben', 'Cy'];
    const clients: TestClient[] = [];
    for (const [i, name] of names.entries()) clients.push(await t.player(roomId, i, name));
    const [host, ana, ben, cy] = clients;
    await Promise.all(clients.map((c) => c.until((s) => s.players.length === 4)));
    const key = await t.link(ana!);
    const { c: phone } = await t.phone(roomId, key);

    // A game ends, so the night can go on at another table.
    await host!.call('game:action', { type: 'join-team', team: 'red', role: 'spymaster' });
    await ana!.call('game:action', { type: 'join-team', team: 'red', role: 'operative' });
    await ben!.call('game:action', { type: 'join-team', team: 'blue', role: 'spymaster' });
    await cy!.call('game:action', { type: 'join-team', team: 'blue', role: 'operative' });
    expect(await host!.call('game:action', { type: 'start' })).toEqual({ ok: true });
    const playing = view(await host!.until((s) => view(s).phase === 'playing'));
    const [spy, op] = playing.turn!.team === 'red' ? [host!, ana!] : [ben!, cy!];
    await spy.call('game:action', { type: 'give-clue', word: 'hint', count: 1 });
    await op.until((s) => view(s).turn?.stage === 'guess');
    const assassin = view(host!.latest()!).board.findIndex((c) => c.kind === 'assassin');
    await op.call('game:action', { type: 'guess', card: assassin });
    await host!.until((s) => s.meta?.phase === 'over');
    const card = (
      (await host!.call('room:recap', { scope: 'night' })) as unknown as {
        data: RoomRecap;
      }
    ).data;

    // The host opens the next table; the phone isn't told to go anywhere yet.
    let followed: string | null = null;
    phone.on('room:follow', (id) => {
      followed = id;
    });
    const next = (
      await t.app.inject({
        method: 'POST',
        url: '/api/rooms',
        payload: { gameId: 'echo', token: token(0), nightKey: card.nightKey },
      })
    ).json<{ roomId: string }>().roomId;
    // The key waits there: it opens nothing until Ana's own browser joins that table.
    expect((await t.phone(next, key)).res).toMatchObject({
      ok: false,
      error: { code: 'link-waiting' },
    });
    // Someone else's arrival changes nothing for Ana's key.
    await t.player(next, 2, 'Ben');
    expect((await t.phone(next, key)).res).toMatchObject({ ok: false });
    expect(followed).toBeNull();

    // Ana's PC follows: the phone is told, and its key opens the new table as Ana.
    const told = new Promise<string>((r) => phone.once('room:follow', r));
    const anaThere = await t.player(next, 1, 'Ana');
    expect(await told).toBe(next);
    const { c: phoneThere, res } = await t.phone(next, key);
    expect(res).toEqual({ ok: true });
    expect((await phoneThere.until(() => true)).you).toBe(anaThere.latest()!.you);
    await anaThere.until((s) => s.link?.phone === true);

    // Unlinking in the new table ends it in the first one too.
    expect(await anaThere.call('room:unlink')).toEqual({ ok: true });
    expect((await t.phone(roomId, key)).res).toMatchObject({
      ok: false,
      error: { code: 'unlinked' },
    });
  });

  it('a phone linked after the player moved on reaches the next tables they joined, and only those', async () => {
    const t = await start();
    const roomId = await t.room('codenames');
    const clients: TestClient[] = [];
    for (const [i, name] of ['Host', 'Ana', 'Ben', 'Cy'].entries())
      clients.push(await t.player(roomId, i, name));
    const [host, ana, ben, cy] = clients;
    await host!.call('game:action', { type: 'join-team', team: 'red', role: 'spymaster' });
    await ana!.call('game:action', { type: 'join-team', team: 'red', role: 'operative' });
    await ben!.call('game:action', { type: 'join-team', team: 'blue', role: 'spymaster' });
    await cy!.call('game:action', { type: 'join-team', team: 'blue', role: 'operative' });
    await host!.call('game:action', { type: 'start' });
    const playing = view(await host!.until((s) => view(s).phase === 'playing'));
    const [spy, op] = playing.turn!.team === 'red' ? [host!, ana!] : [ben!, cy!];
    await spy.call('game:action', { type: 'give-clue', word: 'hint', count: 1 });
    await op.until((s) => view(s).turn?.stage === 'guess');
    await op.call('game:action', {
      type: 'guess',
      card: view(host!.latest()!).board.findIndex((c) => c.kind === 'assassin'),
    });
    await host!.until((s) => s.meta?.phase === 'over');
    const card = (
      (await host!.call('room:recap', { scope: 'night' })) as unknown as {
        data: RoomRecap;
      }
    ).data;
    const open = async (seat: number) =>
      (
        await t.app.inject({
          method: 'POST',
          url: '/api/rooms',
          payload: { gameId: 'echo', token: token(seat), nightKey: card.nightKey },
        })
      ).json<{ roomId: string }>().roomId;

    // The host opens the next table and Ana's PC follows, all before any phone is linked.
    const next = await open(0);
    const anaThere = await t.player(next, 1, 'Ana');
    await t.player(next, 2, 'Ben');
    // Ben opens a table after that one, which Ana never enters.
    const later = await open(2);
    await t.player(later, 2, 'Ben');

    // Now Ana links her phone back in the first room: its key opens the table her PC is at.
    const key = await t.link(ana!);
    const { c: phoneThere, res } = await t.phone(next, key);
    expect(res).toEqual({ ok: true });
    expect((await phoneThere.until(() => true)).you).toBe(anaThere.latest()!.you);
    await anaThere.until((s) => s.link?.phone === true);
    // The table she never entered stays shut to it, until her PC comes.
    expect((await t.phone(later, key)).res).toMatchObject({
      ok: false,
      error: { code: 'link-waiting' },
    });
    const anaLater = await t.player(later, 1, 'Ana');
    expect((await t.phone(later, key)).res).toEqual({ ok: true });
    await anaLater.until((s) => s.link?.phone === true);

    // Unlinking at the first table ends it everywhere.
    expect(await ana!.call('room:unlink')).toEqual({ ok: true });
    for (const id of [next, later])
      expect((await t.phone(id, key)).res).toMatchObject({
        ok: false,
        error: { code: 'unlinked' },
      });
  });

  it('a key is never copied into a table its player never entered', async () => {
    const t = await start();
    const roomId = await t.room('codenames');
    const clients: TestClient[] = [];
    for (const [i, name] of ['Host', 'Ana', 'Ben', 'Cy'].entries())
      clients.push(await t.player(roomId, i, name));
    const [host, ana, ben, cy] = clients;
    const key = await t.link(ana!);
    await host!.call('game:action', { type: 'join-team', team: 'red', role: 'spymaster' });
    await ana!.call('game:action', { type: 'join-team', team: 'red', role: 'operative' });
    await ben!.call('game:action', { type: 'join-team', team: 'blue', role: 'spymaster' });
    await cy!.call('game:action', { type: 'join-team', team: 'blue', role: 'operative' });
    await host!.call('game:action', { type: 'start' });
    const playing = view(await host!.until((s) => view(s).phase === 'playing'));
    const [spy, op] = playing.turn!.team === 'red' ? [host!, ana!] : [ben!, cy!];
    await spy.call('game:action', { type: 'give-clue', word: 'hint', count: 1 });
    await op.until((s) => view(s).turn?.stage === 'guess');
    await op.call('game:action', {
      type: 'guess',
      card: view(host!.latest()!).board.findIndex((c) => c.kind === 'assassin'),
    });
    await host!.until((s) => s.meta?.phase === 'over');
    const card = (
      (await host!.call('room:recap', { scope: 'night' })) as unknown as {
        data: RoomRecap;
      }
    ).data;
    const next = (
      await t.app.inject({
        method: 'POST',
        url: '/api/rooms',
        payload: { gameId: 'echo', token: token(0), nightKey: card.nightKey },
      })
    ).json<{ roomId: string }>().roomId;
    // Everyone else plays on there; Ana's PC never comes.
    await t.player(next, 0, 'Host');
    await t.player(next, 2, 'Ben');
    expect((await t.phone(next, key)).res).toMatchObject({ ok: false });
    // A room opened outside the night has no copy at all.
    const unrelated = await t.room('codenames');
    expect((await t.phone(unrelated, key)).res).toMatchObject({
      ok: false,
      error: { code: 'unlinked' },
    });
  });
});
