import type { RoomSnapshot } from '@vt/protocol';
import type { Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CATCH_UP_AFTER_MS,
  QUIET_DROP_MS,
  RoomConnection,
  type RoomListener,
  type RoomStatus,
} from '../../web/src/lib/room-connection.ts';
import { bareRealtime, token } from './test/helpers.ts';

// The browser's room connection (apps/web) against the real socket layer.

type Rt = Awaited<ReturnType<typeof bareRealtime>>;
let rt: Rt | undefined;
const conns: RoomConnection[] = [];

afterEach(async () => {
  for (const c of conns.splice(0)) c.dispose();
  await rt?.close();
  rt = undefined;
});

function open(roomId: string) {
  const heard = {
    states: [] as RoomSnapshot[],
    statuses: [] as RoomStatus[],
    catchingUp: [] as boolean[],
  };
  const waiters: (() => void)[] = [];
  const poke = () => waiters.splice(0).forEach((w) => w());
  const listener: RoomListener = {
    state: (s) => {
      heard.states.push(s);
      poke();
    },
    status: (s) => {
      heard.statuses.push(s);
      poke();
    },
    error: () => {},
    lockReason: () => {},
    catchingUp: (on) => {
      heard.catchingUp.push(on);
      poke();
    },
    wrapped: () => {},
    next: () => {},
    playtestAwards: () => {},
    recap: () => {},
  };
  const conn = new RoomConnection(roomId, listener, rt!.url);
  conns.push(conn);
  const until = async (ok: () => boolean) => {
    while (!ok()) await new Promise<void>((r) => waiters.push(r));
  };
  return { conn, heard, until };
}

/** A phone that slept past the heartbeat: the deadline passed, but no close event fired. */
function sleepPastHeartbeat(conn: RoomConnection) {
  const socket = (conn as unknown as { socket: Socket }).socket;
  (socket.io.engine as unknown as { _pingTimeoutTime: number })._pingTimeoutTime = Date.now() - 1;
}

