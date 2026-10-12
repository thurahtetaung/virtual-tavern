import { type BotCtx, playWithBots } from '@vt/game-sdk';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { roundTable } from './game.ts';
import type { RoundTableAction, RoundTableView } from './types.ts';

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));
const host = (v: RoundTableView) => (v.phase === 'lobby' ? ({ type: 'start' } as const) : null);

describe('Round Table bots', () => {
  it('see only their own seat’s view', () => {
    expectTypeOf<Parameters<NonNullable<typeof roundTable.bot>>>().toEqualTypeOf<
      [RoundTableView, BotCtx]
    >();
  });

  it('handle the Lady of the Lake and Targeting too', () => {
    for (const seed of [1, 2, 3]) {
      const r = playWithBots(roundTable, seats(8), {
        seed,
        maxSteps: 3000,
        host: (v): RoundTableAction | null =>
          v.phase !== 'lobby'
            ? null
            : v.settings.lady && v.settings.targeting
              ? { type: 'start' }
              : { type: 'update-settings', lady: true, targeting: true },
      });
      expect(r.refused).toEqual([]);
      expect(r.over).toBe(true);
    }
  });

  for (let n = 5; n <= 10; n++) {
    it(`play a whole ${n}-player game with no refused move`, () => {
      for (const seed of [1, 2, 3]) {
        const r = playWithBots(roundTable, seats(n), { seed, host, maxSteps: 3000 });
        expect(r.refused).toEqual([]);
        expect(r.over).toBe(true);
        expect(r.deadlines).toBe(0);
      }
    });
  }
});
