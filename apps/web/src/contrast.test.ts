import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { root, uiFiles } from './ui-sources.ts';

/*
 * Guard for readable captions in both themes. Muted text uses the `text-ink-muted` token (stone at
 * 46 % lightness in light mode, stone-400 in dark), never a bare `text-stone-500`, which is too faint
 * on the warm panels and on near-black. A variant (`dark:text-stone-500`, `hover:…`) is left alone.
 * A bare `text-stone-400` is too faint on light panels (about 2.5:1) and is only right on a surface
 * that stays dark in both themes: mark that line, or the line above it, with a `vt-contrast` comment
 * saying so. The dark case: white text on a mid green fill, or on any chromatic 500 fill, reads under
 * 4.5:1, so those chips take the next shade down (`dark:bg-red-600`) or dark text
 * (`dark:text-stone-950`).
 */

const BARE_STONE_500 = /(?<![\w:/[-])text-stone-500(?![\w/-])/g;
const BARE_STONE_400 = /(?<![\w:/[-])text-stone-400(?![\w/-])/g;

const WHITE = /(?<![\w:-])text-white(?![\w/-])/;

/** Fill and text pairs that fail AA contrast in dark mode when they meet on one element. */
const DARK_PAIRS: { fill: RegExp; text: RegExp; unless?: RegExp; why: string }[] = [
  {
    fill: /(?<![\w-])dark:bg-(emerald|green)-(500|600)(?![\w/-])/,
    text: WHITE,
    why: 'white on a mid green fill',
  },
  {
    fill: /(?<![\w-])dark:bg-(red|orange|amber|yellow|lime|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-500(?![\w/-])/,
    text: WHITE,
    unless: /(?<![\w-])dark:text-/,
    why: 'white on a 500 fill',
  },
  {
    fill: /(?<![\w-])dark:bg-red-500(?![\w/-])/,
    text: /(?<![\w-])dark:text-red-950(?![\w/-])/,
    why: 'dark red on red-500',
  },
];

/** Every contrast problem in `source`, as `line: what`. */
export function lowContrast(source: string): string[] {
  const lines = source.split('\n');
  return lines.flatMap((line, i) => [
    ...[...line.matchAll(BARE_STONE_500)].map(() => `${i + 1}: text-stone-500`),
    ...(line.includes('vt-contrast') || lines[i - 1]?.includes('vt-contrast')
      ? []
      : [...line.matchAll(BARE_STONE_400)].map(() => `${i + 1}: text-stone-400`)),
    ...DARK_PAIRS.filter(
      (p) => p.fill.test(line) && p.text.test(line) && !p.unless?.test(line),
    ).map((p) => `${i + 1}: ${p.why}`),
  ]);
}

describe('contrast guard', () => {
  it('flags bare stone-500 captions but not the token or variants', () => {
    expect(
      lowContrast(
        [
          `'text-xs text-stone-500'`,
          `'text-stone-500 dark:text-stone-400'`,
          `'text-ink-muted dark:text-stone-500 hover:text-stone-500 text-stone-500/80'`,
          `'bg-stone-500 text-stone-600'`,
        ].join('\n'),
      ),
    ).toEqual(['1: text-stone-500', '2: text-stone-500']);
  });

  it('flags bare stone-400 text unless the line says it sits on a dark surface', () => {
    expect(
      lowContrast(
        [
          `<span className="text-xs text-stone-400 italic">no discards</span>`,
          `'text-ink-muted dark:text-stone-400 hover:text-stone-400 decoration-stone-400/60'`,
          `{/* vt-contrast: on the dark cover */}`,
          `<span className="text-xs text-stone-400">Keep it hidden</span>`,
          `'bg-stone-900 text-stone-400', // vt-contrast: dark panel`,
        ].join('\n'),
      ),
    ).toEqual(['1: text-stone-400']);
  });

  it('flags dark fills that white or dark text cannot be read on', () => {
    expect(
      lowContrast(
        [
          `'bg-success dark:bg-emerald-600 text-white'`,
          `'bg-success dark:bg-emerald-700 text-white'`,
          `'bg-team-a text-white dark:bg-red-500 dark:text-red-950'`,
          `'bg-team-a text-white dark:bg-red-400 dark:text-red-950'`,
          `'dark:bg-emerald-600 text-stone-950'`,
          `'bg-team-a text-white ring-team-a dark:ring-red-700 dark:bg-red-500'`,
          `'bg-team-a text-white ring-team-a dark:ring-red-700 dark:bg-red-600'`,
          `'bg-accent dark:bg-amber-500 text-white dark:text-stone-950'`,
          `'bg-special text-white dark:bg-indigo-500/20 dark:bg-blue-500/30'`,
        ].join('\n'),
      ),
    ).toEqual(['1: white on a mid green fill', '3: dark red on red-500', '6: white on a 500 fill']);
  });

  it('finds no low-contrast text in UI code', () => {
    const found = uiFiles().flatMap(({ file }) =>
      lowContrast(readFileSync(file, 'utf8')).map((hit) => `${relative(root, file)}:${hit}`),
    );
    expect(found, 'use text-ink-muted, or a darker fill or dark text on a 500 fill').toEqual([]);
  });
});
