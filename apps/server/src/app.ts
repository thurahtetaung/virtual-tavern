import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { AdminAuth } from './admin-auth.ts';
import { dbHealthy, openDb } from './db/index.ts';
import { BACKROOM_COOKIE, Backroom } from './backroom.ts';
import { buildGames, isPrivate } from './games/registry.ts';
import { R2Assets, type R2Config } from './r2.ts';
import { attachRealtime, createRoomEvents } from './realtime.ts';
import { RoomManager } from './rooms/manager.ts';
import { SqliteRoomStore } from './rooms/store.ts';
import { adminGuard, adminRoutes } from './routes/admin.ts';
import { backroomRoutes, requestUnlocked } from './routes/backroom.ts';
import { publicRoutes } from './routes/public.ts';
import { statsRoutes } from './routes/stats.ts';
import { addDays, dayOf } from './stats/days.ts';
import { LiveTracker } from './stats/live.ts';
import { StatsRecorder } from './stats/recorder.ts';
import { SqliteStatsStore } from './stats/sqlite-store.ts';
import { RAW_RETENTION_DAYS } from './stats/types.ts';
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
const LIVE_SAMPLE_MS = 60_000;

/** Short error codes for the statuses Fastify and its plugins raise on their own. */
const ERROR_CODES: Record<number, string> = {
  400: 'bad-request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not-found',
  413: 'too-large',
  415: 'unsupported-media-type',
  429: 'rate-limited',
};

/**
 * Loopback, link-local and private (RFC 1918 / ULA) addresses: where the Cloudflare tunnel on the
 * host, or Docker's bridge, connects from. Only those peers are believed about who the client is.
 */
export function isLocalAddress(address: string | undefined): boolean {
  if (!address) return false;
  const ip = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number) as [number, number];
    return (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    return lower === '::1' || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
  }
  return false;
}

export function buildApp(opts: AppOptions) {
  const now = opts.now ?? Date.now;
  const app = Fastify({
    logger: opts.logger ?? false,
    // Cloudflare Tunnel sits in front in production and runs on the host, so forwarded client
    // addresses are believed only from local peers. Anyone reaching the port directly is
    // identified by their own address, whatever headers they send.
    trustProxy: (address) => isLocalAddress(address),
  });

  const db = openDb(opts.databasePath, opts.migrationsFolder);
  const games = buildGames();
  const backroom = new Backroom(db, now);
  const adminAuth = opts.adminPassword
    ? new AdminAuth(opts.adminPassword, opts.sessionSecret)
    : null;
  const assets = opts.r2 ? new R2Assets(opts.r2) : null;
  const wordLists = new WordListRepo(db, now);
  wordLists.seedIfEmpty();
  if (opts.packsFolder) {
    const added = wordLists.seedPacks(loadWordPacks(opts.packsFolder));
    if (added.length) app.log.info({ packs: added }, 'added built-in word packs');
  }

  const stats = new SqliteStatsStore(db, {
    gameIds: [...games.keys()],
    gameName: (id) => games.get(id)?.name ?? id,
    label: (key, value) => (key === 'wordList' ? wordLists.get(value)?.name : undefined),
  });
  const recorder = new StatsRecorder({ store: stats, logger: app.log });
  /** Rolls up finished days and drops raw events past retention; never fails the caller. */
  const maintainStats = () => {
    try {
      recorder.flush();
      const today = dayOf(now());
      for (const day of stats.unrolledDays(today)) stats.rollupDay(day, now());
      const pruned = stats.prune(addDays(today, -RAW_RETENTION_DAYS));
      if (pruned) app.log.info({ pruned }, 'pruned old stats events');
    } catch (err) {
      app.log.error({ err }, 'stats maintenance failed');
    }
  };
  maintainStats();

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
    logger: app.log,
    observer: recorder,
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
  const sweeper = setInterval(() => {
    rooms.sweep(sweepMs);
    maintainStats();
  }, SWEEP_EVERY_MS);
  sweeper.unref();

  const live = new LiveTracker({
    rooms: () => rooms.liveRooms(),
    sockets: () => io.engine.clientsCount,
    recentPlayers: (since) => recorder.recentPlayers(since),
    gameName: (id) => games.get(id)?.name ?? id,
    now,
  });
  const liveSampler = setInterval(() => live.sample(), LIVE_SAMPLE_MS);
  liveSampler.unref();

  void app.register(fastifyCookie, { secret: opts.sessionSecret });
  void app.register(fastifyRateLimit, {
    global: false,
    keyGenerator: (req) => {
      const cf = req.headers['cf-connecting-ip'];
      return typeof cf === 'string' && cf && isLocalAddress(req.socket.remoteAddress) ? cf : req.ip;
    },
  });

  // Every error leaves in the `{ error: { code, message } }` shape the client expects. Server
  // errors are logged with the request id and never describe themselves to the browser.
  app.setErrorHandler((err: unknown, req, reply) => {
    const { statusCode, message } = (err !== null && typeof err === 'object' ? err : {}) as {
      statusCode?: unknown;
      message?: unknown;
    };
    const status = typeof statusCode === 'number' && statusCode >= 400 ? statusCode : 500;
    if (status >= 500) {
      // The request logger carries the request id, so the log line can be matched to the reply.
      req.log.error({ err }, 'request failed');
      return reply
        .code(500)
        .send({ error: { code: 'server-error', message: 'Something went wrong.' } });
    }
    const code = ERROR_CODES[status] ?? `http-${status}`;
    const text = typeof message === 'string' && message ? message : code;
    return reply.code(status).send({ error: { code, message: text } });
  });

  app.get('/healthz', (_req, reply) => {
    if (!dbHealthy(db)) {
      reply.log.error('health check failed: database unavailable');
      return reply.code(503).send({ status: 'degraded', version: opts.version });
    }
    return { status: 'ok', version: opts.version };
  });

  void app.register((scope, _o, done) => {
    publicRoutes(scope, {
      rooms,
      wordLists,
      games,
      unlocked: (req) => requestUnlocked(req, backroom),
    });
    adminRoutes(scope, { auth: adminAuth, wordLists, backroom, now });
    backroomRoutes(scope, { backroom, games, assets });
    scope.register((admin, _a, ready) => {
      admin.addHook('preHandler', adminGuard(adminAuth, now));
      statsRoutes(admin, {
        queries: stats,
        store: stats,
        live,
        gameIds: [...games.keys()],
        flush: () => recorder.flush(),
        onReset: () => recorder.reset(),
        now,
      });
      ready();
    });
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
    clearInterval(liveSampler);
    rooms.close();
    recorder.close();
    db.$client.close();
    done();
  });

  return app;
}
