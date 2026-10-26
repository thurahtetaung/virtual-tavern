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
import { sketchyAwards } from './awards.ts';
import { sketchyBot } from './bot.ts';
import { sketchy } from './definition.ts';
import { insights } from './insights.ts';
import { packContent } from './test-utils.ts';
import type { SketchyAction } from './types.ts';

const rule = (id: string) => sketchyAwards.rules.find((r) => r.id === id)!;
const players = { players: ['a', 'b', 'c', 'd'] };
const lie = (by: string, fooled: number, word = 'a lie') =>
  recapEv('lie', by, { fooled, authors: [by], words: [{ kind: 'guess', word }] });
const vote = (by: string, foundTruth: boolean) => recapEv('vote', by, { foundTruth });
const drawing = (by: string, found: number, voters = 3) =>
  recapEv('drawing', by, { found, voters });

describe('awards', () => {
  it('best liar and most fooled', () => {
    const g = fixtureGame(
      [lie('a', 2), lie('a', 1), lie('b', 1), vote('c', false), vote('c', false), vote('d', false)],
      players,
    );
    expect(rule('sketchy.best-liar').compute!(g)[0]).toMatchObject({ players: ['a'], value: 3 });
    expect(rule('sketchy.most-fooled').compute!(g)[0]).toMatchObject({ players: ['c'], value: 2 });
    expect(rule('sketchy.best-liar').compute!(fixtureGame([lie('a', 1)], players))).toEqual([]);
  });

  it('most liked and the artists’ favourite', () => {
    const like = (by: string, author: string, byArtist: boolean) =>
      recapEv('like', by, { authors: [author], byArtist });
    const g = fixtureGame(
      [like('a', 'b', true), like('c', 'b', false), like('d', 'c', true), like('a', 'b', true)],
      players,
    );
    expect(rule('sketchy.most-liked').compute!(g)[0]).toMatchObject({ players: ['b'], value: 3 });
    expect(rule('sketchy.artists-favourite').compute!(g)[0]).toMatchObject({
      players: ['b'],
      value: 2,
    });
    expect(
      rule('sketchy.most-liked').compute!(fixtureGame([recapEv('like', 'a')], players)),
    ).toEqual([]);
  });

  it('clear artist, total con, history and nuggets', () => {
    const g = fixtureGame(
      [drawing('a', 2), lie('b', 2, 'sneaky title'), drawing('c', 0, 3), drawing('d', 0, 3)],
      players,
    );
    expect(rule('sketchy.clear-artist').compute!(g)[0]).toMatchObject({ players: ['a'], value: 2 });
    expect(rule('sketchy.total-con').compute!(g)[0]).toMatchObject({
      players: ['b'],
      params: { w: 'sneaky title' },
    });
    expect(sketchyAwards.history!(g)).toEqual([
      '{p:a}’s drawing: 2 of 3 found the real title',
      '{p:c}’s drawing: 0 of 3 found the real title',
      '{p:d}’s drawing: 0 of 3 found the real title',
    ]);
    expect(sketchyAwards.nuggets[0]!.compute([g])).toEqual({
      value: 2,
      text: '2 drawings nobody could name',
    });
  });

  it('every rule reads a real game played by bots', () => {
    const content = packContent();
    for (const seed of [1, 2, 3, 4]) {
      const rng = createRng(seed);
      const ids = ['a', 'b', 'c', 'd'];
      let now = 1_000;
      let state = sketchy.create(
        { now, rng, content },
        ids.map((id) => ({ id, name: id })),
      );
      const events: InsightEvent[] = [];
      const act = (by: string, action: SketchyAction) => {
        const next = sketchy.reduce(state, action, { by, isHost: by === 'a', now, rng, content });
        if (isGameError(next)) return false;
        events.push(...insights(state, next, action, by));
        state = next;
        return true;
      };
      act('a', { type: 'update-settings', timerMode: 'strict' });
      act('a', { type: 'start' });
      for (let i = 0; i < 3000 && state.phase === 'playing'; i++) {
        now += 400;
        const moved = ids.some((id) => {
          const m = sketchyBot(sketchy.view(state, id), { me: id, now, rng, words: () => [] });
          return m ? act(id, m) : false;
        });
        if (!moved && state.game?.stage === 'reveal') act('a', { type: 'next' });
        else if (!moved) {
          const before = state;
          now = Math.max(now, sketchy.nextDeadline!(state)!);
          state = sketchy.onDeadline!(state, now);
          events.push(...insights(before, state, null, null));
        }
      }
      expect(state.phase).toBe('over');
      const g = fixtureGame(
        events.map((e, i) => recapEventOf(e, i + 1)),
        { players: ids },
      );
      expect(g.of('outcome')).toHaveLength(1);
      expect(g.of('drawing')).toHaveLength(8);
      expect(g.of('like').length).toBeGreaterThan(0);
      for (const r of sketchyAwards.rules)
        for (const c of r.compute!(g))
          for (const t of [...r.copy.cheeky, ...r.copy.wholesome])
            expect(renderCopy(t, c)).not.toMatch(/\{\w+\}/);
    }
  });
});
