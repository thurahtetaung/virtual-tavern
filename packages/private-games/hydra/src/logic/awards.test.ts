import { type AwardRule, type GameEvents, fixtureGame, recapEv } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { HYDRA_RULES, hydraAwards } from './awards.ts';
import { HOST, claimAll, legislate, recording, rigged } from './test-utils.ts';
import type { Role } from './types.ts';

const rule = (id: string) => HYDRA_RULES.find((r) => r.id === `hydra.${id}`)!;
const hit = (r: AwardRule, g: GameEvents) => r.compute!(g);
const PLAYERS = ['a', 'b', 'c', 'd', 'e'];
const outcome = (props: Record<string, unknown>, winners: string[] = []) =>
  recapEv('outcome', null, { rounds: 8, leader: 'd', liars: [], honest: [], ...props, winners });
const game = (...events: ReturnType<typeof recapEv>[]) => fixtureGame(events, { players: PLAYERS });
const election = (
  president: string,
  yes: string[],
  no: string[],
  props: Record<string, unknown> = {},
) =>
  recapEv('election', president, {
    president,
    chancellor: 'x',
    yes,
    no,
    passed: yes.length > no.length,
    tracker: 0,
    ...props,
  });

describe('Hydra awards', () => {
  it('Sharpshooter and The Ascension', () => {
    expect(
      hit(rule('sharpshooter'), game(outcome({ how: 'leader-executed', executor: 'a' }))),
    ).toEqual([{ players: ['a'], value: 1, params: { role: 'leader' } }]);
    expect(hit(rule('sharpshooter'), game(outcome({ how: 'blue-policies' })))).toEqual([]);
    expect(hit(rule('ascension'), game(outcome({ how: 'leader-elected' })))[0]!.players).toEqual([
      'd',
    ]);
  });

  it('Pinocchio needs two lies and the most; ties of four share nothing', () => {
    expect(hit(rule('pinocchio'), game(outcome({ liars: ['a', 'a', 'b'] })))[0]).toMatchObject({
      players: ['a'],
      value: 2,
    });
    expect(hit(rule('pinocchio'), game(outcome({ liars: ['a', 'b'] })))).toEqual([]);
    expect(
      hit(rule('pinocchio'), game(outcome({ liars: ['a', 'a', 'b', 'b', 'c', 'c', 'e', 'e'] }))),
    ).toEqual([]);
  });

  it('Straight Shooter: honest winners with at least two claims', () => {
    const claims = ['a', 'a', 'b'].map((p) => recapEv('claim', p, { kind: 'president', blues: 1 }));
    const g = fixtureGame([...claims, outcome({ honest: ['a', 'b'] }, ['a', 'b'])], {
      players: PLAYERS,
    });
    expect(hit(rule('straight-shooter'), g)).toEqual([{ players: ['a'], value: 2 }]);
  });

  it('vote awards: Rubber Stamp, No-Sayer, Chaos Agent', () => {
    const g = game(
      election('a', ['a', 'b'], ['c']),
      election('b', ['a', 'b'], ['c']),
      election('c', ['a'], ['b', 'c']),
      election('d', ['a'], ['c'], { passed: false, tracker: 3 }),
      outcome({}),
    );
    expect(hit(rule('rubber-stamp'), g)[0]).toMatchObject({ players: ['a'], value: 4 });
    expect(hit(rule('no-sayer'), g)[0]).toMatchObject({ players: ['c'], value: 4 });
    expect(hit(rule('chaos-agent'), g)[0]!.players).toEqual(['d']);
  });

  it('Veto Royale names the pair; old events without props give nothing', () => {
    const g = game(
      recapEv('session', 'b', { president: 'a', chancellor: 'b', vetoed: true }),
      outcome({}),
    );
    expect(hit(rule('veto-royale'), g)).toEqual([{ players: ['a', 'b'], value: 1 }]);
    const bare = game(recapEv('outcome', null, {}));
    for (const r of HYDRA_RULES) expect(() => hit(r, bare)).not.toThrow();
    for (const r of HYDRA_RULES) expect(hit(r, bare), r.id).toEqual([]);
  });

  it('Ghost, Not-Him Club, Cursed Hands, Snake, Firewall, Bloodhound, Friendly Fire', () => {
    expect(
      hit(rule('ghost'), game(outcome({ ghost: 'd', how: 'red-policies' })))[0]!.players,
    ).toEqual(['d']);
    expect(
      hit(rule('not-him'), game(recapEv('cleared', 'a'), recapEv('cleared', 'a'), outcome({})))[0],
    ).toMatchObject({
      players: ['a'],
      params: { role: 'leader' },
    });
    expect(hit(rule('cursed-hands'), game(outcome({ rrrBlue: ['b'] })))[0]!.players).toEqual(['b']);
    expect(hit(rule('snake'), game(outcome({ redBlue: ['c', 'c'] })))[0]).toMatchObject({
      players: ['c'],
      value: 2,
    });
    expect(hit(rule('firewall'), game(outcome({ firewall: ['e'] })))).toEqual([]);
    expect(hit(rule('firewall'), game(outcome({ firewall: ['e', 'e'] })))[0]!.players).toEqual([
      'e',
    ]);
    expect(hit(rule('bloodhound'), game(outcome({ bloodhound: ['a'] })))[0]!.players).toEqual([
      'a',
    ]);
    expect(hit(rule('friendly-fire'), game(outcome({ friendlyFire: ['b'] })))[0]!.players).toEqual([
      'b',
    ]);
  });

  it('nuggets and history', () => {
    const g = game(
      outcome({
        how: 'leader-elected',
        rounds: 6,
        lies: 4,
        winner: 'red',
        redEnacted: 3,
        blueEnacted: 1,
        chaos: 1,
      }),
    );
    const texts = hydraAwards.nuggets.map((n) => n.compute([g])?.text).filter(Boolean);
    expect(texts).toContain('Fastest {role:leader} win: round 6');
    expect(texts).toContain('Most lies in one game: 4');
    expect(texts).toContain('1 chaos top-deck');
    expect(hydraAwards.history!(g)).toEqual(['{role:leader} elected in round 6']);
  });
});

