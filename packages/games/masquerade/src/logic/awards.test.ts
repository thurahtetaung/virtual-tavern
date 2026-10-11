import {
  type AwardRule,
  type GameEvents,
  type InsightEvent,
  type RecapEvent,
  TONES,
  fixtureGame,
  recapEv,
  recapEventOf,
  renderCopy,
} from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { locationById } from '../content/locations.ts';
import { masqueradeAwards } from './awards.ts';
import { insightsFor } from './insights.ts';
import { FOUR, HOST, type Harness, NOW, allReady, rig, startedGame } from './test-utils.ts';
import type { MasqueradeAction } from './types.ts';

const rule = (id: string): AwardRule => {
  const r = masqueradeAwards.rules.find((x) => x.id === `masquerade.${id}`);
  if (!r) throw new Error(`no rule ${id}`);
  return r;
};
const run = (id: string, g: GameEvents) => rule(id).compute!(g);

const PLAYERS = ['a', 'b', 'c', 'd', 'e'];

/** One revealed round: the spies' fates and every vote (voter -> target). */
function round(
  n: number,
  spies: Record<string, string>,
  votes: Record<string, string>,
  extra: { location?: string; ts?: number; players?: number } = {},
): RecapEvent[] {
  const location = extra.location ?? 'Bakery';
  const spyIds = Object.keys(spies);
  const received = (id: string) => Object.values(votes).filter((t) => t === id).length;
  return [
    recapEv(
      'round',
      null,
      { location, round: n, spies: spyIds.length, players: extra.players ?? PLAYERS.length },
      extra.ts ?? n * 1000,
    ),
    ...spyIds.map((id) =>
      recapEv(
        'spy',
        id,
        { outcome: spies[id], votes: received(id), location, round: n },
        extra.ts ?? n * 1000,
      ),
    ),
    ...Object.entries(votes).map(([v, t]) =>
      recapEv('vote', v, { hit: spyIds.includes(t), target: t, round: n }, extra.ts ?? n * 1000),
    ),
  ];
}
const game = (...events: RecapEvent[]) => fixtureGame(events, { players: PLAYERS });

