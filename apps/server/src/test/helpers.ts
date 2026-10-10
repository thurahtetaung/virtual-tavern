import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Ack, ClientToServerEvents, RoomSnapshot, ServerToClientEvents } from '@vt/protocol';
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
  const gate = { isPrivateRoom: () => false, isUnlocked: () => false };
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

export type TestClient = Socket<ServerToClientEvents, ClientToServerEvents> & {
  latest: () => RoomSnapshot | null;
  /** Resolves with the next snapshot matching `predicate` (or the current one if it already does). */
  until: (predicate: (s: RoomSnapshot) => boolean) => Promise<RoomSnapshot>;
  call: <E extends keyof ClientToServerEvents>(event: E, ...args: unknown[]) => Promise<Ack>;
};

export async function connect(url: string, cookie?: string): Promise<TestClient> {
  const socket = io(url, {
    transports: ['websocket'],
    forceNew: true,
    extraHeaders: cookie ? { cookie } : undefined,
  }) as TestClient;
  let latest: RoomSnapshot | null = null;
  const waiters = new Set<{
    p: (s: RoomSnapshot) => boolean;
    resolve: (s: RoomSnapshot) => void;
  }>();
  socket.on('room:state', (s) => {
    latest = s;
    for (const w of waiters) {
      if (w.p(s)) {
        waiters.delete(w);
        w.resolve(s);
      }
    }
  });
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
