import { describe, expect, it } from 'vitest';
import { previewSpot } from './Card.tsx';

const win = { w: 1440, h: 900 };
const box = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  width,
  height,
});
const inside = (s: { left: number; top: number; width: number; height: number }) =>
  s.left >= 0 && s.top >= 0 && s.left + s.width <= win.w && s.top + s.height <= win.h;

describe('the hover preview', () => {
  it('shows for a small card, sized from the window in the art’s own shape', () => {
    const s = previewSpot(box(100, 300, 96, 140), true, win)!;
    expect(s).not.toBeNull();
    expect(s.height).toBeCloseTo(900 * 0.7);
    expect(s.width / s.height).toBeCloseTo(700 / 1024);
    expect(inside(s)).toBe(true);
    // Beside the card, never over it.
    expect(s.left).toBeGreaterThanOrEqual(196);
  });

  it('a landscape card keeps its shape and stays on screen', () => {
    const s = previewSpot(box(1200, 700, 160, 110), false, win)!;
    expect(s.width / s.height).toBeCloseTo(1024 / 700);
    expect(s.width).toBeLessThanOrEqual(1440 * 0.6);
    expect(inside(s)).toBe(true);
  });

  it('is hidden when the card is already big', () => {
    // A pinned compare card about 560 px tall.
    expect(previewSpot(box(560, 60, 383, 560), true, win)).toBeNull();
    // Just under 1.6 times: still not worth it.
    expect(previewSpot(box(100, 200, 270, 395), true, win)).toBeNull();
  });

  it('is hidden on a small window where it couldn’t be much bigger', () => {
    expect(previewSpot(box(10, 10, 200, 140), false, { w: 400, h: 300 })).toBeNull();
  });

  it('keeps clear of the card being compared against', () => {
    // A strip card at the bottom left, the pinned card in the middle above it.
    const pinned = box(520, 60, 400, 500);
    const s = previewSpot(box(300, 620, 170, 260), true, win, [pinned])!;
    expect(s).not.toBeNull();
    expect(s.left + s.width <= pinned.left || s.left >= pinned.left + pinned.width).toBe(true);
  });

  it('shrinks to fit beside the compared card, and is hidden when that leaves it too small', () => {
    // A tall pinned card leaves 560 px either side.
    const pinned = box(580, 56, 280, 410);
    const strip = box(12, 526, 180, 285);
    const s = previewSpot(strip, true, win, [pinned])!;
    expect(s.width).toBeGreaterThanOrEqual(180 * 1.6);
    expect(s.left + s.width <= pinned.left || s.left >= pinned.left + pinned.width).toBe(true);
    // A wide strip card: anything clear of the pinned card would be under 1.6 times.
    expect(previewSpot(box(12, 526, 365, 285), false, win, [pinned])).toBeNull();
  });

  it('can sit above the card and beside the compared card at once', () => {
    // The ghost's compare: a wide target over a strip of visions.
    const pinned = box(336, 56, 768, 427);
    const strip = box(201, 542, 182, 285);
    const s = previewSpot(strip, true, win, [pinned])!;
    expect(s).not.toBeNull();
    expect(s.top + s.height).toBeLessThanOrEqual(strip.top);
    expect(s.left + s.width).toBeLessThanOrEqual(pinned.left);
  });
});
