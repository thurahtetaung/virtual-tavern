import { AwsClient } from 'aws4fetch';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Overrides the R2 endpoint, for tests that stand in a fake bucket. */
  endpoint?: string;
}

/** Response headers worth passing on from the bucket to the browser. */
const PASSED_HEADERS = ['content-type', 'content-length', 'content-range', 'etag', 'last-modified'];

/** Headers from the browser that the bucket should see, so partial fetches work. */
const FORWARDED_HEADERS = ['range', 'if-none-match'];

/**
 * Builds the object key for a game's asset, or null if the path tries to escape the game's folder.
 * Keys look like `<gameId>/<path>`; paths may not contain `..`, empty segments or backslashes.
 */
export function assetKey(gameId: string, path: string): string | null {
  if (!/^[a-z0-9-]+$/.test(gameId)) return null;
  if (!path || path.length > 300 || path.includes('\\')) return null;
  const segments = path.split('/');
  if (segments.some((s) => !s || s === '.' || s === '..' || !/^[\w .-]+$/.test(s))) return null;
  return `${gameId}/${path}`;
}

/** Read-only access to the private asset bucket. */
export class R2Assets {
  private readonly client: AwsClient;
  private readonly base: string;
  private readonly manifests = new Map<string, { at: number; body: unknown }>();

  constructor(config: R2Config) {
    this.client = new AwsClient({
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      service: 's3',
      region: 'auto',
    });
    const endpoint = config.endpoint ?? `https://${config.accountId}.r2.cloudflarestorage.com`;
    this.base = `${endpoint}/${config.bucket}`;
  }

  private url(key: string) {
    return `${this.base}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  /**
   * Fetches an object so the server can stream it on. Returns null if it doesn't exist. The
   * browser's conditional and range headers are forwarded, so the response may be 206 or 304.
   */
  async object(
    key: string,
    requestHeaders: Record<string, string | string[] | undefined> = {},
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    body: ReadableStream | null;
  } | null> {
    const headers: Record<string, string> = {};
    for (const name of FORWARDED_HEADERS) {
      const value = requestHeaders[name];
      if (typeof value === 'string') headers[name] = value;
    }
    const res = await this.client.fetch(this.url(key), { headers });
    if (res.status === 404) return null;
    if (!res.ok && res.status !== 304) throw new Error(`R2 ${res.status} for ${key}`);
    const passed: Record<string, string> = {};
    for (const name of PASSED_HEADERS) {
      const value = res.headers.get(name);
      if (value) passed[name] = value;
    }
    return { status: res.status, headers: passed, body: res.body };
  }

  /** A JSON object from the bucket (cached briefly), or null if it doesn't exist. */
  async json(key: string, cacheMs = 60_000): Promise<unknown> {
    const hit = this.manifests.get(key);
    if (hit && Date.now() - hit.at < cacheMs) return hit.body;
    const res = await this.client.fetch(this.url(key));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`R2 ${res.status} for ${key}`);
    const body: unknown = await res.json();
    this.manifests.set(key, { at: Date.now(), body });
    return body;
  }
}
