import { type InsightEvent, fixtureGame, recapEv, recapEventOf } from '@vt/game-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { missionControlAwards } from './awards.ts';
import { missionControl } from './definition.ts';
import { insights } from './insights.ts';
import { att, dive, draftAll, harness, rig, toDraft } from './test-utils.ts';
import type { MissionControlAction } from './types.ts';

afterEach(() => rig(null));

const rule = (id: string) => missionControlAwards.rules.find((r) => r.id === id)!;
const players = { players: ['a', 'b', 'c'] };
const outcome = (props: Record<string, unknown>) => recapEv('outcome', null, props);

describe('awards', () => {
  it('the feeder: most task cards fed, at least 2', () => {
    const g = fixtureGame(
      [
        recapEv('feed', 'a', { to: 'b' }),
        recapEv('feed', 'a', { to: 'c' }),
        recapEv('feed', 'b', { to: 'a' }),
      ],
      players,
    );
    expect(rule('mc.feeder').compute!(g)[0]).toMatchObject({
      players: ['a'],
      value: 2,
      runnerUp: 1,
    });
    expect(rule('mc.feeder').compute!(fixtureGame([recapEv('feed', 'a')], players))).toEqual([]);
  });

  it('mind reader and beacon: a task met right after a teammate’s signal', () => {
    const g = fixtureGame(
      [
        recapEv('task', 'a', { signalBy: ['b'], fedBy: [] }),
        recapEv('task', 'c', { signalBy: [], fedBy: [] }),
      ],
      players,
    );
    expect(rule('mc.mind-reader').compute!(g)[0]).toMatchObject({ players: ['a'], value: 1 });
    expect(rule('mc.beacon').compute!(g)[0]).toMatchObject({ players: ['b'], value: 1 });
    // Old events without the props give nothing.
    expect(rule('mc.beacon').compute!(fixtureGame([recapEv('task', 'a')], players))).toEqual([]);
  });

  it('flawless, comeback and the sunk task', () => {
    const first = fixtureGame([outcome({ success: true, attempt: 1, mission: 7 })], {
      ...players,
      winners: ['a', 'b', 'c'],
    });
    expect(rule('mc.flawless').compute!(first)).toEqual([{ players: ['a', 'b', 'c'], value: 7 }]);
    expect(rule('mc.comeback').compute!(first)).toEqual([]);
    const late = fixtureGame([outcome({ success: true, attempt: 5, mission: 7 })], {
      ...players,
      winners: ['a', 'b'],
    });
    expect(rule('mc.comeback').compute!(late)).toEqual([{ players: ['a', 'b'], value: 5 }]);
    expect(rule('mc.flawless').compute!(late)).toEqual([]);
    const practice = fixtureGame([outcome({ success: true, attempt: 1, practice: true })], players);
    expect(rule('mc.flawless').compute!(practice)).toEqual([]);
    const sunk = fixtureGame([outcome({ success: false, failedBy: 'c', tricks: 4 })], players);
    expect(rule('mc.sunk').compute!(sunk)).toEqual([{ players: ['c'], value: 4 }]);
    const timed = fixtureGame(
      [outcome({ success: false, failedBy: 'c', timedOut: true })],
      players,
    );
    expect(rule('mc.sunk').compute!(timed)).toEqual([]);
  });

  it('a real attempt through the harness feeds the rules', () => {
    // p1 leads the pink 3 and wins it for their own task; p2 and p3 have no pink.
    rig({
      hands: [
        ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 't1', 't2', 't3', 't4', 'b1'],
        ['b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'g1', 'g2', 'g3', 'g4', 'g5'],
        ['g6', 'g7', 'g8', 'g9', 'y1', 'y2', 'y3', 'y4', 'y5', 'y6', 'y7', 'y8', 'y9'],
      ],
      tasks: ['1'],
    });
    const h = harness(3);
    const events: InsightEvent[] = [];
    const act = (by: string, a: MissionControlAction) => {
      const before = h.state;
      h.act(by, a);
      events.push(...insights(before, h.state, a, by));
    };
    toDraft(h);
    draftAll(h);
    dive(h);
    act('p2', { type: 'signal', card: 'b9', pos: 'top' });
    act('p1', { type: 'play', card: 'p3' });
    act('p2', { type: 'play', card: 'b2' });
    act('p3', { type: 'play', card: 'g6' });
    expect(att(h).result?.success).toBe(true);
    const g = fixtureGame(
      events.map((e, i) => recapEventOf(e, i + 1)),
      {
        players: ['p1', 'p2', 'p3'],
        winners: ['p1', 'p2', 'p3'],
      },
    );
    expect(g.of('task')).toHaveLength(1);
    expect(rule('mc.mind-reader').compute!(g)[0]).toMatchObject({ players: ['p1'] });
    expect(rule('mc.flawless').compute!(g)[0]).toMatchObject({ value: 1 });
    expect(missionControlAwards.history!(g)).toEqual(['Mission 1, try 1: made it']);
    expect(missionControl.awards).toBe(missionControlAwards);
  });
});
