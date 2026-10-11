import {
  type AwardCandidate,
  type AwardRule,
  type GameEvents,
  type RecapEvent,
  TONES,
  createRng,
  fixtureGame,
  recapEv,
  recapEventOf,
  renderCopy,
} from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { royalPostAwards } from './awards.ts';
import { autoMove } from './game.ts';
import { insights } from './insights.ts';
import { HOST, startedGame } from './test-utils.ts';

const rule = (id: string): AwardRule => {
  const r = royalPostAwards.rules.find((x) => x.id === `rp.${id}`);
  if (!r) throw new Error(`no rule ${id}`);
  return r;
};
const run = (id: string, events: RecapEvent[], players = ['a', 'b', 'c']): AwardCandidate[] =>
  rule(id).compute!(fixtureGame(events, { players }));

const play = (by: string, card: string, props: Record<string, unknown> = {}) =>
  recapEv('play', by, { card, edition: 'classic', noEffect: false, ...props });
const guard = (by: string, hit: boolean) => recapEv('guard', by, { hit, guess: 'king' });
const out = (who: string, cause: string, by: string | null, props: Record<string, unknown> = {}) =>
  recapEv('elimination', who, { cause, by, lostPrincess: false, ...props });
const round = (n: number, winners: string[], props: Record<string, unknown> = {}) =>
  recapEv('round', null, {
    round: n,
    reason: 'deck-empty',
    roundWinners: winners,
    spy: null,
    ...props,
  });

describe('Royal Post award rules', () => {
  it('Royal Favourite: most round wins, ties shared, more than three dropped', () => {
    expect(
      run('royal-favourite', [round(1, ['a']), round(2, ['a']), round(3, ['b'])])[0],
    ).toMatchObject({ players: ['a'], value: 2 });
    expect(run('royal-favourite', [round(1, ['a']), round(2, ['b'])])).toEqual([]);
    expect(
      run('royal-favourite', [round(1, ['a', 'b']), round(2, ['a', 'b'])])[0]!.players,
    ).toEqual(['a', 'b']);
    const four = ['a', 'b', 'c', 'd'];
    expect(run('royal-favourite', [round(1, four), round(2, four)], four)).toEqual([]);
  });

  it('Lucky Guard and Swing and a Miss read Guard guesses', () => {
    expect(run('lucky-guard', [guard('a', true), guard('b', false)])[0]!.players).toEqual(['a']);
    expect(run('lucky-guard', [guard('a', false)])).toEqual([]);
    const misses = [guard('b', false), guard('b', false), guard('b', false)];
    expect(run('swing-and-a-miss', misses)[0]).toMatchObject({
      players: ['b'],
      value: 3,
      params: { role: 'guard' },
    });
    expect(run('swing-and-a-miss', misses.slice(1))).toEqual([]);
  });

  it('Princess Fumbler and Royal Self-Own tell a knock-out from a discard', () => {
    const knocked = out('a', 'guard', 'b', { lostPrincess: true });
    const self = out('c', 'princess', 'c', { lostPrincess: true });
    expect(run('princess-fumbler', [knocked, self])[0]!.players).toEqual(['a']);
    expect(run('royal-self-own', [knocked, self])[0]!.players).toEqual(['c']);
    expect(run('royal-self-own', [knocked])).toEqual([]);
  });

  it('Duelist credits the Baron winner; Dead Heat a tied Baron', () => {
    expect(run('duelist', [out('b', 'baron', 'a'), out('c', 'baron', 'a')])[0]).toMatchObject({
      players: ['a'],
      value: 2,
    });
    expect(run('duelist', [out('b', 'guard', 'a')])).toEqual([]);
    expect(run('dead-heat', [play('a', 'baron', { tie: true })])[0]!.players).toEqual(['a']);
    expect(run('dead-heat', [play('a', 'baron', { tie: false })])).toEqual([]);
  });

  it('Most Wanted needs three aims and the new target prop', () => {
    const aims = ['a', 'c', 'a'].map((by) => play(by, 'guard', { target: 'b' }));
    expect(run('most-wanted', aims)[0]).toMatchObject({ players: ['b'], value: 3 });
    expect(run('most-wanted', aims.slice(1))).toEqual([]);
    // Old events had no target: no candidate, no throw.
    expect(
      run('most-wanted', [play('a', 'guard'), play('c', 'guard'), play('a', 'guard')]),
    ).toEqual([]);
  });

  it('Spy Bonus and Spy Decides It', () => {
    expect(run('spy-bonus', [recapEv('spy', 'a')])[0]).toMatchObject({
      players: ['a'],
      params: { role: 'spy' },
    });
    const g = fixtureGame([round(1, ['b']), round(2, ['b'], { spy: 'b' })], {
      players: ['a', 'b'],
      winners: ['b'],
    });
    expect(rule('spy-decider').compute!(g)[0]!.players).toEqual(['b']);
    expect(rule('spy-decider').compute!({ ...g, winners: ['a'] })).toEqual([]);
  });

  it('Last One Standing counts last-standing rounds', () => {
    const r = (w: string) => round(1, [w], { reason: 'last-standing' });
    expect(run('last-one-standing', [r('a'), r('a'), r('b')])[0]!.players).toEqual(['a']);
    expect(run('last-one-standing', [round(1, ['a'])])).toEqual([]);
  });

  it('Comeback Courtier: last after a round, winner at the end', () => {
    const rounds = [round(1, ['a']), round(2, ['b']), round(3, ['c']), round(4, ['c'])];
    const g = fixtureGame(rounds, { players: ['a', 'b', 'c'], winners: ['c'] });
    expect(rule('comeback-courtier').compute!(g)[0]!.players).toEqual(['c']);
    expect(rule('comeback-courtier').compute!({ ...g, winners: ['a'] })).toEqual([]);
    // Too short a game to come back in.
    expect(
      rule('comeback-courtier').compute!(fixtureGame(rounds.slice(2), { winners: ['c'] })),
    ).toEqual([]);
  });

  it('Hide and Seek and Autopilot', () => {
    expect(run('hide-and-seek', [play('a', 'handmaid'), play('a', 'handmaid')])[0]).toMatchObject({
      players: ['a'],
      params: { role: 'handmaid' },
    });
    expect(run('hide-and-seek', [play('a', 'handmaid')])).toEqual([]);
    expect(run('autopilot', [play('a', 'guard', { auto: true })])[0]!.players).toEqual(['a']);
    expect(run('autopilot', [play('a', 'guard')])).toEqual([]);
    expect(rule('autopilot').stripOnly).toBe(true);
  });

  it('Opening Strike and Princess Down are moments', () => {
    const strike = [round(1, ['a']), play('a', 'guard'), guard('a', true), play('b', 'priest')];
    expect(run('opening-strike', strike)[0]!.players).toEqual(['a']);
    expect(
      run('opening-strike', [play('b', 'priest'), play('a', 'guard'), guard('a', true)]),
    ).toEqual([]);
    const down = out('b', 'prince', 'a', { lostPrincess: true });
    expect(run('princess-down', [down])[0]).toMatchObject({
      players: ['b'],
      params: { role: 'princess', role2: 'prince' },
    });
  });

  it('every rule survives an empty game', () => {
    const empty = fixtureGame([], { players: ['a', 'b'] });
    for (const r of royalPostAwards.rules) expect(r.compute?.(empty) ?? []).toEqual([]);
    for (const n of royalPostAwards.nuggets) expect(n.compute([empty])).toBeNull();
  });

  it('has two variants per tone, each short with a 12-letter name', () => {
    const name = 'Abcdefghijkl';
    for (const r of royalPostAwards.rules) {
      for (const tone of TONES) {
        expect(r.copy[tone].length, `${r.id} ${tone}`).toBeGreaterThanOrEqual(2);
        for (const t of r.copy[tone]) {
          const text = renderCopy(t, {
            players: ['x'],
            value: 12,
            params: { m: 14, role: 'r', role2: 'r' },
          })
            .replace(/\{p:[^}]+\}/g, name)
            .replace(/\{role:[^}]+\}/g, 'Chancellor');
          expect(text.length, text).toBeLessThanOrEqual(70);
        }
      }
    }
  });
});

