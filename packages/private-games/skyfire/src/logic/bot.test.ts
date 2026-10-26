import { type BotCtx, type PlayerId, createRng, playWithBots } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { skyfireBot } from './bot.ts';
import { skyfire } from './game.ts';
import { playing } from './test-utils.ts';
import type { SkyfireAction, SkyfireView } from './types.ts';

const seats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));

const host =
  (settings: Partial<SkyfireView['settings']> = {}) =>
  (view: SkyfireView, _me: PlayerId): SkyfireAction | null => {
    if (view.phase !== 'lobby') return null;
    const same = Object.entries(settings).every(
      ([k, v]) => view.settings[k as keyof SkyfireView['settings']] === v,
    );
    return same ? { type: 'start' } : { type: 'update-settings', ...settings };
  };

const ctx = (me: string): BotCtx => ({ me, now: 0, rng: createRng(1), words: () => [] });

describe('bots', () => {
  for (const n of [2, 3, 4, 5]) {
    for (const seed of [1, 2, 3, 4]) {
      it(`play a ${n}-player show to the end (seed ${seed})`, () => {
        const r = playWithBots(skyfire, seats(n), { seed, host: host(), maxSteps: 3000 });
        expect(r.refused).toEqual([]);
        expect(r.over).toBe(true);
      });
    }
  }

  it.each([
    ['wild multicolour and black powder', { multi: 'wild', black: true }],
    ['the expert ending, from memory', { expert: true, memory: 'memory' }],
    [
      'one of each, full help, no empty clues',
      { multi: 'one-each', memory: 'full', zeroClues: false },
    ],
  ] as const)('play %s to the end', (_name, settings) => {
    for (const seed of [1, 2, 3]) {
      const r = playWithBots(skyfire, seats(3), { seed, host: host(settings), maxSteps: 3000 });
      expect(r.refused).toEqual([]);
      expect(r.over).toBe(true);
    }
  });

  it('score well enough to be good company', () => {
    let total = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const r = playWithBots(skyfire, seats(3), { seed, host: host(), maxSteps: 3000 });
      total += r.state.game!.result!.score;
    }
    expect(total / 8).toBeGreaterThan(14);
  });

  it('play a card they know is playable', () => {
    const h = playing(3, { p1: 'b3 r1', p2: 'g4' }, { deck: 'y1' });
    h.rig((s) => {
      s.game!.know['hp1-1']!.ranks.push(1);
      s.game!.know['hp1-1']!.colours.push('red');
    });
    expect(skyfireBot(skyfire.view(h.state, 'p1'), ctx('p1'))).toEqual({
      type: 'play',
      card: 'hp1-1',
    });
  });

  it('clue a teammate so a playable card becomes certain', () => {
    const h = playing(3, { p1: 'b3', p2: 'g4 r1 g2', p3: 'w4' }, { fireworks: { red: 0 } });
    // Every firework is empty: "1" tells p2 their r1 is playable.
    expect(skyfireBot(skyfire.view(h.state, 'p1'), ctx('p1'))).toEqual({
      type: 'clue',
      to: 'p2',
      rank: 1,
    });
  });

  it('discard the oldest unclued card when there is nothing better', () => {
    const h = playing(3, { p1: 'b3 r4 g4', p2: 'w4', p3: 'y4' }, { clues: 0, deck: 'y1' });
    expect(skyfireBot(skyfire.view(h.state, 'p1'), ctx('p1'))).toEqual({
      type: 'discard',
      card: 'hp1-2',
    });
  });

  it('takes the view as its first parameter', () => {
    const hook: (view: SkyfireView, ctx: BotCtx) => unknown = skyfireBot;
    expect(hook).toBeTypeOf('function');
  });
});