describe('masquerade awards', () => {
  it('ships copy for every rule in both tones, short and clean', () => {
    for (const r of masqueradeAwards.rules) {
      for (const tone of TONES) {
        expect(r.copy[tone].length, `${r.id} ${tone}`).toBeGreaterThanOrEqual(2);
        for (const t of r.copy[tone]) {
          const text = renderCopy(t, {
            players: ['x'],
            value: 12,
            params: { loc: 'e1-07', r: 12, t: '12m 30s' },
          })
            .replace(/\{p:[^}]+\}/g, 'N'.repeat(12))
            .replace(/\{\w+:[^}]+\}/g, 'L'.repeat(10));
          expect(text.length, `${r.id}: ${text}`).toBeLessThanOrEqual(70);
          expect(text).not.toMatch(
            /stupid|idiot|dumb|worst|loser|fail|trash|choke|carried|useless/i,
          );
        }
      }
    }
  });

  it('spy awards: disguise, ghost, thief, so close', () => {
    const g = game(
      ...round(1, { a: 'escaped' }, { b: 'c', c: 'b', d: 'b', e: 'c' }),
      ...round(2, { b: 'stole' }, { a: 'b', c: 'b', d: 'b', e: 'b' }),
      ...round(3, { c: 'caught' }, { a: 'c', b: 'c', d: 'c', e: 'a' }),
    );
    expect(run('master-of-disguise', g)).toMatchObject([{ players: ['a', 'b'], value: 1 }]);
    expect(run('ghost', g)).toMatchObject([{ players: ['a'], value: 1 }]);
    expect(run('last-second-thief', g)).toMatchObject([
      { players: ['b'], value: 1, params: { loc: 'Bakery' } },
    ]);
    expect(run('so-close', g)).toMatchObject([{ players: ['c'], value: 1 }]);
    expect(run('ghost', game(...round(1, { a: 'escaped' }, { b: 'a', c: 'b' })))).toEqual([]);
  });

  it('voting awards: bloodhound, usual suspect, contrarian', () => {
    const g = game(
      ...round(1, { a: 'caught' }, { b: 'a', c: 'a', d: 'e', e: 'd' }),
      ...round(2, { c: 'escaped' }, { a: 'e', b: 'c', d: 'e', e: 'a' }),
    );
    expect(run('bloodhound', g)).toMatchObject([{ players: ['b'], value: 2 }]);
    // e drew 3 votes as a local, d 1, a 1.
    expect(run('usual-suspect', g)).toMatchObject([{ players: ['e'], value: 3 }]);
    // Lone votes: round 1 d->e and e->d; round 2 b->c and e->a.
    expect(run('contrarian', g)).toMatchObject([{ players: ['e'], value: 2 }]);
    expect(run('bloodhound', game(...round(1, { a: 'caught' }, { b: 'a' })))).toEqual([]);
  });

  it('Spy Whisperer and Go With the Flow need three rounds', () => {
    const rounds = [1, 2, 3].flatMap((n) =>
      round(n, { a: 'caught' }, { b: 'a', c: 'a', d: 'a', e: 'b' }),
    );
    expect(run('spy-whisperer', game(...rounds))).toMatchObject([
      { players: ['b', 'c', 'd'], value: 3 },
    ]);
    expect(run('go-with-the-flow', game(...rounds))).toMatchObject([
      { players: ['b', 'c', 'd'], value: 3 },
    ]);
    const two = [1, 2].flatMap((n) => round(n, { a: 'caught' }, { b: 'a', c: 'a', d: 'a' }));
    expect(run('spy-whisperer', game(...two))).toEqual([]);
    expect(run('go-with-the-flow', game(...two))).toEqual([]);
    // Four perfect voters tie: dropped.
    const four = [1, 2, 3].flatMap((n) =>
      round(n, { a: 'caught' }, { b: 'a', c: 'a', d: 'a', e: 'a' }),
    );
    expect(run('spy-whisperer', game(...four))).toEqual([]);
  });

  it('Partners in Crime: two spies who both got away', () => {
    const g = game(...round(1, { a: 'escaped', b: 'stole' }, { c: 'd', d: 'c', e: 'c' }));
    expect(run('partners-in-crime', g)).toMatchObject([{ players: ['a', 'b'], value: 1 }]);
    const caught = game(...round(1, { a: 'escaped', b: 'caught' }, { c: 'b', d: 'b', e: 'b' }));
    expect(run('partners-in-crime', caught)).toEqual([]);
  });

  it('Top Scorer reads the final standings, and old outcomes lack them', () => {
    const o = recapEv('outcome', null, { rounds: 3, ranking: ['a', 'b', 'c'], scores: [5, 3, 3] });
    expect(run('top-scorer', game(o))).toMatchObject([{ players: ['a'], value: 5, runnerUp: 3 }]);
    expect(run('top-scorer', game(recapEv('outcome', null, { rounds: 3 })))).toEqual([]);
  });

  it('moments: speed round, unanimous catch, chaos vote', () => {
    const g = fixtureGame(
      [
        ...round(1, { a: 'caught' }, { b: 'a', c: 'a', d: 'a', e: 'a' }, { ts: 300_000 }),
        ...round(2, { b: 'escaped' }, { a: 'c', c: 'd', d: 'e', e: 'a' }, { ts: 400_000 }),
      ],
      { players: PLAYERS, startedAt: 0 },
    );
    expect(run('speed-round', g)).toMatchObject([
      { players: [], value: 1, params: { r: 2, t: '1m 40s' } },
    ]);
    expect(run('unanimous-catch', g)).toMatchObject([{ players: ['a'], value: 4 }]);
    expect(run('chaos-vote', g)).toMatchObject([{ players: [], value: 4, params: { r: 2 } }]);
  });

  it('night rules: Spy Magnet and the back-room Grand Tour', () => {
    const g1 = game(
      ...round(1, { a: 'caught' }, {}, { location: 'e1-01' }),
      ...round(2, { a: 'escaped' }, {}, { location: 'e1-02' }),
    );
    const g2 = game(
      ...round(1, { b: 'caught' }, {}, { location: 'e2-03' }),
      ...round(2, { c: 'caught' }, {}, { location: 'e1-04' }),
      ...round(3, { d: 'caught' }, {}, { location: 'e1-05' }),
    );
    expect(rule('spy-magnet').computeNight!([g1, g2])).toMatchObject([
      { players: ['a'], value: 2 },
    ]);
    expect(rule('grand-tour').computeNight!([g1, g2])).toMatchObject([
      { players: PLAYERS, value: 5 },
    ]);
    // Public locations are names: no grand tour.
    expect(rule('grand-tour').computeNight!([game(...round(1, { a: 'caught' }, {}))])).toEqual([]);
    const nuggets = masqueradeAwards.nuggets.flatMap((n) => n.compute([g1, g2])?.text ?? []);
    expect(nuggets).toContain('Edition 1 ×4 · Edition 2 ×1');
  });

  it('never throws on old or empty events', () => {
    const old = game(recapEv('round', null, {}), recapEv('spy', 'a', {}), recapEv('vote', 'b', {}));
    for (const r of masqueradeAwards.rules)
      expect(() => r.compute?.(old) ?? r.computeNight?.([old])).not.toThrow();
    expect(masqueradeAwards.history!(old)).toEqual(['Round 1: spy {p:a}']);
  });

  it('works on a real game played through the engine', () => {
    const insights = insightsFor((id) => locationById(id)?.name ?? id);
    const h = startedGame(FOUR, { rounds: 2 });
    const events: InsightEvent[] = [];
    const step = (hh: Harness, action: MasqueradeAction, by = HOST) => {
      const before = hh.state;
      hh.act(action, by, NOW);
      events.push(...insights(before, hh.state, action, by));
    };
    // Round 1: cy spies at the bakery, escapes with no votes.
    rig(h, { spies: ['cy'], location: 'bakery' });
    allReady(h);
    step(h, { type: 'vote', target: 'ana' }, HOST);
    step(h, { type: 'vote', target: 'ben' }, 'ana');
    step(h, { type: 'vote', target: 'ana' }, 'ben');
    step(h, { type: 'vote', target: 'ana' }, 'cy');
    step(h, { type: 'next-round' });
    // Round 2: ana spies, gets caught, guesses wrong.
    rig(h, { spies: ['ana'], location: 'bakery' });
    allReady(h);
    for (const v of [HOST, 'ben', 'cy']) step(h, { type: 'vote', target: 'ana' }, v);
    step(h, { type: 'vote', target: 'ben' }, 'ana');
    step(h, { type: 'spy-guess', location: 'gym' }, 'ana');
    expect(h.state.phase).toBe('over');
    const g = fixtureGame(
      events.map((e, i) => recapEventOf(e, i + 1)),
      { players: FOUR },
    );
    expect(run('ghost', g)).toMatchObject([{ players: ['cy'], value: 1 }]);
    expect(run('so-close', g)).toMatchObject([{ players: ['ana'], value: 1 }]);
    expect(run('unanimous-catch', g)).toMatchObject([{ players: ['ana'], value: 3 }]);
    // cy: 2 for escaping, then 2 as a local who voted for the spy.
    expect(run('top-scorer', g)).toMatchObject([{ players: ['cy'], value: 4, runnerUp: 2 }]);
    expect(masqueradeAwards.history!(g)).toMatchObject([
      'Round 1 · {loc:Bakery}: spy {p:cy} escaped',
      'Round 2 · {loc:Bakery}: spy {p:ana} caught',
    ]);
  });
});
