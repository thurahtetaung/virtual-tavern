import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  CountUp,
  EdgeFlash,
  Paddle,
  ShowTargets,
  ShowTargetsProvider,
  Stamp,
  placeOf,
  symbolSource,
} from './blocks.tsx';
import type { LoadedRig } from './rig.ts';

// A made-up rig: shapes and tracks of our own, no original art.
const rig: LoadedRig = {
  fps: 30,
  stage: [1280, 720],
  symbols: {
    wood: '<rect width="10" height="40" fill="#963"/>',
    'shape.Star':
      '<defs><clipPath id="c1"><rect/></clipPath></defs><path d="M0 0L5 5" clip-path="url(#c1)"/>',
    slab: '<path d="M0 0h80v40H0z"/><image href="tex-1.webp" width="8" height="8"/>',
  },
  tracks: {
    paddle: {
      Unraise: {
        ms: 100,
        frames: [
          [1, 0, 0, 1, 0, 0, 1],
          [1, 0, 0, 1, 0, 30, 1],
        ],
      },
    },
  },
  places: {
    'paddle.wood': [1, 0, 0, 1, -5, 0],
    'paddle.shape': [1, 0, 0, 1, 0, -40],
    'paddle.num': [1, 0, 0, 1, 0, -20],
    'stamp.profit': [1, 0, 0, 1, 0, 30],
    'row.Three': [
      [1, 0, 0, 1, 100, 0],
      [1, 0, 0, 1, 300, 0],
    ],
  },
  textures: { 'tex-1.webp': 'blob:tex-1' },
};

describe('symbolSource', () => {
  it('namespaces ids and their references, so two copies never share a clip path', () => {
    const a = symbolSource(rig, 'shape.Star');
    const b = symbolSource(rig, 'shape.Star');
    const id = /id="([^"]+)"/.exec(a)![1]!;
    expect(id).toMatch(/_c1$/);
    expect(a).toContain(`url(#${id})`);
    expect(b).not.toContain(`id="${id}"`);
  });

  it('points textures at their loaded URLs and tints every path with --c', () => {
    const s = symbolSource(rig, 'slab', true);
    expect(s).toContain('href="blob:tex-1"');
    expect(s).toContain('<path style="fill:var(--c)" d=');
    expect(symbolSource(rig, 'slab')).not.toContain('var(--c)');
    expect(symbolSource(rig, 'missing')).toBe('');
  });
});

describe('blocks', () => {
  it('reads one place or the nth of a list', () => {
    expect(placeOf(rig, 'paddle.wood')).toEqual([1, 0, 0, 1, -5, 0]);
    expect(placeOf(rig, 'row.Three', 1)).toEqual([1, 0, 0, 1, 300, 0]);
    expect(placeOf(rig, 'nowhere')).toBeUndefined();
  });

  it('draws a paddle at rest in the player colour, with its amount as live text', () => {
    const html = renderToStaticMarkup(
      <Paddle rig={rig} name="ana" shape="Star" colour="#d55e00" amount="$400" />,
    );
    expect(html).toContain('--c:#d55e00');
    expect(html).toContain('matrix(1,0,0,1,0,30)'); // Unraise's last frame
    expect(html).toContain('will-change:transform, opacity');
    expect(html).toContain('$400');
  });

  it('registers named parts as targets for moments', () => {
    const targets = new ShowTargets();
    const ref = targets.ref('ana.num');
    expect(targets.ref('ana.num')).toBe(ref); // stable
    const el = {} as HTMLElement;
    ref(el);
    expect(targets.el('ana.num')).toBe(el);
    ref(null);
    expect(targets.el('ana.num')).toBeNull();
    // Rendering inside a provider is fine on the server (refs attach in the browser).
    expect(
      renderToStaticMarkup(
        <ShowTargetsProvider targets={targets}>
          <Stamp rig={rig} />
        </ShowTargetsProvider>,
      ),
    ).toContain('vt-slab');
  });

  it('keeps the stamp hidden until shown, toned by data-tone', () => {
    const html = renderToStaticMarkup(<Stamp rig={rig} />);
    expect(html).toContain('opacity:0');
    expect(html).toContain('[data-tone=good]{--c:#003300}');
  });

  it('formats a count-up as money or a plain number', () => {
    expect(renderToStaticMarkup(<CountUp name="t" value={1234} format="money" />)).toContain(
      '$1,234',
    );
    expect(renderToStaticMarkup(<CountUp name="t" value={7} />)).toContain('>7<');
  });

  it('colours the edge flash from the theme tokens', () => {
    const html = renderToStaticMarkup(<EdgeFlash />);
    expect(html).toContain('var(--color-danger)');
    expect(html).toContain('aria-hidden="true"');
  });
});
