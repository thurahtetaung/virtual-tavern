#!/usr/bin/env node
// Imports trivia question decks into a running Virtual Tavern through the admin API.
// The folder holds a manifest.json ({ decks: { <slug>: { name, description, games?, enabled? } } },
// the same shape the admin page's "Download all" backup writes) and one <slug>.json per deck
// ({ name?, description?, questions: [{ prompt, answer, alternates?, sources?, adult?, tags?, decoys? }] }).
// Every deck is checked locally first (the same rules the server applies; see
// packages/protocol/src/questions.ts) and nothing is uploaded if any deck fails. Decks whose name
// already exists are skipped, so the script is safe to re-run. The admin password comes from
// ADMIN_PASSWORD (never a flag, so it stays out of shell history). The decks themselves are
// private and never committed; see CLAUDE.md.
// Usage: ADMIN_PASSWORD=... node scripts/import-question-decks.mjs <baseUrl> <folder> [--skip <glob>] [--only <glob>] [--dry-run]
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BLANK = '___';
const MAX_QUESTIONS = 5000;
const MAX_ANSWER = 160;

// An absolute http(s) URL with a host and no spaces (the same check as the server's).
const isHttpUrl = (value) => /^https?:\/\/[^\s/?#]+\S*$/i.test(value);
const trimmed = (v) => (typeof v === 'string' ? v.trim() : v);
const isText = (v, min, max) =>
  typeof v === 'string' && v.trim().length >= min && v.trim().length <= max;
const textList = (v, maxItems, min, max) =>
  v === undefined ||
  (Array.isArray(v) && v.length <= maxItems && v.every((x) => isText(x, min, max)));

/**
 * Checks one deck against the server's rules. Returns `{ deck, errors }`: the request body to
 * send (trimmed, unknown fields dropped) and every problem found, each prefixed with its path.
 */
export function validateDeck(meta, file) {
  const errors = [];
  const name = trimmed(meta?.name ?? file?.name);
  const description = trimmed(meta?.description ?? file?.description ?? '');
  if (!isText(name, 1, 60)) errors.push('name: 1-60 characters');
  if (typeof description !== 'string' || description.length > 200)
    errors.push('description: at most 200 characters');
  if (
    meta?.games !== undefined &&
    !(
      Array.isArray(meta.games) &&
      meta.games.length >= 1 &&
      meta.games.length <= 10 &&
      meta.games.every((g) => typeof g === 'string' && /^[a-z0-9-]{1,40}$/.test(g))
    )
  )
    errors.push('games: 1-10 game ids (lowercase letters, digits and dashes)');
  if (meta?.enabled !== undefined && typeof meta.enabled !== 'boolean')
    errors.push('enabled: true or false');

  const raw = file?.questions;
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_QUESTIONS)
    errors.push(`questions: 1-${MAX_QUESTIONS} questions`);
  const questions = (Array.isArray(raw) ? raw : []).map((q, i) => {
    const at = `questions.${i}`;
    const prompt = trimmed(q?.prompt);
    if (!isText(prompt, 5, 300)) errors.push(`${at}.prompt: 5-300 characters`);
    else {
      const blanks = prompt.split(BLANK).length - 1;
      if (!(blanks === 1 || (blanks === 0 && prompt.endsWith('?'))))
        errors.push(`${at}.prompt: needs exactly one "___", or no blank and a final "?"`);
    }
    if (!isText(q?.answer, 1, MAX_ANSWER)) errors.push(`${at}.answer: 1-${MAX_ANSWER} characters`);
    if (!textList(q?.alternates, 10, 1, MAX_ANSWER))
      errors.push(`${at}.alternates: at most 10, each 1-${MAX_ANSWER} characters`);
    if (!textList(q?.decoys, 30, 1, MAX_ANSWER))
      errors.push(`${at}.decoys: at most 30, each 1-${MAX_ANSWER} characters`);
    if (
      !textList(q?.sources, 5, 0, 500) ||
      (q?.sources ?? []).some((s) => !isHttpUrl(String(s).trim()))
    )
      errors.push(`${at}.sources: at most 5 http(s) URLs`);
    if (q?.adult !== undefined && typeof q.adult !== 'boolean')
      errors.push(`${at}.adult: true or false`);
    if (!textList(q?.tags, 10, 1, 40)) errors.push(`${at}.tags: at most 10, each 1-40 characters`);
    return {
      prompt,
      answer: trimmed(q?.answer),
      alternates: (q?.alternates ?? []).map(trimmed),
      sources: (q?.sources ?? []).map(trimmed),
      adult: q?.adult ?? false,
      tags: (q?.tags ?? []).map(trimmed),
      ...(q?.decoys === undefined ? {} : { decoys: q.decoys.map(trimmed) }),
    };
  });

  const deck = {
    name,
    description,
    questions,
    // Optional: which games offer the deck, and whether it starts switched on.
    ...(meta?.games ? { games: meta.games } : {}),
    ...(meta?.enabled === undefined ? {} : { enabled: meta.enabled }),
  };
  return { deck, errors };
}

/** `*` matches anything; everything else is literal. */
export const globRegex = (glob) =>
  glob ? new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`) : null;

async function main() {
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
      'Usage: ADMIN_PASSWORD=... node scripts/import-question-decks.mjs <baseUrl> <folder> [--skip <glob>] [--only <glob>] [--dry-run]',
    );
    process.exit(1);
  }
  const skip = globRegex(opts.skip);
  const only = globRegex(opts.only);

  const manifest = JSON.parse(readFileSync(join(folder, 'manifest.json'), 'utf8'));
  const wanted = Object.entries(manifest.decks ?? {})
    .filter(([slug]) => !(skip && skip.test(slug)) && !(only && !only.test(slug)))
    .map(([slug, meta]) => ({
      slug,
      ...validateDeck(meta, JSON.parse(readFileSync(join(folder, `${slug}.json`), 'utf8'))),
    }));

  const invalid = wanted.filter((d) => d.errors.length);
  for (const { slug, errors } of invalid) {
    console.error(`invalid  ${slug}.json (${errors.length} problems)`);
    for (const e of errors.slice(0, 20)) console.error(`  ${e}`);
  }
  if (invalid.length) {
    console.error(`nothing imported: ${invalid.length} deck(s) failed validation`);
    process.exit(1);
  }

  if (opts.dryRun) {
    for (const { deck } of wanted)
      console.log(`would import ${deck.questions.length} questions as "${deck.name}"`);
    return;
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

  const login = await api('/api/admin/login', {
    method: 'POST',
    body: JSON.stringify({ password }),
  });
  cookie = login.res.headers
    .getSetCookie()
    .map((c) => c.split(';')[0])
    .join('; ');
  if (!cookie) throw new Error('login returned no session cookie');

  const existing = new Set((await api('/api/admin/question-decks')).body.map((d) => d.name));
  let created = 0;
  for (const { deck } of wanted) {
    if (existing.has(deck.name)) {
      console.log(`skip     "${deck.name}" (already exists)`);
      continue;
    }
    const { body } = await api('/api/admin/question-decks', {
      method: 'POST',
      body: JSON.stringify(deck),
    });
    console.log(`created  "${body.name}" (${body.questionCount} questions, id ${body.id})`);
    existing.add(deck.name);
    created++;
  }
  await api('/api/admin/logout', { method: 'POST', body: '{}' });
  console.log(`done: ${created} created, ${wanted.length - created} skipped`);
}

// Run only when executed directly, so tests can import the validator.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
