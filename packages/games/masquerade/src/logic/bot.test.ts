import { type BotCtx, playWithBots } from '@vt/game-sdk';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { masquerade } from './index.ts';
import type { MasqueradeView } from './types.ts';

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));

/** The human host starts the game and deals each next round. */
const host = (v: MasqueradeView) =>
  v.phase === 'lobby'
    ? ({ type: 'start' } as const)
    : v.round?.stage === 'reveal'
      ? ({ type: 'next-round' } as const)
      : null;

describe('Masquerade bots', () => {
  it('see only their own seat’s view', () => {
    expectTypeOf<Parameters<NonNullable<typeof masquerade.bot>>>().toEqualTypeOf<
      [MasqueradeView, BotCtx]
    >();
  });

  it('play whole games at every table size with no refused move', () => {
    for (let n = 3; n <= 9; n++) {
      for (const seed of [1, 2, 3]) {
        const r = playWithBots(masquerade, seats(n), { seed, host, maxSteps: 4000 });
        expect(r.refused).toEqual([]);
        expect(r.over).toBe(true);
      }
    }
  });
});
