#!/usr/bin/env node
// Imports one private content pack (Going Once's title groups or hint lines) into a running
// Virtual Tavern through the admin API. The server checks the data against the game's own schema
// (`contentPacks` on its definition; Going Once's is in
// packages/private-games/going-once/src/logic/content.ts) and refuses anything that doesn't fit.
// A pack with the same game, kind and name is skipped, so the script is safe to re-run. The admin
// password comes from ADMIN_PASSWORD (never a flag, so it stays out of shell history). Packs are
// private content and never committed; see CLAUDE.md and docs/deployment.md.
// Usage: ADMIN_PASSWORD=... node scripts/import-content-pack.mjs <baseUrl> <gameId> <kind> <file.json> [--name <name>] [--disabled] [--dry-run]
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The command line as options, or an error message. */
export function parseArgs(argv) {
  const positional = [];
  const opts = { name: null, enabled: true, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name') opts.name = argv[++i] ?? '';
    else if (a === '--disabled') opts.enabled = false;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a.startsWith('--')) return { error: `unknown option ${a}` };
    else positional.push(a);
  }
  if (positional.length !== 4) return { error: 'expected <baseUrl> <gameId> <kind> <file.json>' };
  const [baseUrl, gameId, kind, file] = positional;
  if (!/^https?:\/\//.test(baseUrl)) return { error: 'baseUrl must start with http(s)://' };
  if (!/^[a-z0-9-]{1,40}$/.test(gameId))
    return { error: 'gameId: lowercase letters, digits, dashes' };
  if (!/^[a-zA-Z0-9-]{1,40}$/.test(kind)) return { error: 'kind: letters, digits, dashes' };
  const name = (opts.name ?? basename(file).replace(/\.json$/i, '')).trim();
  if (!name || name.length > 80) return { error: 'name: 1-80 characters' };
  return { baseUrl: baseUrl.replace(/\/$/, ''), gameId, kind, file, ...opts, name };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.error) {
    console.error(args.error);
    console.error(
      'usage: ADMIN_PASSWORD=... node scripts/import-content-pack.mjs <baseUrl> <gameId> <kind> <file.json> [--name <name>] [--disabled] [--dry-run]',
    );
    process.exit(1);
  }
  const data = JSON.parse(readFileSync(args.file, 'utf8'));
  const entries = Array.isArray(data) ? data.length : Object.keys(data ?? {}).length;
  if (!entries) {
    console.error(`${args.file} holds no entries`);
    process.exit(1);
  }
  if (args.dryRun) {
    console.log(`would import "${args.name}" (${args.gameId}/${args.kind}, ${entries} entries)`);
    return;
  }
  const password = process.env.ADMIN_PASSWORD;
  if (!password) {
    console.error('set ADMIN_PASSWORD');
    process.exit(1);
  }

  let cookie = '';
  const api = async (path, init = {}) => {
    const res = await fetch(`${args.baseUrl}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', cookie, ...init.headers },
    });
    const body = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok)
      throw new Error(
        `${init.method ?? 'GET'} ${path} -> ${res.status} ${body?.error?.message ?? ''}`,
      );
    return { res, body };
  };
  const login = await api('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
  cookie = login.res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  if (!cookie) throw new Error('login returned no session cookie');
  try {
    const existing = (await api('/api/admin/content-packs')).body;
    if (
      existing.some((p) => p.gameId === args.gameId && p.kind === args.kind && p.name === args.name)
    ) {
      console.log(`skip     "${args.name}" (already exists)`);
      return;
    }
    const { body } = await api('/api/admin/content-packs', {
      method: 'POST',
      body: JSON.stringify({
        gameId: args.gameId,
        kind: args.kind,
        name: args.name,
        data,
        enabled: args.enabled,
      }),
    });
    console.log(`created  "${body.name}" (${body.entries} entries, id ${body.id})`);
  } finally {
    await api('/api/admin/logout', { method: 'POST', body: '{}' });
  }
}

// Run only when executed directly, so tests can import the parser.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
