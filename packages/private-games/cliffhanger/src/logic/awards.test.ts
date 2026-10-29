import { type InsightEvent, fixtureGame, playWithBots, recapEv, recapEventOf } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { cliffhangerAwards } from './awards.ts';
import { hostMove } from './bot.ts';
import { cliffhanger } from './definition.ts';
import { insights } from './insights.ts';
import { content, ids } from './test-utils.ts';
import type { CliffhangerState } from './types.ts';

const rule = (id: string) => cliffhangerAwards.rules.find((r) => r.id === id)!;
const players = { players: ['a', 'b', 'c', 'd'] };

describe('Cliffhanger awards', () => {
  it('face-off champ, longest rally and the steal king', () => {
    const g = fixtureGame(
      [
        recapEv('faceoff', 'a', { round: 1, answers: 9 }),
        recapEv('faceoff', 'a', { round: 2, answers: 2 }),
        recapEv('faceoff', 'b', { round: 3, answers: 4 }),
        recapEv('got', 'c', { steal: true, ms: 9000 }),
        recapEv('got', 'c', { steal: true, ms: 12000 }),
        recapEv('got', 'a', { steal: false, ms: 2500 }),
      ],
      players,
    );
    expect(rule('cl.faceoff-king').compute!(g)[0]).toMatchObject({ players: ['a'], value: 2 });
    expect(rule('cl.longest-rally').compute!(g)).toEqual([{ players: [], value: 9 }]);
    expect(rule('cl.steal-king').compute!(g)[0]).toMatchObject({ players: ['c'], value: 2 });
    expect(rule('cl.quick-draw').compute!(g)[0]).toMatchObject({
      players: ['a'],
      params: { s: 2.5 },
    });
  });

  it('a comeback names the winning team', () => {
    const g = fixtureGame(
      [recapEv('outcome', null, { winners: ['a', 'c'], winner: 'a', comeback: true, behind: 3 })],
      players,
    );
    expect(rule('cl.comeback').compute!(g)).toEqual([
      { players: ['a', 'c'], value: 3, params: { team: 'Popcorn' } },
    ]);
  });

  it('a whole bot game reports through its insights', () => {
    const events: InsightEvent[] = [];
    let last: CliffhangerState | null = null;
    const result = playWithBots(
      cliffhanger,
      ids(6).map((id) => ({ id, name: id })),
      {
        seed: 11,
        content: content(),
        maxSteps: 4000,
        host: hostMove,
        onChange: (state) => {
          if (last) events.push(...insights(last, state, null, null));
          last = state;
        },
      },
    );
    expect(result.over).toBe(true);
    const g = fixtureGame(
      events.map((e, i) => recapEventOf(e, i + 1)),
      { players: ids(6) },
    );
    expect(g.of('faceoff').length).toBe(result.state.round!.number);
    expect(g.of('outcome')).toHaveLength(1);
    expect(g.of('got').length).toBeGreaterThan(0);
    expect(cliffhangerAwards.history!(g)[0]).toMatch(/^Round 1: \{p:p\d+\} won the face-off/);
    // Every genre the winners collected was reported once.
    const winner = result.state.winner!;
    const genres = g.of('genre').filter((e) => e.props?.team === winner);
    expect(genres.length).toBeGreaterThanOrEqual(8);
  });
});
