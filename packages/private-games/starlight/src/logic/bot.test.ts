import { type BotCtx, playWithBots } from '@vt/game-sdk';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { starlight } from './game.ts';
import { content } from './test-utils.ts';
import type { StarlightAction, StarlightView } from './types.ts';

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));

const host = (v: StarlightView): StarlightAction | null =>
  v.phase === 'lobby'
    ? { type: 'start' }
    : v.round?.stage === 'done' && v.phase === 'playing'
      ? { type: 'next-round' }
      : null;

describe('Starlight bots', () => {
  it('see only their own seat’s view', () => {
    expectTypeOf<Parameters<NonNullable<typeof starlight.bot>>>().toEqualTypeOf<
      [StarlightView, BotCtx]
    >();
  });

  it('choose, mark, lock and show through whole games with no refused move', () => {
    for (let n = 3; n <= 6; n++) {
      for (const seed of [1, 2, 3, 4]) {
        const r = playWithBots(starlight, seats(n), { seed, host, content, maxSteps: 5000 });
        expect(r.refused).toEqual([]);
        expect(r.over).toBe(true);
        expect(r.state.round?.no).toBe(4);
      }
    }
  });
});