describe('a real game through insights and awards', () => {
  it('reports elections, sessions, claims and powers, and nothing secret until the end', () => {
    const roles: Role[] = ['blue', 'blue', 'red', 'leader', 'blue'];
    const h = rigged(roles, { deck: ['red', 'red', 'red'], settings: { quick: true } });
    const rec = recording(h);
    h.state = { ...h.state, game: { ...h.game(), enacted: { blue: 0, red: 3 } } };
    h.act({ type: 'nominate', player: 'ana' }, HOST);
    for (const p of ['host', 'ana', 'ben', 'cy', 'dee']) h.act({ type: 'vote', ballot: 'yes' }, p);
    legislate(h, 'red');
    claimAll(h);
    expect(JSON.stringify(rec.events)).not.toMatch(/"leader"|"roles"|"liars"/);
    h.act({ type: 'execute', player: 'cy' }, HOST);
    expect(h.state.phase).toBe('over');
    const types = rec.events.map((e) => e.type);
    expect(types).toEqual([
      'election',
      'cleared',
      'session',
      'claim',
      'claim',
      'power',
      'execution',
      'outcome',
    ]);
    const g = fixtureGame(rec.events, { players: h.game().players });
    expect(hit(rule('sharpshooter'), g)[0]!.players).toEqual([HOST]);
    // The President claimed 1 blue from three red: a lie.
    const o = rec.events.at(-1)!.props!;
    expect(o.liars).toEqual(expect.arrayContaining([HOST]));
    expect(o.rrrBlue).toEqual([HOST]);
  });
});
