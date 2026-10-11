/** Names a back-room game's private ids (roles, locations, cards) from its manifest. */
export type Labeler = (kind: 'role' | 'loc' | 'card', id: string) => string | undefined;

/** A piece of resolved text: plain, or a player's name (shown bold). */
export interface Segment {
  text: string;
  name?: boolean;
}

const PLACEHOLDER = /\{(p|role|loc|card):([^{}]*)\}/g;

/** "alpha-wolf" → "Alpha wolf": the fallback for an id nothing names. */
export const idLabel = (id: string) => {
  const words = id.replace(/[-_]+/g, ' ').trim();
  return words ? words[0]!.toUpperCase() + words.slice(1) : id;
};

/**
 * Splits server text into segments, naming players from `names` and private ids through the
 * game's labeler (falling back to readable ids). A player nobody can name is "someone".
 */
export function resolveSegments(
  text: string,
  names: ReadonlyMap<string, string>,
  labels: Labeler | null,
): Segment[] {
  const out: Segment[] = [];
  let at = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (m.index > at) out.push({ text: text.slice(at, m.index) });
    const [, kind, id = ''] = m;
    if (kind === 'p') out.push({ text: names.get(id) ?? 'someone', name: true });
    else {
      const k = kind as 'role' | 'loc' | 'card';
      // Public games report readable words already; private ones report ids the manifest names.
      out.push({ text: labels?.(k, id) ?? (k === 'loc' ? id : idLabel(id)) });
    }
    at = m.index + m[0].length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}

export const resolveText = (
  text: string,
  names: ReadonlyMap<string, string>,
  labels: Labeler | null,
) =>
  resolveSegments(text, names, labels)
    .map((s) => s.text)
    .join('');
