import { type BotCtx, type PlayerId, createRng, playWithBots } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { encoreBot, handValue } from './bot.ts';
import { encore } from './game.ts';
import { cards, playing } from './test-utils.ts';
import type { EncoreAction, EncoreView } from './types.ts';

const seats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));

const host = (view: EncoreView, _me: PlayerId): EncoreAction | null =>
  view.phase === 'lobby' ? { type: 'start' } : null;

const ctx = (me: string): BotCtx => ({ me, now: 0, rng: createRng(1), words: () => [] });

describe('bots', () => {
  for (const n of [2, 3, 4, 5]) {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      it(`plays a ${n}-player game to the end (seed ${seed})`, () => {
        const r = playWithBots(encore, seats(n), { seed, host, maxSteps: 6000 });
        expect(r.refused).toEqual([]);
        expect(r.over).toBe(true);
        expect(encore.view(r.state, null).game!.results).toHaveLength(n);
      });
    }
  }

  it('values longer groups', () => {
    expect(handValue(cards('4/1 4/2 4/3'))).toBeGreaterThan(handValue(cards('4/1 7/2 2/3')));
  });

  it('shows the cards that join two groups', () => {
    // 5-5 | 9 | 5: showing the 9 is weak; the bot shows the pair or better.
    const h = playing(3, { p1: '5/1 5/2 9/1 6/1 7/1' }, { table: '3/1', owner: 'p3' });
    const move = encoreBot(encore.view(h.state, 'p1'), ctx('p1'));
    expect(move?.type).toBe('show');
    if (move?.type === 'show') expect(move.to - move.from).toBeGreaterThanOrEqual(1);
  });

  it('flips a hand that reads better the other way', () => {
    const h = playing(3, {});
    h.rig((s) => {
      s.game!.stage = 'flip';
      // Upside down this is 5-5-5-5.
      s.game!.players.p1!.hand = cards('1/5 7/5 3/5 9/5');
      for (const id of ['p1', 'p2', 'p3']) s.game!.players[id]!.flip = null;
    });
    expect(encoreBot(encore.view(h.state, 'p1'), ctx('p1'))).toEqual({ type: 'flip', flip: true });
  });

  it('takes the view as its first parameter', () => {
    const hook: (view: EncoreView, ctx: BotCtx) => unknown = encoreBot;
    expect(hook).toBeTypeOf('function');
  });
});
