import type { GuideFooter } from '@vt/game-sdk';

/**
 * The private `mission-control/manifest.json` (asset storage only, never in the repo). Every
 * field is optional; without it cards are drawn from their colour symbol and value, tasks show as
 * text and the plain words below stand in for the theme's names.
 *
 * {
 *   title,
 *   names: { trump, trumps, token, captain, dummy, distress, crew },
 *   cards: { "pink-3": "cards/pink-3.webp" | { art, thumb }, …, "sub-4": … },  // or "p3", "t4"
 *   back: "…" | { art, thumb },
 *   tasks: { "<task id>": { art, thumb } },                                    // task card scans
 *   tokens: { "sonar-green", "sonar-red", "captain", "distress-up", "distress-down", "reminder" },
 *   box: "…" | { art, thumb },
 *   logbook: { "<mission n>": { title?, text?, rule? }, "epilogue": { … } },
 *   credit: "…" | { title, text, url, paragraphs: […], links: [{ label, href }] }
 * }
 */
export type ArtRef = string | { art?: string; thumb?: string };

export interface Names {
  trump: string;
  trumps: string;
  token: string;
  captain: string;
  dummy: string;
  distress: string;
  crew: string;
}

export const PLACEHOLDER_NAMES: Names = {
  trump: 'trump',
  trumps: 'trumps',
  token: 'signal token',
  captain: 'captain',
  dummy: 'the dummy',
  distress: 'distress signal',
  crew: 'crew',
};

export interface LogbookEntry {
  title?: string;
  text?: string;
  rule?: string;
}

export interface Manifest {
  title?: string;
  names?: Partial<Names>;
  cards?: Record<string, ArtRef>;
  back?: ArtRef;
  tasks?: Record<string, ArtRef>;
  tokens?: Record<string, ArtRef>;
  box?: ArtRef;
  logbook?: Record<string, LogbookEntry>;
  credit?:
    | string
    | {
        title?: string;
        text?: string;
        url?: string;
        paragraphs?: string[];
        links?: { label?: string; href?: string }[];
      };
}

export const clean = (v: unknown, max = 200): string | undefined =>
  typeof v === 'string' && v.trim() && v.trim().length <= max ? v.trim() : undefined;

export const asManifest = (raw: unknown): Manifest => (raw && typeof raw === 'object' ? raw : {});

/** The theme's names, each falling back to the plain word. */
export function namesOf(m: Manifest | null | undefined): Names {
  const out = { ...PLACEHOLDER_NAMES };
  const given = m?.names && typeof m.names === 'object' ? m.names : {};
  for (const k of Object.keys(out) as (keyof Names)[]) out[k] = clean(given[k], 40) ?? out[k];
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Fills name tokens: `{trump}`, `{trumps}`, `{token}`, `{captain}`, `{dummy}`, `{distress}`,
 * `{crew}`, capitalised (`{Trump}`) for a sentence start.
 */
export function fillNames(text: string, names: Names): string {
  return text.replace(/\{([A-Za-z]+)\}/g, (all, key: string) => {
    const lower = key.charAt(0).toLowerCase() + key.slice(1);
    const word = names[lower as keyof Names];
    if (word === undefined) return all;
    return key === lower ? word : cap(word);
  });
}

/** A card's key in the manifest: "pink-3", "sub-4" (the plain id "p3" is read too). */
const SUIT_KEYS: Record<string, string> = {
  p: 'pink',
  b: 'blue',
  g: 'green',
  y: 'yellow',
  t: 'sub',
};
export const cardKey = (id: string) => `${SUIT_KEYS[id[0]!] ?? id[0]}-${id.slice(1)}`;

/** The art path in an entry (a plain path, or `{ art }`). */
export const artOf = (ref: ArtRef | undefined): string | undefined =>
  typeof ref === 'string' ? clean(ref) : clean(ref?.art);
export const thumbOf = (ref: ArtRef | undefined): string | undefined =>
  typeof ref === 'string' ? undefined : clean(ref?.thumb);

/** The original game's credit, for the guide's footer (unlocked browsers only). */
export function footerOf(m: Manifest | null | undefined): GuideFooter | undefined {
  const raw = m?.credit;
  if (typeof raw === 'string')
    return clean(raw, 600) ? { title: 'Credits', paragraphs: [raw.trim()] } : undefined;
  const paragraphs = [...(raw?.paragraphs ?? []), ...(raw?.text ? [raw.text] : [])].flatMap((p) =>
    clean(p, 600) ? [p.trim()] : [],
  );
  if (!paragraphs.length) return undefined;
  const given = [
    ...(raw?.links ?? []),
    ...(raw?.url ? [{ label: 'Original game', href: raw.url }] : []),
  ];
  const links = given.flatMap((l) =>
    clean(l.label) && typeof l.href === 'string' && /^https:\/\//.test(l.href)
      ? [{ label: l.label!.trim(), href: l.href }]
      : [],
  );
  return { title: clean(raw?.title) ?? 'Credits', paragraphs, ...(links.length ? { links } : {}) };
}
