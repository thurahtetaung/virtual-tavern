import type { GuideFooter } from '@vt/game-sdk';
import { type Names, PLACEHOLDER_NAMES } from './names.ts';

/**
 * The private `thorns/manifest.json` (asset storage only, never in the repo). Every field is
 * optional; anything missing falls back to the placeholders (emoji on a disc in the player's
 * colour, plain mats).
 *
 * {
 *   title,
 *   names: { rose, roses, thorn, thorns, chance },
 *   sets: [{ id, name, rose: "discs/….webp", thorn, back, mat, matScored,
 *            thumbs: { rose, thorn, back, mat, matScored } }, …],   // one per seat, in seat order
 *   chance: { face, faceThumb, back },      // the Last Chance disc (no back: its face shows)
 *   lobby: "lobby.webp",
 *   guide: { tagline },
 *   credit: { title, paragraphs: […], links: [{ label, href }] }
 * }
 */
export interface ManifestSet {
  id?: string;
  name?: string;
  rose?: string;
  thorn?: string;
  back?: string;
  mat?: string;
  matScored?: string;
  /** Small copies, for discs drawn small. */
  thumbs?: { rose?: string; thorn?: string; back?: string; mat?: string; matScored?: string };
}

export interface Manifest {
  title?: string;
  names?: Partial<Record<keyof Omit<Names, 'title'>, string>>;
  sets?: ManifestSet[];
  chance?: { face?: string; faceThumb?: string; back?: string | null };
  lobby?: string;
  guide?: { tagline?: string };
  credit?: { title?: string; paragraphs?: string[]; links?: { label?: string; href?: string }[] };
}

export const clean = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, 80) : undefined;

/** The manifest's names over the placeholders, word by word. */
export function namesOf(m: Manifest | null | undefined): Names {
  const n = m?.names ?? {};
  return {
    title: clean(m?.title) ?? PLACEHOLDER_NAMES.title,
    rose: clean(n.rose) ?? PLACEHOLDER_NAMES.rose,
    roses: clean(n.roses) ?? PLACEHOLDER_NAMES.roses,
    thorn: clean(n.thorn) ?? PLACEHOLDER_NAMES.thorn,
    thorns: clean(n.thorns) ?? PLACEHOLDER_NAMES.thorns,
    chance: clean(n.chance) ?? PLACEHOLDER_NAMES.chance,
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
