import {
  type AwardRule,
  type GameEvents,
  type RecapEvent,
  TONES,
  fixtureGame,
  recapEv,
  recapEventOf,
  renderCopy,
} from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { hoodwinkAwards } from './awards.ts';
import { hoodwink } from './game.ts';
import { insights } from './insights.ts';
import {
  FOUR,
  HOST,
  NOW,
  content,
  lieOf,
  lureDeck,
  round as roundOf,
  startedGame,
  truthIndex,
  writeAll,
} from './test-utils.ts';

const rule = (id: string): AwardRule => {
  const r = hoodwinkAwards.rules.find((x) => x.id === `hoodwink.${id}`);
  if (!r) throw new Error(`no rule ${id}`);
  return r;
};
const run = (id: string, g: GameEvents) => rule(id).compute!(g);

const P = ['ana', 'ben', 'cy', 'dee'];

interface LieSpec {
  by: string[];
  text: string;
  auto?: string[];
}

/**
 * One round: `lies` are the board's lies (index = position), `votes` maps voter → lie index, or
 * 'truth', or 'house'.
 */
function round(
  lies: LieSpec[],
  votes: Record<string, number | 'truth' | 'house'>,
  extra: Record<string, unknown> = {},
): RecapEvent[] {
  const fooled = (i: number) => Object.values(votes).filter((v) => v === i).length;
  return [
    ...lies.map((l, i) =>
      recapEv('lie', l.by[0], {
        fooled: fooled(i),
        authors: l.by,
        auto: !!l.auto?.length,
        autoAuthors: l.auto ?? [],
        words: [{ kind: 'guess', word: l.text }],
      }),
    ),
    ...Object.entries(votes).map(([v, pick]) =>
      recapEv('vote', v, {
        foundTruth: pick === 'truth',
        authors: typeof pick === 'number' ? lies[pick]!.by : [],
        house: pick === 'house',
      }),
    ),
    recapEv('round', null, {
      truthFound: Object.values(votes).filter((v) => v === 'truth').length,
      liesCount: lies.length,
      double: false,
      pointsTo: [],
      points: [],
      ...extra,
    }),
  ];
}

const game = (events: RecapEvent[], players = P) => fixtureGame(events, { players });
const L = (by: string, text = `lie ${by}`, auto?: string[]): LieSpec => ({
  by: [by],
  text,
  ...(auto && { auto }),
});

