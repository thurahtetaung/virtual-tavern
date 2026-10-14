import {
  type AwardCandidate,
  type GameEvents,
  type RecapEvent,
  fixtureGame,
  recapEv,
  recapEventOf,
} from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { codenamesAwards } from './awards.ts';
import { insights } from './insights.ts';
import { HOST, OP, SPY, cardsOf, startedGame } from './test-utils.ts';
import type { CodenamesAction, Team } from './types.ts';

const PLAYERS = ['a', 'b', 'c', 'd'];
const rule = (id: string) => {
  const r = codenamesAwards.rules.find((x) => x.id === `codenames.${id}`);
  if (!r) throw new Error(`no rule ${id}`);
  return r;
};
const run = (id: string, g: GameEvents): AwardCandidate[] => rule(id).compute!(g);
const game = (events: RecapEvent[]) => fixtureGame(events, { players: PLAYERS });

const clue = (by: string, word: string, count: number | null, team = 'red', props = {}) =>
  recapEv('clue', by, { word, count, team, ...props });
const guess = (by: string, kind: string, team = 'red', props: Record<string, unknown> = {}) =>
  recapEv('guess', by, { word: 'w', kind, correct: kind === team, team, ...props });
const endTurn = (reason: string, team = 'red', by: string | null = null) =>
  recapEv('end-turn', by, { reason, team });
const outcome = (winner: string, winReason: string, props = {}) =>
  recapEv('outcome', null, { winner, winReason, ...props });

