#!/usr/bin/env node
// Imports word lists into a running Virtual Tavern through the admin API.
// The folder holds a manifest.json ({ lists: { <slug>: { name, description } } }) and one
// <slug>.txt per list, one word per line. Lists whose name already exists are skipped, so the
// script is safe to re-run. The admin password comes from ADMIN_PASSWORD (never a flag, so it
// stays out of shell history). The lists themselves are never committed; see CLAUDE.md.
// Usage: ADMIN_PASSWORD=... node scripts/import-word-lists.mjs <baseUrl> <folder> [--skip <glob>] [--only <glob>] [--dry-run]
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const argv = process.argv.slice(2);
const positional = [];
const opts = { skip: null, only: null, dryRun: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--dry-run') opts.dryRun = true;
  else if (a === '--skip' || a === '--only') opts[a.slice(2)] = argv[++i] ?? null;
  else positional.push(a);
}
const [baseUrl, folder] = positional;
const password = process.env.ADMIN_PASSWORD;
if (!baseUrl || !folder || (!password && !opts.dryRun)) {
  console.error(
    'Usage: ADMIN_PASSWORD=... node scripts/import-word-lists.mjs <baseUrl> <folder> [--skip <glob>] [--only <glob>] [--dry-run]',
  );
  process.exit(1);
}
const toRegex = (glob) =>
  glob && new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
const skip = toRegex(opts.skip);
const only = toRegex(opts.only);

const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
const wanted = Object.entries(manifest.lists).filter(
  ([slug]) => !(skip && skip.test(slug)) && !(only && !only.test(slug)),
);
const readWords = (slug) =>
  readFileSync(join(folder, `${slug}.txt`), 'utf8')
    .split('\n')
    .map((w) => w.trim())
    .filter(Boolean);

if (opts.dryRun) {
  for (const [slug, meta] of wanted)
    console.log(`would import ${readWords(slug).length} words as "${meta.name}"`);
  process.exit(0);
}

const base = baseUrl.replace(/\/$/, '');
let cookie = '';
const api = async (path, init = {}) => {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', cookie, ...init.headers },
  });
  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      `${init.method ?? 'GET'} ${path} -> ${res.status} ${body?.error?.message ?? ''}`,
    );
  }
  return { res, body };
};

const login = await api('/api/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
cookie = login.res.headers
  .getSetCookie()
  .map((c) => c.split(';')[0])
  .join('; ');
if (!cookie) throw new Error('login returned no session cookie');

const existing = new Set((await api('/api/admin/word-lists')).body.map((l) => l.name));
let created = 0;
for (const [slug, meta] of wanted) {
  if (existing.has(meta.name)) {
    console.log(`skip     "${meta.name}" (already exists)`);
    continue;
  }
  const words = readWords(slug);
  const { body } = await api('/api/admin/word-lists', {
    method: 'POST',
    body: JSON.stringify({ name: meta.name, description: meta.description ?? '', words }),
  });
  console.log(`created  "${body.name}" (${words.length} words, id ${body.id})`);
  created++;
}
await api('/api/admin/logout', { method: 'POST', body: '{}' });
console.log(`done: ${created} created, ${wanted.length - created} skipped`);
