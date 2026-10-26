import type { GuideFooter } from '@vt/game-sdk';
import { TYPES, type TypeId, VARIANTS, typeOf, variantOf } from './cards.ts';

/**
 * The private `conveyor/manifest.json` (asset storage only, never in the repo). Every field is
 * optional; without it, cards are drawn from their dish, points and icons. Each art entry is a
 * path or `{ art, thumb }` (a small copy, for phone hands and trays).
 *
 * {
 *   title,
 *   cards: { "<variant id>": { art, thumb } },   // nigiri-egg, maki-2, spoon-5, icecream, order…
 *   tiles: { "<type id>": { art, thumb } },   // each dish's menu tile (its rules card)
 *   tileBacks: { "<group or maki-6-8>": { art, thumb } },
 *   back, board, box: { art, thumb },
 *   names: { types: { "<type id>": "…" }, cards: { "<variant id>": "…" }, menus: { "<menu id>": "…" } },
 *   guide: { tagline },
 *   credit: "…" | { title, paragraphs: […], links: [{ label, href }] }
 * }
 */
export type ArtRef = string | { art?: string; thumb?: string };

export interface Manifest {
  title?: string;
  cards?: Record<string, ArtRef>;
  tiles?: Record<string, ArtRef>;
  tileBacks?: Record<string, ArtRef>;
  back?: ArtRef;
  board?: ArtRef;
  box?: ArtRef;
  names?: {
    types?: Record<string, string>;
    cards?: Record<string, string>;
    menus?: Record<string, string>;
  };
  guide?: { tagline?: string };
  credit?:
    string | { title?: string; paragraphs?: string[]; links?: { label?: string; href?: string }[] };
}

export const clean = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().replace(/^\.\//, '').slice(0, 200) : undefined;

export const artOf = (ref: ArtRef | undefined): string | undefined =>
  typeof ref === 'string' ? clean(ref) : clean(ref?.art);

export const thumbOf = (ref: ArtRef | undefined): string | undefined =>
  typeof ref === 'string' ? undefined : clean(ref?.thumb);

/** Display names: the manifest's, else plain dish words. */
export interface Names {
  type: (t: TypeId) => string;
  card: (variant: string) => string;
  menu: (id: string, fallback: string) => string;
}

const SHAPES: Record<string, string> = { circle: '●', triangle: '▲', square: '■', rectangle: '▬' };
const FRUITS: Record<string, string> = { w: '🍉', p: '🍍', o: '🍊' };

/** A variant's plain name: the dish, plus what tells it apart (icons, shape, fruit, kind). */
export function plainCardName(variant: string, typeName: string): string {
  const x = variantOf(variant);
  switch (x.type) {
    case 'nigiri':
      return `${{ 1: 'Egg', 2: 'Salmon', 3: 'Squid' }[x.points ?? 1]} ${typeName.toLowerCase()}`;
    case 'maki':
    case 'uramaki':
      return `${typeName} ×${x.icons}`;
    case 'onigiri':
      return `${typeName} ${SHAPES[x.shape ?? ''] ?? ''}`;
    case 'fruit':
      return `${typeName} ${Object.entries(x.fruit ?? {})
        .flatMap(([f, n]) => Array.from({ length: n }, () => FRUITS[f]))
        .join('')}`;
    default:
      return typeName;
  }
}

export function namesOf(m: Manifest | null | undefined): Names {
  const obj = (v: unknown): Record<string, string> =>
    v && typeof v === 'object' ? (v as Record<string, string>) : {};
  const types = obj(m?.names?.types);
  const cards = obj(m?.names?.cards);
  const menus = obj(m?.names?.menus);
  const type = (t: TypeId) => clean(types[t]) ?? TYPES[t].name;
  return {
    type,
    card: (variant) =>
      clean(cards[variant]) ??
      (Object.hasOwn(VARIANTS, variant) ? plainCardName(variant, type(typeOf(variant))) : variant),
    menu: (id, fallback) => clean(menus[id]) ?? fallback,
  };
}

export const PLAIN_NAMES: Names = namesOf(null);

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
