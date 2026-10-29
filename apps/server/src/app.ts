import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import fastifyCookie from '@fastify/cookie';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyRequest, type FastifyServerOptions } from 'fastify';
import type { LockReason } from '@vt/protocol';
import { EDGE_COOKIE } from '@vt/protocol/edge';
import { ADMIN_COOKIE, AdminAuth } from './admin-auth.ts';
import { dbHealthy, openDb } from './db/index.ts';
import { BACKROOM_COOKIE, Backroom } from './backroom.ts';
import { EdgePass } from './edge.ts';
import { offsiteStatusPath, readOffsiteStatus } from './backup-status.ts';
import {
  type GameRegistry,
  buildGames,
  isPrivate,
  questionDeckGameIds,
  openQuestionGameIds,
} from './games/registry.ts';
import { NarrationLengths, withNarration } from './narration.ts';
import { R2Assets, type R2Config } from './r2.ts';
import {
  announceNextTable,
  attachRealtime,
  countSockets,
  createRoomEvents,
  sendPlaytestAwards,
} from './realtime.ts';
import { RecapStore } from './recap/hall.ts';
import { RecapService } from './recap/service.ts';
import { RecapSettings } from './recap/settings.ts';
import { BotRunner } from './rooms/bots.ts';
import { RoomManager } from './rooms/manager.ts';
import { PlaytestPreview } from './rooms/preview.ts';
import { SqliteRoomStore } from './rooms/store.ts';
import { TEST_SEED_HEADER, TestSeeds } from './rooms/test-seed.ts';
import { adminGuard, adminRoutes } from './routes/admin.ts';
import { backroomRoutes } from './routes/backroom.ts';
import { playtestRoutes } from './routes/playtest.ts';
import { gamesAdminRoutes } from './routes/games-admin.ts';
import { contentPackRoutes } from './routes/content-packs.ts';
import { publicRoutes } from './routes/public.ts';
import { statsRoutes } from './routes/stats.ts';
import { stageRoutes } from './routes/stage.ts';
import { STAGE_COOKIE, StageDoor } from './stage.ts';
import { addDays, dayOf } from './stats/days.ts';
import type { TavernMetrics } from './metrics/tavern.ts';
import { LiveTracker } from './stats/live.ts';
import { StatsRecorder } from './stats/recorder.ts';
import { SqliteStatsStore } from './stats/sqlite-store.ts';
import { RAW_RETENTION_DAYS } from './stats/types.ts';
import { forgetRoomStats } from './stats/forget-room.ts';
import { testTrafficCheck } from './test-traffic.ts';
import { GameSettingsStore, gameNamer, offMessage } from './game-settings.ts';
import { QuestionDeckRepo, roomContent } from './question-decks.ts';
import { ContentPackRepo, withContentPacks } from './content-packs.ts';
import { WordListRepo } from './word-lists.ts';
import { loadWordPacks } from './word-packs.ts';
import { Lists } from './routes/lists.ts';
import { Manifests } from './routes/manifests.ts';

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
  /** The games to serve; defaults to every registered game (tests add stand-ins). */
  games?: GameRegistry;
  /** Private asset storage; without it private games run but can't show pictures. */
  r2?: R2Config | null;
  /** `x-vt-test: <token>` marks test traffic, whose rooms record no stats. Unset: ignored. */
  statsIgnoreToken?: string | null;
  /** Rooms one address may create a minute; 20 by default. */
  roomCreateLimit?: number;
  /** Signs the edge pass for the Cloudflare Worker; unset, none is issued. */
  edgeSecret?: string | null;
  /** The off-site backup job's status file; defaults to `backups/` next to the database. */
  offsiteStatusPath?: string | null;
  /** How long a playtest bot thinks before a move (ms, before the speed factor); tests only. */
  botDelay?: (trivial: boolean) => number;
  /** Test builds only (`VT_TEST_SEED`): rooms draw their randomness from this seed. */
  testSeed?: string | null;
  /** Prometheus metrics to keep up to date; served on their own port by the caller, if at all. */
  metrics?: TavernMetrics | null;
}

