import { type BotCtx, playWithBots } from '@vt/game-sdk';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { hostMove } from './bot.ts';
import { stampede } from './game.ts';
import { content, deck } from './test-utils.ts';
import type { StampedeView } from './types.ts';

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));

describe('Stampede bots', () => {
  it('see only their own seat’s view', () => {
    expectTypeOf<Parameters<NonNullable<typeof stampede.bot>>>().toEqualTypeOf<
      [StampedeView, BotCtx]
    >();
  });

  it('play whole games with generic answers, at every table size', () => {
    for (const n of [3, 4, 6, 10, 20]) {
      for (const seed of [1, 2, 3]) {
        const r = playWithBots(stampede, seats(n), {
          seed,
          host: hostMove,
          content: content([deck('odd', 30)]),
          maxSteps: 6000,
        });
        expect(r.refused).toEqual([]);
        expect(r.over, `${n} players, seed ${seed}`).toBe(true);
      }
    }
  });

  it('copy a deck’s common answers, so herds form', () => {
    const r = playWithBots(stampede, seats(5), {
      seed: 4,
      host: hostMove,
      content: content([deck('odd', 30)]),
      hints: () => ['Pancakes', 'Waffles'],
      maxSteps: 4000,
    });
    expect(r.refused).toEqual([]);
    expect(r.over).toBe(true);
    expect(r.state.history.filter((h) => h.herd === 'Pancakes').length).toBeGreaterThan(0);
  });

  it('pass the Pink Cow on when the holder picks (house rule)', () => {
    const r = playWithBots(stampede, seats(8), {
      seed: 9,
      host: (v) =>
        v.phase === 'lobby' && !v.settings.holderPicks
          ? { type: 'update-settings', holderPicks: true }
          : hostMove(v),
      content: content([deck('odd', 40)]),
      maxSteps: 8000,
    });
    expect(r.refused).toEqual([]);
    expect(r.over).toBe(true);
  });
});
