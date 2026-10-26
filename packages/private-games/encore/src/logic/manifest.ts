import type { GuideFooter } from '@vt/game-sdk';

/**
 * The private `encore/manifest.json` (asset storage only, never in the repo). Every field is
 * optional; without it, cards are drawn from their two numbers and colours.
 *
 * {
 *   title,
 *   cards: { "1-2": "cards/1-2.webp" | { art, thumb }, … },   // the 45 cards by id (low-high)
 *   artUp: "low" | "high",          // which number reads upright on the card art (default low)
 *   back, backThumb,                // the card back (and a small copy)
 *   chip, startHat,                  // the chip, the start player's hat
 *   marker, markerUsed,        // the Recruit & Show marker, unused and used
 *   box, logo,
 *   names: { recruit, recruits?, recruited?, recruiting? },   // the action's word (default recruit)
 *   guide: { tagline },
 *   credit: "…" | { title, paragraphs: […], links: [{ label, href }] }
 * }
 */
export type ArtRef = string | { art?: string; thumb?: string };

export interface Manifest {
  title?: string;
  cards?: Record<string, ArtRef>;
  artUp?: 'low' | 'high';
  back?: string;
  backThumb?: string;
  chip?: string;
  startHat?: string;
  marker?: string;
  markerUsed?: string;
  box?: string;
  logo?: string;
  names?: { recruit?: string; recruits?: string; recruited?: string; recruiting?: string };
  guide?: { tagline?: string };
  credit?:
    string | { title?: string; paragraphs?: string[]; links?: { label?: string; href?: string }[] };
}

export const clean = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : undefined;

/** The art path in an entry (a plain path, or `{ art }`). */
export const artOf = (ref: ArtRef | undefined): string | undefined =>
  typeof ref === 'string' ? clean(ref) : clean(ref?.art);

/** A small copy, when the entry has one. */
export const thumbOf = (ref: ArtRef | undefined): string | undefined =>
  typeof ref === 'string' ? undefined : clean(ref?.thumb);

/** The original game's credit, for the guide's footer (unlocked browsers only). */
export function footerOf(m: Manifest | null | undefined): GuideFooter | undefined {
  const raw = m?.credit;
  if (typeof raw === 'string')
    return clean(raw) ? { title: 'Credits', paragraphs: [raw.trim()] } : undefined;
  const paragraphs = (raw?.paragraphs ?? []).flatMap((p) => (clean(p) ? [p.trim()] : []));
  if (!paragraphs.length) return undefined;
  const links = (raw?.links ?? []).flatMap((l) =>
    clean(l.label) && typeof l.href === 'string' && /^https:\/\//.test(l.href)
      ? [{ label: l.label!.trim(), href: l.href }]
      : [],
  );
  return { title: clean(raw?.title) ?? 'Credits', paragraphs, ...(links.length ? { links } : {}) };
}
