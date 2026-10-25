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
import { jewellerAwards } from './awards.ts';
import { jewellerBot } from './bot.ts';
import { jeweller } from './game.ts';
import { insights } from './insights.ts';
import { content } from './test-utils.ts';
import type { JewellerAction } from './types.ts';

const rule = (id: string) => jewellerAwards.rules.find((r) => r.id === id)!;
const players = { players: ['a', 'b', 'c'] };
const buy = (by: string, props: Record<string, unknown>) =>
  recapEv('buy', by, { level: 1, points: 0, paid: 3, gold: 0, free: false, ...props });
const outcome = (props: Record<string, unknown>) => recapEv('outcome', null, props);

describe('awards', () => {
  it('noble magnet: most nobles, at least 2', () => {
    const g = fixtureGame(
      [recapEv('noble', 'a'), recapEv('noble', 'a'), recapEv('noble', 'b')],
      players,
    );
    expect(rule('jw.noble-magnet').compute!(g)[0]).toMatchObject({
      players: ['a'],
      value: 2,
      runnerUp: 1,
    });
    expect(rule('jw.noble-magnet').compute!(fixtureGame([recapEv('noble', 'a')], players))).toEqual(
      [],
    );
  });

  it('travelling light: the winner bought fewer cards than anyone', () => {
    const won = outcome({ winners: ['b'], ranking: ['b', 'a', 'c'], cards: [9, 12, 11] });
    expect(rule('jw.lean-win').compute!(fixtureGame([won], players))).toEqual([
      { players: ['b'], value: 9 },
    ]);
    const tied = outcome({ winners: ['b'], ranking: ['b', 'a'], cards: [9, 9] });
    expect(rule('jw.lean-win').compute!(fixtureGame([tied], players))).toEqual([]);
    const shared = outcome({ winners: ['a', 'b'], ranking: ['a', 'b'], cards: [9, 9] });
    expect(rule('jw.lean-win').compute!(fixtureGame([shared], players))).toEqual([]);
    // Old events without the props give nothing.
    expect(rule('jw.lean-win').compute!(fixtureGame([outcome({})], players))).toEqual([]);
  });

  it('big spender, free lunch, gold hoarder and overflowing pockets', () => {
    const g = fixtureGame(
      [
        buy('a', { paid: 8 }),
        buy('b', { paid: 6 }),
        buy('c', { paid: 0, free: true }),
        buy('c', { paid: 0, free: true }),
        ...Array.from({ length: 3 }, () => recapEv('reserve', 'b', { gold: true })),
        recapEv('reserve', 'a', { auto: true }),
        recapEv('return', 'c', { count: 2 }),
        recapEv('return', 'c', { count: 1 }),
      ],
      players,
    );
    expect(rule('jw.big-buy').compute!(g)[0]).toMatchObject({ players: ['a'], value: 8 });
    expect(rule('jw.free-lunch').compute!(g)[0]).toMatchObject({ players: ['c'], value: 2 });
    expect(rule('jw.gold-hoarder').compute!(g)[0]).toMatchObject({ players: ['b'], value: 3 });
    expect(rule('jw.overflow').compute!(g)[0]).toMatchObject({ players: ['c'], value: 3 });
    expect(rule('jw.big-buy').compute!(fixtureGame([buy('a', { paid: 5 })], players))).toEqual([]);
  });

  it('history and nuggets', () => {
    const g = fixtureGame(
      [
        recapEv('noble', 'a'),
        recapEv('final', 'b', { points: 16 }),
        ...Array.from({ length: 10 }, () => buy('a', {})),
        outcome({ scores: [16, 12] }),
      ],
      players,
    );
    expect(jewellerAwards.history!(g)).toEqual([
      'A noble visited {p:a}',
      '{p:b} reached 16 points',
    ]);
    expect(jewellerAwards.nuggets.map((n) => n.compute([g]))).toEqual([
      { value: 16, text: 'Highest score: 16 points' },
      { value: 10, text: '10 cards bought' },
    ]);
  });

  it('every rule reads a real game played by bots', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const rng = createRng(seed);
      const ids = ['a', 'b', 'c'];
      let now = 1_000;
      let state = jeweller.create(
        { now, rng, content },
        ids.map((id) => ({ id, name: id })),
      );
      const events: InsightEvent[] = [];
      const act = (by: string, action: JewellerAction) => {
        const next = jeweller.reduce(state, action, { by, isHost: by === 'a', now, rng, content });
        if (isGameError(next)) throw new Error(next.code);
        events.push(...insights(state, next, action, by));
        state = next;
      };
      act('a', { type: 'start' });
      for (let i = 0; i < 2000 && state.phase === 'playing'; i++) {
        now += 1000;
        const by = state.game!.current;
        const move = jewellerBot(jeweller.view(state, by), { me: by, now, rng, words: () => [] });
        act(by, move!);
      }
      expect(state.phase).toBe('over');
      const g = fixtureGame(
        events.map((e, i) => recapEventOf(e, i + 1)),
        { players: ids },
      );
      expect(g.of('outcome')).toHaveLength(1);
      expect(g.of('buy').length).toBeGreaterThan(10);
      for (const r of jewellerAwards.rules)
        for (const c of r.compute!(g))
          for (const t of r.copy.cheeky) expect(renderCopy(t, c)).not.toMatch(/\{\w+\}/);
    }
  });
});