describe('codenames awards', () => {
  it('ships copy for every rule in both tones', () => {
    for (const r of codenamesAwards.rules) {
      expect(r.copy.cheeky.length, r.id).toBeGreaterThanOrEqual(2);
      expect(r.copy.wholesome.length, r.id).toBeGreaterThanOrEqual(2);
      expect(typeof r.compute, r.id).toBe('function');
    }
  });

  it('Assassin Magnet: hit, miss and a shared tie', () => {
    expect(run('assassin-magnet', game([guess('b', 'assassin')]))).toMatchObject([
      { players: ['b'], value: 1 },
    ]);
    expect(run('assassin-magnet', game([guess('b', 'red')]))).toEqual([]);
    expect(
      run('assassin-magnet', game([guess('b', 'assassin'), guess('d', 'assassin', 'blue')])),
    ).toMatchObject([{ players: ['b', 'd'], value: 1 }]);
  });

  it('Sharpshooter: needs three agents, and a clear or shared lead', () => {
    const three = [
      guess('b', 'red'),
      guess('b', 'red'),
      guess('b', 'red'),
      guess('d', 'blue', 'blue'),
    ];
    expect(run('sharpshooter', game(three))).toMatchObject([{ players: ['b'], value: 3 }]);
    expect(run('sharpshooter', game(three.slice(1)))).toEqual([]);
  });

  it('drops a tie of four or more', () => {
    const events = PLAYERS.map((p) => guess(p, 'assassin'));
    expect(run('assassin-magnet', game(events))).toEqual([]);
  });

  it('Galaxy Brain and Perfect Cash: a big clue fully cashed', () => {
    const events = [
      clue('a', 'orbit', 4),
      guess('b', 'red'),
      guess('b', 'red'),
      guess('b', 'red'),
      guess('b', 'red'),
      endTurn('passed', 'red', 'b'),
    ];
    expect(run('galaxy-brain', game(events))).toMatchObject([
      { players: ['a'], value: 4, params: { w: 'ORBIT' } },
    ]);
    expect(run('perfect-cash', game(events))).toMatchObject([{ players: ['a'], value: 4 }]);
    // Three of four is not cashed.
    expect(run('galaxy-brain', game([clue('a', 'orbit', 4), ...events.slice(1, 4)]))).toEqual([]);
    expect(run('perfect-cash', game([clue('a', 'orbit', 3), ...events.slice(1, 4)]))).toEqual([]);
  });

  it('Bonus Round: the extra guess, only with the newer props', () => {
    const bonus = guess('b', 'red', 'red', { clueCount: 2, guessNo: 3 });
    expect(run('bonus-round', game([bonus]))).toMatchObject([{ players: ['b'] }]);
    expect(
      run('bonus-round', game([guess('b', 'red', 'red', { clueCount: 2, guessNo: 2 })])),
    ).toEqual([]);
    // Old events lack the props: no candidate, no throw.
    expect(run('bonus-round', game([guess('b', 'red')]))).toEqual([]);
    // A clue for 0 has no guess limit, so its first guess is no bonus.
    expect(
      run('bonus-round', game([guess('b', 'red', 'red', { clueCount: 0, guessNo: 1 })])),
    ).toEqual([]);
  });

  it('Friendly Fire and Bystander Tour', () => {
    expect(run('friendly-fire', game([guess('b', 'blue')]))).toMatchObject([{ players: ['b'] }]);
    expect(run('friendly-fire', game([guess('b', 'bystander')]))).toEqual([]);
    expect(run('bystander-tour', game([guess('b', 'bystander')]))).toEqual([]);
    expect(
      run('bystander-tour', game([guess('b', 'bystander'), guess('b', 'bystander')])),
    ).toMatchObject([{ players: ['b'], value: 2 }]);
  });

  it('Quick Draw and Deep Thinker: timing, with minimum samples', () => {
    const fast = (by: string, ms: number) => guess(by, 'red', 'red', { actMs: ms });
    const events = [
      fast('b', 1000),
      fast('b', 2000),
      fast('b', 3000),
      fast('d', 9000),
      fast('d', 9000),
      fast('d', 9000),
    ];
    expect(run('quick-draw', game(events))).toMatchObject([
      { players: ['b'], value: 2000, params: { s: 2 } },
    ]);
    expect(run('quick-draw', game(events.slice(0, 2)))).toEqual([]);
    const slow = [
      clue('a', 'x', 1, 'red', { actMs: 60_000 }),
      clue('a', 'y', 1, 'red', { actMs: 30_000 }),
      clue('c', 'z', 1, 'blue', { actMs: 5_000 }),
      clue('c', 'z', 1, 'blue', { actMs: 5_000 }),
    ];
    expect(run('deep-thinker', game(slow))).toMatchObject([{ players: ['a'], params: { s: 45 } }]);
    expect(run('deep-thinker', game([clue('a', 'x', 1)]))).toEqual([]);
  });

  it('The Closer and Own-Goal Victory read the final guess', () => {
    const closer = [clue('a', 'x', 1), guess('b', 'red'), outcome('red', 'all-agents')];
    expect(run('the-closer', game(closer))).toMatchObject([{ players: ['b'] }]);
    expect(run('own-goal-victory', game(closer))).toEqual([]);
    const ownGoal = [clue('a', 'x', 1), guess('b', 'blue'), outcome('blue', 'all-agents')];
    expect(run('own-goal-victory', game(ownGoal))).toMatchObject([{ players: ['b'] }]);
    expect(run('the-closer', game(ownGoal))).toEqual([]);
    expect(run('the-closer', game([guess('b', 'assassin'), outcome('blue', 'assassin')]))).toEqual(
      [],
    );
  });

  it('Speedrun: the assassin on the first guess', () => {
    expect(run('speedrun', game([clue('a', 'x', 1), guess('b', 'assassin')]))).toMatchObject([
      { players: ['b'] },
    ]);
    expect(run('speedrun', game([guess('b', 'red'), guess('b', 'assassin')]))).toEqual([]);
  });

  it('Comeback: the winners were four behind, and needs the newer outcome props', () => {
    // Red starts (9 vs 8); blue finds 5 before red finds any: red is 9 - 3 = 6 behind.
    const events = [
      ...Array.from({ length: 5 }, () => guess('d', 'blue', 'blue')),
      ...Array.from({ length: 9 }, () => guess('b', 'red')),
    ];
    const won = outcome('red', 'all-agents', { startingTeam: 'red' });
    const g = fixtureGame([...events, won], { players: PLAYERS, winners: ['a', 'b'] });
    expect(run('comeback', g)).toMatchObject([
      { players: ['a', 'b'], value: 6, params: { team: 'Red' } },
    ]);
    expect(run('comeback', fixtureGame([...events, outcome('red', 'all-agents')]))).toEqual([]);
    expect(
      run(
        'comeback',
        fixtureGame([guess('b', 'red'), outcome('red', 'all-agents', { startingTeam: 'red' })]),
      ),
    ).toEqual([]);
  });

  it('Big Swing, Clue Collector and Spotless Spymaster', () => {
    expect(run('big-swing', game([clue('a', 'x', 4), clue('c', 'y', 2, 'blue')]))).toMatchObject([
      { players: ['a'], value: 4 },
    ]);
    expect(run('big-swing', game([clue('a', 'x', 3)]))).toEqual([]);
    const four = Array.from({ length: 4 }, () => clue('a', 'x', 1));
    expect(run('clue-collector', game(four))).toMatchObject([{ players: ['a'], value: 4 }]);
    expect(run('clue-collector', game(four.slice(1)))).toEqual([]);
    const clean = [0, 1, 2].flatMap(() => [
      clue('a', 'x', 1),
      guess('b', 'red'),
      endTurn('passed'),
    ]);
    expect(run('spotless-spymaster', game(clean))).toMatchObject([{ players: ['a'], value: 3 }]);
    expect(
      run('spotless-spymaster', game([...clean, clue('a', 'y', 1), guess('b', 'bystander')])),
    ).toEqual([]);
  });

  it('Hot Streak: consecutive right guesses by one player', () => {
    const streak = Array.from({ length: 4 }, () => guess('b', 'red'));
    expect(run('hot-streak', game(streak))).toMatchObject([{ players: ['b'], value: 4 }]);
    expect(
      run('hot-streak', game([...streak.slice(0, 2), guess('b', 'bystander'), ...streak.slice(2)])),
    ).toEqual([]);
  });

  it('Pass Master: passes named by the newer end-turn player', () => {
    const passes = [endTurn('passed', 'red', 'b'), endTurn('passed', 'red', 'b')];
    expect(run('pass-master', game(passes))).toMatchObject([{ players: ['b'], value: 2 }]);
    // Old end-turn events name nobody.
    expect(run('pass-master', game([endTurn('passed'), endTurn('passed')]))).toEqual([]);
  });

  it('nuggets summarise the night', () => {
    const g = game([
      clue('a', 'orbit', 2),
      guess('b', 'red', 'red', { actMs: 1500 }),
      guess('b', 'red'),
      guess('b', 'assassin'),
      outcome('blue', 'assassin'),
    ]);
    const texts = codenamesAwards.nuggets.map((n) => n.compute([g])?.text);
    expect(texts).toContain('3 guesses · 67% right');
    expect(texts).toContain('1 assassin found');
    expect(texts).toContain('Biggest clue cashed: "ORBIT 2"');
    expect(texts).toContain('Fastest guess: 1.5 s');
    expect(codenamesAwards.nuggets.every((n) => n.compute([]) === null || n.id)).toBe(true);
  });

  it('history: one line per clue', () => {
    const g = game([clue('a', 'orbit', 2), guess('b', 'red'), guess('b', 'assassin')]);
    expect(codenamesAwards.history!(g)).toEqual([
      'Red: {p:a} gave "ORBIT 2", 1 found, then the assassin',
    ]);
    const open = game([clue('a', 'orbit', null), guess('b', 'red'), guess('b', 'red')]);
    expect(codenamesAwards.history!(open)).toEqual(['Red: {p:a} gave "ORBIT ∞", 2 found']);
  });

  it('never throws on events missing their props', () => {
    const g = game([
      recapEv('clue', 'a'),
      recapEv('guess', 'b'),
      recapEv('end-turn'),
      recapEv('outcome'),
    ]);
    for (const r of codenamesAwards.rules) expect(() => r.compute!(g), r.id).not.toThrow();
    for (const n of codenamesAwards.nuggets) expect(() => n.compute([g]), n.id).not.toThrow();
    expect(() => codenamesAwards.history!(g)).not.toThrow();
  });
});

