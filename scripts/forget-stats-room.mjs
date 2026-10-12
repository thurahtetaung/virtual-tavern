#!/usr/bin/env node
// Deletes rooms' stats through the admin API: their raw events, recap nights, awards and records,
// and the players who never appeared anywhere else. The daily rollups of the days they touched are
// rebuilt, so the stats page stops counting them. `--dry-run` only shows what would go.
// The admin password comes from ADMIN_PASSWORD (never a flag, so it stays out of shell history).
// Usage: ADMIN_PASSWORD=... node scripts/forget-stats-room.mjs <baseUrl> <roomId>... [--dry-run]

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const [baseUrl, ...roomIds] = args.filter((a) => a !== '--dry-run');
const password = process.env.ADMIN_PASSWORD;
if (!baseUrl || !roomIds.length || !password) {
  console.error(
    'Usage: ADMIN_PASSWORD=... node scripts/forget-stats-room.mjs <baseUrl> <roomId>... [--dry-run]',
  );
  process.exit(1);
}

const base = baseUrl.replace(/\/$/, '');
let cookie = '';
async function api(path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(init.body !== undefined && { 'content-type': 'application/json' }),
      cookie,
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok)
    throw new Error(
      `${init.method ?? 'GET'} ${path} -> ${res.status} ${body?.error?.message ?? ''}`,
    );
  return { res, body };
}

const login = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
cookie = login.res.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');
if (!cookie) throw new Error('login returned no session cookie');
let failed = false;
try {
  for (const roomId of roomIds) {
    try {
      const { body } = await api(
        `/api/admin/stats/rooms/${encodeURIComponent(roomId)}${dryRun ? '?dryRun=1' : ''}`,
        { method: 'DELETE' },
      );
      console.log(`${roomId}${dryRun ? ' (dry run: nothing changed)' : ''}`);
      for (const [table, n] of Object.entries(body.deleted))
        console.log(`  ${table.padEnd(20)} ${n}`);
      console.log(`  days                 ${body.days.join(', ') || '-'}`);
      console.log(`  rollups rebuilt      ${body.rebuiltDays.join(', ') || '-'}`);
      console.log(`  players removed      ${body.playersRemoved.length}`);
    } catch (err) {
      failed = true;
      console.error(`${roomId}: ${err.message}`);
    }
  }
} finally {
  await api('/api/admin/logout', { method: 'POST', body: '{}' });
}
if (failed) process.exit(1);
