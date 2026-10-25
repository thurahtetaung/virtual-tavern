import { type BotCtx, type PlayerId, createRng, playWithBots, validateDrawing } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { scribble, sketchyBot } from './bot.ts';
import { sketchy } from './definition.ts';
import { packContent } from './test-utils.ts';
import type { SketchyAction, SketchyView } from './types.ts';

const seats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));

/** The human host's buttons: start, and Next after each reveal. */
export const host = (view: SketchyView, _me: PlayerId): SketchyAction | null =>
  view.phase === 'lobby'
    ? { type: 'start' }
    : view.game?.stage === 'reveal'
      ? { type: 'next' }
      : null;

describe('bots', () => {
  for (const n of [3, 4, 6, 8]) {
    for (const seed of [1, 2, 3]) {
      it(`play a ${n}-player game to the end (seed ${seed})`, () => {
        const r = playWithBots(sketchy, seats(n), {
          seed,
          host,
          content: packContent(),
          maxSteps: 4000,
        });
        expect(r.over).toBe(true);
        expect(r.refused).toEqual([]);
        expect(r.state.game!.history).toHaveLength(n * (n >= 8 ? 1 : 2));
      });
    }
  }

  it('draw scribbles that pass the checks', () => {
    for (let seed = 1; seed <= 20; seed++)
      expect(validateDrawing(scribble(createRng(seed))).ok).toBe(true);
  });

  it('takes the view as its first parameter', () => {
    const hook: (view: SketchyView, ctx: BotCtx) => unknown = sketchyBot;
    expect(hook).toBeTypeOf('function');
  });
});
