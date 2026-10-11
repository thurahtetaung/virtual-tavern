/** Remembers the last automatic reload, so a chunk that is really missing can't loop. */
const KEY = 'vt-chunk-reload';
/** A second failure within this long shows the error page instead of reloading again. */
const WINDOW_MS = 60_000;

/**
 * Whether `err` is a code chunk that failed to load: after a deploy the old file names are gone,
 * so a page opened before the release can't fetch the room or a game.
 */
export function isChunkLoadError(err: unknown): boolean {
  const message = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Unable to preload CSS|Failed to fetch dynamically/i.test(
    message,
  );
}

/**
 * Reloads the page once to pick up the new build. Returns false (and does nothing) when it
 * already reloaded for this reason within the last minute, so the caller can show its error.
 */
export function reloadOnce(): boolean {
  try {
    const last = Number(sessionStorage.getItem(KEY) ?? 0);
    if (Date.now() - last < WINDOW_MS) return false;
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // No storage (private mode): reloading once more is still better than the error page.
  }
  window.location.reload();
  return true;
}
