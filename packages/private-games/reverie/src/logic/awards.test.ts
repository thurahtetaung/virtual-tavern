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
import { reverieAwards } from './awards.ts';
import { reverie } from './game.ts';
import { insights } from './insights.ts';
import { FOUR, HOST, NOW, startedGame, tellAndGive, voteAll } from './test-utils.ts';

const rule = (id: string): AwardRule => {
  const r = reverieAwards.rules.find((x) => x.id === `reverie.${id}`);
  if (!r) throw new Error(`no rule ${id}`);
  return r;
};
const run = (id: string, g: GameEvents) => rule(id).compute!(g);

const P = ['ana', 'ben', 'cy', 'dee'];

/** One turn: `st` tells `clue`; `votes` maps voter → whose card they picked. */
function turn(
  round: number,
  st: string,
  votes: Record<string, string>,
  clue = 'moonlight',
): RecapEvent[] {
  const voters = Object.keys(votes).length;
  const found = Object.values(votes).filter((o) => o === st).length;
  return [
    recapEv('story', st, {
      clue,
      round,
      voters,
      found,
      allOrNone: found === 0 || found === voters,
    }),
    ...Object.entries(votes).map(([v, owner]) =>
      recapEv('vote', v, { found: owner === st, owner }),
    ),
  ];
}

const game = (events: RecapEvent[], players = P) => fixtureGame(events, { players });

