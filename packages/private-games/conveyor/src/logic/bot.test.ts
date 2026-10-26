import { type BotCtx, type PlayerId, playWithBots } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { PRESETS } from './cards.ts';
import { conveyorBot } from './bot.ts';
import { conveyor } from './game.ts';
import type { ConveyorAction, ConveyorView } from './types.ts';

const seats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));

const hostWith =
  (settings: Partial<ConveyorView['settings']>) =>
  (view: ConveyorView, _me: PlayerId): ConveyorAction | null => {
    if (view.phase !== 'lobby') return null;
    const want = Object.entries(settings).find(
      ([k, v]) => JSON.stringify(view.settings[k as keyof typeof settings]) !== JSON.stringify(v),
    );
    return want ? { type: 'update-settings', ...settings } : { type: 'start' };
  };

describe('bots', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8]) {
    for (const preset of PRESETS) {
      it(`plays a ${n}-player game to the end (${preset.id})`, () => {
        const legal = preset.types.every((t) =>
          t === 'spoon' || t === 'edamame' ? n >= 3 : t === 'menu' || t === 'order' ? n <= 6 : true,
        );
        const r = playWithBots(conveyor, seats(n), {
          seed: n * 31 + preset.id.length,
          host: hostWith({ menu: legal ? preset.id : 'random' }),
          maxSteps: 4000,
        });
        expect(r.refused).toEqual([]);
        expect(r.over).toBe(true);
        expect(conveyor.view(r.state, null).game!.results).toHaveLength(3);
      });
    }
  }

  it('plays 2-player draw piles, pass both ways and golf', () => {
    const r = playWithBots(conveyor, seats(2), {
      seed: 5,
      host: hostWith({ menu: 'two', drawPile: true, passBoth: true, golf: true }),
      maxSteps: 4000,
    });
    expect(r.refused).toEqual([]);
    expect(r.over).toBe(true);
  });

  it('takes the view as its first parameter', () => {
    const hook: (view: ConveyorView, ctx: BotCtx) => unknown = conveyorBot;
    expect(hook).toBeTypeOf('function');
  });
});
