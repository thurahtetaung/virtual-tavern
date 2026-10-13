import { type BotCtx, type PlayerId, playWithBots } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { tavernBrawlBot } from './bot.ts';
import { tavernBrawl } from './game.ts';
import type { TavernBrawlAction, TavernBrawlView } from './types.ts';

const seats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));

const host = (view: TavernBrawlView, _me: PlayerId): TavernBrawlAction | null => {
  if (view.phase !== 'lobby') return null;
  const seated = view.seats.filter((s) => s.playing);
  return seated.length >= 2 && seated.every((s) => s.hero) ? { type: 'start' } : null;
};

describe('bots', () => {
  for (const n of [2, 3, 4]) {
    for (const seed of [1, 2, 3, 4, 5]) {
      it(`plays a ${n}-player game to the end (seed ${seed})`, () => {
        const r = playWithBots(tavernBrawl, seats(n), { seed, host, maxSteps: 4000 });
        expect(r.refused).toEqual([]);
        expect(r.over).toBe(true);
      });
    }
  }

  it('takes the view as its first parameter', () => {
    const hook: (view: TavernBrawlView, ctx: BotCtx) => unknown = tavernBrawlBot;
    expect(hook).toBeTypeOf('function');
  });
});
