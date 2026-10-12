import {
  type AwardRule,
  type GameEvents,
  TONES,
  fixtureGame,
  recapEv,
  renderCopy,
} from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { roundTableAwards } from './awards.ts';
import {
  HOST,
  type Harness,
  playAll,
  propose,
  questRound,
  recording,
  rigged,
  voteAll,
} from './test-utils.ts';
import type { RoleId } from './types.ts';

const rule = (id: string): AwardRule => {
  const r = roundTableAwards.rules.find((x) => x.id === `round-table.${id}`);
  if (!r) throw new Error(`no rule ${id}`);
  return r;
};
const run = (id: string, g: GameEvents) => rule(id).compute!(g);
const winners = (id: string, g: GameEvents) => run(id, g).map((c) => c.players);

/** Plays `script` on a rigged table and returns the game's events, as the recap reads them. */
function played(roles: RoleId[], script: (h: Harness) => void, opts: { lady?: boolean } = {}) {
  const h = rigged(roles, opts);
  const log = recording(h);
  script(h);
  return fixtureGame(log.events, {
    players: h.state.game!.players,
    startedAt: 0,
    endedAt: 600_000,
  });
}

// Seats: host merlin, ana percival, ben + cy servants, dee assassin, eve mordred.
const SIX: RoleId[] = ['merlin', 'percival', 'servant', 'servant', 'assassin', 'mordred'];
// Seats: host merlin, ana + ben + cy + dee servants, eve assassin, fin oberon, gus minion.
const EIGHT: RoleId[] = [
  'merlin',
  'servant',
  'servant',
  'servant',
  'servant',
  'assassin',
  'oberon',
  'minion',
];

/** Good wins three clean quests; the Assassin then misses (or hits). */
const goodGame = (target: string) =>
  played(SIX, (h) => {
    questRound(h, [HOST, 'ana']);
    // A rejection with Evil aboard: Ben and Cy (Good) vote it down.
    propose(h, ['dee', 'ben', 'cy']);
    voteAll(h, ['ben', 'cy', 'ana']);
    questRound(h, ['ana', 'ben', 'cy']);
    propose(h, ['eve', 'ben', 'cy', HOST]);
    voteAll(h, ['ben', 'cy', 'ana', HOST]);
    questRound(h, ['ana', 'ben', 'cy', HOST]);
    h.act({ type: 'assassinate', target }, 'dee');
  });

