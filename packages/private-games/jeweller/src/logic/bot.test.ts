import { type BotCtx, type PlayerId, playWithBots } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { jewellerBot, styleOf } from './bot.ts';
import { jeweller } from './game.ts';
import type { JewellerAction, JewellerView } from './types.ts';

const seats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));

const host = (view: JewellerView, _me: PlayerId): JewellerAction | null =>
  view.phase === 'lobby' ? { type: 'start' } : null;

describe('bots', () => {
  for (const n of [2, 3, 4]) {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      it(`plays a ${n}-player game to the end (seed ${seed})`, () => {
        const r = playWithBots(jeweller, seats(n), { seed, host, maxSteps: 4000 });
        expect(r.refused).toEqual([]);
        expect(r.over).toBe(true);
        // Someone reached the target: the game ended on points, not by running out of moves.
        const v = jeweller.view(r.state, null);
        expect(Math.max(...v.game!.players.map((p) => p.points))).toBeGreaterThanOrEqual(15);
      });
    }
  }

  for (const [label, settings] of [
    ['Cities', { cities: true }],
    ['Strongholds', { strongholds: true }],
    ['Cities and Strongholds', { cities: true, strongholds: true }],
  ] as const) {
    for (const n of [2, 3, 4]) {
      for (const seed of [1, 2, 3, 4]) {
        it(`plays a ${n}-player game with ${label} to the end (seed ${seed})`, () => {
          const r = playWithBots(jeweller, seats(n), {
            seed,
            host: (view, me) =>
              view.phase === 'lobby' && !view.settings.strongholds && !view.settings.cities
                ? { type: 'update-settings', ...settings }
                : host(view, me),
            maxSteps: 6000,
          });
          expect(r.refused).toEqual([]);
          expect(r.over).toBe(true);
          const v = jeweller.view(r.state, null);
          const g = v.game!;
          // Ended by a City (or the target), not by running out of moves.
          expect(r.state.log.at(-1)).not.toMatchObject({ how: 'stalled' });
          if ('cities' in settings)
            for (const w of g.winners)
              expect(g.players.find((p) => p.id === w)!.cities.length).toBeGreaterThan(0);
          if ('strongholds' in settings)
            expect(r.state.log.some((e) => e.kind === 'hold' || e.kind === 'evict')).toBe(true);
        });
      }
    }
  }

  it('seats get different styles', () => {
    expect(new Set(seats(4).map((s) => styleOf(s.id))).size).toBeGreaterThan(1);
  });

  it('takes the view as its first parameter', () => {
    const hook: (view: JewellerView, ctx: BotCtx) => unknown = jewellerBot;
    expect(hook).toBeTypeOf('function');
  });
});
