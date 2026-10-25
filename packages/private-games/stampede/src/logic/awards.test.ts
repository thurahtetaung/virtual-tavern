import { type InsightEvent, fixtureGame, recapEv, recapEventOf } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { stampedeAwards } from './awards.ts';
import { stampede } from './game.ts';
import { insights } from './insights.ts';
import { HOST, next, playRound, started } from './test-utils.ts';
import type { StampedeState } from './types.ts';

const rule = (id: string) => stampedeAwards.rules.find((r) => r.id === id)!;
const answer = (by: string, props: Record<string, unknown>) => recapEv('answer', by, props);
const players = { players: ['a', 'b', 'c', 'd'] };

describe('Stampede awards', () => {
  it('herd leader and lone wolf, at least twice', () => {
    const g = fixtureGame(
      [
        answer('a', { herd: true, with: ['b'] }),
        answer('b', { herd: true, with: ['a'] }),
        answer('c', { alone: true, with: [] }),
        answer('a', { herd: true, with: ['c'] }),
        answer('c', { herd: true, with: ['a'] }),
        answer('b', { alone: true, with: [] }),
        answer('c', { alone: true, with: [] }),
        answer('c', { alone: true, with: [] }),
      ],
      players,
    );
    expect(rule('sp.herd-leader').compute!(g)[0]).toMatchObject({ players: ['a'], value: 2 });
    expect(rule('sp.lone-wolf').compute!(g)[0]).toMatchObject({ players: ['c'], value: 3 });
    // Old events without the props give nothing.
    expect(rule('sp.herd-leader').compute!(fixtureGame([recapEv('answer', 'a')]))).toEqual([]);
  });

  it('mind meld: the pair that matched most, counted once per round', () => {
    const pair = (a: string, b: string) => [
      answer(a, { herd: true, with: [b] }),
      answer(b, { herd: true, with: [a] }),
    ];
    const g = fixtureGame(
      [...pair('a', 'b'), ...pair('a', 'b'), ...pair('a', 'b'), ...pair('c', 'd')],
      players,
    );
    expect(rule('sp.mind-meld').compute!(g)).toEqual([
      expect.objectContaining({ players: ['a', 'b'], value: 3 }),
    ]);
    expect(rule('sp.mind-meld').compute!(fixtureGame(pair('a', 'b'), players))).toEqual([]);
  });

  it('cow magnet and the great escape name the Pink Cow by placeholder', () => {
    const g = fixtureGame(
      [
        recapEv('pink', 'a', { from: null }),
        recapEv('pink', 'b', { from: 'a' }),
        recapEv('pink', 'a', { from: 'b' }),
        recapEv('pink', 'c', { from: 'a' }),
        recapEv('outcome', null, { winners: ['a'] }),
      ],
      players,
    );
    expect(rule('sp.pink-magnet').compute!(g)).toEqual([
      expect.objectContaining({ players: ['a'], value: 2, params: { card: 'pink-cow' } }),
    ]);
    expect(rule('sp.escape').compute!(g)[0]).toMatchObject({ players: ['a'], value: 2 });
    expect(
      rule('sp.escape').compute!(fixtureGame([recapEv('outcome', null, { winners: ['d'] })])),
    ).toEqual([]);
  });

  it('one big herd: a round where everyone agreed', () => {
    const round = (props: Record<string, unknown>) => recapEv('round', null, props);
    const g = fixtureGame(
      [round({ groups: 1, herdSize: 4, blanks: 0 }), round({ groups: 2, herdSize: 3, blanks: 0 })],
      players,
    );
    expect(rule('sp.one-herd').compute!(g)).toEqual([{ players: [], value: 4 }]);
    expect(
      rule('sp.one-herd').compute!(fixtureGame([round({ groups: 1, herdSize: 4, blanks: 1 })])),
    ).toEqual([]);
  });

  it('nuggets and history read a real game through its insights', () => {
    const h = started(4, { settings: { target: 5 } });
    const events: InsightEvent[] = [];
    const step = (fn: () => void) => {
      const before: StampedeState = h.state;
      fn();
      events.push(...insights(before, h.state, null, HOST));
    };
    step(() => playRound(h, ['Pizza', 'pizza', 'Tacos', 'Soup'])); // two alone: no Pink Cow
    step(() => next(h));
    step(() => playRound(h, ['Moon', 'moon', 'Moon', 'Mars'])); // p4 takes the Pink Cow
    step(() => next(h));
    step(() => playRound(h, ['a', 'a', 'b', 'b'])); // a tie
    for (let i = 0; i < 4 && h.state.phase === 'playing'; i++) {
      step(() => next(h));
      step(() => playRound(h, ['x', 'y', 'x', 'q'])); // two alone: the Pink Cow stays
    }
    expect(h.state.phase).toBe('over');
    const g = fixtureGame(
      events.map((e, i) => recapEventOf(e, i + 1)),
      { players: ['p1', 'p2', 'p3', 'p4'] },
    );
    expect(g.winners).toEqual(h.state.winners);
    expect(stampedeAwards.history!(g).slice(0, 3)).toEqual([
      'Round 1: 2 said “Pizza”',
      'Round 2: 3 said “Moon”; {p:p4} took the {card:pink-cow}',
      'Round 3: a tie at the top, no cows',
    ]);
    const biggest = stampedeAwards.nuggets.find((n) => n.id === 'sp.biggest-herd')!;
    expect(biggest.compute([g])).toEqual({ value: 3, text: 'Biggest herd: 3 players, one answer' });
    expect(rule('sp.herd-leader').compute!(g)[0]).toMatchObject({ players: ['p1'], value: 5 });
    // Every answer event carries its group's facts.
    const answers = g.of('answer');
    expect(answers).toHaveLength(4 * h.state.history.length);
    expect(answers[0]!.props).toMatchObject({ round: 1, herd: true, alone: false, with: ['p2'] });
  });

  it('report nothing before an answer is public', () => {
    const h = started(3);
    const start = h.state;
    h.act('p1', { type: 'answer', text: 'secret' });
    h.act('p2', { type: 'answer', text: 'secret' });
    expect(insights(start, h.state, null, 'p2')).toEqual([]);
    // The last answer reveals the round, and only then are the answers reported.
    const before = h.state;
    h.act('p3', { type: 'answer', text: 'other' });
    expect(stampede.view(h.state, 'p2').round!.stage).toBe('reveal');
    expect(insights(before, h.state, null, 'p3').map((e) => e.type)).toEqual([
      'answer',
      'answer',
      'answer',
      'round',
      'pink',
    ]);
  });
});