describe('reverie awards', () => {
  it('names the sweet-spot storyteller, sharing ties and needing two stories', () => {
    const g = game([
      ...turn(1, 'ana', { ben: 'ana', cy: 'ben', dee: 'ben' }),
      ...turn(2, 'ben', { ana: 'ben', cy: 'ana', dee: 'ana' }),
      ...turn(3, 'ana', { ben: 'ana', cy: 'cy', dee: 'cy' }),
    ]);
    expect(run('sweet-spot', g)).toMatchObject([{ players: ['ana'], value: 2 }]);
    const tied = game([
      ...turn(1, 'ana', { ben: 'ana', cy: 'ben' }),
      ...turn(2, 'ben', { ana: 'ben', cy: 'ana' }),
      ...turn(3, 'ana', { ben: 'ana', cy: 'ben' }),
      ...turn(4, 'ben', { ana: 'ben', cy: 'ana' }),
    ]);
    expect(run('sweet-spot', tied)[0]!.players).toEqual(['ana', 'ben']);
    expect(run('sweet-spot', game(turn(1, 'ana', { ben: 'ana', cy: 'ben' })))).toEqual([]);
  });

  it('finds too-cryptic and too-obvious stories with their clue', () => {
    const g = game([
      ...turn(1, 'ana', { ben: 'cy', cy: 'ben', dee: 'ben' }, 'the {void}'),
      ...turn(2, 'ben', { ana: 'ben', cy: 'ben', dee: 'ben' }, 'carrot'),
    ]);
    expect(run('too-cryptic', g)).toMatchObject([
      { players: ['ana'], value: 1, params: { w: 'the void' } },
    ]);
    expect(run('too-obvious', g)).toMatchObject([
      { players: ['ben'], value: 1, params: { w: 'carrot' } },
    ]);
    expect(run('too-cryptic', game(turn(1, 'ana', { ben: 'ana', cy: 'ben' })))).toEqual([]);
  });

  it('counts mind readers and the easily charmed', () => {
    const g = game([
      ...turn(1, 'ana', { ben: 'ana', cy: 'dee', dee: 'cy' }),
      ...turn(2, 'dee', { ana: 'cy', ben: 'dee', cy: 'ana' }),
    ]);
    expect(run('mind-reader', g)).toMatchObject([{ players: ['ben'], value: 2 }]);
    expect(run('easily-charmed', g)).toMatchObject([{ players: ['cy'], value: 2 }]);
  });

  it('crowns decoy royalty and soulmates from vote owners', () => {
    const g = game([
      ...turn(1, 'ana', { ben: 'cy', dee: 'cy', cy: 'ana' }),
      ...turn(2, 'ben', { ana: 'cy', dee: 'cy', cy: 'ben' }),
    ]);
    expect(run('decoy-royalty', g)).toMatchObject([{ players: ['cy'], value: 4 }]);
    // Ben and Dee both fell for Cy once; Dee again in turn 2: Dee → Cy twice, Ana → Cy once.
    expect(run('soulmates', g)).toMatchObject([{ players: ['dee', 'cy'], value: 2 }]);
    // Two pairs tied: nobody.
    const tie = game([
      ...turn(1, 'ana', { ben: 'cy', dee: 'cy' }),
      ...turn(2, 'ana', { ben: 'cy', dee: 'cy' }),
    ]);
    expect(run('soulmates', tie)).toEqual([]);
  });

  it('measures clues: the poet and the minimalist', () => {
    const g = game([
      ...turn(1, 'ana', { ben: 'ana', cy: 'ben' }, 'a lantern under the old sea'),
      ...turn(2, 'ben', { ana: 'ben', cy: 'ana' }, 'fog'),
    ]);
    expect(run('clue-poet', g)[0]).toMatchObject({ players: ['ana'], value: 27 });
    expect(run('minimalist', g)).toMatchObject([
      { players: ['ben'], value: 3, runnerUp: -21, params: { w: 'fog' } },
    ]);
  });

  it('reads scores: big payday, slow burn and the champion', () => {
    const scores = (
      round: number,
      totals: Record<string, number>,
      points: Record<string, number>,
    ) =>
      Object.entries(totals).map(([id, total]) =>
        recapEv('score', id, { round, total, points: points[id] ?? 0, storyteller: false }),
      );
    const events: RecapEvent[] = [];
    const totals = [
      { ana: 3, ben: 2, cy: 1, dee: 0 },
      { ana: 6, ben: 4, cy: 2, dee: 1 },
      { ana: 7, ben: 5, cy: 3, dee: 8 },
      { ana: 8, ben: 6, cy: 4, dee: 9 },
    ];
    totals.forEach((t, i) => {
      events.push(...turn(i + 1, 'ana', { ben: 'ana', cy: 'ben' }));
      events.push(...scores(i + 1, t, i === 2 ? { dee: 7 } : { ana: 3 }));
    });
    events.push(
      recapEv('outcome', null, {
        winners: ['dee'],
        ranking: ['dee', 'ana', 'ben', 'cy'],
        scores: [9, 8, 6, 4],
      }),
    );
    const g = game(events);
    expect(run('big-payday', g)).toMatchObject([{ players: ['dee'], value: 7 }]);
    expect(run('slow-burn', g)).toMatchObject([{ players: ['dee'], value: 1, params: { n: 1 } }]);
    expect(run('champion', g)).toMatchObject([{ players: ['dee'], value: 9, runnerUp: 8 }]);
  });

  it('spots the moments', () => {
    const g = game([
      ...turn(1, 'ana', { ben: 'cy', cy: 'ana', dee: 'cy' }),
      ...turn(2, 'ana', { ben: 'dee', cy: 'dee', dee: 'ana' }),
      ...turn(3, 'ben', { ana: 'cy', cy: 'ben', dee: 'cy' }),
      ...turn(4, 'cy', { ana: 'dee', ben: 'dee', dee: 'dee' }),
      recapEv('outcome', null, { winners: ['ana'] }),
    ]);
    // Turn 4: every vote on Dee's card (the storyteller is Cy).
    expect(run('same-decoy', g)).toMatchObject([{ players: ['dee'], value: 3 }]);
    expect(run('deciding-all-or-none', g)).toMatchObject([
      { players: ['cy'], value: 1, params: { r: 4 } },
    ]);
    const magnet = game(
      [...turn(1, 'ana', { ben: 'cy', dee: 'cy', cy: 'ana', eve: 'cy' })],
      [...P, 'eve'],
    );
    expect(run('decoy-magnet', magnet)).toMatchObject([{ players: ['cy'], value: 3 }]);
  });

  it('gives nothing (and never throws) for events from before the new props', () => {
    const old = game([
      recapEv('story', 'ana', { clue: 'x', allOrNone: false, round: 1, found: 1, voters: 3 }),
      recapEv('vote', 'ben', { found: false }),
      recapEv('vote', 'cy', { found: true }),
      recapEv('outcome', null, { target: 30 }),
    ]);
    for (const id of ['decoy-royalty', 'soulmates', 'big-payday', 'slow-burn', 'same-decoy'])
      expect(run(id, old)).toEqual([]);
    for (const r of reverieAwards.rules) expect(() => r.compute!(fixtureGame([]))).not.toThrow();
    for (const n of reverieAwards.nuggets) expect(n.compute([fixtureGame([])])).toBeNull();
  });

  it('has two variants per tone of short copy', () => {
    const name = 'Abcdefghijkl';
    for (const r of reverieAwards.rules)
      for (const tone of TONES) {
        expect(r.copy[tone].length, r.id).toBeGreaterThanOrEqual(2);
        for (const t of r.copy[tone]) {
          const text = renderCopy(t, {
            players: ['x', 'y'],
            value: 12,
            params: { w: 'Abcdefghij', r: 12 },
          }).replace(/\{p:\w+\}( & \{p:\w+\})?/g, name);
          expect(text.length, `${r.id}: ${text}`).toBeLessThanOrEqual(70);
        }
      }
  });

  it('awards a real game played through the rules', () => {
    const h = startedGame(FOUR, { targetScore: 15 });
    const events: RecapEvent[] = [];
    const act = h.act.bind(h);
    let ts = 0;
    h.act = (action, by = HOST, now = NOW) => {
      const before = h.state;
      const after = act(action, by, now);
      events.push(
        ...insights(before, after, action, by).map((e: InsightEvent) => recapEventOf(e, ++ts)),
      );
      return after;
    };
    // Ana alone finds every story; nobody finds hers.
    while (h.state.phase === 'playing') {
      tellAndGive(h);
      voteAll(h, h.state.turn!.storyteller === 'ana' ? [] : ['ana']);
      h.act({ type: 'next-turn' });
    }
    const g = fixtureGame(events, { players: FOUR });
    expect(g.of('score').length).toBeGreaterThan(0);
    expect(run('mind-reader', g)[0]!.players).toEqual(['ana']);
    expect(run('champion', g)[0]!.players).toEqual(h.state.winners.slice().sort());
    expect(run('decoy-royalty', g).length).toBe(1);
    const lines = reverieAwards.history!(g);
    expect(lines.length).toBeGreaterThan(0);
    expect(lines[0]).toMatch(/^Turn 1: \{p:\w+\} told "moonlight", /);
    expect(reverie.awards).toBe(reverieAwards);
  });
});
