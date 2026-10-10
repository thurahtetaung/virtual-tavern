import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { type BetterSQLite3Database, drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.ts';

export type Db = BetterSQLite3Database<typeof schema> & { $client: Database.Database };

export function openDb(path: string, migrationsFolder: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  // The usual WAL setting: durable on a crash of the process, and the WAL is fsynced on
  // checkpoint rather than on every move (FULL fsyncs each transaction).
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return db;
}

/** Whether the database still answers queries; false once the handle is closed or the file is gone. */
export function dbHealthy(db: Db): boolean {
  try {
    return db.$client.prepare('select 1 as ok').pluck().get() === 1;
  } catch {
    return false;
  }
}