describe('round-table awards', () => {
  it('ships copy for every rule in both tones, short and clean', () => {
    expect(roundTableAwards.rules).toHaveLength(13);
    for (const r of roundTableAwards.rules) {
      for (const tone of TONES) {
        expect(r.copy[tone].length, `${r.id} ${tone}`).toBeGreaterThanOrEqual(2);
        for (const t of r.copy[tone]) {
          const text = renderCopy(t, { players: ['x'], value: 12 }).replace(
            /\{p:[^}]+\}/g,
            'N'.repeat(12),
          );
          expect(text.length, `${r.id}: ${text}`).toBeLessThanOrEqual(70);
          expect(text).not.toMatch(/stupid|idiot|dumb|worst|loser|\bfail|trash|choke|useless/i);
          expect(text).not.toMatch(/\{\w+\}/);
        }
      }
    }
  });

  it('Merlin hidden, Percival’s guard, Bloodhound and Kingmaker when the Assassin misses', () => {
    const g = goodGame('ben');
    expect(winners('hidden-in-plain-sight', g)).toEqual([[HOST]]);
    expect(winners('percivals-guard', g)).toEqual([['ana']]);
    expect(run('perfect-strike', g)).toEqual([]);
    expect(winners('bloodhound', g)).toEqual([['ana', 'ben', 'cy']]);
    expect(run('kingmaker', g)).toEqual([]);
    expect(run('contrarian', g)).toEqual([]);
  });

  it('a Perfect Strike when the Assassin finds Merlin, and Mordred’s Shadow', () => {
    const g = goodGame(HOST);
    expect(winners('perfect-strike', g)).toEqual([['dee']]);
    expect(winners('mordreds-shadow', g)).toEqual([['eve']]);
    expect(run('hidden-in-plain-sight', g)).toEqual([]);
    expect(run('percivals-guard', g)).toEqual([]);
  });

  it('Silver Tongue, Saboteur, Oberon Alone, Kingmaker and the Lady’s Favourite', () => {
    const g = played(
      EIGHT,
      (h) => {
        // Gus (Evil) rides two clean quests, led by Host and Ana.
        questRound(h, ['gus', 'ana', 'ben']);
        questRound(h, ['gus', 'ana', 'ben', 'cy']);
        h.act({ type: 'lady', target: 'eve' }, 'gus');
        // Then three sunk quests with Evil aboard.
        questRound(h, ['eve', 'fin', 'ben', 'cy'], ['eve']);
        h.act({ type: 'lady', target: 'fin' }, 'eve');
        questRound(h, ['eve', 'fin', 'gus', 'cy', 'dee'], ['eve', 'fin']);
        h.act({ type: 'lady', target: 'ana' }, 'fin');
        questRound(h, ['eve', 'fin', 'gus', 'cy', 'dee'], ['fin']);
      },
      { lady: true },
    );
    expect(g.of('outcome')[0]!.props).toMatchObject({ winner: 'evil', reason: 'fails' });
    expect(winners('silver-tongue', g)).toEqual([['gus']]);
    expect(winners('saboteur', g)).toEqual([['eve', 'fin']]);
    expect(winners('oberon-alone', g)).toEqual([['fin']]);
    expect(winners('kingmaker', g)).toEqual([]);
    // Gus checked Eve (Evil); Eve checked Fin (Evil): one each, a shared award.
    expect(winners('ladys-favourite', g)).toEqual([['eve', 'gus']]);
  });

  it('Yes-Man, Contrarian and On the Hammer over a long standoff', () => {
    const g = played(SIX, (h) => {
      for (let i = 0; i < 4; i++) {
        propose(h, [HOST, 'ana']);
        voteAll(h, ['ben', 'cy', 'dee', 'eve']);
      }
      propose(h, [HOST, 'ana']);
      voteAll(h, ['ben', 'cy', 'dee', 'eve']);
    });
    expect(g.of('outcome')[0]!.props).toMatchObject({ reason: 'rejections', streak: 5 });
    expect(winners('yes-man', g)).toEqual([['ana', HOST]]);
    expect(run('contrarian', g)).toEqual([]); // four share it: too many
    expect(winners('on-the-hammer', g)).toEqual([['dee']]);
  });

  it('old events without the newer props give no candidates', () => {
    const g = fixtureGame([recapEv('outcome', null, {}), recapEv('quest', null, {})]);
    for (const r of roundTableAwards.rules) expect(r.compute!(g), r.id).toEqual([]);
  });

  it('nuggets: sides, records and sweeps', () => {
    const games = [goodGame('ben'), goodGame(HOST)];
    const text = (id: string) =>
      roundTableAwards.nuggets.find((n) => n.id === `round-table.${id}`)!.compute(games);
    expect(text('sides')).toEqual({ value: 1, text: '2 games: Good won 1, Evil 1' });
    expect(text('assassin-rate')).toEqual({
      value: 1,
      text: 'The Assassin found Merlin 1 of 2 times',
    });
    expect(text('fewest-proposals')).toEqual({ value: 5, text: 'Fewest proposals in a game: 5' });
    expect(text('clean-sweeps')).toEqual({ value: 2, text: 'Clean sweeps (3–0): 2' });
    expect(text('quickest-win')).toEqual({ value: 600_000, text: 'Quickest win: 10m 0s' });
    const records = Object.fromEntries(roundTableAwards.nuggets.map((n) => [n.id, n.record]));
    expect(records).toMatchObject({
      'round-table.longest-standoff': 'max',
      'round-table.fewest-proposals': 'min',
      'round-table.quickest-win': 'min',
    });
  });

  it('history: one line per game', () => {
    expect(roundTableAwards.history!(goodGame('ben'))).toEqual(['Good 3–0 · assassin missed']);
    expect(roundTableAwards.history!(goodGame(HOST))).toEqual([
      'Evil · Merlin assassinated after Good went 3–0',
    ]);
    const standoff = played(SIX, (h) => {
      for (let i = 0; i < 5; i++) {
        propose(h, [HOST, 'ana']);
        voteAll(h, [HOST, 'ana', 'ben', 'cy']);
      }
    });
    expect(roundTableAwards.history!(standoff)).toEqual(['Evil by 5 rejections']);
    const sunk = played(SIX, (h) => {
      for (const team of [
        ['dee', 'ana'],
        ['dee', 'ana', 'ben'],
        ['dee', 'ana', 'ben', 'cy'],
      ]) {
        propose(h, team);
        voteAll(h);
        playAll(h, ['dee']);
      }
    });
    expect(roundTableAwards.history!(sunk)).toEqual(['Evil 3–0 · three quests sunk']);
  });
});
