import {
  type AwardRule,
  type InsightEvent,
  fixtureGame,
  recapEv,
  recapEventOf,
} from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { seanceAwards } from './awards.ts';
import { voteStage } from './game.ts';
import { insights } from './insights.ts';
import { HOST, type Harness, playHour, startedGame, toFinal } from './test-utils.ts';

const rule = (id: string): AwardRule => seanceAwards.rules.find((r) => r.id === id)!;
const PLAYERS = ['g', 'a', 'b', 'c'];

const guess = (who: string, correct: boolean, tries = 1, visions = 2, hour = 1) =>
  recapEv('guess', who, { correct, tries, visions, hour, pillar: 'suspect' });
const outcome = (props: Record<string, unknown>) => recapEv('outcome', null, props);

describe('Séance awards', () => {
  it('Mind Reader: most first-try finds, at least two', () => {
    const g = fixtureGame(
      [
        guess('a', true),
        guess('a', true),
        guess('b', true),
        guess('b', true, 2),
        guess('c', false),
      ],
      { players: PLAYERS },
    );
    expect(rule('seance.mind-reader').compute!(g)).toMatchObject([{ players: ['a'], value: 2 }]);
    const none = fixtureGame([guess('a', true), guess('b', true)], { players: PLAYERS });
    expect(rule('seance.mind-reader').compute!(none)).toEqual([]);
  });

  it('Mind Reader ties: up to three share it', () => {
    const g = fixtureGame(
      [guess('a', true), guess('a', true), guess('b', true), guess('b', true)],
      { players: PLAYERS },
    );
    expect(rule('seance.mind-reader').compute!(g)).toMatchObject([{ players: ['a', 'b'] }]);
  });

  it('Sixth Sense: most clairvoyance hits', () => {
    const hit = (who: string, h: boolean) => recapEv('clairvoyance', who, { hit: h, kind: 'yes' });
    const g = fixtureGame([hit('a', true), hit('a', true), hit('b', true), hit('b', false)], {
      players: PLAYERS,
    });
    expect(rule('seance.sixth-sense').compute!(g)).toMatchObject([{ players: ['a'], value: 2 }]);
  });

  it('Lost in the Mist: three or more misses', () => {
    const g = fixtureGame(
      [guess('a', false), guess('a', false), guess('a', false), guess('b', false)],
      {
        players: PLAYERS,
      },
    );
    expect(rule('seance.lost-in-the-mist').compute!(g)).toMatchObject([
      { players: ['a'], value: 3 },
    ]);
    const two = fixtureGame([guess('a', false), guess('a', false)], { players: PLAYERS });
    expect(rule('seance.lost-in-the-mist').compute!(two)).toEqual([]);
  });

  it('Spirit Guide: the ghost of a won game; nothing for a loss', () => {
    const win = fixtureGame([outcome({ win: true, ghost: 'g', hour: 4 })], { players: PLAYERS });
    expect(rule('seance.spirit-guide').compute!(win)).toEqual([{ players: ['g'], value: 4 }]);
    const loss = fixtureGame([outcome({ win: false, ghost: 'g', hour: 7 })], { players: PLAYERS });
    expect(rule('seance.spirit-guide').compute!(loss)).toEqual([]);
  });

  it('Raven Keeper, One Card Wonder, First Light and Photo Finish', () => {
    const g = fixtureGame(
      [
        recapEv('raven', 'g', { hour: 1 }),
        recapEv('raven', 'g', { hour: 2 }),
        guess('a', true, 1, 1),
        guess('b', true, 1, 1),
        recapEv('finish', 'a', { hour: 5 }),
        recapEv('finish', 'b', { hour: 7 }),
        outcome({ win: true, ghost: 'g', hour: 7 }),
      ],
      { players: PLAYERS },
    );
    expect(rule('seance.raven-keeper').compute!(g)).toEqual([{ players: ['g'], value: 2 }]);
    expect(rule('seance.one-card-wonder').compute!(g)).toEqual([{ players: ['g'], value: 2 }]);
    expect(rule('seance.first-to-finish').compute!(g)).toMatchObject([
      { players: ['a'], value: 5 },
    ]);
    expect(rule('seance.photo-finish').compute!(g)).toEqual([{ players: [], value: 7 }]);
  });

  it('old events without the newer props give no candidate', () => {
    const g = fixtureGame(
      [recapEv('guess', 'a', {}), recapEv('guess', 'a', {}), recapEv('outcome', null, {})],
      { players: PLAYERS },
    );
    for (const r of seanceAwards.rules) expect(r.compute?.(g) ?? []).toEqual([]);
  });

  it('a real game, through its own insights, feeds the awards, nuggets and history', () => {
    const h = startedGame(4);
    const events: InsightEvent[] = [];
    let before = h.state;
    const step = (fn: () => void) => {
      fn();
      events.push(...insights(before, h.state, null, null));
      before = h.state;
    };
    step(() => h.act({ type: 'raven', cards: [h.game().hand[0]!] }, HOST));
    step(() => playHour(h, ['ana']));
    step(() => h.act({ type: 'raven', cards: [h.game().hand[0]!] }, HOST));
    step(() => toFinal(h));
    step(() => h.act({ type: 'shared', group: 0, cards: h.game().hand.slice(0, 3) }, HOST));
    while (h.state.phase !== 'over') step(() => voteInTurn(h));
    const g = fixtureGame(
      events.map((e, i) => recapEventOf(e, i + 1)),
      { players: [HOST, 'ana', 'ben', 'cy'] },
    );
    expect(g.winners.sort()).toEqual([HOST, 'ana', 'ben', 'cy'].sort());
    expect(rule('seance.spirit-guide').compute!(g)).toMatchObject([{ players: [HOST] }]);
    expect(rule('seance.raven-keeper').compute!(g)).toMatchObject([{ players: [HOST], value: 2 }]);
    expect(rule('seance.first-to-finish').compute!(g)).toMatchObject([{ players: ['ana'] }]);
    expect(seanceAwards.history!(g)[0]).toBe('Hour 1: 1 of 3 found their card');
    expect(seanceAwards.history!(g).at(-1)).toBe('The vote found the culprit');
    const solved = seanceAwards.nuggets.find((n) => n.id === 'seance.solved')!;
    expect(solved.compute([g])).toEqual({ value: 1, text: 'Ghosts laid to rest: 1 of 1' });
  });
});

function voteInTurn(h: Harness) {
  const g = h.game();
  const p = g.psychics.find(
    (x) => voteStage(g, x) === g.final!.revealed && !(x.color in g.final!.votes),
  )!;
  h.act({ type: 'vote', group: 0 }, p.id);
}
