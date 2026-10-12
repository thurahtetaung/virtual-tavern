import { type BotCtx, playWithBots } from '@vt/game-sdk';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { hoodwink } from './game.ts';
import { content, deck, lureDeck } from './test-utils.ts';
import type { HoodwinkAction, HoodwinkView } from './types.ts';

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));

const host = (v: HoodwinkView): HoodwinkAction | null =>
  v.phase === 'lobby'
    ? { type: 'start' }
    : v.round?.stage === 'reveal'
      ? { type: 'next-round' }
      : null;

describe('Hoodwink bots', () => {
  it('see only their own seat’s view', () => {
    expectTypeOf<Parameters<NonNullable<typeof hoodwink.bot>>>().toEqualTypeOf<
      [HoodwinkView, BotCtx]
    >();
  });

  it('write canned lies and vote, never for their own, through whole games', () => {
    for (let n = 3; n <= 8; n++) {
      for (const seed of [1, 2, 3]) {
        const r = playWithBots(hoodwink, seats(n), {
          seed,
          host,
          content: content([deck('odd', 20)]),
          maxSteps: 3000,
        });
        // Two canned lies can collide with each other; never with the answer.
        expect(r.refused.length).toBeLessThanOrEqual(2);
        expect(r.over).toBe(true);
      }
    }
  });

  it('use "Lie for me" when the question has built-in fakes', () => {
    const r = playWithBots(hoodwink, seats(4), {
      seed: 5,
      // Five questions in the deck, so five rounds.
      host: (v) =>
        v.phase === 'lobby' && v.settings.rounds !== 5
          ? { type: 'update-settings', rounds: 5 }
          : host(v),
      content: content([lureDeck(['Copper kettle', 'Paper fan', 'Tin whistle', 'Glass bell'])]),
      maxSteps: 3000,
    });
    expect(r.refused).toEqual([]);
    expect(r.over).toBe(true);
  });
});
