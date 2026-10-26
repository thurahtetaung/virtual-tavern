import { type BotCtx, type PlayerId, playWithBots } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { missionControlBot } from './bot.ts';
import { missionControl } from './definition.ts';
import { packContent } from './test-utils.ts';
import type { MissionControlAction, MissionControlView } from './types.ts';

const seats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));

/** The human host: picks a mission and starts. */
const hostOf =
  (mission: number) =>
  (view: MissionControlView, _me: PlayerId): MissionControlAction | null => {
    if (view.phase !== 'lobby') return null;
    return view.chosen === mission ? { type: 'start' } : { type: 'choose', mission };
  };

/** The human host on the one-card voyage. */
const cardHost =
  (mission: number) =>
  (view: MissionControlView, _me: PlayerId): MissionControlAction | null => {
    if (view.phase !== 'lobby') return null;
    if (view.settings.voyageKey !== 'test-cards')
      return { type: 'update-settings', voyageKey: 'test-cards' };
    return view.chosen === mission ? { type: 'start' } : { type: 'choose', mission };
  };

describe('bots on the one-card voyage', () => {
  for (const n of [2, 3, 4, 5]) {
    for (let mission = 1; mission <= 21; mission++) {
      it(`play mission ${mission} with ${n} to the end`, () => {
        const r = playWithBots(missionControl, seats(n), {
          seed: n * 1000 + mission,
          host: cardHost(mission),
          content: packContent(),
          maxSteps: 3000,
        });
        expect(r.refused).toEqual([]);
        expect(r.over).toBe(true);
      });
    }
  }
});

describe('bots', () => {
  for (const n of [2, 3, 4, 5]) {
    for (const mission of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0]) {
      it(`play mission ${mission} with ${n} to the end`, () => {
        const r = playWithBots(missionControl, seats(n), {
          seed: n * 100 + mission,
          host: hostOf(mission),
          content: packContent(),
          maxSteps: 3000,
        });
        expect(r.refused).toEqual([]);
        expect(r.over).toBe(true);
      });
    }
  }

  it('takes the view as its first parameter', () => {
    const hook: (view: MissionControlView, ctx: BotCtx) => unknown = missionControlBot;
    expect(hook).toBeTypeOf('function');
  });
});
