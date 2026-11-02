import type { GuideFooter } from '@vt/game-sdk';

/**
 * The private `red-herring/manifest.json` (asset storage only, never in the repo). Every field is
 * optional; without one the cards are numbered placeholders on a plain back, the components plain
 * words and emoji, and the game is silent.
 *
 * {
 *   back: "back.jpg",                                   // every card's back, our picture cards too
 *   sets: { base: { name, from, to }, noir: { name, from, to } },   // the decks' names
 *   components: {
 *     lobbyArt, notebookCover, notebookPage, pencil,
 *     vp: { "3", "4", "5", back },                       // the point tokens
 *     markers: { blue, green, red, orange, white, yellow, purple, brown }   // player boards
 *   },
 *   sound: { newWord: "sound/new-word.mp3", winner: "sound/winner.mp3" },
 *   guide: { tagline },
 *   credit: "…" | { title, paragraphs: […], links: [{ label, href }] }
 * }
 *
 * The cards themselves are `cards/<nnn>.jpg` (001–252), not listed.
 */
export const MARKER_COLORS = [
  'blue',
  'green',
  'red',
  'orange',
  'white',
  'yellow',
  'purple',
  'brown',
] as const;
export type MarkerColor = (typeof MARKER_COLORS)[number];

export interface Manifest {
  back?: string;
  sets?: Partial<Record<'base' | 'noir', { name?: string; from?: number; to?: number }>>;
  components?: {
    lobbyArt?: string;
    notebookCover?: string;
    notebookPage?: string;
    pencil?: string;
    vp?: Partial<Record<'3' | '4' | '5' | 'back', string>>;
    markers?: Partial<Record<MarkerColor, string>>;
  };
  sound?: { newWord?: string; winner?: string };
  guide?: { tagline?: string };
  credit?:
    string | { title?: string; paragraphs?: string[]; links?: { label?: string; href?: string }[] };
}

export const clean = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : undefined;

export const asManifest = (m: unknown): Manifest | null => (m && typeof m === 'object' ? m : null);

export const GAME_ID = 'red-herring';

/** A file in the game's private storage. */
export const assetUrl = (path: string) =>
  `/api/backroom/assets/${GAME_ID}/${path.replace(/^\/+/, '')}`;

/** The decks' names: the manifest's, else plain ones. */
export function deckNames(m: Manifest | null | undefined): Record<'base' | 'noir', string> {
  return {
    base: clean(m?.sets?.base?.name) ?? 'Classic deck',
    noir: clean(m?.sets?.noir?.name) ?? 'Noir deck',
  };
}

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
