import { type BotCtx, playWithBots } from '@vt/game-sdk';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { royalPost } from './game.ts';
import type { RoyalPostView } from './types.ts';

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));

/** The human host: picks the edition, starts, and deals each next round. */
const host = (edition: 'classic' | '2019') => (v: RoyalPostView) =>
  v.phase === 'lobby'
    ? v.settings.edition === edition
      ? ({ type: 'start' } as const)
      : ({ type: 'update-settings', edition } as const)
    : v.round?.stage === 'over'
      ? ({ type: 'next-round' } as const)
      : null;

describe('Royal Post bots', () => {
  it('see only their own seat’s view', () => {
    expectTypeOf<Parameters<NonNullable<typeof royalPost.bot>>>().toEqualTypeOf<
      [RoyalPostView, BotCtx]
    >();
  });

  for (const [edition, max] of [
    ['classic', 4],
    ['2019', 6],
  ] as const) {
    it(`play whole ${edition} games with no refused move`, () => {
      for (let n = 2; n <= max; n++) {
        for (const seed of [1, 2, 3]) {
          const r = playWithBots(royalPost, seats(n), {
            seed,
            host: host(edition),
            maxSteps: 4000,
          });
          expect(r.refused).toEqual([]);
          expect(r.over).toBe(true);
        }
      }
    });
  }

  it('wait for their own turn', () => {
    const r = playWithBots(royalPost, seats(3), { seed: 4, host: host('classic'), maxSteps: 10 });
    expect(r.refused).toEqual([]);
  });
});
