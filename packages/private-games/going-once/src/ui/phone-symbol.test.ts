// @vitest-environment jsdom
import type { LoadedRig } from '@vt/ui/show';
import { describe, expect, it } from 'vitest';
import { phoneSymbol } from './phone-symbol.ts';

const rig = (source: string): LoadedRig => ({
  fps: 30,
  stage: [100, 100],
  symbols: { icon: source },
  tracks: {},
  places: {},
  textures: { 'tex.webp': 'blob:texture' },
});

describe('phone rig SVG', () => {
  it('removes scripts, event handlers, foreign HTML and script URLs', () => {
    const html = phoneSymbol(
      rig(
        '<script>alert(1)</script><g onload="alert(1)"><foreignObject><div>unsafe</div></foreignObject><a href="javascript:alert(1)"><path d="M0 0"/></a></g>',
      ),
      'icon',
    );
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.innerHTML = html;
    expect(svg.querySelector('script, foreignObject, [onload]')).toBeNull();
    expect(svg.querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(svg.querySelector('path')).not.toBeNull();
  });

  it('keeps vector art, clip references, filters and loaded texture URLs', () => {
    const html = phoneSymbol(
      rig(
        '<defs><clipPath id="clip"><rect width="10" height="10"/></clipPath><filter id="shadow"><feGaussianBlur stdDeviation="2"/></filter></defs><g clip-path="url(#clip)" filter="url(#shadow)"><path d="M0 0L10 10"/><image href="tex.webp" width="10" height="10"/></g>',
      ),
      'icon',
    );
    expect(html).toContain('href="blob:texture"');
    expect(html).toContain('<clipPath');
    expect(html).toContain('<feGaussianBlur');
    expect(html).toMatch(/clip-path="url\(#r\d+_clip\)"/);
    expect(html).toMatch(/filter="url\(#r\d+_shadow\)"/);
  });
});
