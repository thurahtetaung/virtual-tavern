/**
 * Online SQLite backup (safe while the server is running).
 * Usage: node dist/backup.js [destination] — defaults to <db dir>/backups/tavern-<timestamp>.db,
 * keeping the newest BACKUP_KEEP (default 14) files in that folder.
 */
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { loadConfig } from './config.ts';

const { databasePath } = loadConfig();
const dir = join(dirname(databasePath), 'backups');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dest = process.argv[2] ?? join(dir, `tavern-${stamp}.db`);

mkdirSync(dirname(dest), { recursive: true });
const db = new Database(databasePath, { readonly: true, fileMustExist: true });
await db.backup(dest);
db.close();
console.log(`Backed up ${databasePath} -> ${dest}`);

const keep = Number(process.env.BACKUP_KEEP ?? 14);
const old = readdirSync(dir)
  .filter((f) => f.endsWith('.db'))
  .sort()
  .slice(0, -keep);
for (const f of old) rmSync(join(dir, f));
