/**
 * How long each narration line of a private game lasts, in ms, from its manifest: `narration`
 * maps a line's key to its clip paths, `durations` a clip path to its length in ms. A line's
 * length is the sum of its clips' (a clip with no length counts as nothing). Null when the
 * manifest has no narration or no durations, so the game keeps its plain timing.
 */
export function narrationLengths(manifest: unknown): Record<string, number> | null {
  if (!manifest || typeof manifest !== 'object') return null;
  const { narration, durations } = manifest as { narration?: unknown; durations?: unknown };
  if (!narration || typeof narration !== 'object' || !durations || typeof durations !== 'object')
    return null;
  const ms = (src: unknown) => {
    const d = typeof src === 'string' ? (durations as Record<string, unknown>)[src] : undefined;
    return typeof d === 'number' && Number.isFinite(d) && d > 0 ? Math.round(d) : 0;
  };
  const out: Record<string, number> = {};
  for (const [key, clips] of Object.entries(narration as Record<string, unknown>))
    if (Array.isArray(clips)) out[key] = clips.reduce((sum: number, src) => sum + ms(src), 0);
  return out;
}
