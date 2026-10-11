import { type GameEvents, fixtureGame, recapEv } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { ALL_NIGHT_RULES, MVP, type NightContext, fallbacksFor } from './night-awards.ts';

const rule = (id: string) => ALL_NIGHT_RULES.find((r) => r.id === id)!;

/** A game with these players and winners, optionally a final ranking. */
const g = (
  n: number,
  players: string[],
  winners: string[],
  opts: { ranking?: string[]; endedAt?: number } = {},
): GameEvents =>
  fixtureGame(opts.ranking ? [recapEv('outcome', null, { ranking: opts.ranking })] : [], {
    gameNo: n,
    players,
    winners,
    startedAt: n * 1000,
    endedAt: opts.endedAt ?? n * 1000 + 500,
  });

const ctx = (games: GameEvents[], extra: Partial<NightContext> = {}): NightContext => ({
  games,
  glory: new Map(),
  chaos: new Map(),
  tzOffsetMin: null,
  ...extra,
});

const P = ['ana', 'ben', 'cy', 'dee'];

describe('night awards', () => {
  it('MVP: most wins, with places and skill awards as tie-breakers', () => {
    const night = ctx([g(1, P, ['ana']), g(2, P, ['ana', 'ben']), g(3, P, ['ben'])], {
      glory: new Map([['ana', 2]]),
    });
    expect(MVP.compute(night)).toMatchObject([{ players: ['ana'], params: { n: 2, m: 3 } }]);
  });

  it('MVP: nobody who never won', () => {
    expect(MVP.compute(ctx([g(1, P, []), g(2, P, [])]))).toEqual([]);
  });

  it('Comeback Kid: lost early, won late (needs four games)', () => {
    const games = [g(1, P, ['ben']), g(2, P, ['ben']), g(3, P, ['ana']), g(4, P, ['ana'])];
    expect(rule('night-comeback').compute(ctx(games))).toMatchObject([{ players: ['ana'] }]);
    expect(rule('night-comeback').compute(ctx(games.slice(0, 3)))).toEqual([]);
  });

  it('Chaos Agent: the most blunders, at least two', () => {
    const night = ctx([], {
      chaos: new Map([
        ['cy', 3],
        ['dee', 1],
      ]),
    });
    expect(rule('night-chaos').compute(night)).toMatchObject([
      { players: ['cy'], value: 3, runnerUp: 1 },
    ]);
    expect(rule('night-chaos').compute(ctx([], { chaos: new Map([['cy', 1]]) }))).toEqual([]);
  });

  it('Old Reliable: top half of every ranked game', () => {
    const games = [
      g(1, P, ['ana'], { ranking: ['ana', 'ben', 'cy', 'dee'] }),
      g(2, P, ['ben'], { ranking: ['ben', 'ana', 'dee', 'cy'] }),
      g(3, P, ['cy'], { ranking: ['cy', 'ana', 'ben', 'dee'] }),
    ];
    expect(rule('night-reliable').compute(ctx(games))).toMatchObject([
      { players: ['ana'], value: 3 },
    ]);
    // Games without a ranking (old events) give no candidate.
    expect(rule('night-reliable').compute(ctx([g(1, P, []), g(2, P, []), g(3, P, [])]))).toEqual(
      [],
    );
  });

  it('The Regular: everyone who played all of them, up to three', () => {
    const games = [g(1, ['ana', 'ben'], []), g(2, ['ana', 'cy'], []), g(3, ['ana', 'dee'], [])];
    expect(rule('night-regular').compute(ctx(games))).toMatchObject([
      { players: ['ana'], value: 3 },
    ]);
    const all = [g(1, P, []), g(2, P, []), g(3, P, [])];
    expect(rule('night-regular').compute(ctx(all))).toEqual([]);
  });

  it('Fashionably Late: the latest arrival', () => {
    const games = [
      g(1, ['ana', 'ben'], []),
      g(2, ['ana', 'ben'], []),
      g(3, ['ana', 'ben', 'eli'], []),
    ];
    expect(rule('night-late').compute(ctx(games))).toMatchObject([{ players: ['eli'], value: 3 }]);
  });

  it('On Fire: three wins in a row', () => {
    const games = [g(1, P, ['dee']), g(2, P, ['dee']), g(3, P, ['dee']), g(4, P, ['ana'])];
    expect(rule('night-streak').compute(ctx(games))).toMatchObject([
      { players: ['dee'], value: 3 },
    ]);
    expect(rule('night-streak').compute(ctx(games.slice(1)))).toEqual([]);
  });

  it('Dynamic Duo: won together twice; co-op wins do not count', () => {
    const games = [g(1, P, ['ana', 'ben']), g(2, P, ['ana', 'ben']), g(3, P, ['cy', 'dee'])];
    expect(rule('night-duo').compute(ctx(games))).toMatchObject([
      { players: ['ana', 'ben'], value: 2 },
    ]);
    const coop = [g(1, P, P), g(2, P, P)];
    expect(rule('night-duo').compute(ctx(coop))).toEqual([]);
  });

  it('Rivals: three close meetings, the one ahead first', () => {
    const two = ['ana', 'ben'];
    const games = [g(1, two, ['ben']), g(2, two, ['ana']), g(3, two, ['ben'])];
    expect(rule('night-rivals').compute(ctx(games))).toMatchObject([
      { players: ['ben', 'ana'], params: { n: 2, m: 1 } },
    ]);
    const lopsided = [g(1, two, ['ben']), g(2, two, ['ben']), g(3, two, ['ben'])];
    expect(rule('night-rivals').compute(ctx(lopsided))).toEqual([]);
  });

  it('Last Orders: only after midnight in the host time zone', () => {
    // 01:30 UTC; the host is UTC (offset 0).
    const late = g(1, P, [], { endedAt: Date.UTC(2026, 9, 11, 1, 30) });
    expect(rule('night-last-orders').compute(ctx([late], { tzOffsetMin: 0 }))).toMatchObject([
      { params: { time: '1:30' } },
    ]);
    // 01:30 UTC is 21:30 the evening before in New York (offset 240).
    expect(rule('night-last-orders').compute(ctx([late], { tzOffsetMin: 240 }))).toEqual([]);
    // Unknown time zone: no claim.
    expect(rule('night-last-orders').compute(ctx([late]))).toEqual([]);
  });

  it('fallbacks: the regular, the late arrival, the good sport, then just showing up', () => {
    const games = [
      g(1, ['ana', 'ben'], ['ben']),
      g(2, ['ana', 'ben', 'eli'], ['ben']),
      g(3, ['ana', 'eli'], ['eli']),
    ];
    expect(fallbacksFor(ctx(games), 'ana').map((f) => f.rule.id)).toEqual([
      'night-regular',
      'night-good-sport',
      'night-showed-up',
    ]);
    expect(fallbacksFor(ctx(games), 'eli').map((f) => f.rule.id)).toEqual([
      'night-late',
      'night-showed-up',
    ]);
    expect(fallbacksFor(ctx(games.slice(0, 1)), 'ben').map((f) => f.rule.id)).toEqual([
      'night-showed-up',
    ]);
  });
});
