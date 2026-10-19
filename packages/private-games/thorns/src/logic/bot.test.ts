import { type BotCtx, type PlayerId, playWithBots } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { thornsBot } from './bot.ts';
import { thorns } from './game.ts';
import type { ThornsAction, ThornsView } from './types.ts';

const seats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));

const host = (view: ThornsView, _me: PlayerId): ThornsAction | null =>
  view.phase === 'lobby' ? { type: 'start' } : null;

describe('bots', () => {
  for (const n of [3, 4, 5, 6]) {
    for (const seed of [1, 2, 3, 4, 5]) {
      it(`plays a ${n}-player game to the end (seed ${seed})`, () => {
        const r = playWithBots(thorns, seats(n), { seed, host, maxSteps: 4000 });
        expect(r.refused).toEqual([]);
        expect(r.over).toBe(true);
      });
    }
  }

  it('takes the view as its first parameter', () => {
    const hook: (view: ThornsView, ctx: BotCtx) => unknown = thornsBot;
    expect(hook).toBeTypeOf('function');
  });
});
