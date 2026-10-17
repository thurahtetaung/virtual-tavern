import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { offsiteStatusPath } from './backup-status.ts';
import { testApp } from './test/helpers.ts';

const NOW = Date.parse('2026-10-17T12:00:00Z');
const HOUR = 60 * 60_000;

describe('GET /api/admin/backup-status', () => {
  const cleanups: (() => unknown)[] = [];
  afterEach(async () => {
    for (const fn of cleanups.reverse()) await fn();
    cleanups.length = 0;
  });

  async function start(file?: unknown) {
    const dir = mkdtempSync(join(tmpdir(), 'vt-offsite-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const path = join(dir, 'offsite-status.json');
    if (file !== undefined) {
      writeFileSync(path, typeof file === 'string' ? file : JSON.stringify(file));
    }
    const app = testApp({ offsiteStatusPath: path, now: () => NOW });
    cleanups.push(() => app.close());
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { password: 'hunter2' },
    });
    const admin = `vt_admin=${login.cookies.find((c) => c.name === 'vt_admin')!.value}`;
    const get = (cookie: string | null = admin) =>
      app.inject({ url: '/api/admin/backup-status', headers: cookie ? { cookie } : {} });
    return { get };
  }

  const ok = {
    at: new Date(NOW - 8 * HOUR).toISOString(),
    ok: true,
    key: 'tavern/2026-10-17.db.gz',
    bytes: 981898,
    copies: 2,
    totalBytes: 1963796,
  };

  it('says nothing is recorded when the job has not written its file', async () => {
    const { get } = await start();
    expect((await get()).json()).toEqual({ recorded: false });
  });

  it('returns the last successful run', async () => {
    const { get } = await start(ok);
    expect((await get()).json()).toEqual({ recorded: true, ...ok, stale: false });
  });

  it('returns a failed run with its error', async () => {
    const { get } = await start({ at: ok.at, ok: false, error: 'upload timed out' });
    expect((await get()).json()).toEqual({
      recorded: true,
      at: ok.at,
      ok: false,
      error: 'upload timed out',
      stale: false,
    });
  });

  it('marks a success older than 26 hours as stale', async () => {
    const { get } = await start({ ...ok, at: new Date(NOW - 27 * HOUR).toISOString() });
    expect((await get()).json()).toMatchObject({ ok: true, stale: true });
  });

  it('passes on only the known fields', async () => {
    const { get } = await start({ ...ok, bucket: 'secret-bucket', token: 'abc' });
    const body = (await get()).body;
    expect(body).not.toMatch(/secret-bucket|token/);
  });

  it('reads an unreadable file as a failed run', async () => {
    const { get } = await start('{ not json');
    expect((await get()).json()).toMatchObject({ recorded: true, ok: false, stale: false });
  });

  it('is for admins only', async () => {
    const { get } = await start(ok);
    const res = await get(null);
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain('tavern/');
  });
});

describe('offsiteStatusPath', () => {
  it('sits in backups/ next to the database', () => {
    expect(offsiteStatusPath('/data/tavern.db')).toBe('/data/backups/offsite-status.json');
    expect(offsiteStatusPath(':memory:')).toBeNull();
  });
});