const SWEEP_EVERY_MS = 60 * 60_000;
/** How often ended playtests are looked for. */
const PLAYTEST_SWEEP_EVERY_MS = 5 * 60_000;
/** A playtest with no seat connected for this long is deleted. */
export const PLAYTEST_IDLE_MS = 15 * 60_000;
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
  const offsiteStatusFile =
    opts.offsiteStatusPath === undefined
      ? offsiteStatusPath(opts.databasePath)
      : opts.offsiteStatusPath;
  const games = opts.games ?? buildGames();
  const backroom = new Backroom(db, now);
  const edge = opts.edgeSecret ? new EdgePass(opts.edgeSecret) : null;
  const adminAuth = opts.adminPassword
    ? new AdminAuth(opts.adminPassword, opts.sessionSecret)
    : null;
  const assets = opts.r2 ? new R2Assets(opts.r2) : null;
  // Private games may time their night by their narrator's clips, from their manifest.
  const narration = assets
    ? new NarrationLengths(assets, now, (err, gameId) =>
        app.log.warn({ err, gameId }, 'could not read narration lengths'),
      )
    : null;
  const gameSettings = new GameSettingsStore(db, games);
  const gameName = gameNamer(games, gameSettings);
  const wordLists = new WordListRepo(db, now);
  wordLists.seedIfEmpty();
  if (opts.packsFolder) {
    const added = wordLists.seedPacks(loadWordPacks(opts.packsFolder));
    if (added.length) app.log.info({ packs: added }, 'added built-in word packs');
  }
  const questionDecks = new QuestionDeckRepo(
    db,
    now,
    questionDeckGameIds(games),
    openQuestionGameIds(games),
  );
  const contentPacks = new ContentPackRepo(db, games, now);

  const stats = new SqliteStatsStore(db, {
    gameIds: [...games.keys()],
    gameName,
    label: (key, value) =>
      key === 'wordList'
        ? wordLists.get(value)?.name
        : key === 'questionDeck'
          ? questionDecks.name(value)
          : undefined,
  });
  const isTestTraffic = testTrafficCheck(opts.statsIgnoreToken);
  // Test rooms record nothing; `rooms` is assigned below, before any room can exist.
  const isTestRoom = (roomId: string) => rooms.isTest(roomId);
  const metrics = opts.metrics ?? null;
  const recorder = new StatsRecorder({
    store: stats,
    logger: app.log,
    isTestRoom,
    ...(metrics && {
      onEvent: (e) => metrics.event(e),
      onFlush: (seconds, ok) => metrics.flush(seconds, ok),
    }),
  });
  const recapSettings = new RecapSettings(db, now);
  /** Whether a request carries a current admin session. */
  const isAdminRequest = (req: FastifyRequest) => adminAuth?.isAdmin(req, now()) ?? false;
  /** Unsigns one cookie from a raw `Cookie` header (sockets have no parsed cookies). */
  const signedCookie = (header: string | undefined, name: string) => {
    const raw = header ? app.parseCookie(header)[name] : undefined;
    if (!raw) return null;
    const { valid, value } = app.unsignCookie(raw);
    return valid ? value : null;
  };
  /**
   * The one back-room check, for every door (HTTP and socket): a current unlock, or a current
   * admin session, since the admin always has the back room.
   */
  const hasBackroom = (cookieHeader: string | undefined) =>
    backroom.isUnlocked(signedCookie(cookieHeader, BACKROOM_COOKIE)) ||
    (adminAuth?.isAdminValue(signedCookie(cookieHeader, ADMIN_COOKIE), now()) ?? false);
  const requestHasBackroom = (req: FastifyRequest) => hasBackroom(req.headers.cookie);
  const testSeeds = opts.testSeed ? new TestSeeds(opts.testSeed) : null;
  /** The seed a test browser asks for its new room; only a test build listens. */
  const testSeedOf = (req: FastifyRequest) => {
    const seed = testSeeds && req.headers[TEST_SEED_HEADER];
    return typeof seed === 'string' && seed ? seed.slice(0, 200) : undefined;
  };
  /**
   * Why a cookie without the back room was turned away: an admin session that ended (signed out,
   * or the admin password changed) comes first, since that is what let the admin in; then an
   * unlock from before the word changed; otherwise there was no current unlock at all.
   */
  const lockReason = (cookieHeader: string | undefined): LockReason => {
    if (signedCookie(cookieHeader, ADMIN_COOKIE)) return 'signed-out';
    if (backroom.isStale(signedCookie(cookieHeader, BACKROOM_COOKIE))) return 'changed';
    return 'none';
  };
  const recapStore = new RecapStore(db);
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
  const roomEvents = createRoomEvents(
    () => realtime.io,
    () => rooms,
    metrics ? (seconds, sizes) => metrics.broadcast(seconds, sizes) : undefined,
  );
  const rooms: RoomManager = new RoomManager({
    store: new SqliteRoomStore(db),
    games,
    content: withNarration(
      withContentPacks(roomContent(wordLists, questionDecks, games), contentPacks, games),
      games,
      narration,
    ),
    // Every change also wakes the playtest bots (they move only in playtests with a human in).
    events: {
      changed: (roomId) => {
        roomEvents.changed(roomId);
        bots.poke(roomId);
      },
      kicked: (roomId, playerId) => roomEvents.kicked(roomId, playerId),
      closed: (roomId) => {
        bots.stop(roomId);
        roomEvents.closed?.(roomId);
      },
    },
    now,
    testSeeds,
    logger: app.log,
    observer: {
      observe(o) {
        // A playtest's awards are worked out in memory, never recorded (it is a test room too).
        if (o.kind === 'room.swept' || rooms.isPlaytest(o.roomId)) preview.observe(o);
        recorder.observe(o);
        if (o.kind === 'room.swept') recapSettings.forget(o.roomId);
        // A test room never freezes a night; a sweep still clears up after it.
        if (!o.test || o.kind === 'room.swept') recap.observe(o);
      },
    },
    recapMeta: (roomId) => recap.meta(roomId),
    gameOff: (gameId) => (gameSettings.enabled(gameId) ? null : offMessage(gameName(gameId))),
  });
  const recap: RecapService = new RecapService({
    source: stats,
    store: recapStore,
    games,
    gameName,
    rooms,
    settings: recapSettings,
    flush: () => recorder.flush(),
    record: (type, at, props) => recorder.record(type, at, props),
    changed: (roomId) => roomEvents.changed(roomId),
    logger: app.log,
    now,
    isTestRoom,
  });
  const bots: BotRunner = new BotRunner({
    rooms,
    // Bots get word lists, open questions' common answers and content packs (Sketchy's prompts,
    // for fake titles); never trivia answers or decoys.
    words: (gameId, ids) => wordLists.forGame(gameId).words(ids),
    hints: (gameId, id) => questionDecks.hints(gameId, id),
    contentPacks: (gameId, kind) => contentPacks.forGame(gameId).contentPacks(kind),
    logger: app.log,
    now,
    ...(opts.botDelay && { delay: opts.botDelay }),
    ...(testSeeds && { seed: (roomId: string, key: string) => testSeeds.draw(roomId, key) }),
  });
  const preview = new PlaytestPreview({
    games,
    tone: (roomId) => recapSettings.room(roomId).tone,
    send: (roomId, lines) => {
      if (realtime.io) sendPlaytestAwards(realtime.io, roomId, lines);
    },
    logger: app.log,
  });
  const isPrivateRoom = (roomId: string) =>
    isPrivate(games.get(rooms.exists(roomId)?.gameId ?? ''));
  const stageDoor = new StageDoor({ rooms, backroom, isPrivateRoom, now });
  /** The room a raw `Cookie` header's table-screen pass opens right now, or null. */
  const stageRoomOf = (cookieHeader: string | undefined) =>
    stageDoor.roomOf(signedCookie(cookieHeader, STAGE_COOKIE));
  const stageRoom = (req: FastifyRequest) => stageRoomOf(req.headers.cookie);
  /** The game a request's table-screen pass is for (its back-room art and manifest only). */
  const stageGame = (req: FastifyRequest) => {
    const roomId = stageRoom(req);
    return roomId ? (rooms.exists(roomId)?.gameId ?? null) : null;
  };
  const isAdminHeader = (header: string | undefined) =>
    adminAuth?.isAdminValue(signedCookie(header, ADMIN_COOKIE), now()) ?? false;
  const io = (realtime.io = attachRealtime(
    app.server,
    rooms,
    app.log,
    {
      isPrivateRoom,
      hasBackroom,
      lockReason,
      isPlaytest: (roomId) => rooms.isPlaytest(roomId),
      isAdmin: isAdminHeader,
      // A pass opens its own room only; in a playtest the admin needs no code either.
      stageAllowed: (roomId, header) =>
        stageRoomOf(header) === roomId || (rooms.isPlaytest(roomId) && isAdminHeader(header)),
    },
    {
      recap,
      stage: stageDoor,
      isTestTraffic,
      playtestAwards: (roomId) => preview.latest(roomId),
      ...(metrics && {
        onRefusal: (roomId: string, code: string) => {
          const room = rooms.exists(roomId);
          if (room && !rooms.isTest(roomId)) metrics.refusal(room.gameId, code);
        },
      }),
    },
  ));

  // A new password or "Sign everyone out" sends players in back-room rooms to the door right
  // away: the broadcast re-checks every socket's unlock and turns the stale ones away.
  backroom.onVersionChange(() => {
    for (const room of rooms.occupiedRooms()) {
      if (isPrivate(games.get(room.gameId))) roomEvents.changed(room.id);
    }
  });

  const sweepMs = (opts.roomIdleDays ?? 7) * 24 * 60 * 60_000;
  const sweeper = setInterval(() => {
    rooms.sweep(sweepMs);
    maintainStats();
  }, SWEEP_EVERY_MS);
  sweeper.unref();
  const playtestSweeper = setInterval(() => {
    const removed = rooms.sweepPlaytests(PLAYTEST_IDLE_MS);
    if (removed) app.log.info({ removed }, 'swept idle playtests');
  }, PLAYTEST_SWEEP_EVERY_MS);
  playtestSweeper.unref();

  const live = new LiveTracker({
    rooms: () => rooms.liveRooms(),
    // Seat tabs of a playtest (and test traffic) are not real visitors.
    sockets: () => countSockets(io, (roomId) => rooms.isTest(roomId)),
    playtests: () => rooms.playtestsRunning(),
    recentPlayers: (since) => recorder.recentPlayers(since),
    gameName,
    now,
  });
  const liveSampler = setInterval(() => live.sample(), LIVE_SAMPLE_MS);
  liveSampler.unref();

  if (metrics) {
    metrics.attach({
      version: opts.version,
      gameIds: [...games.keys()],
      liveRooms: () => rooms.liveRooms(),
      sockets: () => countSockets(io, (roomId) => rooms.isTest(roomId)),
      playtests: () => rooms.playtestsRunning(),
      databasePath: opts.databasePath,
      offsiteStatusPath: offsiteStatusFile,
      now,
    });
    app.addHook('onResponse', (_req, reply, done) => {
      metrics.response(reply.statusCode);
      done();
    });
  }

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

  // A back-room refusal (locked, unknown game, missing file, any error) must never be kept by a
  // cache keyed by URL alone, or an unlocked player could be handed a locked browser's 404.
  app.addHook('onSend', (req, reply, payload, done) => {
    if (req.url.startsWith('/api/backroom/') && reply.statusCode >= 400)
      void reply.header('cache-control', 'private, no-store');
    done(null, payload);
  });

  // Browsers unlocked before the edge pass existed (or whose pass is for an older unlock) get one
  // on their next API call.
  if (edge) {
    app.addHook('onRequest', (req, reply, done) => {
      if (req.url.startsWith('/api/')) {
        const header = req.headers.cookie;
        const unlock = signedCookie(header, BACKROOM_COOKIE);
        const pass = header ? app.parseCookie(header)[EDGE_COOKIE] : undefined;
        if (unlock && backroom.isUnlocked(unlock) && !edge.matches(pass, unlock))
          edge.set(reply, unlock, now());
      }
      done();
    });
  }

  app.get('/healthz', (_req, reply) => {
    if (!dbHealthy(db)) {
      reply.log.error('health check failed: database unavailable');
      return reply.code(503).send({ status: 'degraded', version: opts.version });
    }
    return { status: 'ok', version: opts.version };
  });

  const lists = new Lists({
    games,
    wordLists,
    hasBackroom: requestHasBackroom,
    settings: gameSettings,
    build: opts.version,
  });
  const manifests = new Manifests({ games, assets, settings: gameSettings, lists });
  void app.register((scope, _o, done) => {
    publicRoutes(scope, {
      rooms,
      games,
      lists,
      manifests,
      forget: (playerId) => recorder.forget(playerId) + recapStore.forgetPlayer(playerId),
      linkable: (nightKey, playerId) => recap.linkable(nightKey, playerId),
      isTestTraffic: (req) => isTestTraffic(req.headers),
      testSeedOf,
      roomCreateLimit: opts.roomCreateLimit ?? 20,
      isAdmin: isAdminRequest,
      stageRoom,
      linked: (from, next) => {
        const privateTable = isPrivate(games.get(next.gameId));
        for (const roomId of from) announceNextTable(io, roomId, next, privateTable);
      },
    });
    adminRoutes(scope, {
      auth: adminAuth,
      wordLists,
      questionDecks,
      backroom,
      recapSettings,
      offsiteStatus: () => readOffsiteStatus(offsiteStatusFile, now()),
      now,
      lists,
    });
    backroomRoutes(scope, {
      backroom,
      edge,
      now,
      games,
      assets,
      questionDecks,
      hasBackroom: requestHasBackroom,
      isAdmin: isAdminRequest,
      stageGame,
      lists,
      manifests,
    });
    stageRoutes(scope, { door: stageDoor, stageRoom });
    scope.register((admin, _a, ready) => {
      admin.addHook('preHandler', adminGuard(adminAuth, now));
      gamesAdminRoutes(admin, { games, assets, settings: gameSettings });
      contentPackRoutes(admin, { packs: contentPacks });
      playtestRoutes(admin, { rooms, games, settings: gameSettings, now, testSeedOf });
      statsRoutes(admin, {
        queries: stats,
        store: stats,
        live,
        gameIds: [...games.keys()],
        flush: () => recorder.flush(),
        onReset: () => recorder.reset(),
        recaps: recap,
        forgetRoom: (roomId, dryRun) => {
          const res = forgetRoomStats(db, stats, roomId, { dryRun, now: now() });
          if (!dryRun) {
            recorder.forgetRoom(roomId);
            // Drops the room's cached cards (its frozen nights are already gone).
            recap.forget(roomId);
          }
          return res;
        },
        now,
      });
      ready();
    });
    done();
  });

  if (opts.webDist && existsSync(opts.webDist)) {
    // Private games' code is built into /backroom-assets/ and only served to unlocked players
    // (and the admin), and to a back-room room's table screen (the chunks are shared by every
    // back-room game, and the code is no secret; art and manifests stay with its own game).
    const stageInBackroom = (req: FastifyRequest) => {
      const roomId = stageRoom(req);
      return !!roomId && isPrivateRoom(roomId);
    };
    app.addHook('onRequest', (req, reply, done) => {
      if (
        req.url.startsWith('/backroom-assets/') &&
        !requestHasBackroom(req) &&
        !stageInBackroom(req)
      ) {
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
          // Back-room chunks are content-hashed too, but `private`: no shared cache may keep them.
          // Only the edge Worker caches them, behind its own unlock check.
          path.startsWith('/backroom-assets/')
            ? reply.statusCode === 200
              ? 'private, max-age=31536000, immutable'
              : 'private, no-store'
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

  // Drop websockets first, or the HTTP server waits for them forever. Their clients are not told:
  // socket.io never retries a connection the server said goodbye on, while one that just drops
  // keeps trying until the server is back (what a restart needs).
  app.addHook('preClose', (done) => {
    for (const socket of io.of('/').sockets.values()) socket._onclose('server shutting down');
    io.engine.close();
    done();
  });
  app.addHook('onClose', (_app, done) => {
    clearInterval(sweeper);
    clearInterval(playtestSweeper);
    bots.close();
    clearInterval(liveSampler);
    rooms.close();
    recorder.close();
    db.$client.close();
    done();
  });

  return app;
}
