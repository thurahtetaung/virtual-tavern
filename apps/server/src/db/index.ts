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
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return db;
}