describe('hoodwink awards', () => {
  it('names the best liar and the truth seeker', () => {
    const g = game([
      ...round([L('ana'), L('ben'), L('cy'), L('dee')], { ben: 0, cy: 0, dee: 'truth', ana: 1 }),
      ...round([L('ana'), L('ben'), L('cy'), L('dee')], { ben: 0, cy: 'truth', dee: 'truth' }),
    ]);
    expect(run('best-liar', g)).toMatchObject([{ players: ['ana'], value: 3 }]);
    expect(run('truth-seeker', g)).toMatchObject([{ players: ['dee'], value: 2 }]);
  });

  it('pairs identical liars and nemeses', () => {
    const g = game([
      ...round([{ by: ['ana', 'ben'], text: 'Cheese' }, L('cy')], { cy: 0, dee: 1 }),
      ...round([L('ana'), L('cy')], { dee: 1, ben: 'truth' }),
    ]);
    expect(run('great-minds', g)).toMatchObject([
      { players: ['ana', 'ben'], value: 2, params: { w: 'Cheese' } },
    ]);
    expect(run('nemesis', g)).toMatchObject([{ players: ['dee', 'cy'], value: 2 }]);
    expect(run('nemesis', game(round([L('ana')], { dee: 0 })))).toEqual([]);
  });

  it('spots a total con and a truth nobody believed', () => {
    const g = game(round([L('ana', 'Moon cheese'), L('ben')], { ben: 0, cy: 0, dee: 0 }));
    expect(run('total-con', g)).toMatchObject([
      { players: ['ana'], value: 3, params: { w: 'Moon cheese' } },
    ]);
    expect(run('too-weird', g)).toMatchObject([{ players: [], value: 3, params: { r: 1 } }]);
    const found = game(round([L('ana')], { ben: 0, cy: 'truth', dee: 0 }));
    expect(run('total-con', found)).toEqual([]);
    expect(run('too-weird', found)).toEqual([]);
  });

  it('counts the house, the hoodwinked and the robot', () => {
    const g = game([
      ...round([L('ana', 'x', ['ana'])], { ben: 'house', cy: 0, dee: 0 }),
      ...round([L('ana', 'y', ['ana'])], { ben: 0, cy: 'house', dee: 0 }),
      ...round([L('ben')], { ana: 0, cy: 0, dee: 0 }),
    ]);
    expect(run('fell-for-house', g)).toMatchObject([{ players: ['ben', 'cy'], value: 1 }]);
    expect(run('hoodwinked', g)).toMatchObject([{ players: ['cy', 'dee'], value: 3 }]);
    expect(run('lie-for-me', g)).toMatchObject([{ players: ['ana'], value: 2 }]);
  });

  it('drops a tie of more than three', () => {
    const g = game(round([L('ana')], { ben: 'house', cy: 'house', dee: 'house', eve: 'house' }), [
      ...P,
      'eve',
    ]);
    expect(run('fell-for-house', g)).toEqual([]);
  });

  it('finds the final-round heist', () => {
    const g = game([
      ...round([L('ana')], { ben: 0 }, { pointsTo: ['ana'], points: [500] }),
      ...round(
        [L('ben')],
        { ana: 0 },
        { double: true, pointsTo: ['ben', 'cy'], points: [1000, 500] },
      ),
    ]);
    expect(run('final-heist', g)).toMatchObject([{ players: ['ben'], value: 1000, runnerUp: 500 }]);
  });

  it('measures lies: novelist, haiku and too honest', () => {
    const rounds = Array.from({ length: 5 }, (_, i) =>
      round([L('ana', i === 0 ? 'A very long story about a goose' : 'Hat'), L('dee', 'Nope')], {
        ben: 0,
        cy: 'truth',
      }),
    ).flat();
    const g = game(rounds);
    expect(run('novelist', g)[0]).toMatchObject({ players: ['ana'], value: 31 });
    expect(run('haiku', g)).toMatchObject([{ players: ['ana'], value: 3, params: { w: 'Hat' } }]);
    expect(run('too-honest', g)).toMatchObject([{ players: ['dee'], value: 5 }]);
    expect(run('too-honest', game(rounds.slice(0, 8)))).toEqual([]);
  });

  it('gives nothing (and never throws) for events from before the new props', () => {
    const old = game([
      recapEv('lie', 'ana', { fooled: 1, authors: ['ana'], auto: false }),
      recapEv('vote', 'ben', { foundTruth: false }),
      recapEv('round', null, { truthFound: 0, liesCount: 1, house: 0 }),
    ]);
    for (const id of ['nemesis', 'fell-for-house', 'lie-for-me', 'final-heist'])
      expect(run(id, old)).toEqual([]);
    for (const r of hoodwinkAwards.rules) expect(() => r.compute!(fixtureGame([]))).not.toThrow();
    for (const n of hoodwinkAwards.nuggets) expect(n.compute([fixtureGame([])])).toBeNull();
  });

  it('has two variants per tone of short copy', () => {
    const name = 'Abcdefghijkl';
    for (const r of hoodwinkAwards.rules)
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
    const h = startedGame(FOUR, {
      rounds: 5,
      provider: content([lureDeck(['Tin cup', 'Feather'])]),
    });
    const events: RecapEvent[] = [];
    let ts = 0;
    const act = h.act.bind(h);
    h.act = (action, by = HOST, now = NOW) => {
      const before = h.state;
      const after = act(action, by, now);
      events.push(...insights(before, after, action, by).map((e) => recapEventOf(e, ++ts)));
      return after;
    };
    // p3's lie fools everyone else every round.
    while (h.state.phase === 'playing') {
      writeAll(h);
      for (const id of roundOf(h).voters)
        h.act({ type: 'vote', option: id === 'p3' ? truthIndex(h) : lieOf(h, 'p3') }, id);
      h.act({ type: 'next-round' });
    }
    const g = fixtureGame(events, { players: FOUR });
    expect(run('best-liar', g)[0]!.players).toEqual(['p3']);
    expect(run('truth-seeker', g)[0]!.players).toEqual(['p3']);
    expect(run('nemesis', g)).toEqual([]); // three voters tie on p3
    expect(run('final-heist', g)[0]!.players).toEqual(['p3']);
    const lines = hoodwinkAwards.history!(g);
    expect(lines).toHaveLength(5);
    expect(lines[4]).toMatch(
      /^Round 5 \(double\): truth found by 1 of 4; \{p:p3\}'s "Lie p3" fooled 3$/,
    );
    expect(hoodwink.awards).toBe(hoodwinkAwards);
  });
});
