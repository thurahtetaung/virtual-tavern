import { createHmac } from 'node:crypto';
import { BACKROOM_SESSION_MS } from '@vt/protocol/edge';
import { beforeEach, describe, expect, it } from 'vitest';
import { assetKey as serverAssetKey } from '../../server/src/r2.ts';
import { readPass, resetSigned, verifyPass } from './pass.ts';
import { assetKey, targetOf } from './paths.ts';
import {
  type ArtBucket,
  type ArtObject,
  type Deps,
  type EdgeCache,
  VERSION_TTL_MS,
  handle,
  resetVersion,
} from './worker.ts';

const SECRET = 'edge-secret';
const NOW = 1_700_000_000_000;
const ORIGIN = 'https://tavern.example';

/** A pass as the server signs it (node:crypto there, WebCrypto here). */
const passFor = (version: number, issuedAt: number, secret = SECRET) => {
  const unlock = `${version}.${issuedAt}`;
  return `${unlock}.${createHmac('sha256', secret).update(unlock).digest('base64url')}`;
};

describe('verifyPass', () => {
  const current = { version: 3, open: true };
  beforeEach(() => resetSigned());

  it('accepts a pass the server signed, for the current version, until the unlock runs out', async () => {
    const pass = passFor(3, NOW);
    expect(await verifyPass(pass, SECRET, current, NOW)).toBe(true);
    expect(await verifyPass(pass, SECRET, current, NOW + BACKROOM_SESSION_MS - 1)).toBe(true);
    expect(await verifyPass(pass, SECRET, current, NOW + BACKROOM_SESSION_MS)).toBe(false);
    expect(await verifyPass(pass, SECRET, current, NOW - 1)).toBe(false);
  });

  it('turns away other versions, a closed back room, other secrets and forgeries', async () => {
    expect(await verifyPass(passFor(2, NOW), SECRET, current, NOW)).toBe(false);
    expect(await verifyPass(passFor(3, NOW), SECRET, { version: 3, open: false }, NOW)).toBe(false);
    expect(await verifyPass(passFor(3, NOW, 'other'), SECRET, current, NOW)).toBe(false);
    const [, , mac] = passFor(3, NOW).split('.');
    expect(await verifyPass(`3.${NOW + 1}.${mac}`, SECRET, current, NOW + 1)).toBe(false);
    for (const junk of [null, '', '3', `3.${NOW}`, `3.${NOW}.`, `3.${NOW}.!!`, `x.${NOW}.${mac}`])
      expect(await verifyPass(junk, SECRET, current, NOW)).toBe(false);
    expect(await verifyPass(passFor(3, NOW), '', current, NOW)).toBe(false);
  });

  it('finds the pass among other cookies', () => {
    expect(readPass(`vt_backroom=s%3Aabc; vt_edge=1.2.x-y_z; theme=dark`)).toBe('1.2.x-y_z');
    expect(readPass('vt_edgex=1')).toBeNull();
    expect(readPass(null)).toBeNull();
  });
});

describe('targetOf', () => {
  it('knows code chunks and art files, and leaves everything else to origin', () => {
    expect(targetOf('/backroom-assets/private-Ab12_x-9.js')).toEqual({ kind: 'code' });
    expect(targetOf('/api/backroom/assets/reverie/cards/001.jpg')).toEqual({
      kind: 'art',
      key: 'reverie/cards/001.jpg',
    });
    expect(targetOf('/api/backroom/assets/nightfall/voice/a%20b.ogg')).toEqual({
      kind: 'art',
      key: 'nightfall/voice/a b.ogg',
    });
    for (const other of [
      '/assets/index-abc.js',
      '/backroom-assets/x/y.js',
      '/api/backroom/assets/reverie/manifest.json',
      '/api/backroom/assets/reverie',
      '/api/backroom/assets/reverie/../x.jpg',
      '/api/backroom/assets/reverie/%E0%A4%A.jpg',
      '/api/backroom/manifest/reverie',
    ])
      expect(targetOf(other)).toBeNull();
  });

  it('maps paths to bucket keys exactly as the server does', () => {
    const cases: [string, string][] = [
      ['reverie', 'cards/001.jpg'],
      ['nightfall', 'music/night one.ogg'],
      ['reverie', ''],
      ['reverie', '../secret'],
      ['reverie', 'a//b.jpg'],
      ['reverie', './a.jpg'],
      ['reverie', 'a\\b.jpg'],
      ['reverie', 'a?.jpg'],
      ['reverie', 'x'.repeat(301)],
      ['../x', 'a.png'],
      ['Reverie', 'a.png'],
    ];
    for (const [game, path] of cases) expect(assetKey(game, path)).toBe(serverAssetKey(game, path));
  });
});

