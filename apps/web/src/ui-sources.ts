import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/* Every UI source file in the repo, for the colour guards (`light-mode.test.ts`, `contrast.test.ts`). */

export const root = join(import.meta.dirname, '../../..');

/**
 * Hydra's editions recolour its teams by overriding Tailwind's sky (blue team) and red scales on the
 * game's root (`teamColors` in its `assets.ts`), so those two scales are its palette.
 */
const EDITION_SCALES: Record<string, string[]> = {
  'packages/private-games/hydra': ['sky', 'red'],
  'packages/private-games/hogwarts': ['sky', 'red'],
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'node_modules' || name === 'dist') return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

/** Every UI source file, with the chromatic scales it may use. */
export function uiFiles(): { file: string; scales: string[] }[] {
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
