/** What the Worker can speed up for one request path. */
export type EdgeTarget =
  /** A back-room code chunk, fetched from origin on a miss. */
  | { kind: 'code' }
  /** A back-room art file, read from the bucket on a miss. */
  | { kind: 'art'; key: string };

const ART_PREFIX = '/api/backroom/assets/';

/**
 * The bucket key for a game's asset, or null if the path tries to escape the game's folder.
 * Must agree with the server's `assetKey` (apps/server/src/r2.ts), which the tests check.
 */
export function assetKey(gameId: string, path: string): string | null {
  if (!/^[a-z0-9-]+$/.test(gameId)) return null;
  if (!path || path.length > 300 || path.includes('\\')) return null;
  const segments = path.split('/');
  if (segments.some((s) => !s || s === '.' || s === '..' || !/^[\w .-]+$/.test(s))) return null;
  return `${gameId}/${path}`;
}

/** Which kind of back-room file a path is, or null for anything the Worker leaves to origin. */
export function targetOf(pathname: string): EdgeTarget | null {
  if (/^\/backroom-assets\/[\w.-]+\.js$/.test(pathname)) return { kind: 'code' };
  if (!pathname.startsWith(ART_PREFIX)) return null;
  let rest: string;
  try {
    rest = decodeURIComponent(pathname.slice(ART_PREFIX.length));
  } catch {
    return null;
  }
  const slash = rest.indexOf('/');
  if (slash < 0) return null;
  const gameId = rest.slice(0, slash);
  const path = rest.slice(slash + 1);
  // The manifest changes with every art upload; origin always serves it fresh.
  if (path === 'manifest.json') return null;
  const key = assetKey(gameId, path);
  return key ? { kind: 'art', key } : null;
}