describe('codenames awards on a real game', () => {
  it('reads what insights() reports', () => {
    const h = startedGame();
    const events: RecapEvent[] = [];
    const act = (action: CodenamesAction, by: string) => {
      const before = h.state;
      h.act(action, by);
      events.push(...insights(before, h.state, action, by).map((e) => recapEventOf(e)));
    };
    // Red: a 4-clue fully cashed, then a pass; blue: one wrong guess; red wins.
    act({ type: 'give-clue', word: 'orbit', count: 4 }, SPY.red);
    for (const card of cardsOf(h.state, 'red').slice(0, 4)) act({ type: 'guess', card }, OP.red);
    act({ type: 'end-turn' }, OP.red);
    act({ type: 'give-clue', word: 'sea', count: 1 }, SPY.blue);
    act({ type: 'guess', card: cardsOf(h.state, 'bystander')[0]! }, OP.blue);
    while (h.state.phase === 'playing') {
      const team: Team = h.state.turn!.team;
      act({ type: 'give-clue', word: `hint${events.length}`, count: 1 }, SPY[team]);
      const card = cardsOf(h.state, team)[0]!;
      act({ type: 'guess', card }, OP[team]);
      if (h.state.phase === 'playing' && h.state.turn!.team === team)
        act({ type: 'end-turn' }, OP[team]);
    }
    const g = fixtureGame(events, { players: [HOST, 'p2', 'p3', 'p4'] });
    const ids = (id: string) => run(id, g).flatMap((c) => c.players);
    expect(ids('galaxy-brain')).toEqual([SPY.red]);
    expect(ids('perfect-cash')).toEqual([SPY.red]);
    expect(run('pass-master', g)).toBeDefined();
    expect(ids('the-closer').length + ids('own-goal-victory').length).toBe(1);
    expect(ids('sharpshooter')).toContain(OP.red);
    const last = events.findLast((e) => e.type === 'outcome');
    expect(last?.props).toMatchObject({ startingTeam: 'red' });
    expect(codenamesAwards.history!(g).length).toBeGreaterThan(2);
    expect(codenamesAwards.history!(g)[0]).toBe(`Red: {p:${SPY.red}} gave "ORBIT 4", 4 found`);
  });
});
