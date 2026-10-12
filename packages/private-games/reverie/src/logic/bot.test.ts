import { type BotCtx, playWithBots } from '@vt/game-sdk';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { reverie } from './game.ts';
import type { ReverieAction, ReverieView } from './types.ts';

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));

const host = (v: ReverieView): ReverieAction | null =>
  v.phase === 'lobby'
    ? { type: 'start' }
    : v.turn?.phase === 'reveal'
      ? { type: 'next-turn' }
      : null;

describe('Reverie bots', () => {
  it('see only their own seat’s view', () => {
    expectTypeOf<Parameters<NonNullable<typeof reverie.bot>>>().toEqualTypeOf<
      [ReverieView, BotCtx]
    >();
  });

  it('tell, give and vote through whole games with no refused move', () => {
    for (let n = 3; n <= 8; n++) {
      for (const seed of [1, 2, 3]) {
        const r = playWithBots(reverie, seats(n), { seed, host, maxSteps: 5000 });
        expect(r.refused).toEqual([]);
        expect(r.over).toBe(true);
      }
    }
  });
});
