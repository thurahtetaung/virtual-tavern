import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OUT, contrast, parseOklch, render, tailwindTheme } from './light-palette.mjs';

const css = readFileSync(new URL('../apps/web/src/index.css', import.meta.url), 'utf8');

/** The light values of the semantic tokens (the first `:root` block in index.css). */
function lightTokens() {
  const block = /^:root \{([^}]*)\}/m.exec(css)?.[1] ?? '';
  return Object.fromEntries(
    [...block.matchAll(/--vt-([\w-]+):\s*(oklch\([^)]*\))/g)].map((m) => [m[1], parseOklch(m[2])]),
  );
}

describe('light palette', () => {
  it('is up to date with the generator and the installed Tailwind', () => {
    expect(readFileSync(OUT, 'utf8')).toBe(render(tailwindTheme()));
  });

  it('keeps text on the light tokens at WCAG AA (4.5:1)', () => {
    const t = lightTokens();
    const white = [1, 0, 0];
    const pairs = [
      ['ink', 'page'],
      ['ink', 'card'],
      ['ink-muted', 'page'],
      ['ink-muted', 'panel'],
      ['ink-muted', 'card'],
      ['accent-fg', 'accent'],
      ['accent-fg', 'accent-hover'],
      ['accent-text', 'accent-soft'],
      ['accent-text', 'page'],
      ...['info', 'warn', 'danger', 'success', 'special', 'team-a', 'team-b'].flatMap((tone) => [
        [`${tone}-ink`, `${tone}-soft`],
        [`${tone}-ink`, 'card'],
      ]),
    ];
    const low = [];
    for (const [fg, bg] of pairs) {
      expect(t[fg], fg).toBeDefined();
      expect(t[bg], bg).toBeDefined();
      const ratio = contrast(t[fg], t[bg]);
      if (ratio < 4.5) low.push(`${fg} on ${bg}: ${ratio.toFixed(2)}`);
    }
    for (const fill of ['danger', 'success', 'info', 'special', 'team-a', 'team-b']) {
      const ratio = contrast(white, t[fill]);
      if (ratio < 4.5) low.push(`white on ${fill}: ${ratio.toFixed(2)}`);
    }
    expect(low).toEqual([]);
  });
});
