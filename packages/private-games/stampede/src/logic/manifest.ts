import type { GuideFooter } from '@vt/game-sdk';
import { type Names, PLACEHOLDER_NAMES } from './names.ts';

/**
 * The private `stampede/manifest.json` (asset storage only, never in the repo). Every field is
 * optional; anything missing falls back to the placeholders, and the game needs none of it.
 *
 * {
 *   title,
 *   names: { pink, cow, cows },
 *   credit: { title, paragraphs: […], links: [{ label, href }] }
 * }
 */
export interface Manifest {
  title?: string;
  names?: Partial<Record<keyof Omit<Names, 'title'>, string>>;
  credit?: { title?: string; paragraphs?: string[]; links?: { label?: string; href?: string }[] };
}

export const clean = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, 40) : undefined;

/** The manifest's names over the placeholders, word by word. */
export function namesOf(m: Manifest | null | undefined): Names {
  const n = m?.names ?? {};
  return {
    title: clean(m?.title) ?? PLACEHOLDER_NAMES.title,
    pink: clean(n.pink) ?? PLACEHOLDER_NAMES.pink,
    cow: clean(n.cow) ?? PLACEHOLDER_NAMES.cow,
    cows: clean(n.cows) ?? PLACEHOLDER_NAMES.cows,
  };
}

/** The original game's credit, for the guide's footer (unlocked browsers only). */
export function footerOf(m: Manifest | null | undefined): GuideFooter | undefined {
  const c = m?.credit;
  const paragraphs = (c?.paragraphs ?? []).flatMap((p) => (clean(p) ? [p.trim()] : []));
  if (!paragraphs.length) return undefined;
  const links = (c?.links ?? []).flatMap((l) =>
    clean(l.label) && typeof l.href === 'string' && /^https:\/\//.test(l.href)
      ? [{ label: l.label!.trim(), href: l.href }]
      : [],
  );
  return { title: clean(c?.title) ?? 'Credits', paragraphs, ...(links.length ? { links } : {}) };
}
