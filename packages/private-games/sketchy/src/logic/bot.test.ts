import { type BotCtx, type PlayerId, createRng, playWithBots, validateDrawing } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { botLie, scribble, sketchyBot } from './bot.ts';
import { sketchy } from './definition.ts';
import { lower } from './content.ts';
import { PROMPTS, packContent, started } from './test-utils.ts';
import { view } from './view.ts';
import type { SketchyAction, SketchyView } from './types.ts';

const seats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));

/**
 * The human host's buttons: strict timers (so a step where every bot's title hit the real one
 * still moves on), start, and Next after each reveal.
 */
export const host = (view: SketchyView, _me: PlayerId): SketchyAction | null =>
  view.phase === 'lobby'
    ? view.settings.timerMode === 'soft'
      ? { type: 'update-settings', timerMode: 'strict' }
      : { type: 'start' }
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
        // A bot can only stumble on the real title it can't see; it then writes another.
        expect(r.refused.filter((x) => x.code !== 'is-the-truth')).toEqual([]);
        expect(r.state.game!.history).toHaveLength(n * (n >= 8 ? 1 : 2));
      });
    }
  }

  it('write fake titles from prompts this game hasn’t shown them', () => {
    const h = started(4);
    const bot = 'p2';
    const own = h.state.game!.sketches[bot]!.prompt.text;
    const content = packContent();
    const ctx: BotCtx = {
      me: bot,
      now: h.now,
      rng: createRng(3),
      words: () => [],
      contentPacks: (kind) => content.contentPacks!(kind),
    };
    const prompts = new Set(PROMPTS.map((p) => lower(p.prompt)));
    for (let i = 0; i < 30; i++) {
      const lie = botLie(view(h.state, bot), { ...ctx, rng: createRng(i) });
      expect(prompts.has(lie)).toBe(true);
      expect(lie).not.toBe(own);
    }
  });

  it('draw scribbles that pass the checks', () => {
    for (let seed = 1; seed <= 20; seed++)
      expect(validateDrawing(scribble(createRng(seed))).ok).toBe(true);
  });

  it('takes the view as its first parameter', () => {
    const hook: (view: SketchyView, ctx: BotCtx) => unknown = sketchyBot;
    expect(hook).toBeTypeOf('function');
  });
});
