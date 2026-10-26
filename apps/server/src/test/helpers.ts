import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type Ack,
  type ClientToServerEvents,
  type Patch,
  type RoomSnapshot,
  type ServerToClientEvents,
  applyPatch,
} from '@vt/protocol';
import Fastify from 'fastify';
import { type Socket, io } from 'socket.io-client';
import { type AppOptions, buildApp } from '../app.ts';
import { openDb } from '../db/index.ts';
import { buildGames } from '../games/registry.ts';
import { type RealtimeOptions, attachRealtime, createRoomEvents } from '../realtime.ts';
import { RoomManager } from '../rooms/manager.ts';
import { SqliteRoomStore } from '../rooms/store.ts';
import { WordListRepo } from '../word-lists.ts';

export const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** The socket layer on its own, with no HTTP routes, for options the full app does not expose. */
export async function bareRealtime(opts: RealtimeOptions = {}) {
  const db = openDb(':memory:', MIGRATIONS);
  const content = new WordListRepo(db);
  content.seedIfEmpty();
  const holder: { io?: ReturnType<typeof attachRealtime> } = {};
  const rooms: RoomManager = new RoomManager({
    store: new SqliteRoomStore(db),
    games: buildGames(),
    content,
    events: createRoomEvents(
      () => holder.io,
      () => rooms,
    ),
    logger: { warn: () => {}, error: () => {} },
  });
  const server = createServer();
  const gate = { isPrivateRoom: () => false, hasBackroom: () => false };
  holder.io = attachRealtime(server, rooms, Fastify({ logger: false }).log, gate, opts);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  const url = typeof addr === 'object' && addr ? `http://127.0.0.1:${addr.port}` : '';
  return {
    url,
    rooms,
    close: async () => {
      rooms.close();
      await holder.io!.close();
    },
  };
}

export function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'vt-test-'));
  return {
    path: join(dir, 'test.db'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

export function testApp(overrides: Partial<AppOptions> = {}) {
  return buildApp({
    version: 'test',
    databasePath: ':memory:',
    migrationsFolder: MIGRATIONS,
    sessionSecret: 'test-secret',
    adminPassword: 'hunter2',
    ...overrides,
  });
}

export const token = (n: number) => `test-token-${String(n).padStart(24, '0')}`;

/** Whether `connect` joins as a browser that takes patches (see `patch-mode.ts`). */
let patchClients = false;
export function setPatchClients(on: boolean) {
  patchClients = on;
}

export type TestClient = Socket<ServerToClientEvents, ClientToServerEvents> & {
  latest: () => RoomSnapshot | null;
  /** Messages received: whole rooms, patches, and patches that didn't fit (each asks again). */
  received: { full: number; patch: number; misfit: number };
  /** Resolves with the next snapshot matching `predicate` (or the current one if it already does). */
  until: (predicate: (s: RoomSnapshot) => boolean) => Promise<RoomSnapshot>;
  call: <E extends keyof ClientToServerEvents>(event: E, ...args: unknown[]) => Promise<Ack>;
};

/**
 * A test socket. With `patches` (default: `setPatchClients`), it joins saying it takes patches
 * and rebuilds each room from them like the browser; its `room:state` listeners then hear every
 * rebuilt room, patched or whole.
 */
export async function connect(
  url: string,
  cookie?: string,
  headers: Record<string, string> = {},
  { patches = patchClients }: { patches?: boolean } = {},
): Promise<TestClient> {
  const extraHeaders = { ...headers, ...(cookie && { cookie }) };
  const socket = io(url, {
    transports: ['websocket'],
    forceNew: true,
    extraHeaders: Object.keys(extraHeaders).length ? extraHeaders : undefined,
  }) as TestClient;
  let latest: RoomSnapshot | null = null;
  const waiters = new Set<{
    p: (s: RoomSnapshot) => boolean;
    resolve: (s: RoomSnapshot) => void;
  }>();
  const received = { full: 0, patch: 0, misfit: 0 };
  const listeners: ((s: RoomSnapshot) => void)[] = [];
  const got = (s: RoomSnapshot) => {
    latest = s;
    for (const w of waiters) {
      if (w.p(s)) {
        waiters.delete(w);
        w.resolve(s);
      }
    }
    for (const fn of listeners) fn(s);
  };
  let copy: { seq?: number; snapshot: RoomSnapshot } | null = null;
  socket.on('room:state', ({ seq, ...s }) => {
    received.full += 1;
    if (patches) copy = { ...(seq !== undefined && { seq }), snapshot: s };
    got(s);
  });
  socket.on('room:patch', (p) => {
    received.patch += 1;
    if (!patches) throw new Error('a patch reached a socket that never asked for them');
    if (!copy || copy.seq !== p.base) {
      received.misfit += 1;
      copy = null;
      socket.emit('room:resync', () => {});
      return;
    }
    const snapshot = {
      ...applyPatch(copy.snapshot, JSON.parse(JSON.stringify(p.ops)) as Patch),
      serverNow: p.serverNow,
    };
    copy = { seq: p.seq, snapshot };
    got(snapshot);
  });
  if (patches) {
    const on = socket.on.bind(socket);
    socket.on = ((event: string, fn: (...a: never[]) => void) =>
      event === 'room:state'
        ? (listeners.push(fn as (s: RoomSnapshot) => void), socket)
        : on(event as 'connect', fn)) as typeof socket.on;
    const emit = socket.emit.bind(socket);
    socket.emit = (event: string, ...args: unknown[]) =>
      (emit as (...a: unknown[]) => typeof socket)(
        event,
        ...(event === 'room:join' && typeof args[0] === 'object'
          ? [{ ...(args[0] as object), patch: true }, ...args.slice(1)]
          : args),
      );
  }
  socket.received = received;
  socket.latest = () => latest;
  socket.until = (p) =>
    latest && p(latest)
      ? Promise.resolve(latest)
      : new Promise((resolve, reject) => {
          const w = { p, resolve };
          waiters.add(w);
          setTimeout(() => {
            if (waiters.delete(w)) reject(new Error('timed out waiting for room state'));
          }, 3000);
        });
  socket.call = (event, ...args) =>
    new Promise((resolve) => {
      (socket.emit as (...a: unknown[]) => void)(event, ...args, resolve);
    });
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}
