import { EDGE_VERSION_PATH, type EdgeVersion } from '@vt/protocol/edge';
import { readPass, verifyPass } from './pass.ts';
import { targetOf } from './paths.ts';

/**
 * The edge Worker in front of the back room's files (`/backroom-assets/*` and
 * `/api/backroom/assets/*`). It only ever speeds things up: a browser whose edge pass it can prove
 * current gets the file from Cloudflare's cache (filled from the bucket or from origin); anything
 * else, including every error, goes to origin untouched, which applies its own checks.
 */

/** The subset of an R2 object the Worker reads. */
export interface ArtObject {
  body: ReadableStream;
  size: number;
  httpEtag: string;
  range?: { offset?: number; length?: number; suffix?: number };
  writeHttpMetadata(headers: Headers): void;
}

export interface ArtBucket {
  get(key: string, options?: { range?: Headers }): Promise<ArtObject | null>;
}

export interface Env {
  /** Same value as the server's `EDGE_SECRET`. */
  EDGE_SECRET?: string;
  /** The private art bucket. */
  ART?: ArtBucket;
}

export interface EdgeCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface Deps {
  cache: EdgeCache;
  fetch: (request: Request) => Promise<Response>;
  waitUntil: (promise: Promise<unknown>) => void;
  now: () => number;
}

/** How long the password version is trusted before asking origin again. */
export const VERSION_TTL_MS = 30_000;
export const BROWSER_CACHE = 'private, max-age=31536000, immutable';
/** The cached copy: only Cloudflare's cache ever sees this header, never a browser. */
const STORED_CACHE = 'public, max-age=31536000, immutable';

/** Types to serve by extension when the bucket stored none or a generic one (as the server). */
const TYPES_BY_EXTENSION: Record<string, string> = {
  woff2: 'font/woff2',
  woff: 'font/woff',
  webp: 'image/webp',
};

let known: { at: number; version: Promise<EdgeVersion | null> } | null = null;

/** Forgets the cached password version (tests). */
export function resetVersion() {
  known = null;
}

/** The back room's current version, asked of origin at most every 30 s; null if unknown. */
function currentVersion(request: Request, deps: Deps): Promise<EdgeVersion | null> {
  const now = deps.now();
  if (known && now - known.at < VERSION_TTL_MS) return known.version;
  const version = deps
    .fetch(
      new Request(new URL(EDGE_VERSION_PATH, request.url), {
        headers: { accept: 'application/json' },
      }),
    )
    .then(async (res) => {
      if (!res.ok) return null;
      const body = (await res.json()) as Partial<EdgeVersion>;
      return typeof body.version === 'number' && typeof body.open === 'boolean'
        ? { version: body.version, open: body.open }
        : null;
    })
    .catch(() => null);
  known = { at: now, version };
  // A failed lookup is retried on the next request rather than trusted for 30 s.
  void version.then((v) => {
    if (!v && known?.version === version) known = null;
  });
  return version;
}

function labelled(response: Response, edge: 'hit' | 'miss' | 'pass', cacheControl?: string) {
  const out = new Response(response.body, response);
  out.headers.set('x-vt-edge', edge);
  if (cacheControl) out.headers.set('cache-control', cacheControl);
  return out;
}

async function pass(request: Request, deps: Deps) {
  return labelled(await deps.fetch(request), 'pass');
}

/** Keeps a copy in the edge cache, keyed by the bare URL: never by cookie or query. */
function store(deps: Deps, key: Request, response: Response) {
  const copy = new Response(response.body, response);
  copy.headers.delete('set-cookie');
  copy.headers.delete('x-vt-edge');
  copy.headers.set('cache-control', STORED_CACHE);
  deps.waitUntil(deps.cache.put(key, copy).catch(() => undefined));
}

function artHeaders(object: ArtObject, key: string) {
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  const type = headers.get('content-type');
  const byExtension = TYPES_BY_EXTENSION[key.split('.').pop()!.toLowerCase()];
  if (byExtension && (!type || type === 'application/octet-stream'))
    headers.set('content-type', byExtension);
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', BROWSER_CACHE);
  return headers;
}

/** An art file straight from the bucket: a byte range (Nightfall's audio) or the whole file. */
async function fromBucket(
  bucket: ArtBucket,
  key: string,
  request: Request,
): Promise<Response | null> {
  const ranged = request.headers.has('range');
  const object = await bucket.get(key, ranged ? { range: request.headers } : undefined);
  if (!object) return null;
  const headers = artHeaders(object, key);
  const range = object.range;
  if (ranged && range) {
    const offset = range.suffix !== undefined ? object.size - range.suffix : (range.offset ?? 0);
    const length = range.suffix ?? range.length ?? object.size - offset;
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('content-length', String(length));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set('content-length', String(object.size));
  return new Response(object.body, { status: 200, headers });
}

export async function handle(request: Request, env: Env, deps: Deps): Promise<Response> {
  try {
    const url = new URL(request.url);
    const target = request.method === 'GET' ? targetOf(url.pathname) : null;
    const secret = env.EDGE_SECRET;
    if (!target || !secret || (target.kind === 'art' && !env.ART)) return await pass(request, deps);
    const edgePass = readPass(request.headers.get('cookie'));
    if (!edgePass) return await pass(request, deps);
    const ranged = target.kind === 'art' && request.headers.has('range');
    const key = new Request(`${url.origin}${url.pathname}`);
    // Look in the cache while the pass is checked; nothing found is served unless the pass holds.
    const lookup = ranged ? null : deps.cache.match(key);
    void lookup?.catch(() => undefined);
    const version = await currentVersion(request, deps);
    const proven = version !== null && (await verifyPass(edgePass, secret, version, deps.now()));
    if (!proven) {
      void lookup?.then((found) => found?.body?.cancel()).catch(() => undefined);
      return await pass(request, deps);
    }

    if (ranged) {
      const partial = await fromBucket(env.ART!, target.key, request);
      return partial ? labelled(partial, 'miss') : await pass(request, deps);
    }
    const cached = await lookup;
    if (cached) return labelled(cached, 'hit', BROWSER_CACHE);

    if (target.kind === 'art') {
      const fresh = await fromBucket(env.ART!, target.key, request);
      if (!fresh) return await pass(request, deps);
      store(deps, key, fresh.clone());
      return labelled(fresh, 'miss');
    }
    // Code: origin checks the unlock again and serves the file; only a 200 is kept.
    const fresh = await deps.fetch(request);
    if (fresh.status !== 200) return labelled(fresh, 'pass');
    store(deps, key, fresh.clone());
    return labelled(fresh, 'miss', BROWSER_CACHE);
  } catch {
    // Fail open: whatever went wrong, origin answers as if the Worker weren't there.
    return deps.fetch(request);
  }
}

interface WorkerContext {
  waitUntil(promise: Promise<unknown>): void;
}

export default {
  fetch(request: Request, env: Env, ctx: WorkerContext): Promise<Response> {
    return handle(request, env, {
      cache: (caches as unknown as { default: EdgeCache }).default,
      fetch: (r) => fetch(r),
      waitUntil: (p) => ctx.waitUntil(p),
      now: Date.now,
    });
  },
};