describe('room connection', () => {
  it('sends the first tap after a long sleep once the page is back in the room', async () => {
    rt = await bareRealtime();
    const roomId = rt.rooms.create('codenames', 'nobody');
    const { conn, heard, until } = open(roomId);
    conn.enable(() => ({ token: token(1), name: 'Ana' }));
    await until(() => heard.statuses.at(-1) === 'joined');

    sleepPastHeartbeat(conn);
    const res = await conn.call('room:rename', 'Bea');
    expect(res).toEqual({ ok: true });
    // Back within moments: no "Connection lost".
    expect(heard.statuses).not.toContain('reconnecting');
    await until(() => heard.states.at(-1)?.players[0]?.name === 'Bea');
  });

  it('says it is reconnecting on waking after a long sleep, until the room arrives again', async () => {
    rt = await bareRealtime();
    const roomId = rt.rooms.create('codenames', 'nobody');
    const { conn, heard, until } = open(roomId);
    conn.enable(() => ({ token: token(1), name: 'Ana' }));
    await until(() => heard.statuses.at(-1) === 'joined');
    const states = heard.states.length;

    const now = Date.now();
    conn.visibility(false, now - CATCH_UP_AFTER_MS - 1);
    sleepPastHeartbeat(conn);
    conn.visibility(true, now);
    expect(heard.catchingUp).toEqual([true]);
    await until(() => heard.catchingUp.at(-1) === false);
    expect(heard.states.length).toBeGreaterThan(states);
    // The catching-up hint was the banner; the quick rejoin itself never said "reconnecting".
    expect(heard.statuses).not.toContain('reconnecting');
  });

  it('a drop that heals at once never says so, and a tap made meanwhile goes through', async () => {
    rt = await bareRealtime();
    const roomId = rt.rooms.create('codenames', 'nobody');
    const { conn, heard, until } = open(roomId);
    conn.enable(() => ({ token: token(1), name: 'Ana' }));
    await until(() => heard.statuses.at(-1) === 'joined');
    const socket = (conn as unknown as { socket: Socket }).socket;
    let dropped = false;
    socket.once('disconnect', () => (dropped = true));

    // The network drops the connection under the page (socket.io reconnects by itself).
    socket.io.engine.close();
    expect(dropped).toBe(true);
    const res = await conn.call('room:rename', 'Bea');
    expect(res).toEqual({ ok: true });
    await until(() => heard.states.at(-1)?.players[0]?.name === 'Bea');
    expect(heard.statuses).not.toContain('reconnecting');
  });

  it('says it is reconnecting once a drop outlasts its quiet time', async () => {
    rt = await bareRealtime();
    const roomId = rt.rooms.create('codenames', 'nobody');
    const { conn, heard, until } = open(roomId);
    conn.enable(() => ({ token: token(1), name: 'Ana' }));
    await until(() => heard.statuses.at(-1) === 'joined');

    const at = Date.now();
    const down = rt;
    rt = undefined;
    await down.close();
    await until(() => heard.statuses.at(-1) === 'reconnecting');
    expect(Date.now() - at).toBeGreaterThanOrEqual(QUIET_DROP_MS - 50);
  });

  it('a short look away changes nothing', async () => {
    rt = await bareRealtime();
    const roomId = rt.rooms.create('codenames', 'nobody');
    const { conn, heard, until } = open(roomId);
    conn.enable(() => ({ token: token(1), name: 'Ana' }));
    await until(() => heard.statuses.at(-1) === 'joined');
    const now = Date.now();
    conn.visibility(false, now - 5_000);
    conn.visibility(true, now);
    expect(heard.catchingUp).toEqual([]);
    expect(heard.statuses.at(-1)).toBe('joined');
  });

  it('joins with the connection itself, sending no separate join', async () => {
    rt = await bareRealtime();
    const roomId = rt.rooms.create('codenames', 'nobody');
    const { conn, heard, until } = open(roomId);
    const socket = (conn as unknown as { socket: Socket }).socket;
    const sent: string[] = [];
    socket.onAnyOutgoing((event: string) => sent.push(event));
    conn.enable(() => ({ token: token(1), name: 'Ana' }));
    await until(() => heard.statuses.at(-1) === 'joined');
    expect(heard.states.at(-1)?.players.map((p) => p.name)).toEqual(['Ana']);
    expect(sent).toEqual([]);
  });

  it('a join refused with the connection says why', async () => {
    rt = await bareRealtime();
    const { conn, heard, until } = open('zzzzzzzzzz');
    conn.enable(() => ({ token: token(1), name: 'Ana' }));
    await until(() => heard.statuses.at(-1) === 'error');
    expect(heard.states).toEqual([]);
  });

  it('the next room page reuses the open connection and leaves the last room', async () => {
    rt = await bareRealtime();
    const first = rt.rooms.create('codenames', 'nobody');
    const second = rt.rooms.create('codenames', 'nobody');
    const a = open(first);
    a.conn.enable(() => ({ token: token(1), name: 'Ana' }));
    await a.until(() => a.heard.statuses.at(-1) === 'joined');
    const socketOf = (c: RoomConnection) => (c as unknown as { socket: Socket }).socket;
    const before = socketOf(a.conn);
    a.conn.dispose();
    conns.splice(conns.indexOf(a.conn), 1);

    const b = open(second);
    expect(socketOf(b.conn)).toBe(before);
    b.conn.enable(() => ({ token: token(1), name: 'Ana' }));
    await b.until(() => b.heard.statuses.at(-1) === 'joined');
    // Only the new room's state reaches the new page.
    expect(b.heard.states.map((s) => s.players.length)).toEqual([1]);
    expect(rt.rooms.snapshot(first, 'x')?.players[0]?.connected).toBe(false);
    expect(a.heard.states.length).toBe(1);
  });

  it('refuses a tap at once when the page left the room for good', async () => {
    rt = await bareRealtime();
    const roomId = rt.rooms.create('codenames', 'nobody');
    const { conn, heard, until } = open(roomId);
    conn.enable(() => ({ token: token(1), name: 'Ana' }));
    await until(() => heard.statuses.at(-1) === 'joined');
    conn.close();
    const res = await conn.call('room:rename', 'Bea');
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error.code).toBe('offline');
  });
});
