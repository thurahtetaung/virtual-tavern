import type { GuideFooter } from '@vt/game-sdk';
import { CARD_TYPES, type CardType } from './cards.ts';
import { type Names, PLACEHOLDER_NAMES } from './names.ts';
import type { Art } from './types.ts';

/**
 * The private `short-fuse/manifest.json` (asset storage only, never in the repo). Every field is
 * optional; anything missing or odd falls back to the placeholders.
 *
 * {
 *   title, back: "cards/back.webp",
 *   names: { cards: { bomb: "…", … }, adultCards: { cat1: "…", … } (the adult deck's own names),
 *            sets: { classic: "…", adult: "…", party: "…", x1: "…" }, bomb: "…", bombs: "…" },
 *   faces: { bomb: { classic: ["cards/….webp", …], adult: […] }, void: { classic: […] }, … },
 *   thumbs: "cards/thumb/",          // a folder with a small copy of every face, same file names
 *   text: { "cards/….webp": { flavour, rules } },
 *   extras: { crownIcon: "extras/….webp" },   // the Vault's crown, for its wearer's seat
 *   credit: { title, paragraphs: […], links: [{ label, href }] }
 * }
 */
export interface Manifest {
  title?: string;
  back?: string;
  names?: {
    cards?: Partial<Record<string, string>>;
    /** Names that differ on the adult deck (its cats). */
    adultCards?: Partial<Record<string, string>>;
    sets?: Partial<Record<string, string>>;
    bomb?: string;
    bombs?: string;
  };
  faces?: Partial<Record<string, Partial<Record<Art, string[]>>>>;
  thumbs?: string;
  text?: Record<string, { flavour?: string; rules?: string }>;
  extras?: { crown?: string; crownIcon?: string };
  credit?: { title?: string; paragraphs?: string[]; links?: { label?: string; href?: string }[] };
}

const clean = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : undefined;

/** The manifest's names over the placeholders, field by field (for the deck's art). */
export function namesOf(m: Manifest | null | undefined, art: Art = 'classic'): Names {
  const cards = { ...PLACEHOLDER_NAMES.cards };
  for (const t of CARD_TYPES) {
    const n =
      (art === 'adult' ? clean(m?.names?.adultCards?.[t]) : undefined) ??
      clean(m?.names?.cards?.[t]);
    if (n) cards[t] = n;
  }
  const sets = { ...PLACEHOLDER_NAMES.sets };
  for (const [k, v] of Object.entries(m?.names?.sets ?? {})) {
    const n = clean(v);
    if (n) sets[k] = n;
  }
  return {
    title: clean(m?.title) ?? PLACEHOLDER_NAMES.title,
    cards,
    sets,
    bomb: clean(m?.names?.bomb) ?? PLACEHOLDER_NAMES.bomb,
    bombs: clean(m?.names?.bombs) ?? PLACEHOLDER_NAMES.bombs,
  };
}

/** The art for one card instance, or null (placeholder). Copies cycle through the faces. */
export function faceOf(
  m: Manifest | null | undefined,
  t: CardType,
  face: number,
  art: Art,
): string | null {
  const f = m?.faces?.[t];
  const list = (f?.[art]?.length ? f[art] : f?.classic?.length ? f.classic : f?.adult) ?? [];
  const files = list.filter((x): x is string => typeof x === 'string' && x.length > 0);
  return files.length ? files[((face % files.length) + files.length) % files.length]! : null;
}

/** The small copy of a face, when the manifest has thumbnails. */
export function thumbOf(m: Manifest | null | undefined, file: string): string {
  const dir = clean(m?.thumbs);
  if (!dir) return file;
  const name = file.split('/').at(-1)!;
  return `${dir.replace(/\/?$/, '/')}${name}`;
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
  return {
    title: clean(c?.title) ?? 'Credits',
    paragraphs,
    ...(links.length ? { links } : {}),
  };
}
