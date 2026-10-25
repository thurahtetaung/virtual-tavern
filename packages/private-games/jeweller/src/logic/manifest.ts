import type { GuideFooter } from '@vt/game-sdk';
import type { Level, Token } from './types.ts';

/**
 * The private `jeweller/manifest.json` (asset storage only, never in the repo). Every field is
 * optional; anything missing falls back to the placeholders (cards drawn from their numbers,
 * gems as coloured chips, nobles numbered).
 *
 * {
 *   title,
 *   cards: { "L1-01": "cards/L1-01.webp" | { art, thumb }, … },   // the 90 cards by id
 *   backs: { "1" | "l1": "backs/l1.webp", …, "3" },                // each level's deck
 *   backThumbs: { "1" | "l1": …, … }, tokenThumbs: { white, … },    // small copies
 *   nobles: { "N01": "nobles/N01.webp" | { art, name }, … },
 *   tokens: { white, blue, green, red, black, gold },              // piece faces
 *   box, logo,
 *   guide: { tagline },
 *   credit: "…" | { title, paragraphs: […], links: [{ label, href }] }
 * }
 */
export type ArtRef = string | { art?: string; thumb?: string; name?: string };

export interface Manifest {
  title?: string;
  cards?: Record<string, ArtRef>;
  backs?: Record<string, string>;
  backThumbs?: Record<string, string>;
  tokenThumbs?: Partial<Record<Token, string>>;
  nobles?: Record<string, ArtRef>;
  tokens?: Partial<Record<Token, string>>;
  box?: string;
  logo?: string;
  guide?: { tagline?: string };
  credit?:
    string | { title?: string; paragraphs?: string[]; links?: { label?: string; href?: string }[] };
}

/** A deck's back from a `backs` map keyed "1" or "l1". */
export const backOf = (map: Record<string, string> | undefined, level: Level): string | undefined =>
  clean(map?.[`${level}`]) ?? clean(map?.[`l${level}`]);

export const clean = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : undefined;

/** The art path in an entry (a plain path, or `{ art }`). */
export const artOf = (ref: ArtRef | undefined): string | undefined =>
  typeof ref === 'string' ? clean(ref) : clean(ref?.art);

/** A small copy, when the entry has one. */
export const thumbOf = (ref: ArtRef | undefined): string | undefined =>
  typeof ref === 'string' ? undefined : clean(ref?.thumb);

/** A noble's name, when the manifest gives one. */
export const nameOf = (ref: ArtRef | undefined): string | undefined =>
  typeof ref === 'string' ? undefined : clean(ref?.name)?.slice(0, 60);

/** "N03" → "Noble 3": the placeholder name. */
export const nobleNumber = (id: string) => `Noble ${Number(id.replace(/\D/g, '')) || id}`;

/** The original game's credit, for the guide's footer (unlocked browsers only). */
export function footerOf(m: Manifest | null | undefined): GuideFooter | undefined {
  const raw = m?.credit;
  if (typeof raw === 'string')
    return clean(raw) ? { title: 'Credits', paragraphs: [raw.trim()] } : undefined;
  const c = raw;
  const paragraphs = (c?.paragraphs ?? []).flatMap((p) => (clean(p) ? [p.trim()] : []));
  if (!paragraphs.length) return undefined;
  const links = (c?.links ?? []).flatMap((l) =>
    clean(l.label) && typeof l.href === 'string' && /^https:\/\//.test(l.href)
      ? [{ label: l.label!.trim(), href: l.href }]
      : [],
  );
  return { title: clean(c?.title) ?? 'Credits', paragraphs, ...(links.length ? { links } : {}) };
}
