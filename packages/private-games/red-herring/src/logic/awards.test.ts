import {
  type AwardRule,
  type GameEvents,
  type RecapEvent,
  fixtureGame,
  recapEv,
  recapEventOf,
} from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { redHerringAwards } from './awards.ts';
import { redHerring } from './game.ts';
import { insights } from './insights.ts';
import { SIX, playRound, round, startedGame } from './test-utils.ts';

const rule = (id: string): AwardRule => {
  const r = redHerringAwards.rules.find((x) => x.id === `red-herring.${id}`);
  if (!r) throw new Error(`no rule ${id}`);
  return r;
};
const run = (id: string, g: GameEvents) => rule(id).compute!(g);
const P = ['ana', 'ben', 'cy', 'dee', 'eve'];
const game = (events: RecapEvent[]) => fixtureGame(events, { players: P });

const roundEv = (no: number, picker: string, conspirator: string, against: number, extra = {}) =>
  recapEv('round', picker, {
    round: no,
    word: 'Fog',
    conspirator,
    against,
    caught: against >= 2,
    voters: 4,
    pickerPoints: against >= 2 ? 0 : 4,
    ...extra,
  });
const consp = (no: number, id: string, against: number) =>
  recapEv('conspirator', id, { round: no, against, caught: against >= 2 });
const vote = (no: number, voter: string, target: string, right: boolean, asC = false) =>
  recapEv('vote', voter, { round: no, target, right, asConspirator: asC });

describe('red herring awards', () => {
  it('a Conspirator nobody voted for blends in; repeat escapes are slippery', () => {
    const g = game([
      roundEv(1, 'ana', 'ben', 0),
      consp(1, 'ben', 0),
      roundEv(2, 'ben', 'ben', 1),
      consp(2, 'ben', 1),
      roundEv(3, 'cy', 'dee', 3),
      consp(3, 'dee', 3),
    ]);
    expect(run('blend-in', g)).toMatchObject([{ players: ['ben'], value: 1 }]);
    expect(run('escape', g)).toMatchObject([{ players: ['ben'], value: 2 }]);
    expect(run('blend-in', game([consp(1, 'dee', 1)]))).toEqual([]);
  });

  it('the sharpest Detective and the one who took the bait', () => {
    const g = game([
      roundEv(1, 'ana', 'ben', 2),
      vote(1, 'cy', 'ben', true),
      vote(1, 'dee', 'ben', true),
      vote(1, 'eve', 'cy', false),
      vote(1, 'ben', 'eve', false, true),
      roundEv(2, 'ben', 'ana', 2),
      vote(2, 'cy', 'ana', true),
      vote(2, 'eve', 'dee', false),
      roundEv(3, 'cy', 'ana', 0),
      vote(3, 'eve', 'dee', false),
      vote(3, 'ben', 'dee', false),
    ]);
    expect(run('sharp', g)).toMatchObject([{ players: ['cy'], value: 2 }]);
    expect(run('misled', g)).toMatchObject([{ players: ['eve'], value: 3 }]);
    expect(run('misled', game([vote(1, 'eve', 'dee', false)]))).toEqual([]);
    // The Conspirator's own vote is no mistake.
    expect(run('misled', game([vote(1, 'ben', 'eve', false, true)]))).toEqual([]);
    // Innocent players with the most votes.
    expect(run('suspect', g)).toMatchObject([{ players: ['dee'], value: 3 }]);
  });

  it('the word-picker whose words won the most, and the unanimous catch', () => {
    const g = game([
      roundEv(1, 'ana', 'ben', 0),
      roundEv(2, 'ana', 'cy', 1),
      roundEv(3, 'ben', 'dee', 4, { voters: 4 }),
      consp(3, 'dee', 3),
    ]);
    expect(run('wordsmith', g)).toMatchObject([{ players: ['ana'], value: 8 }]);
    expect(run('unanimous', g)).toMatchObject([{ players: ['dee'], value: 3 }]);
  });

  it('old events without the props give no candidates', () => {
    const g = game([
      recapEv('round', 'ana', {}),
      recapEv('vote', 'ben', {}),
      recapEv('conspirator', 'cy', {}),
    ]);
    for (const r of redHerringAwards.rules) expect(r.compute!(g)).toEqual([]);
    expect(redHerringAwards.history!(g)).toHaveLength(1);
  });

  it('a real game’s insights feed the awards', () => {
    const h = startedGame(SIX, 4);
    const events: RecapEvent[] = [];
    let before = h.state;
    const record = () => {
      for (const e of insights(before, h.state, null, null))
        events.push(recapEventOf(e, events.length + 1));
      before = h.state;
    };
    while (h.state.phase === 'playing') {
      // Everyone finds the Conspirator in odd rounds, nobody in even ones.
      const catchIt = round(h).no % 2 === 1;
      playRound(h, (voter) => {
        const r = round(h);
        const c = r.conspirator!;
        return catchIt && voter !== c
          ? c
          : r.order.slice(1).find((id) => id !== voter && id !== c)!;
      });
      record();
      h.act({ type: 'next-round' });
      record();
    }
    const g = fixtureGame(events, { players: SIX });
    expect(g.of('round')).toHaveLength(6);
    expect(g.of('outcome')).toHaveLength(1);
    expect(run('sharp', g).length).toBeGreaterThan(0);
    expect(redHerringAwards.history!(g)).toHaveLength(6);
    expect(redHerring.awards).toBe(redHerringAwards);
  });
});
