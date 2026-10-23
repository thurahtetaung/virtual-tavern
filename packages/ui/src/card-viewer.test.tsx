import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  CardViewer,
  MAX_ZOOM,
  SWIPE_PX,
  TAP_ZOOM,
  type ViewerItem,
  keyOf,
  swipeOf,
  viewerReducer,
  viewerStart,
} from './card-viewer.tsx';

const items: ViewerItem[] = [1, 2, 3].map((n) => ({
  key: `vision-${n}`,
  label: `Vision ${n}`,
  aspect: 700 / 1024,
  src: `/api/backroom/assets/seance/cards/vision/${n}.jpg`,
}));
const frame = { w: 200, h: 300 };

describe('CardViewer', () => {
  it('opens on the card it was asked for, with its place in the group', () => {
    const page = renderToStaticMarkup(
      <CardViewer items={items} start={1} title="Your hand" onClose={() => undefined} />,
    );
    expect(page).toContain('data-viewer-card="vision-2"');
    expect(page).toContain('2 / 3');
    expect(page).toContain('src="/api/backroom/assets/seance/cards/vision/2.jpg"');
    expect(page).toContain('aria-label="Close"');
    expect(page).toContain('aria-label="Next card"');
    expect(page).toContain('draggable="false"');
  });

  it('clamps a start outside the group', () => {
    expect(viewerStart(9, 3).index).toBe(2);
    expect(viewerStart(-1, 3).index).toBe(0);
  });

  it('shows the fallback when there is no art, and the actions for the card shown', () => {
    const page = renderToStaticMarkup(
      <CardViewer
        items={[{ key: 'x', label: 'Card 7', aspect: 1, fallback: <span>PLACEHOLDER</span> }]}
        title="One"
        onClose={() => undefined}
        actions={(i) => <button type="button">Pick {i}</button>}
      />,
    );
    expect(page).toContain('PLACEHOLDER');
    expect(page).toContain('Pick 0');
    expect(page).not.toContain('1 / 1');
  });

  it('moves through the group with next, prev and go, stopping at the ends', () => {
    let s = viewerStart(0, 3);
    s = viewerReducer(s, { type: 'prev' });
    expect(s.index).toBe(0);
    s = viewerReducer(s, { type: 'next' });
    s = viewerReducer(s, { type: 'next' });
    s = viewerReducer(s, { type: 'next' });
    expect(s.index).toBe(2);
    expect(viewerReducer(s, { type: 'go', to: 0 }).index).toBe(0);
  });

  it('starts every card unzoomed', () => {
    let s = viewerReducer(viewerStart(0, 3), { type: 'toggle', frame });
    expect(s.scale).toBe(TAP_ZOOM);
    s = viewerReducer(s, { type: 'pan', dx: 40, dy: 20, frame });
    expect(s.x).toBe(40);
    s = viewerReducer(s, { type: 'next' });
    expect(s).toMatchObject({ index: 1, scale: 1, x: 0, y: 0 });
  });

  it('zooms between 1 and the maximum, keeping the pan inside the card', () => {
    let s = viewerReducer(viewerStart(0, 1), { type: 'zoom', scale: 99, frame });
    expect(s.scale).toBe(MAX_ZOOM);
    s = viewerReducer(s, { type: 'pan', dx: 10_000, dy: -10_000, frame });
    expect(s.x).toBe(((MAX_ZOOM - 1) * frame.w) / 2);
    expect(s.y).toBe(-((MAX_ZOOM - 1) * frame.h) / 2);
    s = viewerReducer(s, { type: 'zoom', scale: 0.1, frame });
    expect(s).toMatchObject({ scale: 1, x: 0, y: 0 });
  });

  it('zooms in around the finger, and a second double tap zooms back out', () => {
    let s = viewerReducer(viewerStart(0, 1), { type: 'toggle', at: { x: 40, y: 0 }, frame });
    // The point under the finger stays put: 40 - (40 - 0) * 2.5.
    expect(s.x).toBe(-60);
    s = viewerReducer(s, { type: 'toggle' });
    expect(s).toMatchObject({ scale: 1, x: 0, y: 0 });
  });

  it('never pans at zoom 1 (a drag there is a swipe)', () => {
    const s = viewerReducer(viewerStart(0, 2), { type: 'pan', dx: 50, dy: 0, frame });
    expect(s.x).toBe(0);
  });

  it('reads swipes: sideways moves, down closes, small or upward drags do nothing', () => {
    expect(swipeOf(-(SWIPE_PX + 1), 10)).toBe('next');
    expect(swipeOf(SWIPE_PX + 1, -10)).toBe('prev');
    expect(swipeOf(5, SWIPE_PX + 1)).toBe('close');
    expect(swipeOf(10, 10)).toBeNull();
    expect(swipeOf(0, -200)).toBeNull();
  });

  it('maps the keys: arrows move, Escape closes, 0 resets', () => {
    expect(keyOf('ArrowRight')).toEqual({ type: 'next' });
    expect(keyOf('ArrowLeft')).toEqual({ type: 'prev' });
    expect(keyOf('Escape')).toBe('close');
    expect(keyOf('0')).toEqual({ type: 'reset' });
    expect(keyOf('a')).toBeNull();
  });

  it('keeps the index inside a group that shrinks (a card sent away)', () => {
    const s = viewerReducer(viewerStart(2, 3), { type: 'count', count: 2 });
    expect(s.index).toBe(1);
  });
});
