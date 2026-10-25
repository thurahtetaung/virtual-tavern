import { type BotCtx, type PlayerId, createRng, playWithBots } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { goingOnceBot, scribble } from './bot.ts';
import { goingOnce } from './definition.ts';
import { packContent } from './test-utils.ts';
import type { GoingOnceAction, GoingOnceView } from './types.ts';
import { validateDrawing } from '@vt/game-sdk';

const seats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));

const host = (view: GoingOnceView, _me: PlayerId): GoingOnceAction | null =>
  view.phase === 'lobby' ? { type: 'start' } : null;

describe('bots', () => {
  for (const n of [3, 4, 5, 6]) {
    for (const seed of [1, 2, 3]) {
      it(`play a ${n}-player game to the end (seed ${seed})`, () => {
        const r = playWithBots(goingOnce, seats(n), {
          seed,
          host,
          content: packContent(),
          stepMs: 300,
          maxSteps: 6000,
        });
        expect(r.over).toBe(true);
        // Only bids beaten to the price on screen may be refused.
        for (const x of r.refused) expect(['too-late', 'too-fast', 'leading']).toContain(x.code);
        const g = r.state.game!;
        expect(Object.values(g.items).some((i) => i.sale?.buyer)).toBe(true);
      });
    }
  }

  it('draw scribbles that pass the checks', () => {
    for (let seed = 1; seed <= 20; seed++)
      expect(validateDrawing(scribble(createRng(seed))).ok).toBe(true);
  });

  it('takes the view as its first parameter', () => {
    const hook: (view: GoingOnceView, ctx: BotCtx) => unknown = goingOnceBot;
    expect(hook).toBeTypeOf('function');
  });
});
