import type { GuideFooter } from '@vt/game-sdk';
import type { SetId } from './types.ts';

/**
 * The private `iconic/manifest.json` (asset storage only, never in the repo). Every field is
 * optional; without it the icons show as numbered tiles ("Icon 17") and the sets as their
 * symbols.
 *
 * {
 *   title,
 *   icons: { "1": { name, meanings: [ … ], art: "icons/001.png" }, …, "118": { … } },
 *   markers: { main: "markers/main.png", sub1, sub2, sub3, sub4 },
 *   back, box, logo,
 *   guide: { tagline },
 *   credit: { title, paragraphs: […], links: [{ label, href }] }
 * }
 *
 * Icons are numbered in the printed board's order: column by column, each row left then right.
 */
export interface ManifestIcon {
  name?: string;
  meanings?: string[];
  art?: string;
}

export interface Manifest {
  title?: string;
  icons?: Record<string, ManifestIcon>;
  markers?: Partial<Record<SetId, string>>;
  back?: string;
  box?: string;
  logo?: string;
  guide?: { tagline?: string };
  credit?: { title?: string; paragraphs?: string[]; links?: { label?: string; href?: string }[] };
}

export const clean = (v: unknown, max = 80): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;

export const asManifest = (m: unknown): Manifest | null => (m && typeof m === 'object' ? m : null);

/** An icon's placeholder name, without the manifest. */
export const iconPlaceholder = (n: number) => `Icon ${n}`;

/** An icon's name: the manifest's, else "Icon 17". */
export function iconName(m: Manifest | null | undefined, n: number): string {
  return clean(m?.icons?.[String(n)]?.name) ?? iconPlaceholder(n);
}

/** What an icon can stand for, from the manifest (empty without it). */
export function iconMeanings(m: Manifest | null | undefined, n: number): string[] {
  const list = m?.icons?.[String(n)]?.meanings;
  return Array.isArray(list) ? list.flatMap((x) => (clean(x) ? [clean(x)!] : [])).slice(0, 12) : [];
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
