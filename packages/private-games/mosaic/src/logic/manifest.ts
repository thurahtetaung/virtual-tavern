import type { GuideFooter } from '@vt/game-sdk';
import type { Colour, Special, Tile } from './types.ts';

/**
 * The private `mosaic/manifest.json` (asset storage only, never in the repo). Every field is
 * optional; without it, tiles are plain colours with their symbol.
 *
 * {
 *   title,
 *   tiles: { blue, yellow, red, black, white | aqua, joker },  // tile faces (light blue: "white")
 *   jokers,                                              // the joker's face (older key)
 *   thumbs: { blue, …, white, joker, first, factory, box, sf1, sf2-blue, …, sf5 },  // small copies
 *   first,                                               // the first-player marker
 *   factory,                                             // a factory display (a round disc)
 *   board: { colour, grey },                             // board pictures, for the guide
 *   specialFactories: { sf1, sf3, sf4, sf5, sf2: { blue, yellow, red, black, white | aqua } },
 *   box,
 *   credit: "…" | { title, paragraphs: […], links: [{ label, href }] }
 * }
 */
export interface Manifest {
  title?: string;
  tiles?: Partial<Record<Tile | 'white', string>>;
  jokers?: string;
  specialFactories?: {
    sf1?: string;
    sf3?: string;
    sf4?: string;
    sf5?: string;
    sf2?: Partial<Record<Colour | 'white', string>>;
  };
  thumbs?: Record<string, string>;
  first?: string;
  factory?: string;
  board?: { colour?: string; grey?: string };
  box?: string;
  credit?:
    string | { title?: string; paragraphs?: string[]; links?: { label?: string; href?: string }[] };
}

export const clean = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, 200) : undefined;

/** A tile face's path: the light blue may be keyed `aqua` or `white`. */
export function tileOf(map: Manifest['tiles'] | Record<string, string> | undefined, c: Tile) {
  const m: Record<string, unknown> | undefined = map;
  return clean(m?.[c]) ?? (c === 'aqua' ? clean(m?.white) : undefined);
}

/** A special factory face's path (full size), or its thumb's key. */
export function specialOf(m: Manifest | null | undefined, sp: Special): string | undefined {
  const f = m?.specialFactories;
  if (!f || typeof f !== 'object') return undefined;
  if (sp.kind !== 'sf2') return clean(f[sp.kind]);
  const c = sp.colour;
  return c ? (clean(f.sf2?.[c]) ?? (c === 'aqua' ? clean(f.sf2?.white) : undefined)) : undefined;
}

export const specialThumbKey = (sp: Special) =>
  sp.kind === 'sf2' ? `sf2-${sp.colour === 'aqua' ? 'white' : sp.colour}` : sp.kind;

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
