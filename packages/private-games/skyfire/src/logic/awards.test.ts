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
import { candidatesOf, skyfireAwards } from './awards.ts';
import { skyfireBot } from './bot.ts';
import { skyfire } from './game.ts';
import { insights } from './insights.ts';
import { content, playing } from './test-utils.ts';
import type { SkyfireAction } from './types.ts';

const players = { players: ['a', 'b', 'c'] };
const play = (by: string, props: Record<string, unknown>) =>
  recapEv('play', by, { suit: 'red', rank: 1, ok: true, clued: true, ...props });

describe('awards', () => {
  it('perfect show: everyone, only for a win', () => {
    const win = fixtureGame([recapEv('outcome', null, { win: true, score: 25 })], players);
    expect(candidatesOf('sf.perfect', win)[0]).toMatchObject({
      players: ['a', 'b', 'c'],
      value: 25,
    });
    const lost = fixtureGame([recapEv('outcome', null, { win: false, score: 24 })], players);
    expect(candidatesOf('sf.perfect', lost)).toEqual([]);
  });

  it('telepath: one clue that led to two plays or more', () => {
    const g = fixtureGame(
      [
        play('b', { clueBy: 'a', clueTurn: 3 }),
        play('b', { clueBy: 'a', clueTurn: 3 }),
        play('c', { clueBy: 'b', clueTurn: 4 }),
        play('c', { clueBy: 'b', clueTurn: 6 }),
        play('c', { clueBy: 'b', clueTurn: 6, ok: false }),
      ],
      players,
    );
    expect(candidatesOf('sf.telepath', g)).toEqual([
      expect.objectContaining({ players: ['a'], value: 2 }),
    ]);
  });

  it('lucky guess, bomb squad, last-second hero and grand finale', () => {
    const g = fixtureGame(
      [
        play('a', { clued: false }),
        play('a', { clued: false, auto: true }),
        play('b', { ok: false }),
        play('b', { ok: false }),
        play('c', { lastRound: true }),
        play('c', { completed: true }),
        play('c', { completed: true }),
      ],
      players,
    );
    expect(candidatesOf('sf.lucky', g)[0]).toMatchObject({ players: ['a'], value: 1 });
    expect(candidatesOf('sf.boom', g)[0]).toMatchObject({ players: ['b'], value: 2 });
    expect(candidatesOf('sf.last-second', g)[0]).toMatchObject({ players: ['c'], value: 1 });
    expect(candidatesOf('sf.finisher', g)[0]).toMatchObject({ players: ['c'], value: 2 });
  });

  it('clue machine needs five clues', () => {
    const clues = (by: string, n: number) =>
      Array.from({ length: n }, () => recapEv('clue', by, {}));
    expect(candidatesOf('sf.clue-machine', fixtureGame(clues('a', 4), players))).toEqual([]);
    expect(candidatesOf('sf.clue-machine', fixtureGame(clues('a', 5), players))[0]).toMatchObject({
      players: ['a'],
    });
  });

  it('old events without the new props give nothing', () => {
    const g = fixtureGame([recapEv('play', 'a'), recapEv('outcome', null)], players);
    for (const r of skyfireAwards.rules) expect(r.compute!(g), r.id).toEqual([]);
  });

  it('history and nuggets', () => {
    const g = fixtureGame(
      [
        recapEv('outcome', null, { score: 21, reached: 21, how: 'deck' }),
        ...Array.from({ length: 10 }, () => play('a', {})),
        ...Array.from({ length: 10 }, () => recapEv('clue', 'b', {})),
      ],
      players,
    );
    expect(skyfireAwards.history!(g)).toEqual(['Fireworks reached 21: the deck ran out']);
    expect(skyfireAwards.nuggets.map((n) => n.compute([g]))).toEqual([
      { value: 21, text: 'Best show: 21 points' },
      { value: 10, text: '10 cards lit' },
      { value: 10, text: '10 clues given' },
    ]);
  });

  it('insights credit a play to the clue that touched it', () => {
    const h = playing(3, { p1: 'b3', p2: 'r1 g4' }, { deck: 'y1 y2' });
    h.act('p1', { type: 'clue', to: 'p2', rank: 1 });
    const before = h.state;
    h.act('p2', { type: 'play', card: 'hp2-0' });
    const [e] = insights(before, h.state, null, 'p2');
    expect(e).toMatchObject({
      type: 'play',
      playerId: 'p2',
      props: { ok: true, clued: true, clueBy: 'p1', clueTurn: 1, suit: 'red', rank: 1 },
    });
  });

  it('every rule reads a real game played by bots', () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const rng = createRng(seed);
      const ids = ['a', 'b', 'c', 'd'];
      let now = 1_000;
      let state = skyfire.create(
        { now, rng, content },
        ids.map((id) => ({ id, name: id })),
      );
      const events: InsightEvent[] = [];
      const act = (by: string, action: SkyfireAction) => {
        const next = skyfire.reduce(state, action, { by, isHost: by === 'a', now, rng, content });
        if (isGameError(next)) throw new Error(next.code);
        events.push(...insights(state, next, action, by));
        state = next;
      };
      act('a', { type: 'start' });
      for (let i = 0; i < 1000 && state.phase === 'playing'; i++) {
        now += 1000;
        const by = state.game!.current;
        const move = skyfireBot(skyfire.view(state, by), { me: by, now, rng, words: () => [] });
        act(by, move!);
      }
      expect(state.phase).toBe('over');
      const g = fixtureGame(
        events.map((e, i) => recapEventOf(e, i + 1)),
        { players: ids },
      );
      expect(g.of('outcome')).toHaveLength(1);
      expect(g.of('play').length).toBeGreaterThan(5);
      for (const r of skyfireAwards.rules)
        for (const c of r.compute!(g))
          for (const t of [...r.copy.cheeky, ...r.copy.wholesome])
            expect(renderCopy(t, c)).not.toMatch(/\{\w+\}/);
    }
  });
});
