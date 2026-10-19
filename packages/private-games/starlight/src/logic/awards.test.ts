import {
  type AwardRule,
  type GameEvents,
  type InsightEvent,
  type RecapEvent,
  fixtureGame,
  recapEv,
  recapEventOf,
} from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { starlightAwards } from './awards.ts';
import { insights } from './insights.ts';
import { FOUR, fromFirst, round, startedGame } from './test-utils.ts';
import type { StarlightAction, StarlightState } from './types.ts';

const rule = (id: string): AwardRule => {
  const r = starlightAwards.rules.find((x) => x.id === `starlight.${id}`);
  if (!r) throw new Error(`no rule ${id}`);
  return r;
};
const run = (id: string, g: GameEvents) => rule(id).compute!(g);
const P = ['ana', 'ben', 'cy', 'dee'];
const game = (events: RecapEvent[]) => fixtureGame(events, { players: P });

const show = (scout: string, kind: string, markers: string[] = [scout], round = 1) =>
  recapEv('show', scout, { round, kind, markers, others: markers.length - 1 });
const roundEv = (id: string, props: Record<string, unknown>) =>
  recapEv('round', id, { round: 1, ...props });

describe('starlight awards', () => {
  it('pairs the players who share the most Super-Sparks', () => {
    const g = game([
      show('ana', 'super', ['ana', 'ben']),
      show('ben', 'super', ['ben', 'ana']),
      show('cy', 'super', ['cy', 'dee']),
    ]);
    expect(run('kindred', g)).toMatchObject([{ players: ['ana', 'ben'], value: 2 }]);
    expect(run('kindred', game([show('ana', 'super', ['ana', 'ben'])]))).toEqual([]);
  });

  it('counts Super-Sparks for both players, Sparks for the Scout and falls', () => {
    const g = game([
      show('ana', 'super', ['ana', 'ben']),
      show('cy', 'super', ['cy', 'ben']),
      show('ana', 'spark', ['ana', 'ben', 'cy']),
      show('ana', 'spark', ['ana', 'ben', 'cy']),
      show('ana', 'spark', ['ana', 'cy', 'dee']),
      show('dee', 'fall'),
      show('dee', 'fall'),
      show('cy', 'fall'),
    ]);
    expect(run('super-spark', g)).toMatchObject([{ players: ['ben'], value: 2 }]);
    expect(run('spark-plug', g)).toMatchObject([{ players: ['ana'], value: 3 }]);
    expect(run('lone-star', g)).toMatchObject([{ players: ['dee'], value: 2 }]);
    expect(run('lone-star', game([show('dee', 'fall')]))).toEqual([]);
  });

  it('praises a clean Dark round and names a lost one', () => {
    const g = game([
      roundEv('ana', { dark: true, fell: false, points: 11 }),
      roundEv('ben', { dark: true, fell: true, points: 3, round: 2 }),
      roundEv('cy', { dark: false, fell: true, points: 4 }),
    ]);
    expect(run('lantern', g)).toMatchObject([{ players: ['ana'], value: 11 }]);
    expect(run('lost-in-dark', g)).toMatchObject([{ players: ['ben'], params: { r: 'II' } }]);
    expect(run('lantern', game([roundEv('ana', { dark: false, fell: false, points: 9 })]))).toEqual(
      [],
    );
  });

  it('finds a big round and a one-card player', () => {
    const g = game([
      roundEv('ana', { points: 12, marks: 6 }),
      roundEv('ben', { points: 3, marks: 1 }),
      roundEv('ben', { points: 2, marks: 1, round: 2 }),
    ]);
    expect(run('big-round', g)).toMatchObject([{ players: ['ana'], value: 12 }]);
    expect(run('minimalist', g)).toMatchObject([{ players: ['ben'], value: 5 }]);
    expect(run('big-round', game([roundEv('ana', { points: 5 })]))).toEqual([]);
  });

  it('reads old events without the props as no candidate', () => {
    const g = game([recapEv('show', 'ana', {}), recapEv('round', 'ben', {})]);
    for (const r of starlightAwards.rules) expect(r.compute!(g), r.id).toEqual([]);
  });
});

describe('insights feed the awards', () => {
  it('plays a real game and reads it back', () => {
    const h = startedGame(FOUR, 4);
    const events: InsightEvent[] = [];
    const act = (action: StarlightAction, by: string) => {
      const before: StarlightState = h.state;
      h.act(action, by);
      events.push(...insights(before, h.state, action, by));
    };
    for (let no = 1; no <= 4; no++) {
      const [a, b, c, d] = fromFirst(h) as [string, string, string, string];
      const marks = { [a]: [0, 1], [b]: [0], [c]: [1], [d]: [0, 5] };
      for (const [id, positions] of Object.entries(marks)) act({ type: 'mark', positions }, id);
      for (const id of Object.keys(marks)) act({ type: 'lock' }, id);
      act({ type: 'show', pos: 0 }, a); // B and D marked it too: a Spark.
      while (round(h).stage === 'reveal') {
        const s = round(h).scout!;
        const pos = round(h).marks[s]!.find((p) => !round(h).shown.some((x) => x.pos === p))!;
        act({ type: 'show', pos }, s);
      }
      act({ type: 'next-round' }, 'host');
    }
    expect(h.state.phase).toBe('over');
    expect(events.filter((e) => e.type === 'word')).toHaveLength(4);
    expect(events.filter((e) => e.type === 'round')).toHaveLength(16);
    expect(events.filter((e) => e.type === 'outcome')).toHaveLength(1);
    expect(events.find((e) => e.type === 'word')!.words).toMatchObject([{ kind: 'clue' }]);
    const g = fixtureGame(
      events.map((e, i) => recapEventOf(e, i)),
      { players: FOUR, winners: h.state.winners },
    );
    // Every round: a Spark on the first card, a Super-Spark between the First Scout and the third
    // player, and the fourth player's lone card falls.
    const nugget = (id: string) =>
      starlightAwards.nuggets.find((n) => n.id === `starlight.${id}`)!.compute([g]);
    expect(nugget('supers')).toMatchObject({ value: 4 });
    expect(nugget('falls')).toMatchObject({ value: 4 });
    expect(starlightAwards.history!(g)).toHaveLength(4);
    expect(
      starlightAwards.nuggets.find((n) => n.id === 'starlight.sparks')!.compute([g]),
    ).toMatchObject({ value: 4 });
  });
});
