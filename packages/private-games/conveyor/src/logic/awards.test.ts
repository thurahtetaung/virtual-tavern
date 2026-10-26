import { createRng, fixtureGame, isGameError, recapEv, recapEventOf } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { conveyorAwards } from './awards.ts';
import { conveyorBot } from './bot.ts';
import { conveyor } from './game.ts';
import { insights } from './insights.ts';
import { HOST, content, ids } from './test-utils.ts';
import type { ConveyorAction, ConveyorState } from './types.ts';

const rule = (id: string) => conveyorAwards.rules.find((r) => r.id === id)!;
const players = { players: ['a', 'b', 'c'] };

describe('awards', () => {
  it('wasabi sniper: the most tripled points, 9 or more', () => {
    const g = fixtureGame(
      [
        recapEv('wasabi', 'a', { points: 9 }),
        recapEv('wasabi', 'a', { points: 6 }),
        recapEv('wasabi', 'b', { points: 3 }),
      ],
      players,
    );
    expect(rule('cv.wasabi-sniper').compute!(g)[0]).toMatchObject({ players: ['a'], value: 15 });
    expect(
      rule('cv.wasabi-sniper').compute!(
        fixtureGame([recapEv('wasabi', 'a', { points: 6 })], players),
      ),
    ).toEqual([]);
  });

  it('dessert hoarder, roll royalty, feast', () => {
    const g = fixtureGame(
      [
        recapEv('desserts', 'a', { count: 5 }),
        recapEv('desserts', 'b', { count: 2 }),
        recapEv('round', 'b', { points: 30, rolls: 6 }),
        recapEv('round', 'b', { points: 12, rolls: 6 }),
        recapEv('round', 'c', { points: 20, rolls: 3 }),
      ],
      players,
    );
    expect(rule('cv.dessert-hoarder').compute!(g)[0]).toMatchObject({ players: ['a'], value: 5 });
    expect(rule('cv.roll-royalty').compute!(g)[0]).toMatchObject({ players: ['b'], value: 12 });
    expect(rule('cv.feast').compute!(g)[0]).toMatchObject({ players: ['b'], value: 30 });
    // Old events without the props give nothing.
    expect(rule('cv.feast').compute!(fixtureGame([recapEv('round', 'a')], players))).toEqual([]);
  });

  it('sticky fingers, soup spiller, long spoon, copycat', () => {
    const g = fixtureGame(
      [
        recapEv('steal', 'a', { from: 'b' }),
        recapEv('steal', 'a', { from: 'c' }),
        recapEv('miso', null, { players: ['b', 'c'] }),
        recapEv('miso', null, { players: ['b', 'a'] }),
        recapEv('spoon', 'c', { hit: true }),
        recapEv('spoon', 'c', { hit: true }),
        recapEv('spoon', 'a', { hit: true, auto: true }),
        recapEv('spoon', 'a', { hit: false }),
        recapEv('copy', 'b', { k: 'tea' }),
        recapEv('copy', 'b', { k: 'tea' }),
      ],
      players,
    );
    expect(rule('cv.sticky-fingers').compute!(g)[0]).toMatchObject({ players: ['a'], value: 2 });
    expect(rule('cv.miso-clash').compute!(g)[0]).toMatchObject({ players: ['b'], value: 2 });
    expect(rule('cv.spoon').compute!(g)[0]).toMatchObject({ players: ['c'], value: 2 });
    expect(rule('cv.copycat').compute!(g)[0]).toMatchObject({ players: ['b'], value: 2 });
  });

  it('history and nuggets', () => {
    const g = fixtureGame(
      [
        recapEv('round', 'a', { round: 1, points: 22 }),
        recapEv('round', 'b', { round: 1, points: 30 }),
        recapEv('round', 'a', { round: 2, points: 18 }),
        recapEv('wasabi', 'a', { points: 9 }),
        recapEv('wasabi', 'a', { points: 9 }),
        recapEv('wasabi', 'b', { points: 3 }),
        recapEv('outcome', null, { scores: [70, 50] }),
      ],
      players,
    );
    expect(conveyorAwards.history!(g)).toEqual([
      'Round 1: {p:b} served the best tray (30)',
      'Round 2: {p:a} served the best tray (18)',
    ]);
    const nugget = (id: string) => conveyorAwards.nuggets.find((n) => n.id === id)!.compute([g]);
    expect(nugget('cv.best-round')).toMatchObject({ value: 30 });
    expect(nugget('cv.top-score')).toMatchObject({ value: 70 });
    expect(nugget('cv.wasabi')).toMatchObject({ value: 3 });
  });

  it('a real bot game’s insights feed the awards', () => {
    const rng = createRng(3);
    let now = 1_000_000;
    let state: ConveyorState = conveyor.create(
      { now, rng, content },
      ids(4).map((id) => ({ id, name: id })),
    );
    const act = (by: string, a: ConveyorAction) => {
      const r = conveyor.reduce(state, a, { by, isHost: by === HOST, now, rng, content });
      if (isGameError(r)) return false;
      const events = insights(state, r, a, by);
      all.push(...events.map((e) => recapEventOf(e, now)));
      state = r;
      return true;
    };
    const all: ReturnType<typeof recapEventOf>[] = [];
    act(HOST, { type: 'update-settings', menu: 'cutthroat' });
    act(HOST, { type: 'start' });
    for (let i = 0; i < 3000 && state.phase === 'playing'; i++) {
      now += 1000;
      let moved = false;
      for (const id of state.game!.order) {
        const m = conveyorBot(conveyor.view(state, id), { me: id, now, rng, words: () => [] });
        if (m && act(id, m)) {
          moved = true;
          break;
        }
      }
      if (!moved) {
        now = Math.max(now, conveyor.nextDeadline!(state) ?? now);
        state = conveyor.onDeadline!(state, now);
      }
    }
    expect(state.phase).toBe('over');
    const g = fixtureGame(all, { players: ids(4) });
    expect(g.of('round')).toHaveLength(12);
    expect(g.of('outcome')).toHaveLength(1);
    for (const r of conveyorAwards.rules) expect(() => r.compute!(g)).not.toThrow();
    expect(conveyorAwards.history!(g)).toHaveLength(3);
  });
});
