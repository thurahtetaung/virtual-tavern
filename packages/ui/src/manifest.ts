/**
 * A back-room game's private manifest, fetched once per page and shared by everything that reads
 * it (the game's own UI, the room shell's guide and recap names). When the page knows the
 * manifest's version (from the room lookup or the back-room status) it asks for that version,
 * which the browser keeps for a day; otherwise the plain URL, which revalidates with an ETag.
 */
const manifests = new Map<string, Promise<Record<string, unknown> | null>>();
const versions = new Map<string, string>();

/** The manifests' versions the server named for this page. */
export function noteManifestVersions(named: Record<string, string> | undefined): void {
  for (const [gameId, v] of Object.entries(named ?? {})) versions.set(gameId, v);
}

/** The manifest as an object, or null when the game has none (no asset storage, tests, dev). */
export function loadManifest(gameId: string): Promise<Record<string, unknown> | null> {
  let p = manifests.get(gameId);
  if (!p) {
    const v = versions.get(gameId);
    p = fetch(`/api/backroom/manifest/${gameId}${v ? `?v=${encodeURIComponent(v)}` : ''}`)
      .then(async (res) => {
        if (!res.ok) return null;
        const body: unknown = await res.json();
        return body && typeof body === 'object' && !Array.isArray(body)
          ? (body as Record<string, unknown>)
          : null;
      })
      .catch(() => {
        // A dropped connection isn't an answer: the next caller asks again.
        manifests.delete(gameId);
        return null;
      });
    manifests.set(gameId, p);
  }
  return p;
}
