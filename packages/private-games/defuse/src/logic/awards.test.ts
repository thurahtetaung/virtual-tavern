import { createRng, fixtureGame, recapEv, recapEventOf } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { candidatesOf, defuseAwards } from './awards.ts';
import { setBotMistakes } from './bot.ts';
import { LIGHTS } from './bomb.ts';
import { defuse } from './game.ts';
import { insights } from './insights.ts';
import { ANA, BEN, must, send, table, wait } from './test-utils.ts';

const players = { players: ['a', 'b'] };
const outcome = (props: Record<string, unknown>) =>
  recapEv('outcome', 'a', {
    defused: true,
    how: 'defused',
    strikes: 0,
    modules: 3,
    solved: 3,
    bomb: 1,
    ...props,
  });

describe('awards', () => {
  it('clutch under a second, cool hand under ten', () => {
    expect(
      candidatesOf('df.clutch', fixtureGame([outcome({ left: 640 })], players))[0],
    ).toMatchObject({ players: ['a'] });
    expect(candidatesOf('df.clutch', fixtureGame([outcome({ left: 4000 })], players))).toEqual([]);
    expect(
      candidatesOf('df.cool-hand', fixtureGame([outcome({ left: 4000 })], players))[0],
    ).toMatchObject({ players: ['a'] });
  });

  it('a clean sweep is for the table; a wrong wire for the defuser', () => {
    expect(
      candidatesOf('df.clean', fixtureGame([outcome({ left: 90_000 })], players))[0]!.players,
    ).toEqual(['a', 'b']);
    const g = fixtureGame(
      [recapEv('strike', 'a', { kind: 'wires' }), outcome({ left: 1, strikes: 1 })],
      players,
    );
    expect(candidatesOf('df.wrong-wire', g)[0]).toMatchObject({ players: ['a'], value: 1 });
    expect(candidatesOf('df.clean', g)).toEqual([]);
  });

  it('a bomb that goes off has a history line', () => {
    const g = fixtureGame([outcome({ defused: false, how: 'time', left: 0 })], players);
    expect(defuseAwards.history!(g)).toEqual(['Bomb 1: it went off (the clock ran out)']);
    expect(candidatesOf('df.boom', g)[0]!.players).toEqual(['a']);
  });

  it('reads the insights of a real bomb', () => {
    setBotMistakes(0);
    const t = table([ANA, BEN], 5, { modules: 3 });
    must(t, ANA, { type: 'start' });
    must(t, BEN, { type: 'claim', page: 'wires', on: true });
    wait(t, LIGHTS.clock);
    const events = [];
    for (let i = 0; i < 400 && t.state.stage === 'bomb'; i++) {
      const before = t.state;
      const move = defuse.bot!(defuse.view(t.state, ANA), {
        me: ANA,
        now: t.now + 30_000,
        rng: createRng(i),
        words: () => [],
      });
      if (move && move.type !== 'ponder') send(t, ANA, move);
      events.push(...insights(before, t.state, null, ANA));
      wait(t, 500);
    }
    setBotMistakes(1 / 8);
    expect(t.state.stage).toBe('result');
    const g = fixtureGame(
      events.map((e) => recapEventOf(e)),
      { players: [ANA, BEN] },
    );
    expect(g.of('outcome')).toHaveLength(1);
    expect(g.of('module').length).toBe(3);
    expect(defuseAwards.history!(g)[0]).toMatch(/^Bomb 1: defused with \d:\d\d left$/);
  });
});
