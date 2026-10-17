import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { OffsiteBackupStatus } from '@vt/protocol';
import { z } from 'zod';

/** A last success older than this means the nightly off-site copy has stopped. */
export const OFFSITE_STALE_MS = 26 * 60 * 60_000;

/** Where the off-site job writes its result: `backups/` next to the database, like `backup.ts`. */
export function offsiteStatusPath(databasePath: string): string | null {
  return databasePath === ':memory:'
    ? null
    : join(dirname(databasePath), 'backups', 'offsite-status.json');
}

const count = z.number().int().nonnegative().optional();
const statusFile = z.object({
  at: z.string().refine((s) => !Number.isNaN(Date.parse(s))),
  ok: z.boolean(),
  key: z.string().max(300).optional(),
  bytes: count,
  copies: count,
  totalBytes: count,
  error: z.string().optional(),
});

/**
 * Reads the job's status file. Only the known fields leave, so nothing else the file may hold
 * reaches the admin page; an unreadable file reads as a failed run.
 */
export function readOffsiteStatus(path: string | null, now: number): OffsiteBackupStatus {
  if (!path) return { recorded: false };
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { recorded: false };
    throw err;
  }
  let parsed: z.infer<typeof statusFile>;
  try {
    parsed = statusFile.parse(JSON.parse(raw));
  } catch {
    return {
      recorded: true,
      at: new Date(now).toISOString(),
      ok: false,
      error: 'The status file could not be read.',
      stale: false,
    };
  }
  const { at, ok, key, bytes, copies, totalBytes, error } = parsed;
  return {
    recorded: true,
    at,
    ok,
    ...(key !== undefined && { key }),
    ...(bytes !== undefined && { bytes }),
    ...(copies !== undefined && { copies }),
    ...(totalBytes !== undefined && { totalBytes }),
    ...(!ok && { error: (error ?? 'No reason was given.').slice(0, 500) }),
    stale: ok && now - Date.parse(at) > OFFSITE_STALE_MS,
  };
}
