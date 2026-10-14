import {
  type AwardCandidate,
  type AwardRule,
  type GameEvents,
  type RecapEvent,
  createRng,
  fixtureGame,
  recapEv,
  recapEventOf,
} from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { tavernBrawlAwards } from './awards.ts';
import { tavernBrawlBot } from './bot.ts';
import { tavernBrawl } from './game.ts';
import { insights } from './insights.ts';
import { started } from './test-utils.ts';

const rule = (id: string): AwardRule => {
  const r = tavernBrawlAwards.rules.find((x) => x.id === `tb.${id}`);
  if (!r) throw new Error(`no rule ${id}`);
  return r;
};
const run = (id: string, events: RecapEvent[], players = ['a', 'b', 'c']): AwardCandidate[] =>
  rule(id).compute!(fixtureGame(events, { players }));

const outcome = (winners: string[], props: Record<string, unknown> = {}) =>
  recapEv('outcome', null, {
    winners,
    players: ['a', 'b', 'c'],
    heroes: ['mage', 'brute', 'knight'],
    turns: 12,
    longestChain: [2, 2, 2],
    biggestHit: [3, 3, 3],
    ...props,
  });
const ko = (who: string, by: string, props: Record<string, unknown> = {}) =>
  recapEv('ko', who, { by, card: 'mage.06', self: by === who, removed: false, ...props });
const hit = (by: string, target: string, hp: number, shield = 0) =>
  recapEv('hit', by, { target, hp, shield, power: false, self: false });

describe('Tavern Brawl award rules', () => {
  it('Haunting: the most ghost damage (2 or more), five or more players', () => {
    const ghostHit = (by: string, n: number) =>
      recapEv('hit', by, { target: 'a', hp: n, shield: 0, power: true, self: false, ghost: true });
    const five = ['a', 'b', 'c', 'd', 'e'];
    expect(
      run('haunting', [ghostHit('b', 1), ghostHit('b', 1), ghostHit('c', 1)], five)[0],
    ).toMatchObject({ players: ['b'], value: 2 });
    expect(run('haunting', [ghostHit('b', 1)], five)).toEqual([]);
    expect(run('haunting', [hit('b', 'a', 3)], five)).toEqual([]);
  });

  it('Puppet Master: two or more steered attacks', () => {
    const steer = (by: string) => recapEv('redirect', by, { attacker: 'b', target: 'c' });
    expect(run('puppet-master', [steer('a'), steer('a')])[0]).toMatchObject({ players: ['a'] });
    expect(run('puppet-master', [steer('a')])).toEqual([]);
  });

  it('Last One Standing: the winner with two or more knockouts', () => {
    expect(run('last-standing', [ko('b', 'a'), ko('c', 'a'), outcome(['a'])])[0]).toMatchObject({
      players: ['a'],
      value: 2,
    });
    expect(run('last-standing', [ko('b', 'a'), ko('c', 'b'), outcome(['a'])])).toEqual([]);
    // Knockouts by someone who didn't win don't count.
    expect(run('last-standing', [ko('b', 'c'), ko('a', 'c'), outcome(['a'])])).toEqual([]);
  });

  it('Untouchable: won without losing a hit point', () => {
    expect(
      run('untouchable', [hit('a', 'b', 3), hit('b', 'a', 0, 2), outcome(['a'])])[0],
    ).toMatchObject({ players: ['a'] });
    expect(run('untouchable', [hit('b', 'a', 1), outcome(['a'])])).toEqual([]);
    expect(run('untouchable', [outcome([])])).toEqual([]);
  });

  it('Own Goal: knocked themselves out (not a removal)', () => {
    expect(run('own-goal', [ko('a', 'a'), outcome(['b'])])[0]!.players).toEqual(['a']);
    expect(run('own-goal', [ko('a', 'a', { removed: true, self: false })])).toEqual([]);
    expect(run('own-goal', [ko('a', 'b')])).toEqual([]);
  });

  it('Bad Trade: lost hit points in a swap and didn’t win', () => {
    const swap = (by: string, before: number, after: number) =>
      recapEv('swap', by, { with: 'c', before, after });
    expect(run('bad-trade', [swap('a', 8, 3), outcome(['b'])])[0]).toMatchObject({
      players: ['a'],
      value: 5,
    });
    expect(run('bad-trade', [swap('a', 8, 3), outcome(['a'])])).toEqual([]);
    expect(run('bad-trade', [swap('a', 3, 8), outcome(['b'])])).toEqual([]);
  });

  it('The Healer and Shield Wall need at least 6', () => {
    const heal = (p: string, amount: number) => recapEv('heal', p, { amount });
    expect(run('healer', [heal('a', 4), heal('a', 3), heal('b', 2)])[0]).toMatchObject({
      players: ['a'],
      value: 7,
    });
    expect(run('healer', [heal('a', 5)])).toEqual([]);
    expect(run('shield-wall', [hit('b', 'a', 0, 4), hit('c', 'a', 1, 3)])[0]).toMatchObject({
      players: ['a'],
      value: 7,
    });
    expect(run('shield-wall', [hit('b', 'a', 0, 5)])).toEqual([]);
  });

  it('Chain Reaction and Big Hit read the outcome', () => {
    expect(run('chain', [outcome(['a'], { longestChain: [5, 2, 1] })])[0]).toMatchObject({
      players: ['a'],
      value: 5,
    });
    expect(run('chain', [outcome(['a'])])).toEqual([]);
    expect(run('big-hit', [outcome(['a'], { biggestHit: [2, 6, 6] })])[0]!.players).toEqual([
      'b',
      'c',
    ]);
    // Old events without the props simply give nothing.
    expect(run('chain', [recapEv('outcome', null, { winners: ['a'] })])).toEqual([]);
  });

  it('Good Sport, Sticky Fingers and Shield Breaker', () => {
    const social = (p: string, done: boolean, auto = false) => recapEv('social', p, { done, auto });
    expect(
      run('good-sport', [social('a', true), social('b', true, true), social('c', false)])[0]!
        .players,
    ).toEqual(['a']);
    const steal = (p: string, count: number) => recapEv('steal', p, { count });
    expect(run('sticky-fingers', [steal('a', 1), steal('a', 2)])[0]).toMatchObject({ value: 3 });
    expect(run('sticky-fingers', [steal('a', 1)])).toEqual([]);
    const broke = (p: string, owner: string) =>
      recapEv('shield', p, { card: 'x', holder: owner, owner });
    expect(
      run('shield-breaker', [broke('a', 'b'), broke('a', 'c'), broke('a', 'b')])[0]!.players,
    ).toEqual(['a']);
    expect(run('shield-breaker', [broke('a', 'a'), broke('a', 'a'), broke('a', 'b')])).toEqual([]);
  });
});

