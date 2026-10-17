import type { RoomSnapshot } from '@vt/protocol';
import type { Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CATCH_UP_AFTER_MS,
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
    expect(heard.statuses).toContain('reconnecting');
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
    expect(heard.statuses.slice(-2)).toEqual(['reconnecting', 'joined']);
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
