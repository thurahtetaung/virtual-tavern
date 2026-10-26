#!/usr/bin/env node
// Imports one private content pack (Going Once's title groups or hint lines) into a running
// Virtual Tavern through the admin API. The server checks the data against the game's own schema
// (`contentPacks` on its definition; Going Once's is in
// packages/private-games/going-once/src/logic/content.ts) and refuses anything that doesn't fit.
// Markup in any string (tags, entities) is taken out before it is sent, keeping the words and
// line and paragraph breaks; the server strips it again. A pack with the same game, kind and
// name is skipped, so the script is safe to re-run, unless --replace is given: then that pack's
// data is replaced in place (same id, so rooms' memory of the groups they used carries on). The
// admin password comes from ADMIN_PASSWORD (never a flag, so it stays out of shell history).
// Packs are private content and never committed; see CLAUDE.md and docs/deployment.md.
// Usage: ADMIN_PASSWORD=... node scripts/import-content-pack.mjs <baseUrl> <gameId> <kind> <file.json> [--name <name>] [--disabled] [--replace] [--dry-run]
import { readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// The games' own markup cleaner, so the script and the server clean text the same way.
import { plainLines, plainText } from '../packages/game-sdk/src/markup.mjs';

export { plainText };

/**
 * Every string in a pack's data with markup taken out, and how many changed. Line and paragraph
 * breaks stay (a story keeps its paragraphs); a game whose schema wants one line cleans again.
 */
export function cleanPack(data) {
  let changed = 0;
  const walk = (v) => {
    if (typeof v === 'string') {
      const clean = plainLines(v);
      if (clean !== v.trim()) changed++;
      return clean;
    }
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object')
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    return v;
  };
  return { data: walk(data), changed };
}

/**
 * Host lines (Going Once's `host` kind) that aren't lines someone would say: recording labels,
 * file or cue names, bracketed stage directions, no words, or no sentence ending. The server
 * refuses the same (`hostLineProblem` in packages/private-games/going-once/src/logic/content.ts);
 * keep the two in step.
 */
export function hostLineProblems(data) {
  const out = [];
  for (const [moment, lines] of Object.entries(data ?? {}))
    for (const line of Array.isArray(lines) ? lines : []) {
      const t = String(line).trim();
      const why = /^(new (version|audio)|redo)\b/i.test(t)
        ? 'a recording label'
        : /\.(ogg|wav|mp3|webp|png)\b|\b[A-Z]{3,}\d{2,}\b/.test(t)
          ? 'a file or cue name'
          : /[[\]()]/.test(t)
            ? 'a stage direction in brackets'
            : !/[A-Za-z]|\$\d/.test(t.replaceAll('{player}', ''))
              ? 'no words'
              : !/[.!?…"”'’]$/.test(t)
                ? 'no sentence ending'
                : null;
      if (why) out.push(`${moment}: "${t}" (${why})`);
    }
  return out;
}

/** The command line as options, or an error message. */
export function parseArgs(argv) {
  const positional = [];
  const opts = { name: null, enabled: true, dryRun: false, replace: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name') opts.name = argv[++i] ?? '';
    else if (a === '--disabled') opts.enabled = false;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--replace') opts.replace = true;
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
      'usage: ADMIN_PASSWORD=... node scripts/import-content-pack.mjs <baseUrl> <gameId> <kind> <file.json> [--name <name>] [--disabled] [--replace] [--dry-run]',
    );
    process.exit(1);
  }
  const cleaned = cleanPack(JSON.parse(readFileSync(args.file, 'utf8')));
  const data = cleaned.data;
  if (cleaned.changed) console.log(`markup taken out of ${cleaned.changed} string(s)`);
  const entries = Array.isArray(data) ? data.length : Object.keys(data ?? {}).length;
  if (!entries) {
    console.error(`${args.file} holds no entries`);
    process.exit(1);
  }
  if (args.kind === 'host') {
    const problems = hostLineProblems(data);
    if (problems.length) {
      for (const p of problems.slice(0, 20)) console.error(`not a line: ${p}`);
      console.error(`nothing imported: ${problems.length} host line(s) to fix`);
      process.exit(1);
    }
  }
  if (args.dryRun) {
    console.log(
      `would ${args.replace ? 'import or replace' : 'import'} "${args.name}" (${args.gameId}/${args.kind}, ${entries} entries)`,
    );
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
    const same = existing.find(
      (p) => p.gameId === args.gameId && p.kind === args.kind && p.name === args.name,
    );
    if (same && args.replace) {
      const { body } = await api(`/api/admin/content-packs/${same.id}`, {
        method: 'PUT',
        body: JSON.stringify({ data }),
      });
      console.log(`replaced "${body.name}" (${body.entries} entries, id ${body.id})`);
      return;
    }
    if (same) {
      console.log(`skip     "${args.name}" (already exists; --replace to update it)`);
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
