#!/usr/bin/env node
// Sets the game categories (the filter chips on the game lists) from a JSON file, through the
// admin API. Categories live only in the database; the file stays private, outside the repo:
//   { "categories": [{ "id": "…", "name": "…", "emoji": "…" }], "games": { "<gameId>": ["<id>", …] } }
// Categories are added or updated by id and put first, in the file's order (others keep theirs
// after them); each listed game gets exactly its listed categories. Games this server doesn't
// have yet are skipped with a note, so the same file can be run again when they go live. The
// admin password comes from ADMIN_PASSWORD (never a flag, so it stays out of shell history).
// Usage: ADMIN_PASSWORD=... node scripts/set-game-categories.mjs <baseUrl> <file.json> [--dry-run]

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const [baseUrl, file] = args.filter((a) => a !== '--dry-run');
const password = process.env.ADMIN_PASSWORD;
if (!baseUrl || !file || !password) {
  console.error(
    'Usage: ADMIN_PASSWORD=... node scripts/set-game-categories.mjs <baseUrl> <file.json> [--dry-run]',
  );
  process.exit(1);
}

const wanted = JSON.parse(readFileSync(file, 'utf8'));
const categories = Array.isArray(wanted.categories) ? wanted.categories : [];
const games = wanted.games && typeof wanted.games === 'object' ? wanted.games : {};
for (const c of categories) {
  if (typeof c?.id !== 'string' || typeof c.name !== 'string' || typeof c.emoji !== 'string') {
    console.error(`Each category needs an id, a name and an emoji: ${JSON.stringify(c)}`);
    process.exit(1);
  }
}

const base = baseUrl.replace(/\/$/, '');
let cookie = '';
async function api(path, init = {}) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', cookie, ...init.headers },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok)
    throw new Error(
      `${init.method ?? 'GET'} ${path} -> ${res.status} ${body?.error?.message ?? ''}`,
    );
  return { res, body };
}
const send = (method, path, body) =>
  dryRun ? Promise.resolve(null) : api(path, { method, body: JSON.stringify(body) });

const login = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
cookie = login.res.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');
if (!cookie) throw new Error('login returned no session cookie');
const tag = dryRun ? '(dry run) ' : '';
try {
  const current = (await api('/api/admin/categories')).body;
  const have = new Map(current.categories.map((c) => [c.id, c]));
  for (const c of categories) {
    const old = have.get(c.id);
    if (!old) {
      await send('POST', '/api/admin/categories', { id: c.id, name: c.name, emoji: c.emoji });
      console.log(`${tag}added ${c.emoji} ${c.name} (${c.id})`);
    } else if (old.name !== c.name || old.emoji !== c.emoji) {
      await send('PUT', `/api/admin/categories/${encodeURIComponent(c.id)}`, {
        name: c.name,
        emoji: c.emoji,
      });
      console.log(`${tag}updated ${c.id}: ${old.emoji} ${old.name} -> ${c.emoji} ${c.name}`);
    }
  }

  const fileIds = categories.map((c) => c.id);
  const order = [
    ...fileIds,
    ...current.categories.map((c) => c.id).filter((id) => !fileIds.includes(id)),
  ];
  const now = [...current.categories.map((c) => c.id), ...fileIds.filter((id) => !have.has(id))];
  if (order.join() !== now.join()) {
    await send('PUT', '/api/admin/categories/order', { ids: order });
    console.log(`${tag}ordered: ${order.join(', ')}`);
  }

  const known = new Map(current.games.map((g) => [g.gameId, g]));
  for (const [gameId, ids] of Object.entries(games)) {
    const game = known.get(gameId);
    if (!game) {
      console.log(`skipped ${gameId}: not on this server yet`);
      continue;
    }
    // Shown in the server's category order, so compare as sets.
    const same =
      game.categories.length === ids.length && ids.every((id) => game.categories.includes(id));
    if (same) continue;
    await send('PUT', `/api/admin/game-categories/${encodeURIComponent(gameId)}`, {
      categories: ids,
    });
    console.log(`${tag}${gameId}: ${ids.join(', ') || '(none)'}`);
  }
  console.log(`${tag}done`);
} finally {
  await api('/api/admin/logout', { method: 'POST', body: '{}' });
}
