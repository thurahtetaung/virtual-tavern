#!/usr/bin/env node
// Sets (or clears) the title a back-room game shows to unlocked players, through the admin API.
// The repository only ever uses each private game's code name; the real title lives in the
// database. The admin password comes from ADMIN_PASSWORD (never a flag, so it stays out of shell
// history).
// Usage: ADMIN_PASSWORD=... node scripts/set-game-title.mjs <baseUrl> <gameId> "<title>"
//        ADMIN_PASSWORD=... node scripts/set-game-title.mjs <baseUrl> <gameId> --clear
//        ADMIN_PASSWORD=... node scripts/set-game-title.mjs <baseUrl> --list

const [baseUrl, gameId, title] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD;
if (!baseUrl || !gameId || !password || (gameId !== '--list' && !title)) {
  console.error(
    'Usage: ADMIN_PASSWORD=... node scripts/set-game-title.mjs <baseUrl> <gameId> "<title>" | --clear\n' +
      '       ADMIN_PASSWORD=... node scripts/set-game-title.mjs <baseUrl> --list',
  );
  process.exit(1);
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

const login = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
cookie = login.res.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');
if (!cookie) throw new Error('login returned no session cookie');
try {
  if (gameId === '--list') {
    for (const g of (await api('/api/admin/games')).body.games.filter((g) => g.private))
      console.log(`${g.gameId.padEnd(24)} ${g.settings.title ?? `(none; shows "${g.name}")`}`);
  } else {
    const { body } = await api(`/api/admin/games/${encodeURIComponent(gameId)}`, {
      method: 'PUT',
      body: JSON.stringify({ title: title === '--clear' ? null : title }),
    });
    const set = body.games.find((g) => g.gameId === gameId)?.settings.title;
    console.log(set ? `${gameId}: "${set}"` : `${gameId}: title cleared`);
  }
} finally {
  await api('/api/admin/logout', { method: 'POST', body: '{}' });
}
