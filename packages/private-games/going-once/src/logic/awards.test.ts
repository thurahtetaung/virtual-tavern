import {
  type InsightEvent,
  createRng,
  fixtureGame,
  isGameError,
  recapEv,
  recapEventOf,
  renderCopy,
} from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { goingOnceAwards } from './awards.ts';
import { goingOnceBot } from './bot.ts';
import { goingOnce } from './definition.ts';
import { insights } from './insights.ts';
import { packContent } from './test-utils.ts';
import type { GoingOnceAction } from './types.ts';

const rule = (id: string) => goingOnceAwards.rules.find((r) => r.id === id)!;
const sale = (by: string, price: number, value: number, extra = {}) =>
  recapEv('sale', by, { price, value, profit: value - price, ...extra });
const players = { players: ['a', 'b', 'c'] };

describe('awards', () => {
  it('best flip and overpaid: the biggest single profit and loss, $500 or more', () => {
    const g = fixtureGame(
      [sale('a', 600, 3600), sale('b', 2000, 900), sale('c', 400, 700)],
      players,
    );
    expect(rule('go.flip').compute!(g)).toEqual([
      expect.objectContaining({ players: ['a'], value: 3000, params: { amt: '$3,000' } }),
    ]);
    expect(rule('go.overpaid').compute!(g)).toEqual([
      expect.objectContaining({ players: ['b'], value: 1100, params: { amt: '$1,100' } }),
    ]);
    expect(rule('go.flip').compute!(fixtureGame([sale('a', 600, 800)], players))).toEqual([]);
  });

  it('loans, own art and forced buys', () => {
    const g = fixtureGame(
      [
        recapEv('loan', 'a', { loans: 1 }),
        recapEv('loan', 'a', { loans: 2 }),
        recapEv('loan', 'b', { loans: 1 }),
        sale('c', 500, 1000, { own: true }),
        sale('b', 500, 1000, { screwedBy: 'a' }),
      ],
      players,
    );
    expect(rule('go.loan-shark').compute!(g)[0]).toMatchObject({ players: ['a'], value: 2 });
    expect(rule('go.own-art').compute!(g)[0]).toMatchObject({ players: ['c'], value: 1 });
    expect(rule('go.screwed-in').compute!(g)[0]).toMatchObject({ players: ['b'], value: 1 });
    // Old events without the props give nothing.
    expect(rule('go.own-art').compute!(fixtureGame([recapEv('sale', 'a')], players))).toEqual([]);
  });

  it('history and nuggets read the sales', () => {
    const g = fixtureGame(
      [
        sale('a', 900, 3500),
        recapEv('unsold', null, { value: 1200 }),
        recapEv('unsold', null, { value: 800 }),
      ],
      players,
    );
    expect(goingOnceAwards.history!(g)).toEqual([
      '{p:a} paid $900 for a drawing worth $3,500',
      'A drawing worth $1,200 went unsold',
      'A drawing worth $800 went unsold',
    ]);
    expect(goingOnceAwards.nuggets.map((n) => n.compute([g]))).toEqual([
      { value: 900, text: 'Highest price paid for a drawing: $900' },
      { value: 2, text: '2 drawings went unsold' },
    ]);
  });

  it('every rule reads a real game played by bots', () => {
    const content = packContent();
    for (const seed of [1, 2, 3, 4]) {
      const rng = createRng(seed);
      const ids = ['a', 'b', 'c', 'd'];
      let now = 1_000;
      let state = goingOnce.create(
        { now, rng, content },
        ids.map((id) => ({ id, name: id })),
      );
      const events: InsightEvent[] = [];
      const act = (by: string, action: GoingOnceAction) => {
        const next = goingOnce.reduce(state, action, { by, isHost: by === 'a', now, rng, content });
        if (isGameError(next)) return false;
        events.push(...insights(state, next, action, by));
        state = next;
        return true;
      };
      act('a', { type: 'start' });
      for (let i = 0; i < 3000 && state.phase === 'playing'; i++) {
        now += 400;
        const moved = ids.some((id) => {
          const m = goingOnceBot(goingOnce.view(state, id), { me: id, now, rng, words: () => [] });
          return m ? act(id, m) : false;
        });
        if (!moved) {
          const before = state;
          now = Math.max(now, goingOnce.nextDeadline!(state)!);
          state = goingOnce.onDeadline!(state, now);
          events.push(...insights(before, state, null, null));
        }
      }
      expect(state.phase).toBe('over');
      const g = fixtureGame(
        events.map((e, i) => recapEventOf(e, i + 1)),
        { players: ids },
      );
      expect(g.of('outcome')).toHaveLength(1);
      expect(g.of('sale').length + g.of('unsold').length).toBe(state.game!.lots.length);
      expect(g.of('drawing')).toHaveLength(8);
      for (const r of goingOnceAwards.rules)
        for (const c of r.compute!(g))
          for (const t of [...r.copy.cheeky, ...r.copy.wholesome])
            expect(renderCopy(t, c)).not.toMatch(/\{\w+\}/);
    }
  });
});
