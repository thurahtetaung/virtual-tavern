import { request } from 'node:http';
import type { CodenamesView } from '@vt/game-codenames/logic';
import type { RoomSnapshot } from '@vt/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { SOCKET_OPTIONS } from './realtime.ts';
import { connect, testApp, token } from './test/helpers.ts';

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const fn of cleanups.reverse()) await fn();
  cleanups.length = 0;
});

async function server() {
  const app = testApp();
  await app.listen({ port: 0, host: '127.0.0.1' });
  cleanups.push(() => app.close());
  const addr = app.server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { app, port, url: `http://127.0.0.1:${port}` };
}

async function room(app: Awaited<ReturnType<typeof server>>['app'], gameId = 'codenames') {
  return (
    await app.inject({ method: 'POST', url: '/api/rooms', payload: { gameId, token: token(0) } })
  ).json<{ roomId: string }>().roomId;
}

async function client(url: string, patches: boolean) {
  const c = await connect(url, undefined, {}, { patches });
  cleanups.push(() => void c.close());
  return c;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 100));
const clockless = (s: RoomSnapshot | null) => ({ ...s, serverNow: 0 });

describe('room updates as patches', () => {
  it('sends patches only to sockets that asked, and both rebuild the same room', async () => {
    const { app, url } = await server();
    const roomId = await room(app);
    // Two tabs of the host: an old browser and a new one.
    const old = await client(url, false);
    const fresh = await client(url, true);
    const ana = await client(url, true);
    await old.call('room:join', { roomId, token: token(0), name: 'Host' });
    await fresh.call('room:join', { roomId, token: token(0), name: 'Host' });
    await ana.call('room:join', { roomId, token: token(1), name: 'Ana' });
    await old.call('game:action', { type: 'join-team', team: 'red', role: 'spymaster' });
    await ana.call('game:action', { type: 'join-team', team: 'red', role: 'operative' });
    await fresh.until((s) => s.players.length === 2);
    await settle();
    expect(old.received.patch).toBe(0);
    expect(fresh.received.full).toBe(1);
    expect(fresh.received.patch).toBeGreaterThan(0);
    expect(fresh.received.misfit).toBe(0);
    expect(clockless(fresh.latest())).toEqual(clockless(old.latest()));
    expect((fresh.latest()!.game as CodenamesView).phase).toBe('lobby');
  });

  it('sends the whole room again on a join, a new room and a resync', async () => {
    const { app, url } = await server();
    const roomA = await room(app);
    const roomB = await room(app);
    const c = await client(url, true);
    const other = await client(url, true);
    await c.call('room:join', { roomId: roomA, token: token(1), name: 'Ana' });
    await other.call('room:join', { roomId: roomA, token: token(2), name: 'Ben' });
    await c.until((s) => s.players.length === 2);
    expect(c.received.full).toBe(1);
    expect(c.received.patch).toBe(1);

    // Joining again (a browser re-sending its join) starts from the whole room.
    await c.call('room:join', { roomId: roomA, token: token(1), name: 'Ana' });
    await settle();
    expect(c.received.full).toBe(2);

    // Moving to another room on the same connection never patches across rooms.
    await c.call('room:join', { roomId: roomB, token: token(1), name: 'Ana' });
    await c.until((s) => s.id === roomB);
    expect(c.received.full).toBe(3);

    // A browser whose copy went wrong asks for the whole room, then patches resume on it.
    expect(await c.call('room:resync')).toEqual({ ok: true });
    await settle();
    expect(c.received.full).toBe(4);
    const bob = await client(url, true);
    await bob.call('room:join', { roomId: roomB, token: token(3), name: 'Bob' });
    await c.until((s) => s.players.length === 2);
    expect(c.received.patch).toBe(2);
    expect(c.received.misfit).toBe(0);
  });

  it('a patch that does not fit its copy brings the whole room back', async () => {
    const { app, url } = await server();
    const roomId = await room(app);
    const c = await client(url, true);
    await c.call('room:join', { roomId, token: token(1), name: 'Ana' });
    await c.until((s) => s.players.length === 1);
    const ben = await client(url, true);
    await ben.call('room:join', { roomId, token: token(2), name: 'Ben' });
    await c.until((s) => s.players.length === 2);
    const before = c.received.full;
    // A patch for an update this socket never got (as if one went missing).
    (c as unknown as { listeners: (e: string) => ((p: unknown) => void)[] }).listeners(
      'room:patch',
    )[0]!({ seq: 999, base: 998, serverNow: 0, ops: [] });
    expect(c.received.misfit).toBe(1);
    await c.until(() => c.received.full > before);
    const cy = await client(url, true);
    await cy.call('room:join', { roomId, token: token(3), name: 'Cy' });
    await c.until((s) => s.players.length === 3);
    expect(c.received.misfit).toBe(1);
    expect(c.received.patch).toBeGreaterThan(2);
  });

  it('refuses a resync from a socket outside any room', async () => {
    const { url } = await server();
    const c = await client(url, true);
    expect(await c.call('room:resync')).toMatchObject({ ok: false, error: { code: 'not-joined' } });
  });
});

describe('no compression', () => {
  it('never agrees to compress the websocket, whatever the browser offers', async () => {
    expect(SOCKET_OPTIONS.perMessageDeflate).toBe(false);
    const { port } = await server();
    const headers = await new Promise<Record<string, unknown>>((resolve, reject) => {
      const req = request({
        host: '127.0.0.1',
        port,
        path: '/socket.io/?EIO=4&transport=websocket',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': Buffer.from('0123456789abcdef').toString('base64'),
          'Sec-WebSocket-Extensions': 'permessage-deflate; client_max_window_bits',
        },
      });
      req.on('upgrade', (res, socket) => {
        socket.destroy();
        resolve(res.headers);
      });
      req.on('response', (res) => reject(new Error(`no upgrade: ${res.statusCode}`)));
      req.on('error', reject);
      req.end();
    });
    expect(headers.upgrade).toBe('websocket');
    expect(headers['sec-websocket-extensions']).toBeUndefined();
  });
});