/** Plays a whole seeded game with the timer's own moves, collecting what `insights` reported. */
function playedGame(): GameEvents {
  const h = startedGame(['host', 'ana', 'ben'], '2019', { short: true });
  const rng = createRng(3);
  const events: RecapEvent[] = [];
  let ts = 1;
  for (let i = 0; i < 2000 && h.state.phase === 'playing'; i++) {
    const before = h.state;
    const round = before.round!;
    const action =
      round.stage === 'over' ? { type: 'next-round' as const } : autoMove(before, rng)!;
    const by = round.stage === 'over' ? HOST : round.current;
    h.act(action, by);
    for (const ev of insights(before, h.state, action, by)) events.push(recapEventOf(ev, ts++));
  }
  expect(h.state.phase).toBe('over');
  return fixtureGame(events, { players: ['host', 'ana', 'ben'] });
}

describe('Royal Post awards on a real game', () => {
  it('finds awards and tells the rounds', () => {
    const g = playedGame();
    expect(g.of('round').length).toBeGreaterThan(1);
    expect(g.of('round')[0]!.props.survivors).toBeDefined();
    expect(g.of('outcome')[0]!.props.ranking).toHaveLength(3);
    const found = royalPostAwards.rules.flatMap((r) => (r.compute?.(g) ?? []).map(() => r.id));
    // The seeded game: Spy bonuses, a last-standing round and a Baron tie.
    expect(found).toEqual(
      expect.arrayContaining(['rp.spy-bonus', 'rp.last-one-standing', 'rp.dead-heat']),
    );
    const history = royalPostAwards.history!(g);
    expect(history.length).toBe(g.of('round').length);
    expect(history[0]).toMatch(/^Round 1: /);
    const nuggets = royalPostAwards.nuggets.flatMap((n) => n.compute([g]) ?? []);
    expect(nuggets.length).toBeGreaterThan(0);
  });
});
