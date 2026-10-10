#!/usr/bin/env node
// Downloads the raw stats events from a running Virtual Tavern as NDJSON (one event per line:
// {id, ts, day, type, gameId, roomId, playerId, props}), for backups or a later backfill into a
// column store such as ClickHouse. Raw events are kept for 90 days; older days only survive as
// daily rollups, which this does not export. The admin password comes from ADMIN_PASSWORD (never
// a flag, so it stays out of shell history).
// Usage: ADMIN_PASSWORD=... node scripts/stats-export.mjs <baseUrl> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--out file.ndjson]
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const argv = process.argv.slice(2);
const positional = [];
const opts = { from: null, to: null, out: null };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--from' || a === '--to' || a === '--out') opts[a.slice(2)] = argv[++i] ?? null;
  else positional.push(a);
}
const [baseUrl] = positional;
const password = process.env.ADMIN_PASSWORD;
const day = /^\d{4}-\d{2}-\d{2}$/;
if (!baseUrl || !password || [opts.from, opts.to].some((d) => d !== null && !day.test(d))) {
  console.error(
    'Usage: ADMIN_PASSWORD=... node scripts/stats-export.mjs <baseUrl> [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--out file.ndjson]',
  );
  process.exit(1);
}

const base = baseUrl.replace(/\/$/, '');
const login = await fetch(`${base}/api/admin/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password }),
});
if (!login.ok) throw new Error(`login failed: ${login.status}`);
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');
if (!cookie) throw new Error('login returned no session cookie');

const query = new URLSearchParams();
if (opts.from) query.set('from', opts.from);
if (opts.to) query.set('to', opts.to);
const res = await fetch(`${base}/api/admin/stats/export?${query}`, { headers: { cookie } });
if (!res.ok || !res.body) {
  const body = await res.json().catch(() => null);
  throw new Error(`export failed: ${res.status} ${body?.error?.message ?? ''}`);
}
const out = opts.out ? createWriteStream(opts.out) : process.stdout;
await pipeline(Readable.fromWeb(res.body), out);
if (opts.out) console.error(`wrote ${opts.out}`);
