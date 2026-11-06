import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ICONS, OUTPUT, drawingOf, iconBody, render } from './icon-sprite.mjs';

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

  it('refuses an icon holding anything but drawing elements', () => {
    const svg = (inner) => `<svg viewBox="0 0 24 24">${inner}</svg>`;
    expect(drawingOf(svg('\n  <path d="M1 1" />\n  <circle cx="2" cy="2" r="1" />\n'), 'ok')).toBe(
      '<path d="M1 1"/><circle cx="2" cy="2" r="1"/>',
    );
    for (const inner of [
      '<path d="M1 1" /><!-- x -->',
      '<path d="M1 1" /><!<!---->-- x -->',
      '<path d="M1 1" /><script>alert(1)</script>',
      '<path d="M1 1" onload="alert(1)" />',
      '<path d="M1 1" style="fill:red" />',
      '<path d="M1 1" /><foreignObject/>',
      '<path d="M1 1" />text',
      '',
    ]) {
      expect(() => drawingOf(svg(inner), 'bad')).toThrow(/more than drawing elements/);
    }
  });
});
