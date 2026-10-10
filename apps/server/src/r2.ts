import { AwsClient } from 'aws4fetch';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/** How long a signed asset link works. */
export const ASSET_LINK_SECONDS = 600;

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
    this.base = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`;
  }

  private url(key: string) {
    return `${this.base}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  /** A short-lived link straight to the object in R2. */
  async signedUrl(key: string, seconds = ASSET_LINK_SECONDS): Promise<string> {
    const url = new URL(this.url(key));
    url.searchParams.set('X-Amz-Expires', String(seconds));
    const signed = await this.client.sign(new Request(url, { method: 'GET' }), {
      aws: { signQuery: true },
    });
    return signed.url;
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
