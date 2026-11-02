import { DRAWING_COLORS, ERASER, type Stroke, encodeDrawing } from '@vt/game-sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DrawingPad, DrawingView } from './drawing.tsx';

const ink = (c: number, x: number): Stroke => ({ c, w: 1, points: [x, 10, x, 900] });
const rub = (x: number): Stroke => ({ c: ERASER, w: 2, points: [x, 500, x + 10, 510] });

const html = (strokes: Stroke[], drawInMs?: number) =>
  renderToStaticMarkup(<DrawingView drawing={strokes} label="A drawing" drawInMs={drawInMs} />);

/** The markup as a tree of what matters: `g[mask]`, `mask` and the pens' colours, in order. */
function shape(markup: string): string {
  return [...markup.matchAll(/<(\/?)(g|mask|path)\b([^>]*)>/g)]
    .filter(([, close, tag]) => !(close && tag === 'path'))
    .map(([, close, tag, attrs]) => {
      if (close) return `/${tag}`;
      if (tag === 'path') return attrs!.match(/stroke="([^"]+)"/)![1]!;
      return tag === 'g' ? (attrs!.includes('mask=') ? 'g' : 'g-') : 'mask';
    })
    .join(' ');
}

const [inkHex, blue, orange] = DRAWING_COLORS.map((c) => c.hex);

describe('DrawingView with the eraser', () => {
  it('draws a drawing without eraser strokes exactly as before (no masks)', () => {
    const markup = html([ink(0, 10), ink(1, 20)]);
    expect(markup).not.toContain('<mask');
    expect(shape(markup)).toBe(`${inkHex} ${blue}`);
  });

  it('masks only what was drawn before each run of eraser strokes, in drawing order', () => {
    const markup = html([ink(0, 10), rub(10), rub(30), ink(1, 20), rub(20), ink(2, 30)]);
    expect(shape(markup)).toBe(
      [
        // The masks: the first run's two strokes, then the second's, each cleared in black.
        'mask #000 #000 /mask mask #000 /mask',
        // The second mask covers the first group and the blue line; orange stays on top, untouched.
        `g g ${inkHex} /g ${blue} /g ${orange}`,
      ].join(' '),
    );
    // Masks clear the ink itself across the whole page, never paint the paper colour.
    expect(markup.match(/<mask [^>]*>/g)).toEqual([
      expect.stringContaining('maskUnits="userSpaceOnUse"'),
      expect.stringContaining('maskUnits="userSpaceOnUse"'),
    ]);
    expect(markup.match(/<rect /g)).toHaveLength(3);
    const ids = [...markup.matchAll(/<mask id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(markup).toContain(`mask="url(#${id})"`);
  });

  it('ignores eraser strokes before any ink', () => {
    const markup = html([rub(10), ink(0, 10)]);
    expect(markup).not.toContain('<mask');
    expect(shape(markup)).toBe(inkHex);
  });

  it('decodes stored drawings and draws the eraser in, in its turn', () => {
    const stored = encodeDrawing([ink(0, 10), rub(10)]);
    const drawn = renderToStaticMarkup(
      <DrawingView drawing={stored} label="Stored" drawInMs={1000} />,
    );
    expect(shape(drawn)).toBe(`mask #000 /mask g ${inkHex} /g`);
    expect(drawn.match(/class="vt-draw-in"/g)).toHaveLength(2);
  });

  it('gives each view its own mask ids', () => {
    const strokes = [ink(0, 10), rub(10)];
    const markup = renderToStaticMarkup(
      <>
        <DrawingView drawing={strokes} label="One" />
        <DrawingView drawing={strokes} label="Two" />
      </>,
    );
    const ids = [...markup.matchAll(/<mask id="([^"]+)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids[0]).toMatch(/^[a-zA-Z0-9_-]+$/);
  });
});

describe('DrawingPad', () => {
  it('offers the eraser with the pens', () => {
    const markup = renderToStaticMarkup(<DrawingPad draftKey="t" onSubmit={() => true} />);
    expect(markup).toMatch(/role="radiogroup" aria-label="Pen"/);
    expect(markup).toMatch(/role="radio" aria-checked="false" aria-label="Eraser"/);
  });
});
