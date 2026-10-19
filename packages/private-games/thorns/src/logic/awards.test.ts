import {
  type ContentProvider,
  type InsightEvent,
  createRng,
  fixtureGame,
  isGameError,
  recapEv,
  recapEventOf,
  renderCopy,
} from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { thornsAwards } from './awards.ts';
import { thornsBot } from './bot.ts';
import { thorns } from './game.ts';
import { insights } from './insights.ts';
import type { ThornsAction } from './types.ts';

const rule = (id: string) => thornsAwards.rules.find((r) => r.id === id)!;
const fail = (by: string, thornBy: string, bid = 2, extra = {}) =>
  recapEv('challenge', by, { success: false, bid, thornBy, own: by === thornBy, ...extra });
const win = (by: string, bid: number) => recapEv('challenge', by, { success: true, bid });
const players = { players: ['a', 'b', 'c'] };

describe('awards', () => {
  it('bluff of the night: the thorn that stopped most challenges', () => {
    const g = fixtureGame([fail('a', 'c'), fail('b', 'c'), fail('c', 'a')], players);
    expect(rule('th.bluff').compute!(g)).toEqual([
      expect.objectContaining({ players: ['c'], value: 2, params: { card: 'thorn' } }),
    ]);
    // Your own thorn is no bluff.
    expect(rule('th.bluff').compute!(fixtureGame([fail('a', 'a')], players))).toEqual([]);
  });

  it('boldest successful bid, at least 2', () => {
    const g = fixtureGame([win('a', 4), win('b', 3), win('a', 1)], players);
    expect(rule('th.bold-bid').compute!(g)[0]).toMatchObject({
      players: ['a'],
      value: 4,
      runnerUp: 3,
    });
    expect(rule('th.bold-bid').compute!(fixtureGame([win('a', 1)], players))).toEqual([]);
  });

  it('own goal, thorn magnet and the auctioneer', () => {
    const g = fixtureGame(
      [
        fail('a', 'a'),
        fail('b', 'c'),
        fail('b', 'a'),
        ...Array.from({ length: 3 }, () => recapEv('bid', 'c', { amount: 1 })),
      ],
      players,
    );
    expect(rule('th.own-goal').compute!(g)[0]).toMatchObject({ players: ['a'], value: 1 });
    expect(rule('th.thorn-magnet').compute!(g)[0]).toMatchObject({ players: ['b'], value: 2 });
    expect(rule('th.auctioneer').compute!(g)[0]).toMatchObject({ players: ['c'], value: 3 });
    // Old events without the props give nothing.
    expect(rule('th.own-goal').compute!(fixtureGame([recapEv('challenge', 'a')], players))).toEqual(
      [],
    );
  });

  it('last petal: a winner on one disc', () => {
    const out = recapEv('outcome', null, { winners: ['b'], ranking: ['b', 'a'], discs: [1, 0] });
    expect(rule('th.last-petal').compute!(fixtureGame([out], players))).toEqual([
      { players: ['b'], value: 1 },
    ]);
  });

  it('history and nuggets read the challenges', () => {
    const g = fixtureGame([win('a', 3), fail('b', 'c'), fail('c', 'c')], players);
    expect(thornsAwards.history!(g)).toEqual([
      '{p:a} turned over 3 and scored',
      '{p:b} bid 2 and hit {p:c}’s {card:thorn}',
      '{p:c} bid 2 and hit their own {card:thorn}',
    ]);
    const nuggets = thornsAwards.nuggets.map((n) => n.compute([g]));
    expect(nuggets).toEqual([
      { value: 3, text: 'Biggest challenge made: 3 discs' },
      { value: 2, text: '2 challenges stopped by a {card:thorn}' },
    ]);
  });

  it('every rule reads a real game played by bots', () => {
    const content: ContentProvider = { wordLists: () => [], words: () => [] };
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const rng = createRng(seed);
      const ids = ['a', 'b', 'c', 'd'];
      let now = 1_000;
      let state = thorns.create(
        { now, rng, content },
        ids.map((id) => ({ id, name: id })),
      );
      const events: InsightEvent[] = [];
      const act = (by: string, action: ThornsAction) => {
        const next = thorns.reduce(state, action, { by, isHost: by === 'a', now, rng, content });
        if (isGameError(next)) throw new Error(next.code);
        events.push(...insights(state, next, action, by));
        state = next;
      };
      act('a', { type: 'start' });
      for (let i = 0; i < 2000 && state.phase === 'playing'; i++) {
        now += 1000;
        const move = ids
          .map(
            (id) =>
              [
                id,
                thornsBot(thorns.view(state, id), { me: id, now, rng, words: () => [] }),
              ] as const,
          )
          .find(([, m]) => m);
        if (move) act(move[0], move[1]!);
        else {
          const before = state;
          now = Math.max(now, thorns.nextDeadline!(state)!);
          state = thorns.onDeadline!(state, now);
          events.push(...insights(before, state, null, null));
        }
      }
      expect(state.phase).toBe('over');
      const g = fixtureGame(
        events.map((e, i) => recapEventOf(e, i + 1)),
        { players: ids },
      );
      expect(g.of('outcome')).toHaveLength(1);
      expect(g.of('challenge').length).toBeGreaterThan(0);
      for (const r of thornsAwards.rules)
        for (const c of r.compute!(g))
          for (const t of r.copy.cheeky) expect(renderCopy(t, c)).not.toMatch(/\{\w+\}/);
    }
  });
});
