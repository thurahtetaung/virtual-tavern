import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ICON_NAMES, Icon, IconSprite } from './icon.tsx';

describe('Icon', () => {
  it('points into the sprite, hidden from screen readers, in the text colour', () => {
    const svg = renderToStaticMarkup(<Icon name="beer" />);
    expect(svg).toContain('<use href="#i-beer"></use>');
    expect(svg).toContain('aria-hidden="true"');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).toContain('width="20"');
    expect(svg).not.toContain('aria-label');
  });

  it('keeps a 1.5 px stroke at every size', () => {
    for (const size of [16, 20, 24, 48]) {
      const svg = renderToStaticMarkup(<Icon name="x" size={size} />);
      const width = Number(/stroke-width="([\d.]+)"/.exec(svg)?.[1]);
      expect(width * (size / 24)).toBeCloseTo(1.5);
    }
  });

  it('names an icon-only control', () => {
    const svg = renderToStaticMarkup(<Icon name="x" label="Close" />);
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="Close"');
    expect(svg).not.toContain('aria-hidden');
  });
});

describe('IconSprite', () => {
  it('holds one symbol per icon and nothing else', () => {
    const sprite = renderToStaticMarkup(<IconSprite />);
    for (const name of ICON_NAMES) expect(sprite).toContain(`<symbol id="i-${name}"`);
    expect(sprite.match(/<symbol /g)).toHaveLength(ICON_NAMES.length);
    expect(sprite).toContain('aria-hidden="true"');
    expect(sprite).not.toMatch(/<script|on\w+=/i);
  });
});
