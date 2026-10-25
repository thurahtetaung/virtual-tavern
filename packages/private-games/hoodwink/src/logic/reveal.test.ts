import { describe, expect, it } from 'vitest';
import { hoodwink, revealOrder, revealProgress } from './game.ts';
import { HOST, NOW, lieOf, round, startedGame, truthIndex, writeAll } from './test-utils.ts';
import { REVEAL_FLIP_MS, REVEAL_STEP_MS } from './types.ts';

const option = (index: number, voters: number, truth = false) => ({
  index,
  truth,
  voters: Array.from({ length: voters }, (_, i) => `v${i}`),
});

describe('the one-by-one reveal', () => {
  it('turns over the picked lies, least picked first, then the truth last', () => {
    const order = revealOrder([
      option(0, 2),
      option(1, 0, true),
      option(2, 1),
      option(3, 0),
      option(4, 1),
    ]);
    // Ties keep board order; nobody picked lie 3, so it waits for the full board.
    expect(order).toEqual([2, 4, 0, 1]);
    expect(revealOrder([option(0, 0), option(1, 3, true)])).toEqual([1]);
  });

  it('steps through the order on the clock, flipping each answer partway', () => {
    expect(revealProgress(3, 0)).toEqual({ step: 0, flipped: false, done: false });
    expect(revealProgress(3, REVEAL_FLIP_MS)).toEqual({ step: 0, flipped: true, done: false });
    expect(revealProgress(3, REVEAL_STEP_MS + 10)).toEqual({
      step: 1,
      flipped: false,
      done: false,
    });
    expect(revealProgress(3, 3 * REVEAL_STEP_MS)).toEqual({ step: 3, flipped: true, done: true });
    // A phone whose clock runs early still starts at the first answer.
    expect(revealProgress(3, -500).step).toBe(0);
  });

  it('starts when the last vote is in, the same moment for every viewer', () => {
    const h = startedGame();
    writeAll(h);
    expect(hoodwink.view(h.state, 'p2').round!.revealAt).toBeNull();
    h.act({ type: 'vote', option: lieOf(h, 'p2') }, HOST, NOW + 5);
    h.act({ type: 'vote', option: truthIndex(h) }, 'p2', NOW + 6);
    h.act({ type: 'vote', option: lieOf(h, 'p2') }, 'p3', NOW + 7);
    h.act({ type: 'vote', option: truthIndex(h) }, 'p4', NOW + 9);
    expect(round(h).stage).toBe('reveal');
    for (const viewer of [HOST, 'p2', 'p3', null]) {
      expect(hoodwink.view(h.state, viewer).round!.revealAt).toBe(NOW + 9);
    }
    // Points are scored at once: the reveal only paces how they are shown.
    expect(round(h).points.p2).toBe(1000 + 1000);
  });

  it('lets only the host skip it, for everyone, and only at the reveal', () => {
    const h = startedGame();
    writeAll(h);
    expect(h.reject({ type: 'skip-reveal' }).code).toBe('wrong-stage');
    for (const id of round(h).voters) h.act({ type: 'vote', option: truthIndex(h) }, id);
    expect(h.reject({ type: 'skip-reveal' }, 'p2').code).toBe('not-host');
    const points = round(h).points;
    h.act({ type: 'skip-reveal' });
    for (const viewer of [HOST, 'p2', null]) {
      expect(hoodwink.view(h.state, viewer).round!.revealAt).toBeNull();
    }
    expect(round(h).points).toEqual(points);
    // The next round turns its answers over again.
    h.act({ type: 'next-round' });
    expect(round(h).revealSkipped).toBeUndefined();
  });
});
