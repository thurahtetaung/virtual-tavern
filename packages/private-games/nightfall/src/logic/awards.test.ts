import {
  type AwardCandidate,
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
import { nightfallAwards } from './awards.ts';
import { insights } from './insights.ts';
import { table, votes } from './test-utils.ts';
import type { NightfallState } from './types.ts';

const rule = (id: string): AwardRule => {
  const r = nightfallAwards.rules.find((x) => x.id === `nf.${id}`);
  if (!r) throw new Error(`no rule ${id}`);
  return r;
};
const PLAYERS = ['a', 'b', 'c', 'd'];
const game = (events: RecapEvent[], players = PLAYERS) => fixtureGame(events, { players });
const run = (id: string, events: RecapEvent[], players = PLAYERS): AwardCandidate[] =>
  rule(id).compute!(game(events, players));
const night = (id: string, games: GameEvents[]): AwardCandidate[] => rule(id).computeNight!(games);

const player = (id: string, props: Record<string, unknown> = {}) =>
  recapEv('player', id, { team: 'village', won: false, died: false, ...props });
const outcome = (props: Record<string, unknown> = {}) =>
  recapEv('outcome', null, { ending: 'werewolf-caught', teamsWon: ['village'], ...props });

describe('Nightfall award rules', () => {
  it('flag rules name every flagged player, up to three', () => {
    expect(run('lone-wolf', [player('a', { loneWolf: true }), player('b')])[0]).toMatchObject({
      players: ['a'],
      params: { role: 'werewolf' },
    });
    expect(run('lone-wolf', [player('a')])).toEqual([]);
    const crisis = PLAYERS.map((p) => player(p, { identityCrisis: true }));
    expect(run('identity-crisis', crisis.slice(0, 2))[0]!.players).toEqual(['a', 'b']);
    expect(run('identity-crisis', crisis)).toEqual([]);
    expect(run('living-the-dream', [player('c', { tannerDream: true })])[0]!.players).toEqual([
      'c',
    ]);
    expect(run('didnt-see-that-coming', [player('d', { blindsided: true })])[0]!.players).toEqual([
      'd',
    ]);
    expect(run('bodyguard-hero', [player('b', { bodyguardSave: true })])[0]!.players).toEqual([
      'b',
    ]);
    expect(run('wrong-place-wrong-time', [player('b', { villageDeath: true })])).toHaveLength(1);
    expect(run('hitman', [player('a', { hitman: true })])).toHaveLength(1);
  });

  it('count rules take the leader, ignore zero and share ties', () => {
    expect(run('parting-shot', [player('a', { hunterShots: 1 })])[0]!.players).toEqual(['a']);
    expect(run('parting-shot', [player('a', { hunterShots: 0 })])).toEqual([]);
    expect(
      run('light-fingers', [player('a', { cardsMoved: 2 }), player('b', { cardsMoved: 2 })])[0]!
        .players,
    ).toEqual(['a', 'b']);
    expect(run('light-fingers', [player('a', { cardsMoved: 1 })])).toEqual([]);
    expect(run('plague-bearer', [player('a', { plague: 2 })])[0]!.value).toBe(2);
    expect(run('heartbreaker', [player('a', { heartbreaks: 1 })])).toHaveLength(1);
    expect(run('sleepwalker', [player('a', { autoActions: 2 })])[0]!.value).toBe(2);
    expect(rule('sleepwalker').stripOnly).toBe(true);
  });

  it('looks: Eagle Eye and Moved Since', () => {
    const looks = [recapEv('look', 'a', { right: true }), recapEv('look', 'b', { right: false })];
    expect(run('eagle-eye', looks)[0]!.players).toEqual(['a']);
    expect(run('moved-since', looks)[0]!.players).toEqual(['b']);
  });

  it('night rules add up across games', () => {
    const g1 = game([player('a', { votedWolf: true, won: true, team: 'village' })]);
    const g2 = game([player('a', { votedWolf: true, won: true, team: 'werewolf' })]);
    const g3 = game([player('a', { team: 'tanner', votesReceived: 2 }), player('b')]);
    expect(night('wolf-whisperer', [g1, g2])[0]).toMatchObject({ players: ['a'], value: 2 });
    expect(night('wolf-whisperer', [g1])).toEqual([]);
    expect(night('survivor', [g1, g2, g3])[0]).toMatchObject({
      players: ['a'],
      value: 2,
      params: { m: 3 },
    });
    expect(night('team-hopper', [g1, g2, g3])[0]).toMatchObject({ players: ['a'], value: 3 });
    expect(night('team-hopper', [g1, g2])).toEqual([]);
    const votesIn = [g3, game([player('a', { votesReceived: 2 })])];
    expect(night('suspicion-magnet', votesIn)[0]).toMatchObject({ players: ['a'], value: 4 });
    const vamp = game([player('c', { vampire: true })]);
    expect(night('fang-fan', [vamp, vamp])[0]!.players).toEqual(['c']);
    expect(night('most-paranoid', [g1, g2])).toEqual([]);
    expect(rule('wolf-whisperer').nightOnly).toBe(true);
  });

  it('moments read the outcome', () => {
    expect(run('epic-battle', [outcome({ epic: true, teams: ['a', 'b', 'c'] })])[0]!.value).toBe(3);
    expect(run('epic-battle', [outcome()])).toEqual([]);
    expect(run('nobody-died', [outcome({ ending: 'nobody-died' })])).toHaveLength(1);
    expect(run('card-chain', [outcome({ chain: 3 })])[0]!.value).toBe(3);
    expect(run('card-chain', [outcome({ chain: 2 })])).toEqual([]);
    expect(run('love-death', [outcome({ loveDeaths: 1 })])).toHaveLength(1);
    expect(
      run('tanner-win', [outcome({ ending: 'tanner' }), player('b', { tannerDream: true })])[0]!
        .players,
    ).toEqual(['b']);
    const untouched = [outcome({ ending: 'wolves-survived' }), player('a'), player('b')];
    expect(run('wolves-untouched', untouched)).toHaveLength(1);
    expect(run('wolves-untouched', [...untouched, player('c', { votedWolf: true })])).toEqual([]);
  });

  it('old events lacking the newer props give no candidate', () => {
    const old = [recapEv('player', 'a', { won: true }), recapEv('outcome', null, {})];
    for (const id of ['sleepwalker', 'parting-shot', 'card-chain', 'love-death', 'epic-battle'])
      expect(run(id, old)).toEqual([]);
    expect(night('suspicion-magnet', [game(old)])).toEqual([]);
  });

  it('every rule survives an empty game', () => {
    const empty = game([]);
    for (const r of nightfallAwards.rules) {
      expect(r.compute?.(empty) ?? []).toEqual([]);
      expect(r.computeNight?.([empty]) ?? []).toEqual([]);
    }
    for (const n of nightfallAwards.nuggets) expect(n.compute([empty])).toBeNull();
    expect(nightfallAwards.history!(empty)).toEqual([]);
  });

  it('has two variants per tone, each short with a 12-letter name', () => {
    for (const r of nightfallAwards.rules) {
      for (const tone of TONES) {
        expect(r.copy[tone].length, `${r.id} ${tone}`).toBeGreaterThanOrEqual(2);
        for (const t of r.copy[tone]) {
          const text = renderCopy(t, { players: ['x'], value: 12, params: { m: 14, role: 'r' } })
            .replace(/\{p:[^}]+\}/g, 'Abcdefghijkl')
            .replace(/\{role:[^}]+\}/g, 'Doppelgang');
          expect(text.length, text).toBeLessThanOrEqual(70);
        }
      }
    }
  });
});

