import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Guard for the calm light mode (`index.css`): UI code paints notices, highlights and buttons with
 * the semantic tokens (`bg-warn-soft`, `ring-accent-line`, `bg-team-a`…), not with Tailwind's
 * chromatic scales, which are what made light mode loud. A light-mode `bg-`, `ring-`, `border-` or
 * `outline-` class on a chromatic hue (shades 50–700) fails this test; `dark:` classes are free,
 * so dark mode can keep its stock colours. Colours that are a game's identity rather than
 * decoration (seat colours, role colours) may stay: mark the line, or the line above it, with a
 * `vt-palette` comment saying why. The light palette mutes those scales anyway.
 */

const root = join(import.meta.dirname, '../../..');

/**
 * Hydra's editions recolour its teams by overriding Tailwind's sky (blue team) and red scales on the
 * game's root (`teamColors` in its `assets.ts`), so those two scales are its palette.
 */
const EDITION_SCALES: Record<string, string[]> = {
  'packages/private-games/hydra': ['sky', 'red'],
  'packages/private-games/hogwarts': ['sky', 'red'],
};

const HUES =
  'red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose';
// A class token: any variants (none of them `dark`), then a chromatic fill, ring, border or outline.
const LOUD = new RegExp(
  String.raw`(?<![\w:/[-])((?:[\w-]+(?:-\[[^\]]+\])?:)*)(bg|ring|border|outline)-(${HUES})-(50|[1-7]00)(?:/\d+)?(?![\w-])`,
  'g',
);

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name === 'dist') return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Every UI source file, with the chromatic scales it may use. */
function uiFiles(): { file: string; scales: string[] }[] {
  const dirs = [
    { dir: join(root, 'apps/web/src'), scales: [] as string[] },
    { dir: join(root, 'packages/ui/src'), scales: [] },
  ];
  for (const group of ['packages/games', 'packages/private-games']) {
    for (const game of readdirSync(join(root, group))) {
      const pkg = `${group}/${game}`;
      for (const sub of ['src/ui', 'src']) {
        const dir = join(root, pkg, sub);
        if (statSync(dir, { throwIfNoEntry: false })) {
          dirs.push({ dir, scales: EDITION_SCALES[pkg] ?? [] });
          break;
        }
      }
    }
  }
  return dirs.flatMap(({ dir, scales }) => sources(dir).map((file) => ({ file, scales })));
}

/** Every loud light-mode class in `source`, as `line: class`. */
export function loudClasses(source: string, scales: string[] = []): string[] {
  const lines = source.split('\n');
  return lines.flatMap((line, i) => {
    if (line.includes('vt-palette') || lines[i - 1]?.includes('vt-palette')) return [];
    return [...line.matchAll(LOUD)]
      .filter((m) => !m[1]!.split(':').includes('dark') && !scales.includes(m[3]!))
      .map((m) => `${i + 1}: ${m[0]}`);
  });
}

describe('light-mode colour guard', () => {
  it('flags chromatic light fills but not tokens, dark classes or marked palettes', () => {
    expect(
      loudClasses(
        [
          `'bg-amber-200 hover:bg-rose-100 ring-2 ring-sky-300 border-emerald-500/40'`,
          `'bg-warn-soft ring-accent-line dark:bg-amber-500/15 dark:hover:bg-rose-900'`,
          `'bg-stone-100 text-amber-700 bg-amber-900 ring-red-950'`,
          `// vt-palette: seat colours`,
          `blue: 'bg-sky-500',`,
          `red: 'bg-red-500', // vt-palette`,
        ].join('\n'),
      ),
    ).toEqual([
      '1: bg-amber-200',
      '1: hover:bg-rose-100',
      '1: ring-sky-300',
      '1: border-emerald-500/40',
    ]);
  });

  it("leaves a package's edition scales alone", () => {
    expect(loudClasses(`'bg-sky-500 ring-red-300 bg-amber-200'`, ['sky', 'red'])).toEqual([
      '1: bg-amber-200',
    ]);
  });

  it('finds no loud light-mode colours in UI code', () => {
    const files = uiFiles();
    expect(files.length).toBeGreaterThan(100);
    const found = files.flatMap(({ file, scales }) =>
      loudClasses(readFileSync(file, 'utf8'), scales).map(
        (hit) => `${relative(root, file)}:${hit}`,
      ),
    );
    expect(found, 'use the semantic tokens from apps/web/src/index.css').toEqual([]);
  });
});
