import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ICONS, OUTPUT, iconBody, render } from './icon-sprite.mjs';

describe('icon sprite', () => {
  it('is current: rerun `node scripts/icon-sprite.mjs` after changing the icon list', () => {
    expect(readFileSync(OUTPUT, 'utf8')).toBe(render());
  });

  it('lists each icon once, sorted', () => {
    expect(ICONS).toEqual([...new Set(ICONS)].sort());
  });

  it('keeps only drawing elements, no attributes from the source <svg>', () => {
    for (const name of ICONS) {
      const body = iconBody(name);
      expect(body).toMatch(/^<(path|circle|rect|line|polyline|polygon|ellipse)\b/);
      expect(body).not.toMatch(/<svg|<!--|class=|stroke-width/);
    }
  });
});