/** A real game to the reveal, with every insight its changes reported. */
function playedGame(): GameEvents {
  const h = table({ players: ['werewolf', 'tanner', 'seer', 'villager'] });
  const events: RecapEvent[] = [];
  let ts = 1;
  const record = (before: NightfallState) => {
    for (const ev of insights(before, h.state, null, null)) events.push(recapEventOf(ev, ts++));
  };
  let before = h.state;
  h.toStep('seer');
  h.tick(); // The Seer sleeps through her turn: the timer looks for her.
  record(before);
  before = h.state;
  h.vote(votes('A,C,D>B; B>A'));
  record(before);
  expect(h.state.stage).toBe('reveal');
  return fixtureGame(events, { players: ['A', 'B', 'C', 'D'] });
}

describe('Nightfall awards on a real game', () => {
  it('finds the tanner’s dream and tells the game', () => {
    const g = playedGame();
    const found = nightfallAwards.rules.flatMap((r) => (r.compute?.(g) ?? []).map(() => r.id));
    expect(found).toEqual(
      expect.arrayContaining(['nf.living-the-dream', 'nf.tanner-win', 'nf.sleepwalker']),
    );
    expect(nightfallAwards.rules.find((r) => r.id === 'nf.living-the-dream')!.compute!(g)).toEqual([
      { players: ['B'], value: 1, params: { role: 'tanner' } },
    ]);
    const history = nightfallAwards.history!(g);
    expect(history[0]).toMatch(/^Ended with a happy tanner; tanner won/);
    expect(history).toContain('{p:B} died as {role:tanner}');
    const nuggets = nightfallAwards.nuggets.flatMap((n) => n.compute([g]) ?? []);
    expect(nuggets.length).toBeGreaterThan(0);
  });
});
