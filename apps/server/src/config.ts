import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export interface Config {
  port: number;
  host: string;
  databasePath: string;
  migrationsFolder: string;
  webDist: string;
  /** Admin area is disabled when unset. */
  adminPassword: string | null;
  sessionSecret: string;
  version: string;
  logLevel: string;
  roomIdleDays: number;
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
    webDist: env.WEB_DIST ?? here('../../web/dist'),
    adminPassword,
    // Dev fallback: sessions just don't survive restarts.
    sessionSecret: env.SESSION_SECRET ?? randomBytes(32).toString('hex'),
    version: env.APP_VERSION ?? 'dev',
    logLevel: env.LOG_LEVEL ?? 'info',
    roomIdleDays: Number(env.ROOM_IDLE_DAYS ?? 7),
  };
}