/** A stand-in bucket holding one image and one sound. */
function bucket() {
  const files = new Map([
    ['reverie/cards/001.jpg', { bytes: new Uint8Array([1, 2, 3, 4, 5, 6]), type: 'image/jpeg' }],
    [
      'nightfall/fonts/a.woff2',
      { bytes: new Uint8Array([9, 9]), type: 'application/octet-stream' },
    ],
  ]);
  const reads: string[] = [];
  const art: ArtBucket = {
    get(key, options) {
      reads.push(options?.range ? `${key} ${options.range.get('range')}` : key);
      const file = files.get(key);
      if (!file) return Promise.resolve(null);
      const match = /^bytes=(\d+)-(\d+)$/.exec(options?.range?.get('range') ?? '');
      const range = match
        ? { offset: Number(match[1]), length: Number(match[2]) - Number(match[1]) + 1 }
        : undefined;
      const bytes = range
        ? file.bytes.slice(range.offset, range.offset + range.length)
        : file.bytes;
      const object: ArtObject = {
        body: new Response(bytes).body!,
        size: file.bytes.length,
        httpEtag: '"e1"',
        ...(range && { range }),
        writeHttpMetadata: (h) => h.set('content-type', file.type),
      };
      return Promise.resolve(object);
    },
  };
  return { art, reads };
}

function setup(version = { version: 1, open: true }) {
  const stored = new Map<string, Response>();
  const cache: EdgeCache = {
    match: (r) => Promise.resolve(stored.get(r.url)?.clone()),
    put: async (r, res) => {
      stored.set(r.url, new Response(await res.arrayBuffer(), res));
    },
  };
  const origin: string[] = [];
  const pending: Promise<unknown>[] = [];
  let now = NOW;
  const deps: Deps = {
    cache,
    fetch: (r) => {
      const path = new URL(r.url).pathname;
      origin.push(path);
      if (path === '/api/edge/backroom-version') return Promise.resolve(Response.json(version));
      if (path === '/backroom-assets/private-abc.js')
        return Promise.resolve(
          new Response('secret()', {
            headers: {
              'content-type': 'text/javascript',
              'cache-control': 'private, max-age=31536000, immutable',
            },
          }),
        );
      return Promise.resolve(new Response('origin', { status: 404 }));
    },
    waitUntil: (p) => pending.push(p),
    now: () => now,
  };
  const { art, reads } = bucket();
  const get = async (path: string, headers: Record<string, string> = {}) => {
    const res = await handle(
      new Request(ORIGIN + path, { headers }),
      { EDGE_SECRET: SECRET, ART: art },
      deps,
    );
    await Promise.all(pending.splice(0));
    return res;
  };
  return { get, origin, reads, stored, tick: (ms: number) => (now += ms), deps, art };
}

