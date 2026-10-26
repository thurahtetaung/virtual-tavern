import type { GuideFooter } from '@vt/game-sdk';
import type { Suit } from './cards.ts';

/**
 * The private `skyfire/manifest.json` (asset storage only, never in the repo). Every field is
 * optional; without it, cards are drawn from their colour, symbol and number, and tokens are emoji.
 *
 * Each picture is a path or `{ art, thumb }` (a small copy for hands).
 *
 * {
 *   title,
 *   cards: { "red-1": "cards/red-1.webp" | { art, thumb, zoom? }, …, "multi-5", "black-1" },
 *   back, backThumb,                    // the card back (backThumb: an older key for its thumb)
 *   tokens: {
 *     clue, clueUsed,
 *     fuse: [{ unused, used }, …] | "…",   // the three fuse tiles in order, or one picture
 *     fuseUsed,
 *   },
 *   suits: { red: "suits/red.webp", … },   // a picture per firework (the stacks' backdrop)
 *   box, lobby,
 *   guide: { tagline },
 *   credit: "…" | { title, paragraphs: […], links: [{ label, href }] }
 * }
 */
/** `zoom`: a sharper large copy, for the card sheet (else `art`). */
export type ArtRef = string | { art?: string; thumb?: string; zoom?: string };

export interface Manifest {
  title?: string;
  cards?: Record<string, ArtRef>;
  back?: ArtRef;
  backThumb?: string;
  tokens?: {
    clue?: ArtRef;
    clueUsed?: ArtRef;
    fuse?: ArtRef | { unused?: ArtRef; used?: ArtRef }[];
    fuseUsed?: ArtRef;
  };
  suits?: Partial<Record<Suit, ArtRef>>;
  box?: ArtRef;
  lobby?: ArtRef;
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

/** The sharper large copy, when the entry has one. */
export const zoomOf = (ref: ArtRef | undefined): string | undefined =>
  typeof ref === 'string' ? undefined : clean(ref?.zoom);

/** A card's key in the manifest: `red-3`. */
export const cardKey = (suit: Suit, rank: number) => `${suit}-${rank}`;

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
