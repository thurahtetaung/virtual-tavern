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
 *   cities: { "C1a": "cities/C1a.webp" | { art, thumb }, … },      // the 14 City sides
 *   strongholds: ["strongholds/blue.webp", …],                     // one per colour (see below)
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
  cities?: Record<string, ArtRef>;
  strongholds?: string[];
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

/** The stronghold colours, in the order seats get the ones no player's room colour claims. */
export const STRONGHOLD_COLORS = ['blue', 'red', 'green', 'orange'] as const;
export type StrongholdColor = (typeof STRONGHOLD_COLORS)[number];

/**
 * Each player's stronghold colour (display only): a player whose room colour is a stronghold
 * colour gets that one, and the others get the colours left, in turn order.
 */
export function strongholdColors(
  order: readonly string[],
  roomColor: (id: string) => string | undefined,
): Record<string, StrongholdColor> {
  const out: Record<string, StrongholdColor> = {};
  for (const id of order) {
    const c = STRONGHOLD_COLORS.find((s) => s === roomColor(id));
    if (c && !Object.values(out).includes(c)) out[id] = c;
  }
  const left = STRONGHOLD_COLORS.filter((c) => !Object.values(out).includes(c));
  order.filter((id) => !out[id]).forEach((id, i) => (out[id] = left[i % left.length] ?? 'blue'));
  return out;
}

/**
 * The stronghold picture in a colour: the list's file named for it (`strongholds/red.webp`), else
 * its place in `STRONGHOLD_COLORS` (repeating past the list).
 */
export function strongholdArt(
  m: Manifest | null | undefined,
  color: StrongholdColor,
): string | undefined {
  const list = (Array.isArray(m?.strongholds) ? m.strongholds : []).filter(
    (p): p is string => typeof p === 'string',
  );
  const named = list.find((p) => p.replace(/^.*\//, '').replace(/\.\w+$/, '') === color);
  return clean(named ?? list[STRONGHOLD_COLORS.indexOf(color) % list.length]);
}

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