describe('handle', () => {
  beforeEach(() => {
    resetVersion();
    resetSigned();
  });
  const unlocked = { cookie: `vt_edge=${passFor(1, NOW)}` };

  it('serves code from origin once, then from the edge cache, keyed by URL alone', async () => {
    const { get, origin, stored } = setup();
    const first = await get('/backroom-assets/private-abc.js', unlocked);
    expect(first.headers.get('x-vt-edge')).toBe('miss');
    expect(first.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(await first.text()).toBe('secret()');
    const second = await get('/backroom-assets/private-abc.js?x=1', unlocked);
    expect(second.headers.get('x-vt-edge')).toBe('hit');
    expect(second.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(second.headers.get('content-type')).toBe('text/javascript');
    expect(await second.text()).toBe('secret()');
    expect(origin.filter((p) => p.startsWith('/backroom-assets/'))).toHaveLength(1);
    expect([...stored.keys()]).toEqual([`${ORIGIN}/backroom-assets/private-abc.js`]);
  });

  it('passes anyone it cannot prove unlocked to origin, untouched', async () => {
    const { get, origin } = setup();
    for (const headers of [
      {} as Record<string, string>,
      { cookie: `vt_edge=${passFor(0, NOW)}` },
      { cookie: 'vt_admin=s%3Ax' },
    ]) {
      const res = await get('/backroom-assets/private-abc.js', headers);
      expect(res.headers.get('x-vt-edge')).toBe('pass');
    }
    expect(origin.filter((p) => p.startsWith('/backroom-assets/'))).toHaveLength(3);
    // Nor does it touch anything outside the back room's files, or anything but GET.
    expect((await get('/api/backroom/manifest/reverie', unlocked)).headers.get('x-vt-edge')).toBe(
      'pass',
    );
  });

  it('never serves a cached file without a pass it can prove', async () => {
    const { get, origin, tick } = setup();
    for (const path of [
      '/backroom-assets/private-abc.js',
      '/api/backroom/assets/reverie/cards/001.jpg',
    ])
      expect((await get(path, unlocked)).headers.get('x-vt-edge')).toBe('miss');
    const [, , mac] = passFor(1, NOW).split('.');
    for (const headers of [
      {} as Record<string, string>,
      { cookie: `vt_edge=${passFor(0, NOW)}` },
      { cookie: `vt_edge=${passFor(1, NOW, 'other')}` },
      { cookie: `vt_edge=1.${NOW + 1}.${mac}` },
    ]) {
      const code = await get('/backroom-assets/private-abc.js', headers);
      expect(code.headers.get('x-vt-edge')).toBe('pass');
      const art = await get('/api/backroom/assets/reverie/cards/001.jpg', headers);
      expect(art.headers.get('x-vt-edge')).toBe('pass');
      expect(await art.text()).toBe('origin');
    }
    expect(origin.filter((p) => p === '/backroom-assets/private-abc.js')).toHaveLength(5);
    // A pass checked once stays bound to its lifetime.
    tick(BACKROOM_SESSION_MS);
    expect((await get('/backroom-assets/private-abc.js', unlocked)).headers.get('x-vt-edge')).toBe(
      'pass',
    );
  });

  it('does not keep what origin refuses', async () => {
    const { get, stored } = setup();
    const res = await get('/backroom-assets/gone.js', unlocked);
    expect(res.status).toBe(404);
    expect(res.headers.get('x-vt-edge')).toBe('pass');
    expect(stored.size).toBe(0);
  });

  it('serves art from the bucket, then from the edge cache', async () => {
    const { get, reads, origin } = setup();
    const first = await get('/api/backroom/assets/reverie/cards/001.jpg', unlocked);
    expect(first.status).toBe(200);
    expect(first.headers.get('x-vt-edge')).toBe('miss');
    expect(first.headers.get('content-type')).toBe('image/jpeg');
    expect(first.headers.get('content-length')).toBe('6');
    expect(first.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    const second = await get('/api/backroom/assets/reverie/cards/001.jpg', unlocked);
    expect(second.headers.get('x-vt-edge')).toBe('hit');
    expect([...new Uint8Array(await second.arrayBuffer())]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(reads).toEqual(['reverie/cards/001.jpg']);
    expect(origin).toEqual(['/api/edge/backroom-version']);
    const font = await get('/api/backroom/assets/nightfall/fonts/a.woff2', unlocked);
    expect(font.headers.get('content-type')).toBe('font/woff2');
  });

  it('answers byte ranges straight from the bucket', async () => {
    const { get, reads } = setup();
    const res = await get('/api/backroom/assets/reverie/cards/001.jpg', {
      ...unlocked,
      range: 'bytes=2-3',
    });
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 2-3/6');
    expect(res.headers.get('content-length')).toBe('2');
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([3, 4]);
    expect(reads).toEqual(['reverie/cards/001.jpg bytes=2-3']);
  });

  it('leaves files the bucket lacks to origin', async () => {
    const { get } = setup();
    const res = await get('/api/backroom/assets/reverie/cards/999.jpg', unlocked);
    expect(res.status).toBe(404);
    expect(res.headers.get('x-vt-edge')).toBe('pass');
  });

  it('asks origin for the version at most every 30 s, and again after a failure', async () => {
    const { get, origin, tick, deps } = setup();
    await get('/backroom-assets/private-abc.js', unlocked);
    await get('/backroom-assets/private-abc.js', unlocked);
    tick(VERSION_TTL_MS - 1);
    await get('/backroom-assets/private-abc.js', unlocked);
    expect(origin.filter((p) => p === '/api/edge/backroom-version')).toHaveLength(1);
    tick(1);
    // A sign-out on the server: within 30 s the old pass goes back to origin.
    const real = deps.fetch;
    deps.fetch = (r) =>
      new URL(r.url).pathname === '/api/edge/backroom-version'
        ? Promise.resolve(Response.json({ version: 2, open: true }))
        : real(r);
    expect((await get('/backroom-assets/private-abc.js', unlocked)).headers.get('x-vt-edge')).toBe(
      'pass',
    );
    tick(VERSION_TTL_MS);
    deps.fetch = (r) =>
      new URL(r.url).pathname === '/api/edge/backroom-version'
        ? Promise.reject(new Error('down'))
        : real(r);
    expect((await get('/backroom-assets/private-abc.js', unlocked)).headers.get('x-vt-edge')).toBe(
      'pass',
    );
    deps.fetch = real;
    expect((await get('/backroom-assets/private-abc.js', unlocked)).headers.get('x-vt-edge')).toBe(
      'hit',
    );
  });

  it('fails open when anything throws', async () => {
    const { get, art } = setup();
    art.get = () => Promise.reject(new Error('bucket down'));
    const res = await get('/api/backroom/assets/reverie/cards/001.jpg', unlocked);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('origin');
  });

  it('passes everything when it has no secret', async () => {
    const { deps } = setup();
    const res = await handle(
      new Request(`${ORIGIN}/backroom-assets/private-abc.js`, { headers: unlocked }),
      {},
      deps,
    );
    expect(res.headers.get('x-vt-edge')).toBe('pass');
  });
});
