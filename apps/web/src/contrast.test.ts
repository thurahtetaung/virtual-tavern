import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { root, uiFiles } from './ui-sources.ts';

/*
 * Guard for readable captions in both themes. Muted text uses the `text-ink-muted` token (stone at
 * 46 % lightness in light mode, stone-400 in dark), never a bare `text-stone-500`, which is too faint
 * on the warm panels and on near-black. A variant (`dark:text-stone-500`, `hover:…`) is left alone.
 * The dark case: white text on a mid green or red fill reads under 4.5:1, so those chips take the
 * next shade down (`dark:bg-emerald-700`) or dark text on a lighter fill (`dark:bg-red-400`).
 */

const BARE_STONE_500 = /(?<![\w:/[-])text-stone-500(?![\w/-])/g;

/** Fill and text pairs that fail AA contrast in dark mode when they meet on one element. */
const DARK_PAIRS: { fill: RegExp; text: RegExp; why: string }[] = [
  {
    fill: /(?<![\w-])dark:bg-(emerald|green)-(500|600)(?![\w/-])/,
    text: /(?<![\w:-])text-white(?![\w/-])/,
    why: 'white on a mid green fill',
  },
  {
    fill: /(?<![\w-])dark:bg-red-500(?![\w/-])/,
    text: /(?<![\w-])dark:text-red-950(?![\w/-])/,
    why: 'dark red on red-500',
  },
];

/** Every contrast problem in `source`, as `line: what`. */
export function lowContrast(source: string): string[] {
  return source
    .split('\n')
    .flatMap((line, i) => [
      ...[...line.matchAll(BARE_STONE_500)].map(() => `${i + 1}: text-stone-500`),
      ...DARK_PAIRS.filter((p) => p.fill.test(line) && p.text.test(line)).map(
        (p) => `${i + 1}: ${p.why}`,
      ),
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

  it('flags dark fills that white or dark text cannot be read on', () => {
    expect(
      lowContrast(
        [
          `'bg-success dark:bg-emerald-600 text-white'`,
          `'bg-success dark:bg-emerald-700 text-white'`,
          `'bg-team-a text-white dark:bg-red-500 dark:text-red-950'`,
          `'bg-team-a text-white dark:bg-red-400 dark:text-red-950'`,
          `'dark:bg-emerald-600 text-stone-950'`,
        ].join('\n'),
      ),
    ).toEqual(['1: white on a mid green fill', '3: dark red on red-500']);
  });

  it('finds no low-contrast text in UI code', () => {
    const found = uiFiles().flatMap(({ file }) =>
      lowContrast(readFileSync(file, 'utf8')).map((hit) => `${relative(root, file)}:${hit}`),
    );
    expect(found, 'use text-ink-muted, or a darker fill under white text').toEqual([]);
  });
});
