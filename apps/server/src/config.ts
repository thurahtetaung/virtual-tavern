import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { R2Config } from './r2.ts';

export interface Config {
  port: number;
  host: string;
  databasePath: string;
  migrationsFolder: string;
  /** Built-in word packs (`*.json`), added to the database once each. */
  packsFolder: string;
  webDist: string;
  /** Admin area is disabled when unset. */
  adminPassword: string | null;
  sessionSecret: string;
  version: string;
  logLevel: string;
  roomIdleDays: number;
  /** Private asset storage (Cloudflare R2); the back room works without it, just with no pictures. */
  r2: R2Config | null;
  /**
   * Requests carrying `x-vt-test: <this token>` are test traffic: their rooms record no stats.
   * Unset: the header means nothing.
   */
  statsIgnoreToken: string | null;
  /** Rooms one address may create a minute (the e2e suite, all on one address, raises it). */
  roomCreateLimit: number;
  /**
   * Signs the edge pass (`vt_edge`) that lets the Cloudflare Worker serve back-room files from
   * its cache. Unset: no pass is issued and the Worker, if any, passes every request through.
   */
  edgeSecret: string | null;
  /**
   * `VT_TEST_SEED`: every room's randomness comes from this seed (or the one its creator asks
   * for), so e2e specs replay. Never read in production.
   */
  testSeed: string | null;
  /**
   * `METRICS_PORT`: serves Prometheus metrics at `/metrics` on this port, apart from the app's
   * own. Unset: no metrics port.
   */
  metricsPort: number | null;
  /** Address the metrics port binds to (`METRICS_HOST`, default the app's `HOST`). */
  metricsHost: string;
}

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

/** Reads configuration from the environment. Paths default relative to `src/` and `dist/` alike. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const adminPassword = env.ADMIN_PASSWORD?.trim() || null;
  const production = env.NODE_ENV === 'production';
  if (production && adminPassword && !env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET must be set when ADMIN_PASSWORD is set in production');
  }
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    databasePath: env.DATABASE_PATH ?? here('../data/tavern.db'),
    migrationsFolder: env.MIGRATIONS_DIR ?? here('../drizzle'),
    packsFolder: env.WORD_PACKS_DIR ?? here('../word-packs'),
    webDist: env.WEB_DIST ?? here('../../web/dist'),
    adminPassword,
    // Dev fallback: sessions just don't survive restarts.
    sessionSecret: env.SESSION_SECRET ?? randomBytes(32).toString('hex'),
    version: env.APP_VERSION ?? 'dev',
    logLevel: env.LOG_LEVEL ?? 'info',
    roomIdleDays: Number(env.ROOM_IDLE_DAYS ?? 7),
    r2:
      env.R2_ACCOUNT_ID && env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_BUCKET
        ? {
            accountId: env.R2_ACCOUNT_ID,
            accessKeyId: env.R2_ACCESS_KEY_ID,
            secretAccessKey: env.R2_SECRET_ACCESS_KEY,
            bucket: env.R2_BUCKET,
          }
        : null,
    statsIgnoreToken: env.STATS_IGNORE_TOKEN?.trim() || null,
    roomCreateLimit: Number(env.ROOM_CREATE_LIMIT ?? 20),
    edgeSecret: env.EDGE_SECRET?.trim() || null,
    testSeed: (!production && env.VT_TEST_SEED?.trim()) || null,
    metricsPort: env.METRICS_PORT?.trim() ? Number(env.METRICS_PORT) : null,
    metricsHost: env.METRICS_HOST ?? env.HOST ?? '0.0.0.0',
  };
}
