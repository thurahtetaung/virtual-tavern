#!/usr/bin/env node
// Uploads a folder of private game assets to R2 under `<gameId>/`.
// Credentials come from a local env file (never the repo):
//   ~/.config/virtual-tavern/r2-upload.env with R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
// Usage: node scripts/r2-upload.mjs <gameId> <folder> [--dry-run]
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { extname, join, relative, sep } from 'node:path';
import { AwsClient } from 'aws4fetch';

const [gameId, folder, flag] = process.argv.slice(2);
if (!gameId || !folder || !/^[a-z0-9-]+$/.test(gameId)) {
  console.error('Usage: node scripts/r2-upload.mjs <gameId> <folder> [--dry-run]');
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(join(homedir(), '.config/virtual-tavern/r2-upload.env'), 'utf8')
    .split('\n')
    .filter((l) => /^\w+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const TYPES = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};
const files = (dir) =>
  readdirSync(dir).flatMap((f) =>
    statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)],
  );
const client = new AwsClient({
  accessKeyId: env.R2_ACCESS_KEY_ID,
  secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  service: 's3',
  region: 'auto',
});
const base = `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${env.R2_BUCKET}`;

for (const file of files(folder)) {
  const type = TYPES[extname(file).toLowerCase()];
  if (!type) continue;
  const key = `${gameId}/${relative(folder, file).split(sep).join('/')}`;
  if (flag === '--dry-run') {
    console.log('would upload', key);
    continue;
  }
  const res = await client.fetch(`${base}/${key.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'PUT',
    body: readFileSync(file),
    headers: { 'content-type': type },
  });
  console.log(res.ok ? 'uploaded' : `FAILED ${res.status}`, key);
  if (!res.ok) process.exitCode = 1;
}
