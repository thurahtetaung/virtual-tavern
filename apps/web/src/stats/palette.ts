// Chart colours for both themes. The categorical order is fixed and was checked with the dataviz
// palette validator against our card surfaces (white in light mode, stone-900 in dark): adjacent
// pairs stay apart for colour-blind readers, and dark mode uses its own selected steps rather than
// an automatic flip. Three light-mode slots sit under 3:1 contrast, so every chart also has a
// table view and a text legend.

export type ChartTheme = 'light' | 'dark';

export interface ChartTokens {
  theme: ChartTheme;
  /** Card surface the chart sits on: the gap between marks and the ring around dots. */
  surface: string;
  ink: string;
  inkSecondary: string;
  muted: string;
  grid: string;
  axis: string;
  /** Categorical slots, in order. */
  series: readonly string[];
  /** Five sequential steps, low → high magnitude. */
  sequential: readonly string[];
  /** Heat cells with nothing in them. */
  empty: string;
  /** For "Other" and anything past the last slot. */
  other: string;
}

const LIGHT: ChartTokens = {
  theme: 'light',
  surface: '#ffffff',
  ink: '#1c1917',
  inkSecondary: '#57534e',
  muted: '#78716c',
  grid: '#e7e5e4',
  axis: '#d6d3d1',
  series: [
    '#2a78d6',
    '#eb6834',
    '#1baf7a',
    '#eda100',
    '#e87ba4',
    '#008300',
    '#6250d6',
    '#e34948',
    '#0e8fa3',
    '#9a6a2f',
    '#56708f',
    '#6f8a00',
    '#a3369a',
    '#2d3f8f',
  ],
  sequential: ['#b7d3f6', '#6da7ec', '#2a78d6', '#1c5cab', '#0d366b'],
  empty: '#f5f5f4',
  other: '#a8a29e',
};

const DARK: ChartTokens = {
  theme: 'dark',
  surface: '#1c1917',
  ink: '#f5f5f4',
  inkSecondary: '#a8a29e',
  muted: '#8a8580',
  grid: '#292524',
  axis: '#44403c',
  series: [
    '#3987e5',
    '#d95926',
    '#199e70',
    '#c98500',
    '#d55181',
    '#008300',
    '#9085e9',
    '#e66767',
    '#22a9bd',
    '#c08a4a',
    '#8fa3bf',
    '#a5bd2e',
    '#c868bd',
    '#7f93e8',
  ],
  // Brighter means more on a dark surface.
  sequential: ['#184f95', '#1c5cab', '#2a78d6', '#5598e7', '#9ec5f4'],
  empty: '#292524',
  other: '#78716c',
};

export const tokensFor = (theme: ChartTheme): ChartTokens => (theme === 'dark' ? DARK : LIGHT);

/**
 * Known games keep their slot whatever else is in the data, so colour follows the game. Append new
 * games at the end: Reverie, Masquerade and Royal Post sit where their ids used to hash, so no
 * existing game changes colour. Nightfall took a ninth slot (a teal, kept apart from the red before it
 * and at least 3:1 on both surfaces), Round Table a tenth (a bronze, 4.7:1 on white and 5.8:1 on
 * stone-900, kept apart from the teal before it), Inquest an eleventh (a slate blue-grey, kept
 * apart from the bronze before it), Hydra a twelfth (an olive, apart from both greens and the
 * amber), Séance a thirteenth (a plum, apart from the pink and the violet) and Hydra's themed
 * edition a fourteenth (a navy, apart from the plum before it and from both blues by lightness).
 * Every slot is now taken, so a game not listed here is drawn in the neutral "other" colour until
 * it is added.
 */
const FIXED_ORDER = [
  'codenames',
  'enigma',
  'echo',
  'reverie',
  'hoodwink',
  'masquerade',
  'royal-post',
  'masquerade-originals',
  'nightfall',
  'round-table',
  'inquest',
  'hydra',
  'seance',
  'hogwarts',
];

/**
 * Stable slot per game id: the known games have fixed slots, and any other game hashes into the
 * remaining ones. A slot depends only on the id, never on which games are in the data, so colour
 * follows the game across every chart and a filter never repaints the survivors.
 */
export function slotFor(id: string): number {
  const fixed = FIXED_ORDER.indexOf(id);
  if (fixed >= 0) return fixed;
  const free = LIGHT.series.length - FIXED_ORDER.length;
  if (free <= 0) return LIGHT.series.length;
  let h = 0;
  for (const c of id) h = (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0;
  return FIXED_ORDER.length + (h % free);
}

export function gameSlots(ids: Iterable<string>): Map<string, number> {
  return new Map([...new Set([...FIXED_ORDER, ...ids])].map((id) => [id, slotFor(id)]));
}

export function slotColor(tokens: ChartTokens, slot: number | undefined): string {
  return slot === undefined ? tokens.other : (tokens.series[slot] ?? tokens.other);
}
