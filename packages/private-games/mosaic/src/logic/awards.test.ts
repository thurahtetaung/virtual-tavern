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
import { mosaicAwards } from './awards.ts';
import { mosaicBot } from './bot.ts';
import { mosaic } from './game.ts';
import { insights } from './insights.ts';
import { content } from './test-utils.ts';
import type { MosaicAction } from './types.ts';

const rule = (id: string) => mosaicAwards.rules.find((r) => r.id === id)!;
const players = { players: ['a', 'b', 'c'] };
const take = (by: string, props: Record<string, unknown>) =>
  recapEv('take', by, { count: 1, penalty: 0, dumped: 0, marker: false, ...props });
const tiling = (by: string, props: Record<string, unknown>) =>
  recapEv('tiling', by, { round: 1, placed: 1, points: 1, penalty: 0, best: 1, ...props });

describe('awards', () => {
  it('hate-drafter: most tiles thrown away on purpose, at least 3', () => {
    const g = fixtureGame(
      [
        take('a', { dumped: 2 }),
        take('a', { dumped: 2 }),
        take('b', { dumped: 3, auto: true }),
        take('c', { dumped: 1 }),
      ],
      players,
    );
    expect(rule('mo.hate-drafter').compute!(g)[0]).toMatchObject({ players: ['a'], value: 4 });
    expect(
      rule('mo.hate-drafter').compute!(fixtureGame([take('a', { dumped: 2 })], players)),
    ).toEqual([]);
  });

  it('biggest round, chain reaction and cleanest wall', () => {
    const g = fixtureGame(
      [
        tiling('a', { round: 1, points: 9, best: 7, perfect: true }),
        tiling('a', { round: 2, points: 3, perfect: true }),
        tiling('a', { round: 3, points: 3, perfect: true }),
        tiling('b', { round: 1, points: 5, perfect: false, penalty: -3 }),
      ],
      players,
    );
    expect(rule('mo.big-round').compute!(g)[0]).toMatchObject({ players: ['a'], value: 9 });
    expect(rule('mo.chain').compute!(g)[0]).toMatchObject({ players: ['a'], value: 7 });
    expect(rule('mo.clean-wall').compute!(g)[0]).toMatchObject({ players: ['a'], value: 3 });
    expect(
      rule('mo.big-round').compute!(fixtureGame([tiling('a', { points: 7 })], players)),
    ).toEqual([]);
  });

  it('floor eater and first dibs', () => {
    const g = fixtureGame(
      [
        take('a', { penalty: -8 }),
        take('b', { penalty: -4 }),
        take('c', { penalty: -14, auto: true }),
        ...Array.from({ length: 3 }, () => take('b', { marker: true })),
      ],
      players,
    );
    expect(rule('mo.floor-eater').compute!(g)[0]).toMatchObject({ players: ['a'], value: 8 });
    expect(rule('mo.first-dibs').compute!(g)[0]).toMatchObject({ players: ['b'], value: 3 });
    // Old events without the props give nothing.
    expect(
      rule('mo.floor-eater').compute!(fixtureGame([recapEv('take', 'a', {})], players)),
    ).toEqual([]);
  });

  it('history and nuggets', () => {
    const g = fixtureGame(
      [
        tiling('a', { round: 1, points: 4, penalty: -1, best: 6 }),
        tiling('b', { round: 1, points: 2 }),
        tiling('a', { round: 2, points: 0, penalty: -14 }),
        tiling('b', { round: 2, points: 0, penalty: -2 }),
        recapEv('outcome', null, { scores: [42, 30] }),
      ],
      players,
    );
    expect(mosaicAwards.history!(g)).toEqual([
      'Round 1: {p:a} gained most (+3)',
      'Round 2: nobody gained',
    ]);
    expect(mosaicAwards.nuggets.map((n) => n.compute([g]))).toEqual([
      { value: 42, text: 'Highest wall score: 42 points' },
      { value: 6, text: 'Best single tile: 6 points' },
      { value: 1, text: '1 full floor (−14 each)' },
    ]);
  });

  it('every rule reads a real game played by bots', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const rng = createRng(seed);
      const ids = ['a', 'b', 'c'];
      let now = 1_000;
      let state = mosaic.create(
        { now, rng, content },
        ids.map((id) => ({ id, name: id })),
      );
      const events: InsightEvent[] = [];
      const act = (by: string, action: MosaicAction) => {
        const next = mosaic.reduce(state, action, { by, isHost: by === 'a', now, rng, content });
        if (isGameError(next)) throw new Error(next.code);
        events.push(...insights(state, next, action, by));
        state = next;
      };
      act('a', { type: 'start' });
      for (let i = 0; i < 2000 && state.phase === 'playing'; i++) {
        now += 1000;
        const g = state.game!;
        if (g.stage === 'tiling') {
          for (const id of ids) if (state.game!.stage === 'tiling') act(id, { type: 'ready' });
          continue;
        }
        const by = g.current;
        const move = mosaicBot(mosaic.view(state, by), { me: by, now, rng, words: () => [] });
        act(by, move!);
      }
      expect(state.phase).toBe('over');
      const g = fixtureGame(
        events.map((e, i) => recapEventOf(e, i + 1)),
        { players: ids },
      );
      expect(g.of('outcome')).toHaveLength(1);
      expect(g.of('tiling').length).toBeGreaterThanOrEqual(3 * 4);
      expect(g.of('take').length).toBeGreaterThan(20);
      for (const r of mosaicAwards.rules)
        for (const c of r.compute!(g))
          for (const t of r.copy.cheeky) expect(renderCopy(t, c)).not.toMatch(/\{\w+\}/);
      expect(mosaicAwards.history!(g).length).toBe(state.game!.round);
    }
  });
});
