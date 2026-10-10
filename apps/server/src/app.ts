import { existsSync } from 'node:fs';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { openDb } from './db/index.ts';
import { BACKROOM_COOKIE, Backroom } from './backroom.ts';
import { buildGames, isPrivate } from './games/registry.ts';
import { R2Assets, type R2Config } from './r2.ts';
import { attachRealtime, createRoomEvents } from './realtime.ts';
import { RoomManager } from './rooms/manager.ts';
import { SqliteRoomStore } from './rooms/store.ts';
import { adminRoutes } from './routes/admin.ts';
import { backroomRoutes, requestUnlocked } from './routes/backroom.ts';
import { publicRoutes } from './routes/public.ts';
import { WordListRepo } from './word-lists.ts';
import { loadWordPacks } from './word-packs.ts';

export interface AppOptions {
  version: string;
  databasePath: string;
  migrationsFolder: string;
  /** Built-in word packs to add on startup; omitted in most tests. */
  packsFolder?: string;
  sessionSecret: string;
  adminPassword?: string | null;
  /** Built web app to serve; skipped if missing (e.g. in dev, where Vite serves it). */
  webDist?: string;
  roomIdleDays?: number;
  logger?: FastifyServerOptions['logger'];
  now?: () => number;
  /** Private asset storage; without it private games run but can't show pictures. */
  r2?: R2Config | null;
}

const SWEEP_EVERY_MS = 60 * 60_000;

export function buildApp(opts: AppOptions) {
  const now = opts.now ?? Date.now;
  // Cloudflare Tunnel sits in front in production; trust it for client IPs (rate limiting).
  const app = Fastify({ logger: opts.logger ?? false, trustProxy: true });

  const db = openDb(opts.databasePath, opts.migrationsFolder);
  const games = buildGames();
  const backroom = new Backroom(db, now);
  const assets = opts.r2 ? new R2Assets(opts.r2) : null;
  const wordLists = new WordListRepo(db, now);
  wordLists.seedIfEmpty();
  if (opts.packsFolder) {
    const added = wordLists.seedPacks(loadWordPacks(opts.packsFolder));
    if (added.length) app.log.info({ packs: added }, 'added built-in word packs');
  }

  // The manager and socket layer reference each other; break the cycle with a late-bound holder.
  const realtime: { io?: ReturnType<typeof attachRealtime> } = {};
  const rooms: RoomManager = new RoomManager({
    store: new SqliteRoomStore(db),
    games,
    content: wordLists,
    events: createRoomEvents(
      () => realtime.io,
      () => rooms,
    ),
    now,
  });
  const io = (realtime.io = attachRealtime(app.server, rooms, app.log, {
    isPrivateRoom: (roomId) => isPrivate(games.get(rooms.exists(roomId)?.gameId ?? '')),
    isUnlocked: (header) => {
      const raw = header ? app.parseCookie(header)[BACKROOM_COOKIE] : undefined;
      if (!raw) return false;
      const { valid, value } = app.unsignCookie(raw);
      return valid && backroom.isUnlocked(value);
    },
  }));

  const sweepMs = (opts.roomIdleDays ?? 7) * 24 * 60 * 60_000;
  const sweeper = setInterval(() => rooms.sweep(sweepMs), SWEEP_EVERY_MS);
  sweeper.unref();

  void app.register(fastifyCookie, { secret: opts.sessionSecret });
  void app.register(fastifyRateLimit, {
    global: false,
    keyGenerator: (req) => (req.headers['cf-connecting-ip'] as string | undefined) ?? req.ip,
  });

  app.get('/healthz', () => ({ status: 'ok', version: opts.version }));

  void app.register((scope, _o, done) => {
    publicRoutes(scope, {
      rooms,
      wordLists,
      games,
      unlocked: (req) => requestUnlocked(req, backroom),
    });
    adminRoutes(scope, { password: opts.adminPassword ?? null, wordLists, backroom, now });
    backroomRoutes(scope, { backroom, games, assets });
    done();
  });

  if (opts.webDist && existsSync(opts.webDist)) {
    // Private games' code is built into /backroom-assets/ and only served to unlocked players.
    app.addHook('onRequest', (req, reply, done) => {
      if (req.url.startsWith('/backroom-assets/') && !requestUnlocked(req, backroom)) {
        void reply.code(404).send({ error: { code: 'not-found', message: 'Not found.' } });
        return;
      }
      done();
    });
    void app.register(fastifyStatic, {
      root: opts.webDist,
      wildcard: false,
      // Cache-Control is set by the onSend hook below; the plugin's own header would conflict.
      cacheControl: false,
    });
    // Vite content-hashes everything under /assets/, so those files never change once published.
    // HTML must be revalidated so a deploy is picked up immediately.
    app.addHook('onSend', (req, reply, payload, done) => {
      const path = req.url.split('?', 1)[0]!;
      if (req.method === 'GET' && !path.startsWith('/api/') && path !== '/healthz') {
        const hashed = path.startsWith('/assets/') && reply.statusCode === 200;
        void reply.header(
          'cache-control',
          // Never let a shared cache (or Cloudflare's edge) keep a copy of private code.
          path.startsWith('/backroom-assets/')
            ? 'private, no-store'
            : hashed
              ? 'public, max-age=31536000, immutable'
              : 'no-cache',
        );
      }
      done(null, payload);
    });
    // Client-side routes (/r/:id, /admin, ...) all load the SPA shell; a missing asset is a real 404.
    app.setNotFoundHandler((req, reply) => {
      const spaRoute = !/^\/(api|assets|backroom-assets)\//.test(req.url);
      if (req.method === 'GET' && spaRoute) return reply.sendFile('index.html');
      return reply.code(404).send({ error: { code: 'not-found', message: 'Not found.' } });
    });
  }

  // Drop websockets first, or the HTTP server waits for them forever.
  app.addHook('preClose', (done) => {
    io.disconnectSockets(true);
    io.engine.close();
    done();
  });
  app.addHook('onClose', (_app, done) => {
    clearInterval(sweeper);
    rooms.close();
    db.$client.close();
    done();
  });

  return app;
}