/** Plays a whole seeded game with bots in every seat, collecting what `insights` reported. */
function playedGame(seed: number): GameEvents {
  const h = started(['mage', 'brute', 'ranger', 'druid'], seed);
  const rng = createRng(seed);
  const events: RecapEvent[] = [];
  let ts = 1;
  for (let i = 0; i < 4000 && h.state.phase === 'playing'; i++) {
    const before = h.state;
    const g = before.game!;
    const me = g.choice?.chooser ?? g.turn.player;
    const move = tavernBrawlBot(tavernBrawl.view(before, me), {
      me,
      now: h.now,
      rng,
      words: () => [],
    });
    if (!move) throw new Error('bot had no move');
    h.act(me, move, me === 'p1');
    for (const ev of insights(before, h.state, move, me)) events.push(recapEventOf(ev, ts++));
  }
  expect(h.state.phase).toBe('over');
  return fixtureGame(events, { players: ['p1', 'p2', 'p3', 'p4'] });
}

describe('Tavern Brawl awards on a real game', () => {
  it('finds awards, nuggets and a history line', () => {
    const games = [1, 2, 3, 4, 5].map(playedGame);
    for (const g of games) {
      expect(g.of('outcome')).toHaveLength(1);
      expect(g.of('play').length).toBeGreaterThan(10);
      expect(g.of('hit').length).toBeGreaterThan(5);
    }
    const found = new Set(
      games.flatMap((g) =>
        tavernBrawlAwards.rules.flatMap((r) => (r.compute?.(g) ?? []).map(() => r.id)),
      ),
    );
    expect(found.size).toBeGreaterThanOrEqual(4);
    const history = tavernBrawlAwards.history!(games[0]!);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatch(/^(\{p:p\d\} won with \{role:\w+\}|Everyone was knocked out)/);
    const nuggets = tavernBrawlAwards.nuggets.flatMap((n) => n.compute(games) ?? []);
    expect(nuggets.length).toBeGreaterThan(1);
  });
});
