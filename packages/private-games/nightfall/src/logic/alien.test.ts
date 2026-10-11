import { createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { buildNightPlan, publicPlan, stepFactor } from './plan.ts';
import { SCENARIOS, scenarioRoles } from './presets.ts';
import { ROLES, ROLE_IDS, type RoleId, hostileGroupsIn } from './roles.ts';
import {
  DEFAULT_WEIGHTS,
  type WeightTable,
  type PlayerSet,
  type Weights,
  blobMembers,
  blobOptions,
  pickFor,
  pickRipple,
  playersIn,
  weightsOf,
} from './tables.ts';
import { setupProblem } from './game.ts';
import { type Harness, dead, table, votes, winners } from './test-utils.ts';
import { MAX_PLAYERS, VOTE_APP } from './types.ts';

// The Alien set and Bonus Pack 3: the rules spec's §5 cases (T53–T62, T72–T73, T84, T86, T87),
// each role's step, every copy, the random tables, ripples and player numbers.

const W = 'werewolf';
const V = 'villager';

/** Weights that make one entry of a table certain. */
const only = (t: WeightTable, key: string): Weights => ({
  [t]: Object.fromEntries(Object.keys(DEFAULT_WEIGHTS[t]).map((k) => [k, k === key ? 1 : 0])),
});
const ws = (...all: Weights[]): Weights => all.reduce<Weights>((a, b) => ({ ...a, ...b }), {});
const STARE = only('alien', 'stare');
const NO_RIPPLE = only('ripple', 'none');

const actors = (h: Harness) => [...h.state.round!.night!.actors];
const notes = (h: Harness, p: string) => h.state.round!.notes[p] ?? [];
const last = (h: Harness, p: string) => notes(h, p).at(-1);
const told = (h: Harness, p: string) => h.view(p).night!.acting?.told;

describe('the Alien set’s cases (§5)', () => {
  it('T53: an epic battle with four sides kills both tied for the most votes', () => {
    const h = table({
      players: ['alien', 'alien', W, W, 'vampire', 'vampire', V, V],
      settings: { weights: ws(STARE, NO_RIPPLE) },
    });
    h.toStep('vampires');
    h.night('E', { players: ['H'] });
    h.vote(votes('A,B,F>G; C,D,G>E; E>A; H>C'));
    expect(h.state.round!.result!.epic).toBe(true);
    expect(dead(h)).toBe('EG');
    expect(winners(h)).toBe('ABCD');
  });

  it('T54: an alien voted out loses the aliens the game', () => {
    const h = table({
      players: ['alien', 'alien', 'seer', V, V],
      settings: { weights: ws(STARE, NO_RIPPLE) },
    });
    h.vote(votes('B,C,D,E>A; A>C'));
    expect(dead(h)).toBe('A');
    expect(winners(h)).toBe('CDE');
  });

  it('T55: the Synthetic Alien wins by dying, and the aliens and village lose', () => {
    const h = table({
      players: ['alien', 'synthetic-alien', 'seer', V, V],
      settings: { weights: ws(STARE, NO_RIPPLE) },
    });
    h.toStep('aliens');
    expect(actors(h)).toEqual(['A', 'B']);
    h.vote(votes('A,C,D,E>B; B>A'));
    expect(dead(h)).toBe('B');
    expect(winners(h)).toBe('B');
  });

  it('T56: Groob and Zerb see each other; Zerb dies, so Groob and the village win', () => {
    const h = table({
      players: ['groob', 'zerb', 'alien', 'leader', V, 'seer'],
      settings: { weights: ws(STARE, NO_RIPPLE) },
    });
    h.toStep('groob-zerb');
    expect(actors(h)).toEqual(['A', 'B']);
    expect(last(h, 'A')).toMatchObject({ kind: 'group', group: 'groob-zerb', players: ['A', 'B'] });
    h.toStep('leader');
    expect(notes(h, 'D').slice(-2)).toMatchObject([
      { kind: 'thumbs', of: 'aliens', players: ['A', 'B', 'C'] },
      { kind: 'thumbs', of: 'groob-zerb', players: ['A', 'B'] },
    ]);
    h.vote(votes('A,C,E>B; B>A; D>E; F>E'));
    expect(dead(h)).toBe('B');
    expect(winners(h)).toBe('AEF');
    const teams = h.state.round!.result!.teams;
    expect(teams.find((t) => t.team === 'groob')).toMatchObject({ won: true });
    expect(teams.find((t) => t.team === 'leader')).toMatchObject({ won: false });
  });

  it('T57: every alien voting for the Leader wins it for the aliens, even with one dead', () => {
    const h = table({
      players: ['alien', 'alien', 'leader', V, 'seer'],
      settings: { weights: ws(STARE, NO_RIPPLE) },
    });
    h.vote(votes('A,B>C; C,D,E>A'));
    expect(dead(h)).toBe('A');
    expect(h.state.round!.result!.leaderRule).toBe(true);
    expect(winners(h)).toBe('AB');
  });

  it('T58: a Blob member dies, so the Blob loses', () => {
    const h = table({ players: ['blob', V, W, V, 'seer'] });
    h.toStep('blob');
    h.state.round!.blob = { left: 2, right: 0 };
    h.vote(votes('B,D,E>C; C>B; A>B'));
    expect(dead(h)).toBe('C');
    expect(h.state.round!.result!.blobs).toEqual([{ player: 'A', members: ['A', 'B', 'C'] }]);
    expect(winners(h)).toBe('BDE');
  });

  it('T59: the Mortician wins when a neighbour dies, even when only pretending', () => {
    const h = table({
      players: ['mortician', W, V, V, 'seer'],
      settings: { weights: only('mortician', 'pretend') },
    });
    h.toStep('mortician');
    expect(last(h, 'A')).toMatchObject({ kind: 'pretended' });
    h.vote(votes('C,D,E>B; B>C; A>C'));
    expect(dead(h)).toBe('B');
    expect(winners(h)).toBe('ACDE');
  });

  it('T60: the Oracle fails the number: everyone else wins because she dies', () => {
    const h = table({
      players: ['oracle', W, 'seer', V, V],
      settings: { weights: only('oracle', 'number') },
      seed: 2,
    });
    h.toStep('oracle');
    expect(told(h, 'A')).toEqual({ kind: 'oracle', question: 'number' });
    h.night('A', { choice: '7' });
    expect(h.state.round!.oracle).toMatchObject({ outcome: 'number:wrong', numberFail: true });
    h.vote(votes('B,C,D>A; A>B; E>B'));
    expect(dead(h)).toBe('A');
    expect(h.state.round!.result!.oracleRule).toBe('oracle');
    expect(winners(h)).toBe('BCDE');
  });

  it('T61: the Oracle joins the werewolves but doesn’t wake with them; she dies as one', () => {
    const h = table({
      players: ['oracle', W, 'seer', V, V],
      settings: { weights: only('oracle', 'werewolf-team') },
    });
    h.toStep('oracle');
    h.night('A', { choice: 'yes' });
    expect(last(h, 'A')).toMatchObject({ kind: 'oracle', outcome: 'werewolf-team:yes' });
    h.toStep('werewolves');
    expect(actors(h)).toEqual(['B']);
    h.vote(votes('C,D,E>A; A>C; B>C'));
    expect(dead(h)).toBe('A');
    expect(h.state.round!.result!.identities.A).toMatchObject({ role: 'oracle', team: 'werewolf' });
    expect(winners(h)).toBe('CDE');
  });

  it('T62: the Body Snatcher’s stolen card is an alien card, and its holder dies', () => {
    const h = table({
      players: ['body-snatcher', 'alien', V, 'seer', V],
      settings: { weights: ws(STARE, NO_RIPPLE, only('body-snatcher', 'steal')) },
    });
    h.toStep('aliens');
    expect(actors(h)).toEqual(['A', 'B']);
    h.toStep('body-snatcher');
    // He may not take the card of an alien he saw awake.
    const ids = h.view('A').night!.acting!.prompt!.players!.ids;
    expect(ids).not.toContain('B');
    h.state.round!.night!.picks![h.state.round!.night!.index] = {
      kind: 'body-snatcher',
      action: 'steal',
      from: { kind: 'any' },
    };
    h.night('A', { players: ['C'] });
    expect(h.state.round!.cards.A).toMatchObject({ role: V, alienCard: true });
    expect(h.role('C')).toBe('body-snatcher');
    h.vote(votes('A,B,D,E>C; C>A'));
    expect(dead(h)).toBe('C');
    expect(h.state.round!.result!.identities.A).toMatchObject({
      role: V,
      team: 'alien',
      alien: 'card',
    });
    expect(winners(h)).toBe('DE');
  });

  it('T72: Nostradamus stops on a werewolf, is announced on its team, and wins with it', () => {
    const h = table({ players: ['nostradamus', V, W, 'seer', V] });
    h.toStep('nostradamus');
    h.night('A', { players: ['B'] });
    h.night('A', { players: ['C'] });
    expect(h.view('A').night!.acting!.prompt).toBeNull();
    h.tick();
    expect(last(h, 'A')).toMatchObject({ kind: 'foretold', team: 'werewolf' });
    // Everyone hears the announcement, the same for all.
    for (const p of h.ids)
      expect(h.view(p).announcements.at(-1)).toMatchObject({
        kind: 'nostradamus',
        team: 'werewolf',
        doppel: false,
      });
    h.vote(votes('B,C,E>D; D>C; A>B'));
    expect(dead(h)).toBe('D');
    expect(winners(h)).toBe('AC');
  });

  it('T73: a dead Nostradamus loses, and his death doesn’t cost the werewolves', () => {
    const h = table({ players: ['nostradamus', V, W, 'seer', V] });
    h.toStep('nostradamus');
    h.night('A', { players: ['C'] });
    h.vote(votes('B,D,E>A; A>B; C>B'));
    expect(dead(h)).toBe('A');
    expect(winners(h)).toBe('C');
  });

  it('T84: the Exposer turns exactly as many centre cards as told, or none', () => {
    const h = table({
      players: ['exposer', W, V, V],
      settings: { weights: only('exposer', 'flip-2') },
    });
    h.toStep('exposer');
    expect(told(h, 'A')).toEqual({ kind: 'exposer', count: 2 });
    expect(h.nightReject('A', { center: [0] })).toBe('bad-count');
    h.night('A', { center: [0, 2] });
    h.dawn();
    expect(h.view('B').day!.centerUp).toEqual([
      { center: 0, role: V },
      { center: 2, role: V },
    ]);
  });

  it('T86: in a time loop everyone wakes as dealt; no Oracle, Blob or ripple comes round', () => {
    const h = table({
      players: ['robber', W, V, 'seer'],
      center: ['alien', 'oracle', 'blob'],
      settings: { weights: ws(STARE, only('ripple', 'repeat-night'), only('oracle', 'number')) },
    });
    h.toStep('robber');
    h.night('A', { players: ['B'] });
    h.toStep('ripple');
    const plan = h.state.round!.night!.plan;
    const loop = plan.slice(h.state.round!.night!.loopFrom);
    expect(loop).toEqual(buildNightPlan(h.state.settings.roles, { loop: true }));
    expect(loop).not.toContain('oracle');
    expect(loop).not.toContain('blob');
    expect(loop).not.toContain('ripple');
    // Every device works the same plan out from the announcement.
    expect(publicPlan(h.state.settings.roles, h.view('C').announcements)).toEqual(plan);
    h.tick();
    while (h.step() !== 'werewolves') h.tick();
    expect(actors(h)).toEqual(['B']);
    while (h.step() !== 'robber') h.tick();
    expect(actors(h)).toEqual(['A']);
  });

  it('T87: a ripple shuffle shows both cards, then shuffles them 50/50 (seeded)', () => {
    const swapped = new Set<boolean>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const h = table({
        players: ['seer', 'troublemaker', W, 'insomniac', 'mason'],
        center: ['alien', V, V],
        seed,
        settings: { weights: ws(STARE, only('ripple', 'shuffle')) },
      });
      h.toStep('ripple');
      const rp = h.state.round!.night!.ripple!;
      if (rp.key !== 'shuffle') throw new Error('not a shuffle');
      const [a, b] = rp.players.map((n) => h.ids[n - 1]!) as [string, string];
      const [ra, rb] = [h.state.round!.deal.players[a]!, h.state.round!.deal.players[b]!];
      expect(actors(h)).toEqual([a, b]);
      expect(last(h, a)).toMatchObject({ kind: 'shuffled', with: b, mine: ra, theirs: rb });
      expect(last(h, b)).toMatchObject({ kind: 'shuffled', with: a, mine: rb, theirs: ra });
      expect([h.role(a), h.role(b)].sort()).toEqual([ra, rb].sort());
      swapped.add(h.role(a) !== ra);
    }
    expect([...swapped].sort()).toEqual([false, true]);
  });
});

describe('the aliens’ step', () => {
  const aliensTable = (
    w: Weights,
    players: RoleId[] = ['alien', V, 'alien', 'cow', 'seer'],
    seed = 7,
  ) => table({ players, settings: { weights: ws(NO_RIPPLE, w) }, seed });

  it('every awake alien is told the instruction; the Cow is not', () => {
    const h = aliensTable(STARE);
    h.toStep('aliens');
    expect(actors(h)).toEqual(['A', 'C', 'D']);
    expect(told(h, 'A')).toEqual({ kind: 'alien', action: 'stare' });
    expect(told(h, 'D')).toBeUndefined();
    expect(notes(h, 'A')).toContainEqual(
      expect.objectContaining({ kind: 'group', group: 'aliens', players: ['A', 'C'] }),
    );
    // The aliens see the Cow's fist; the Cow, next to C, was tipped.
    expect(notes(h, 'A')).toContainEqual(
      expect.objectContaining({ kind: 'thumbs', of: 'cow', players: ['D'] }),
    );
    expect(last(h, 'D')).toMatchObject({ kind: 'tipped', tipped: true });
  });

  it('a Cow with no alien beside her is not tipped', () => {
    const h = aliensTable(STARE, ['alien', V, 'seer', 'cow', V]);
    h.toStep('aliens');
    expect(last(h, 'D')).toMatchObject({ kind: 'tipped', tipped: false });
  });

  it('view: each alien may look at one card of the players named', () => {
    const h = aliensTable(only('alien', 'view'));
    h.toStep('aliens');
    const night = h.state.round!.night!;
    night.picks![night.index] = { kind: 'alien', action: 'view', from: { kind: 'even' } };
    // Even numbers are B (2) and D (4); an alien never looks at its own card.
    expect(h.view('A').night!.acting!.prompt!.players!.ids).toEqual(['B', 'D']);
    expect(h.view('C').night!.acting!.prompt!.players!.ids).toEqual(['B', 'D']);
    h.night('A', { players: ['D'] });
    expect(last(h, 'A')).toMatchObject({ kind: 'saw', slot: { player: 'D' }, role: 'cow' });
    expect(h.view('C').night!.acting!.prompt).not.toBeNull();
  });

  it('all-view: one look for all of them, chosen by the first to confirm', () => {
    const h = aliensTable(only('alien', 'all-view'));
    h.toStep('aliens');
    const night = h.state.round!.night!;
    night.picks![night.index] = {
      kind: 'alien',
      action: 'all-view',
      from: { kind: 'numbers', numbers: [2, 4, 5] },
    };
    expect(h.view('A').night!.acting!.prompt!.players!.ids).toEqual(['B', 'D', 'E']);
    h.night('C', { players: ['E'] });
    expect(last(h, 'A')).toMatchObject({ kind: 'saw', slot: { player: 'E' }, role: 'seer' });
    expect(h.view('A').night!.acting!.prompt).toBeNull();
    // A late confirm from the other alien is no mistake: it just comes too late.
    h.night('A', { players: ['B'] });
  });

  it('show: every alien sees the others’ cards', () => {
    const h = aliensTable(only('alien', 'show'));
    h.toStep('aliens');
    expect(notes(h, 'A')).toContainEqual(
      expect.objectContaining({ kind: 'saw', slot: { player: 'C' }, role: 'alien' }),
    );
  });

  it('timer: the day is cut in half', () => {
    const h = aliensTable(only('alien', 'timer'));
    h.dawn();
    expect(h.view('B').day!.seconds).toBe(150);
    expect(h.state.round!.dayDeadline! - h.now).toBe(150_000);
  });

  it.each(['left', 'right'] as const)(
    '%s: the aliens pass their cards that way, round the aliens',
    (side) => {
      const h = aliensTable(only('alien', side), [
        'alien',
        V,
        'zerb',
        V,
        'synthetic-alien',
        'seer',
      ]);
      h.toStep('aliens');
      // A (1), C (3), E (5) are awake: "left" passes A→C→E→A.
      expect(h.role('A')).toBe(side === 'left' ? 'synthetic-alien' : 'zerb');
      expect(h.role('C')).toBe(side === 'left' ? 'alien' : 'synthetic-alien');
      expect(notes(h, 'A')).toContainEqual(
        expect.objectContaining({ kind: 'passed-card', side, to: side === 'left' ? 'C' : 'E' }),
      );
    },
  );

  it('a shielded alien card stays put when they pass', () => {
    const h = table({
      players: ['alien', 'sentinel', 'zerb', V, 'synthetic-alien'],
      settings: { weights: ws(NO_RIPPLE, only('alien', 'left')) },
    });
    h.toStep('sentinel');
    h.night('B', { players: ['C'] });
    h.toStep('aliens');
    expect(h.role('C')).toBe('zerb');
    expect(h.role('A')).toBe('synthetic-alien');
    expect(h.role('E')).toBe('alien');
  });

  it('new-alien: the named players put out fists; the tapped one is an alien from now on', () => {
    const h = aliensTable(only('alien', 'new-alien'), ['alien', V, 'seer', 'cow', V]);
    h.toStep('aliens');
    const night = h.state.round!.night!;
    expect(told(h, 'A')).toMatchObject({ kind: 'alien', action: 'new-alien' });
    const fists = h.view('A').night!.acting!.prompt!.players!.ids;
    expect(fists.length).toBeGreaterThan(0);
    expect(fists).not.toContain('A');
    const target = fists[0]!;
    for (const f of fists) expect(h.view(f).night!.acting).not.toBeNull();
    h.night('A', { players: [target] });
    expect(h.state.round!.aliens!.players).toEqual([target]);
    expect(last(h, target)).toMatchObject({ kind: 'fist', tapped: true, helper: false });
    expect(night.actors).toContain(target);
    h.vote(votes(`${target}>A; A>${target}`));
    expect(h.state.round!.result!.identities[target]).toMatchObject({
      team: 'alien',
      alien: 'player',
    });
  });

  it('alien-helper: the tapped player joins the aliens without being one', () => {
    const h = aliensTable(only('alien', 'alien-helper'), ['alien', V, 'seer', V, V]);
    h.toStep('aliens');
    const fists = h.view('A').night!.acting!.prompt!.players!.ids;
    h.tick();
    const helper = h.state.round!.aliens!.helpers[0]!;
    expect(fists).toContain(helper);
    expect(notes(h, helper)).toContainEqual(
      expect.objectContaining({ kind: 'fist', tapped: true, helper: true }),
    );
    // Untapped fists learn nobody tapped them.
    for (const f of fists.filter((x) => x !== helper))
      expect(notes(h, f)).toContainEqual(expect.objectContaining({ kind: 'fist', tapped: false }));
    h.vote(votes(`B,C,D,E>A; A>B`));
    expect(h.state.round!.result!.identities[helper]).toMatchObject({
      team: 'alien',
      alien: 'helper',
    });
    expect(h.state.round!.result!.identities[helper]!.group).toBeNull();
    expect(winners(h)).not.toContain(helper);
  });

  it('the Oracle’s "force the aliens to exchange" makes them pass left or right', () => {
    const h = table({
      players: ['oracle', 'alien', V, 'alien', 'seer'],
      settings: { weights: ws(NO_RIPPLE, only('oracle', 'alien-exchange')) },
    });
    h.toStep('oracle');
    h.night('A', { choice: 'yes' });
    h.toStep('aliens');
    const pick = told(h, 'B');
    expect(pick).toMatchObject({ kind: 'alien', forced: true });
    expect(['left', 'right']).toContain(pick?.kind === 'alien' && pick.action);
  });
});

describe('Groob, Zerb and the Leader', () => {
  it('with only Groob at the table, he plays with the aliens', () => {
    const h = table({
      players: ['groob', 'alien', V, 'seer', V],
      center: ['zerb', V, V],
      settings: { weights: ws(STARE, NO_RIPPLE) },
    });
    h.toStep('groob-zerb');
    expect(last(h, 'A')).toMatchObject({ kind: 'group', group: 'groob-zerb', players: ['A'] });
    h.vote(votes('A,B,D,E>C; C>A'));
    expect(h.state.round!.result!.identities.A!.team).toBe('alien');
    expect(winners(h)).toBe('AB');
  });

  it('the Leader alone is killed: the aliens (not Groob or Zerb) and the Leader win', () => {
    const h = table({
      players: ['groob', 'zerb', 'alien', 'leader', V, V],
      settings: { weights: ws(STARE, NO_RIPPLE) },
    });
    h.vote(votes('A,B,C>D; D>E; E>F; F>E'));
    expect(dead(h)).toBe('D');
    expect(winners(h)).toBe('CD');
  });

  it('a Leader without both rivals is a villager, and wins with the village', () => {
    const h = table({
      players: ['alien', 'leader', 'seer', V, V],
      settings: { weights: ws(STARE, NO_RIPPLE) },
    });
    h.toStep('leader');
    expect(last(h, 'B')).toMatchObject({ kind: 'thumbs', of: 'aliens', players: ['A'] });
    h.vote(votes('B,C,D>A; A>C; E>B'));
    expect(winners(h)).toBe('BCDE');
  });
});

describe('the other Alien roles', () => {
  it('the Psychic may look at the cards of the even or odd players named', () => {
    const h = table({
      players: ['psychic', W, V, 'seer', V, V],
      settings: { weights: only('psychic', 'view-2') },
    });
    h.toStep('psychic');
    const night = h.state.round!.night!;
    night.picks![night.index] = { kind: 'psychic', count: 2, from: { kind: 'odd' } };
    expect(h.view('A').night!.acting!.prompt!.players).toEqual({ ids: ['C', 'E'], min: 1, max: 2 });
    h.night('A', { players: ['C', 'E'] });
    expect(notes(h, 'A').filter((n) => n.kind === 'saw')).toHaveLength(2);
  });

  it.each([
    [{ kind: 'higher' }, ['D', 'E', 'F']],
    [{ kind: 'lower' }, ['A', 'B']],
    [{ kind: 'two-left' }, ['D', 'E']],
    [{ kind: 'two-right' }, ['A', 'B']],
  ] as const)('the Rascal swaps two players from %o', (from, ids) => {
    const h = table({
      players: [V, V, 'rascal', W, V, 'seer'],
      settings: { weights: only('rascal', 'troublemaker') },
    });
    h.toStep('rascal');
    const night = h.state.round!.night!;
    night.picks![night.index] = { kind: 'rascal', action: 'troublemaker', from };
    const pr = h.view('C').night!.acting!.prompt!;
    expect(pr.players).toEqual({ ids, min: 2, max: 2 });
    h.night('C', { players: ids.slice(0, 2) });
    expect(last(h, 'C')).toMatchObject({ kind: 'swapped' });
  });

  it('the Rascal as the Witch looks at a card, then must give it to a player', () => {
    const h = table({
      players: ['rascal', W, V, 'seer'],
      settings: { weights: only('rascal', 'witch') },
    });
    h.toStep('rascal');
    const night = h.state.round!.night!;
    night.picks![night.index] = { kind: 'rascal', action: 'witch', from: { kind: 'left' } };
    h.night('A', { players: ['B'] });
    expect(h.view('A').night!.acting!.prompt).toMatchObject({
      stage: 'rascal-give',
      mandatory: true,
    });
    expect(h.view('A').night!.acting!.prompt!.players!.ids).not.toContain('B');
    h.night('A', { players: ['A'] });
    expect(h.role('A')).toBe(W);
    expect(h.role('B')).toBe('rascal');
  });

  it('the Rascal as the Robber may rob from the centre and sees the new card', () => {
    const h = table({
      players: ['rascal', W, V, 'seer'],
      center: ['mason', V, V],
      settings: { weights: only('rascal', 'robber') },
    });
    h.toStep('rascal');
    const night = h.state.round!.night!;
    night.picks![night.index] = { kind: 'rascal', action: 'robber', from: { kind: 'center' } };
    h.night('A', { center: [0] });
    expect(last(h, 'A')).toMatchObject({ kind: 'took', slot: { center: 0 }, role: 'mason' });
  });

  it('the Rascal as the Drunk must swap without looking (at random when time runs out)', () => {
    const h = table({
      players: ['rascal', W, V, 'seer'],
      settings: { weights: only('rascal', 'drunk') },
    });
    h.toStep('rascal');
    const night = h.state.round!.night!;
    night.picks![night.index] = { kind: 'rascal', action: 'drunk', from: { kind: 'right' } };
    expect(h.view('A').night!.acting!.prompt).toMatchObject({
      mandatory: true,
      players: { ids: ['D'] },
    });
    h.tick();
    expect(h.role('D')).toBe('rascal');
  });

  it('the Rascal as the Village Idiot may move everyone’s card', () => {
    const h = table({
      players: ['rascal', W, V, 'seer'],
      settings: { weights: only('rascal', 'idiot') },
    });
    h.toStep('rascal');
    h.night('A', { side: 'left' });
    expect([h.role('B'), h.role('C'), h.role('D')]).toEqual(['seer', W, V]);
  });

  it('a restriction nobody fits makes the action impossible', () => {
    const h = table({
      players: ['rascal', W, V, 'seer'],
      settings: { weights: only('rascal', 'troublemaker') },
    });
    h.toStep('rascal');
    const night = h.state.round!.night!;
    night.picks![night.index] = { kind: 'rascal', action: 'troublemaker', from: { kind: 'lower' } };
    expect(h.view('A').night!.acting!.prompt!.players).toBeNull();
  });

  it('the Mortician looks at a neighbour’s card, his own, or both neighbours', () => {
    const h = table({
      players: [W, 'mortician', V, 'seer'],
      settings: { weights: only('mortician', 'both-cards') },
    });
    h.toStep('mortician');
    expect(h.view('B').night!.acting!.prompt!.players).toEqual({ ids: ['A', 'C'], min: 1, max: 2 });
    const night = h.state.round!.night!;
    night.picks![night.index] = {
      kind: 'mortician',
      action: 'one-card',
      from: { kind: 'yourself' },
    };
    expect(h.view('B').night!.acting!.prompt!.players!.ids).toEqual(['B']);
  });

  it('the Mortician wins with a dead neighbour, even when he dies himself', () => {
    const h = table({
      players: [W, 'mortician', V, 'seer', V],
      settings: { weights: only('mortician', 'pretend') },
    });
    h.vote(votes('C,D>B; B,E>A; A>C'));
    expect(dead(h)).toBe('AB');
    expect(winners(h)).toContain('B');
  });

  it('the Body Snatcher may be told to take a centre card, or only to pretend', () => {
    const h = table({
      players: ['body-snatcher', W, V, 'seer'],
      center: ['mason', V, V],
      settings: { weights: ws(STARE, NO_RIPPLE, only('body-snatcher', 'center')) },
    });
    h.toStep('body-snatcher');
    h.night('A', { center: [0] });
    expect(h.state.round!.cards.A).toMatchObject({ role: 'mason', alienCard: true });
    expect(h.state.round!.center[0]!.card.role).toBe('body-snatcher');
    const p = table({
      players: ['body-snatcher', W, V, 'seer'],
      settings: { weights: ws(STARE, NO_RIPPLE, only('body-snatcher', 'pretend')) },
    });
    p.toStep('body-snatcher');
    expect(last(p, 'A')).toMatchObject({ kind: 'pretended' });
    expect(p.view('A').night!.acting!.prompt).toBeNull();
  });

  it('the Empath sees where the named players point; they point with their eyes closed', () => {
    const h = table({
      players: ['empath', W, V, 'seer', V],
      settings: { weights: only('empath', 'suspicious') },
    });
    h.toStep('empath');
    const night = h.state.round!.night!;
    expect(told(h, 'A')).toMatchObject({ kind: 'empath', prompt: 'suspicious' });
    const pointers = actors(h).filter((p) => p !== 'A');
    for (const p of pointers) expect(h.view(p).night!.acting!.prompt!.stage).toBe('point');
    expect(night.actors).toContain('A');
    const [first, second] = pointers as [string, string?];
    h.night(first, { players: [first === 'B' ? 'C' : 'B'] });
    expect(last(h, 'A')).toMatchObject({ kind: 'saw-point', from: first });
    if (second) h.night(second, { pass: true });
    h.tick();
    expect(notes(h, 'A').filter((n) => n.kind === 'saw-point')).toHaveLength(pointers.length);
  });

  it('with the Empath in the centre, the named players still point', () => {
    const h = table({
      players: [V, W, V, 'seer'],
      center: ['empath', V, V],
      settings: { weights: only('empath', 'think') },
    });
    h.toStep('empath');
    const named = actors(h);
    expect(named.length).toBeGreaterThan(0);
    for (const p of named) expect(h.view(p).night!.acting!.prompt!.stage).toBe('point');
  });

  it('Nostradamus who looks at nobody gets a team at random, announced all the same', () => {
    const h = table({ players: ['nostradamus', V, W, 'seer'] });
    h.toStep('nostradamus');
    h.tick();
    const a = h.view('B').announcements.at(-1);
    expect(a).toMatchObject({ kind: 'nostradamus', doppel: false });
    expect(h.state.round!.cards.A!.foretold).toBeTruthy();
  });

  it('Nostradamus in the centre: the narrator still announces a team, at the same moment', () => {
    const h = table({ players: [V, W, 'seer', V], center: ['nostradamus', V, V] });
    h.toStep('nostradamus');
    expect(actors(h)).toEqual([]);
    h.tick();
    expect(h.view('A').announcements.at(-1)).toMatchObject({ kind: 'nostradamus' });
    expect(h.state.round!.center[0]!.card.foretold).toBeTruthy();
  });

  it('Nostradamus on an own-team card wins only if its holder does', () => {
    const h = table({
      players: ['nostradamus', 'mortician', W, 'seer', V],
      settings: { weights: only('mortician', 'pretend') },
    });
    h.toStep('nostradamus');
    h.night('A', { players: ['B'] });
    h.tick();
    expect(last(h, 'A')).toMatchObject({ kind: 'foretold', team: 'mortician' });
    h.vote(votes('A,B,D,E>C; C>A'));
    expect(h.state.round!.result!.identities.A!.foretold).toEqual({
      team: 'mortician',
      holder: 'B',
    });
    expect(winners(h)).toContain('A');
    expect(winners(h)).toContain('B');
  });
});

describe('the Oracle’s questions', () => {
  // The Renfield card in the centre lets the narrator ask about the vampires.
  const oracleTable = (
    q: string,
    seed = 2,
    center: RoleId[] = [V, 'mason', 'renfield'],
    players: RoleId[] = ['oracle', W, 'alien', 'seer', V, V],
  ) =>
    table({
      players,
      center,
      settings: { weights: ws(only('oracle', q), STARE, NO_RIPPLE) },
      seed,
    });

  it.each([
    ['werewolf-team', 'werewolf', 'werewolf'],
    ['vampire-team', 'vampire', 'vampire'],
  ] as const)('%s: yes makes her card a %s card', (q, team, group) => {
    const h = oracleTable(q);
    h.toStep('oracle');
    expect(h.view('A').night!.acting!.prompt!.choices).toEqual(['yes', 'no']);
    h.night('A', { choice: 'yes' });
    h.vote(votes('B,C,D,E,F>A; A>B'));
    expect(h.state.round!.result!.identities.A).toMatchObject({ role: 'oracle', team, group });
  });

  it('alien-team: yes makes her an alien card, or only an alien supporter', () => {
    const seen = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const h = oracleTable('alien-team', seed);
      h.toStep('oracle');
      h.night('A', { choice: 'yes' });
      seen.add(h.state.round!.oracle!.outcome!);
      h.vote(votes('B,C,D,E,F>A; A>B'));
      const id = h.state.round!.result!.identities.A!;
      expect(id.team).toBe('alien');
      expect(id.group).toBe(id.oracle === 'alien-card' ? 'alien' : null);
    }
    expect([...seen].sort()).toEqual(['alien-team:yes', 'alien-team:yes-helper']);
  });

  it('no keeps her on the village', () => {
    const h = oracleTable('werewolf-team');
    h.toStep('oracle');
    h.night('A', { choice: 'no' });
    expect(h.state.round!.oracle).toMatchObject({ outcome: 'team:no', mod: null });
  });

  it('view-center: she may look at as many centre cards as the narrator allows', () => {
    const counts = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const h = oracleTable('view-center', seed);
      h.toStep('oracle');
      h.night('A', { choice: 'yes' });
      const k = Number(h.state.round!.oracle!.outcome!.split(':')[1]);
      counts.add(String(k));
      expect(h.view('A').night!.acting!.prompt!.center).toMatchObject({ min: 1, max: k });
      h.night('A', { center: [0, 1, 2].slice(0, k) });
      expect(notes(h, 'A').filter((n) => n.kind === 'saw')).toHaveLength(k);
    }
    expect([...counts].sort()).toEqual(['1', '2', '3']);
  });

  it('center-exchange: on a yes she may have to swap with a centre card, or keep hers', () => {
    const seen = new Set<string>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const h = oracleTable('center-exchange', seed);
      h.toStep('oracle');
      h.night('A', { choice: 'yes' });
      const out = h.state.round!.oracle!.outcome!;
      seen.add(out);
      if (out === 'center-exchange:yes') {
        expect(h.view('A').night!.acting!.prompt).toMatchObject({ stage: 'take', mandatory: true });
        h.night('A', { center: [1] });
        expect(h.role('A')).toBe('mason');
      } else expect(h.view('A').night!.acting!.prompt).toBeNull();
    }
    expect([...seen].sort()).toEqual(['center-exchange:denied', 'center-exchange:yes']);
  });

  it('ripple: a yes guarantees a ripple', () => {
    const h = table({
      players: ['oracle', 'alien', V, 'seer'],
      settings: { weights: ws(STARE, only('oracle', 'ripple'), { ripple: { none: 100 } }) },
    });
    h.toStep('oracle');
    h.night('A', { choice: 'yes' });
    h.toStep('ripple');
    expect(h.state.round!.night!.ripple!.key).not.toBe('none');
  });

  it('even-odd: her answer is announced to everyone (she may lie)', () => {
    const h = oracleTable('even-odd');
    h.toStep('oracle');
    expect(h.view('A').night!.acting!.prompt!.choices).toEqual(['even', 'odd']);
    h.night('A', { choice: 'even' });
    expect(h.view('B').announcements).toEqual([]);
    h.tick();
    for (const p of h.ids)
      expect(h.view(p).announcements[0]).toMatchObject({ kind: 'oracle-parity', parity: 'even' });
  });

  it('view-player: she looks at the number she chose, or one the narrator picks; everyone hears whose', () => {
    const seen = new Set<boolean>();
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const h = oracleTable('view-player', seed);
      h.toStep('oracle');
      expect(h.view('A').night!.acting!.prompt!.choices).toEqual(['1', '2', '3', '4', '5', '6']);
      h.night('A', { choice: '4' });
      h.tick();
      const a = h.view('C').announcements[0];
      if (a?.kind !== 'oracle-view') throw new Error('no announcement');
      seen.add(a.swapped);
      if (!a.swapped) expect(a.number).toBe(4);
      else expect([1, 4]).not.toContain(a.number);
      expect(notes(h, 'A')).toContainEqual(
        expect.objectContaining({ kind: 'saw', slot: { player: h.ids[a.number - 1] } }),
      );
    }
    expect([...seen].sort()).toEqual([false, true]);
  });

  it('number: right keeps her eyes open for the rest of the night', () => {
    const h = oracleTable('number', 1);
    h.toStep('oracle');
    h.night('A', { choice: '3' });
    expect(h.state.round!.oracle!.outcome).toBe('number:right');
    h.toStep('aliens');
    h.tick();
    expect(last(h, 'A')).toMatchObject({ kind: 'watched', stepId: 'aliens', awake: ['C'] });
    expect(h.view('B').announcements[0]).toMatchObject({ kind: 'oracle-number', right: true });
  });

  it('with her card in the centre the narrator answers; a wrong number means everyone must live', () => {
    const h = table({
      players: [W, 'seer', V, V],
      center: ['oracle', V, V],
      settings: { weights: only('oracle', 'number') },
      seed: 2,
    });
    h.toStep('oracle');
    expect(actors(h)).toEqual([]);
    h.tick();
    const o = h.state.round!.oracle!;
    expect(o).toMatchObject({ centre: true, mod: null });
    if (o.outcome !== 'number:wrong') return;
    h.vote(votes('A>B; B>C; C>D; D>A'));
    expect(h.state.round!.result!.oracleRule).toBe('circle');
    expect(winners(h)).toBe('ABCD');
  });

  it('a Doppelgänger-Oracle doesn’t wake, and shares the Oracle’s new team', () => {
    const h = table({
      players: ['oracle', 'doppelganger', W, 'seer', V],
      settings: { weights: only('oracle', 'werewolf-team') },
    });
    h.toStep('oracle');
    h.night('A', { choice: 'yes' });
    h.toStep('doppelganger');
    h.night('B', { players: ['A'] });
    expect(h.view('B').night!.acting!.prompt).toBeNull();
    h.vote(votes('A,C,D,E>B; B>A'));
    expect(h.state.round!.result!.identities.B).toMatchObject({ role: 'oracle', team: 'werewolf' });
  });

  it('a Copycat-Oracle is always a plain Villager', () => {
    const h = table({ players: ['copycat', W, 'seer', V], center: ['oracle', V, V] });
    h.toStep('copycat');
    h.night('A', { center: [0] });
    h.vote(votes('A,C,D>B; B>A'));
    expect(h.state.round!.result!.identities.A!.role).toBe('villager');
  });
});

describe('the Blob', () => {
  it.each([
    [3, 1],
    [4, 1],
    [5, 2],
    [6, 2],
    [7, 3],
    [8, 3],
    [9, 4],
    [10, 4],
  ])('with %i players the Blob takes %i neighbours', (n, size) => {
    for (const s of blobOptions(n)) expect(s.left + s.right).toBe(size);
  });

  it('is counted from wherever the Blob card ends up', () => {
    const order = ['A', 'B', 'C', 'D', 'E', 'F'];
    expect(blobMembers(order, 'A', { left: 1, right: 1 }).sort()).toEqual(['A', 'B', 'F']);
    expect(blobMembers(order, 'C', { left: 0, right: 2 }).sort()).toEqual(['A', 'B', 'C']);
  });

  it('is announced to everyone, and nobody wakes', () => {
    const h = table({ players: ['blob', W, V, 'seer', V] });
    h.toStep('blob');
    expect(actors(h)).toEqual([]);
    for (const p of h.ids) expect(h.view(p).announcements.at(-1)).toMatchObject({ kind: 'blob' });
  });

  it('a Doppelgänger who copied the Blob is a Blob of her own, the same shape', () => {
    const h = table({ players: ['doppelganger', 'blob', W, 'seer', V] });
    h.toStep('doppelganger');
    h.night('A', { players: ['B'] });
    h.toStep('blob');
    h.state.round!.blob = { left: 1, right: 0 };
    h.vote(votes('A,B,D,E>C; C>A'));
    expect(h.state.round!.result!.blobs).toEqual([
      { player: 'A', members: ['A', 'B'] },
      { player: 'B', members: ['B', 'C'] },
    ]);
    expect(winners(h)).toContain('A');
    expect(winners(h)).not.toContain('B');
  });
});

const ALIEN_SET = ROLE_IDS.filter((r) => ROLES[r].set === 'alien' || ROLES[r].set === 'bonus3');

describe('the Doppelgänger copies every Alien and Bonus Pack 3 role', () => {
  /** A table where the Doppelgänger (A) copies `role` from B. */
  const copying = (role: RoleId, w: Weights = {}) => {
    const h = table({
      players: ['doppelganger', role, 'alien', V, 'seer'],
      center: [V, V, 'zerb'],
      settings: { weights: ws(STARE, NO_RIPPLE, w) },
    });
    h.toStep('doppelganger');
    h.night('A', { players: ['B'] });
    return h;
  };

  it.each(ALIEN_SET.filter((r) => ROLES[r].wakesWithAliens))(
    '%s: wakes with the aliens',
    (role) => {
      const h = copying(role);
      expect(h.view('A').night!.acting!.prompt).toBeNull();
      h.toStep('aliens');
      expect(actors(h)).toContain('A');
      expect(actors(h)).toContain('B');
    },
  );

  it('cow: puts out her fist with the Cow, while the aliens are awake', () => {
    const h = copying('cow');
    h.toStep('aliens');
    expect(actors(h)).toEqual(['A', 'B', 'C']);
    expect(last(h, 'A')).toMatchObject({ kind: 'tipped' });
  });

  it.each([
    'leader',
    'psychic',
    'rascal',
    'exposer',
    'mortician',
    'body-snatcher',
    'nostradamus',
  ] as RoleId[])('%s: wakes again right after the original, with a pick of her own', (role) => {
    const h = copying(role);
    h.toStep(role);
    expect(actors(h)).toEqual(['B']);
    const first = h.state.round!.night!.picks?.[h.state.round!.night!.index];
    h.toStep(`doppelganger-${role}`);
    expect(actors(h)).toEqual(['A']);
    const second = h.state.round!.night!.picks?.[h.state.round!.night!.index];
    if (first) expect(second).toBeDefined();
  });

  it('empath: watches her own pointing, after the Empath’s', () => {
    const h = copying('empath');
    h.toStep('doppelganger-empath');
    expect(actors(h)).toContain('A');
    expect(actors(h)).not.toContain('B');
  });

  it('body-snatcher: her own card is an Alien card too', () => {
    const h = copying('body-snatcher', only('body-snatcher', 'steal'));
    const anyone = () => {
      const night = h.state.round!.night!;
      night.picks![night.index] = { kind: 'body-snatcher', action: 'steal', from: { kind: 'any' } };
    };
    h.toStep('body-snatcher');
    anyone();
    h.night('B', { players: ['E'] });
    h.toStep('doppelganger-body-snatcher');
    anyone();
    h.night('A', { players: ['D'] });
    expect(h.state.round!.cards.A).toMatchObject({ role: V, alienCard: true });
    expect(h.state.round!.cards.D).toMatchObject({ role: 'doppelganger', alienCard: true });
  });

  it('nostradamus: her announcement names the Doppelgänger', () => {
    const h = copying('nostradamus');
    h.toStep('doppelganger-nostradamus');
    h.night('A', { players: ['C'] });
    h.tick();
    expect(h.view('D').announcements.at(-1)).toMatchObject({
      kind: 'nostradamus',
      doppel: true,
      team: 'alien',
    });
    expect(h.state.round!.cards.A!.foretold).toMatchObject({ team: 'alien' });
  });

  it('groob: wakes with the aliens and again with Zerb; she must kill her rival', () => {
    const h = table({
      players: ['doppelganger', 'groob', 'zerb', V, 'seer'],
      settings: { weights: ws(STARE, NO_RIPPLE) },
    });
    h.toStep('doppelganger');
    h.night('A', { players: ['B'] });
    h.toStep('groob-zerb');
    expect(actors(h)).toEqual(['A', 'B', 'C']);
    h.vote(votes('A,B,D,E>C; C>A'));
    expect(winners(h)).toContain('A');
    expect(winners(h)).toContain('B');
  });

  it('oracle and blob: nothing to do at night, and she plays as the copy', () => {
    for (const role of ['oracle', 'blob'] as RoleId[]) {
      const h = copying(role);
      expect(h.view('A').night!.acting!.prompt).toBeNull();
      h.vote(votes('B,C,D>E; E>A'));
      expect(h.state.round!.result!.identities.A!.role).toBe(role);
    }
  });
});

describe('the Copycat copies the Alien roles', () => {
  it.each([
    'psychic',
    'rascal',
    'exposer',
    'mortician',
    'nostradamus',
    'leader',
    'body-snatcher',
  ] as RoleId[])('%s: acts with the original, on the same instruction', (role) => {
    const h = table({
      players: ['copycat', role, 'alien', V],
      center: [role, V, V],
      settings: { weights: ws(STARE, NO_RIPPLE) },
    });
    // Two cards of a one-card role only to test the shared step: rig the centre's role.
    h.toStep('copycat');
    h.night('A', { center: [0] });
    h.toStep(role);
    expect(actors(h)).toEqual(['A', 'B']);
    const pick = h.state.round!.night!.picks?.[h.state.round!.night!.index];
    if (pick) expect(told(h, 'A')).toEqual(told(h, 'B'));
  });

  it('alien: wakes with the aliens', () => {
    const h = table({
      players: ['copycat', 'seer', V, V],
      center: ['alien', V, V],
      settings: { weights: ws(STARE, NO_RIPPLE) },
    });
    h.toStep('copycat');
    h.night('A', { center: [0] });
    h.toStep('aliens');
    expect(actors(h)).toEqual(['A']);
  });
});

describe('player numbers', () => {
  const order = ['A', 'B', 'C', 'D', 'E', 'F'];
  it.each([
    [{ kind: 'any' }, 'C', 'ABDEF'],
    [{ kind: 'even' }, 'C', 'BDF'],
    [{ kind: 'odd' }, 'C', 'AE'],
    [{ kind: 'numbers', numbers: [1, 3, 6] }, 'C', 'AF'],
    [{ kind: 'neighbours' }, 'A', 'BF'],
    [{ kind: 'left' }, 'F', 'A'],
    [{ kind: 'right' }, 'A', 'F'],
    [{ kind: 'yourself' }, 'D', 'D'],
    [{ kind: 'higher' }, 'D', 'EF'],
    [{ kind: 'lower' }, 'D', 'ABC'],
    [{ kind: 'higher' }, 'F', ''],
    [{ kind: 'two-left' }, 'E', 'AF'],
    [{ kind: 'two-right' }, 'B', 'AF'],
    [{ kind: 'everyone' }, null, 'ABCDEF'],
    [{ kind: 'even' }, null, 'BDF'],
  ] as const)('%o from %s: %s', (set, self, want) => {
    expect(playersIn(order, set as PlayerSet, self).join('')).toBe(want);
  });

  it('with three players, both neighbours are the same two players as everyone else', () => {
    expect(playersIn(['A', 'B', 'C'], { kind: 'neighbours' }, 'A').join('')).toBe('BC');
  });
});

describe('the random tables', () => {
  const ctx = (seed: number, weights?: Weights) => ({
    rng: createRng(seed),
    n: 6,
    weights,
    roles: ['alien', 'oracle', W, 'vampire', 'seer'] as RoleId[],
  });
  const TABLE_ROLE: Record<Exclude<WeightTable, 'ripple'>, RoleId> = {
    alien: 'alien',
    oracle: 'oracle',
    'body-snatcher': 'body-snatcher',
    psychic: 'psychic',
    rascal: 'rascal',
    exposer: 'exposer',
    mortician: 'mortician',
    empath: 'empath',
  };
  const keyOf = (pick: NonNullable<ReturnType<typeof pickFor>>): string => {
    switch (pick.kind) {
      case 'alien':
      case 'rascal':
      case 'body-snatcher':
      case 'mortician':
        return pick.action;
      case 'oracle':
        return pick.question;
      case 'psychic':
        return `view-${pick.count}`;
      case 'exposer':
        return `flip-${pick.count}`;
      case 'empath':
        return pick.prompt;
    }
  };

  it('replay the same from the same seed', () => {
    for (const [t, role] of Object.entries(TABLE_ROLE)) {
      const a = Array.from({ length: 20 }, (_, i) => pickFor(role, ctx(i)));
      const b = Array.from({ length: 20 }, (_, i) => pickFor(role, ctx(i)));
      expect(a, t).toEqual(b);
    }
  });

  it('can draw every entry of every table', () => {
    for (const [t, role] of Object.entries(TABLE_ROLE) as [
      Exclude<WeightTable, 'ripple'>,
      RoleId,
    ][])
      for (const key of Object.keys(DEFAULT_WEIGHTS[t])) {
        const pick = pickFor(role, ctx(1, only(t, key)));
        expect(pick && keyOf(pick), `${t}.${key}`).toBe(key);
      }
    for (const key of Object.keys(DEFAULT_WEIGHTS.ripple)) {
      const rp = pickRipple({
        rng: createRng(1),
        n: 6,
        present: [1, 2, 3, 4, 5, 6],
        weights: only('ripple', key),
        roles: ['alien', 'seer', 'witch'],
        guaranteed: false,
      });
      expect(rp.key, key).toBe(key);
    }
  });

  it('follow the default weights', () => {
    const draws = 4000;
    const counts: Record<string, number> = {};
    for (let i = 0; i < draws; i++) {
      const pick = pickFor('alien', ctx(i));
      if (pick?.kind === 'alien') counts[pick.action] = (counts[pick.action] ?? 0) + 1;
    }
    const total = weightsOf('alien', undefined).reduce((s, [, w]) => s + w, 0);
    for (const [k, w] of weightsOf('alien', undefined))
      expect(Math.abs((counts[k] ?? 0) / draws - w / total), k).toBeLessThan(0.03);
    expect(counts['new-alien'] ?? 0).toBe(0);
  });

  it('ask the Oracle only what the cards allow', () => {
    for (let i = 0; i < 300; i++) {
      const pick = pickFor('oracle', { ...ctx(i), roles: ['oracle', 'seer'] });
      expect([
        'werewolf-team',
        'vampire-team',
        'alien-team',
        'alien-exchange',
        'ripple',
      ]).not.toContain(pick?.kind === 'oracle' && pick.question);
    }
  });

  it('keep the time loop at single odds, and drop "no ripple" when one is guaranteed', () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 4000; i++) {
      const rp = pickRipple({
        rng: createRng(i),
        n: 6,
        present: [1, 2, 3, 4, 5, 6],
        weights: undefined,
        roles: ['alien'],
        guaranteed: true,
      });
      counts[rp.key] = (counts[rp.key] ?? 0) + 1;
    }
    expect(counts.none ?? 0).toBe(0);
    expect(Math.abs((counts['repeat-night'] ?? 0) / 4000 - 5 / 80)).toBeLessThan(0.02);
    expect(counts['repeat-role'] ?? 0).toBe(0);
  });

  it('name each player only once in a ripple', () => {
    for (let i = 0; i < 500; i++) {
      const rp = pickRipple({
        rng: createRng(i),
        n: 5,
        present: [1, 2, 3, 4, 5],
        weights: undefined,
        roles: ['alien'],
        guaranteed: true,
      });
      if (rp.key === 'troublemaker') expect(rp.between).not.toContain(rp.actor);
      if ('from' in rp && rp.from.kind === 'numbers' && 'actor' in rp)
        expect(rp.from.numbers).not.toContain(rp.actor);
      if (rp.key === 'shuffle') expect(new Set(rp.players).size).toBe(2);
    }
  });

  it('the host may change the weights, within limits, and reset them', () => {
    const h = table({ players: ['alien', V, 'seer'] });
    h.state = { ...h.state, stage: 'lobby', round: null };
    h.act({ type: 'update-settings', weights: { alien: { stare: 50 } } });
    expect(h.state.settings.weights).toEqual({ alien: { stare: 50 } });
    expect(h.reject({ type: 'update-settings', weights: { alien: { nope: 1 } } })).toBe(
      'bad-weights',
    );
    expect(h.reject({ type: 'update-settings', weights: { alien: { stare: 101 } } })).toBe(
      'bad-weights',
    );
    h.act({ type: 'update-settings', weights: {} });
    expect(h.state.settings.weights).toEqual({});
    expect(h.reject({ type: 'update-settings', weights: { alien: { stare: 1 } } }, 'B')).toBe(
      'not-host',
    );
  });
});

describe('ripples', () => {
  /** A table whose night ends in this ripple (the aliens' cards are in the centre). */
  const rippling = (
    key: string,
    players: RoleId[] = ['seer', V, W, 'robber', V],
    seed = 5,
    extra: Weights = {},
  ) => {
    const h = table({
      players,
      center: ['alien', V, V],
      seed,
      settings: { weights: ws(STARE, only('ripple', key), extra) },
    });
    h.toStep('ripple');
    return h;
  };
  const named = (h: Harness) => actors(h);

  it('come only with the aliens’ own cards, and never in the time loop', () => {
    expect(buildNightPlan(['cow', 'leader', 'oracle', 'psychic'])).not.toContain('ripple');
    expect(buildNightPlan(['body-snatcher', V])).toContain('ripple');
    expect(buildNightPlan(['alien', V], { loop: true })).not.toContain('ripple');
  });

  it('none: silence, and nothing changes', () => {
    const h = rippling('none');
    expect(h.view('A').announcements).toEqual([]);
    expect(actors(h)).toEqual([]);
  });

  it('are announced to everyone, the same for all', () => {
    const h = rippling('one-minute');
    const a = h.view('A').announcements;
    expect(a).toEqual([expect.objectContaining({ kind: 'ripple', ripple: { key: 'one-minute' } })]);
    for (const p of h.ids) expect(h.view(p).announcements).toEqual(a);
    expect(h.view(null).announcements).toEqual(a);
  });

  it('one-minute: the day lasts one minute', () => {
    const h = rippling('one-minute');
    h.dawn();
    expect(h.view('A').day!.seconds).toBe(60);
  });

  it('vote-for-app: the app may be voted for, and nobody dies if it has the most votes', () => {
    const h = rippling('vote-for-app');
    h.dawn();
    for (const id of h.ids) h.act({ type: 'ready-to-vote', ready: true }, id);
    expect(h.view('A').vote!.app).toBe(true);
    h.act({ type: 'vote', target: VOTE_APP }, 'A');
    h.act({ type: 'vote', target: VOTE_APP }, 'B');
    h.act({ type: 'vote', target: 'C' }, 'D');
    h.act({ type: 'vote', target: 'C' }, 'E');
    h.act({ type: 'vote', target: 'A' }, 'C');
    expect(h.state.round!.result!.appVotes).toBe(2);
    expect(dead(h)).toBe('');
  });

  it('the app can’t be voted for without that ripple', () => {
    const h = rippling('none');
    h.dawn();
    for (const id of h.ids) h.act({ type: 'ready-to-vote', ready: true }, id);
    expect(h.reject({ type: 'vote', target: VOTE_APP }, 'A')).toBe('bad-target');
    expect(h.reject({ type: 'vote', target: 'B', hand: 2 }, 'A')).toBe('one-hand');
  });

  it('two-hand-vote: the named players vote twice, and the vote waits for both hands', () => {
    const h = rippling('two-hand-vote', ['seer', V, W, 'robber', V], 5);
    const rp = h.state.round!.night!.ripple!;
    if (rp.key !== 'two-hand-vote') throw new Error(rp.key);
    const two = h.state.round!.rules!.twoVotes!;
    expect(two).toEqual(playersIn(h.ids, rp.who, null));
    const p = two[0]!;
    h.dawn();
    for (const id of h.ids) h.act({ type: 'ready-to-vote', ready: true }, id);
    expect(h.view(p).vote!.hands).toBe(2);
    for (const id of h.ids) h.act({ type: 'vote', target: id === 'C' ? 'A' : 'C' }, id);
    if (two.length) expect(h.state.stage).toBe('vote');
    for (const id of two) h.act({ type: 'vote', target: id === 'C' ? 'A' : 'C', hand: 2 }, id);
    expect(h.state.stage).toBe('reveal');
    const c = h.ids.filter((id) => id !== 'C').length + two.filter((id) => id !== 'C').length;
    expect(h.state.round!.result!.tally.C).toBe(c);
  });

  it.each(['i-am-alien', 'face-away', 'no-speak'])(
    '%s: the named players are shown the rule all day',
    (key) => {
      const h = rippling(key);
      h.dawn();
      const rules = h.view('A').day!.rules!;
      expect(rules.restrictions?.map((r) => r.kind)).toEqual([key]);
    },
  );

  it.each(['view-1', 'view-2'])('%s: one player may look at cards from the set named', (key) => {
    const h = rippling(key);
    const rp = h.state.round!.night!.ripple!;
    if (rp.key !== 'view-1' && rp.key !== 'view-2') throw new Error(rp.key);
    expect(named(h)).toEqual([h.ids[rp.actor - 1]]);
    const pr = h.view(named(h)[0]!).night!.acting!.prompt!;
    expect((pr.players ?? pr.center)!.max).toBeLessThanOrEqual(key === 'view-1' ? 1 : 2);
    expect(h.view(named(h)[0]!).night!.acting!.ripple).toEqual(rp);
  });

  it('dual-view: two players may each look at up to two cards', () => {
    const h = rippling('dual-view');
    expect(named(h)).toHaveLength(2);
  });

  it('insomniac: three players may look at their own card', () => {
    const h = rippling('insomniac');
    expect(named(h)).toHaveLength(3);
    const p = named(h)[0]!;
    expect(h.view(p).night!.acting!.prompt!.players!.ids).toEqual([p]);
    h.night(p, { players: [p] });
    expect(last(h, p)).toMatchObject({ kind: 'saw-own' });
  });

  it('troublemaker: one player may swap the two others named, without looking', () => {
    const h = rippling('troublemaker');
    const rp = h.state.round!.night!.ripple!;
    if (rp.key !== 'troublemaker') throw new Error(rp.key);
    const [x, y] = rp.between.map((n) => h.ids[n - 1]!) as [string, string];
    const [rx, ry] = [h.role(x), h.role(y)];
    h.night(named(h)[0]!, { players: [x, y] });
    expect([h.role(x), h.role(y)]).toEqual([ry, rx]);
  });

  it('steal: one player may rob a player from the set, and sees the new card', () => {
    const h = rippling('steal');
    const p = named(h)[0]!;
    const target = h.view(p).night!.acting!.prompt!.players?.ids[0];
    if (!target) return;
    const role = h.role(target);
    h.night(p, { players: [target] });
    expect(last(h, p)).toMatchObject({ kind: 'took', role });
  });

  it('drunk: one player must swap with a player from the set (at random if time runs out)', () => {
    const h = rippling('drunk');
    const p = named(h)[0]!;
    const pr = h.view(p).night!.acting!.prompt;
    if (!pr?.players) return;
    expect(pr.mandatory).toBe(true);
    const before = h.role(p);
    h.tick();
    expect(
      h.state.round!.cards[p]!.role === before && h.state.round!.deal.players[p] === before,
    ).toBe(false);
  });

  it('witch: one player may look at a centre card, then must give it away', () => {
    const h = rippling('witch');
    const p = named(h)[0]!;
    h.night(p, { center: [1] });
    const pr = h.view(p).night!.acting!.prompt;
    if (!pr) return;
    expect(pr).toMatchObject({ stage: 'ripple-give', mandatory: true });
    h.night(p, { players: [pr.players!.ids[0]!] });
    expect(last(h, p)).toMatchObject({ kind: 'gave', from: { center: 1 } });
  });

  it('reveal: one player may turn one fixed card face up; it stays if it is village', () => {
    const h = rippling('reveal');
    const p = named(h)[0]!;
    const pr = h.view(p).night!.acting!.prompt!;
    if (!pr.players) return;
    const target = pr.players.ids[0]!;
    h.night(p, { players: [target] });
    expect(last(h, p)).toMatchObject({ kind: 'revealed', target });
  });

  it('repeat-night: Marks are given again and shields placed again on the board as it is', () => {
    const h = table({
      players: ['vampire', 'sentinel', V, 'seer', V],
      center: ['alien', V, V],
      settings: { weights: ws(STARE, only('ripple', 'repeat-night')) },
    });
    h.toStep('vampires');
    h.night('A', { players: ['C'] });
    h.toStep('sentinel');
    h.night('B', { players: ['D'] });
    h.toStep('ripple');
    h.tick();
    while (h.step() !== 'vampires') h.tick();
    h.night('A', { players: ['E'] });
    expect(h.state.round!.marks!.E!.id).toBe('vampire');
    while (h.step() !== 'sentinel') h.tick();
    expect(h.view('B').night!.acting!.prompt!.players!.ids).not.toContain('D');
    h.night('B', { players: ['C'] });
    expect(h.state.round!.cards.C!.shield).not.toBeNull();
    expect(h.state.round!.cards.D!.shield).not.toBeNull();
  });

  it('repeat-observer: the named player keeps their eyes open through the loop', () => {
    const h = rippling('repeat-observer', ['seer', V, W, 'robber', V]);
    const rp = h.state.round!.night!.ripple!;
    if (rp.key !== 'repeat-observer') throw new Error(rp.key);
    const watcher = h.ids[rp.observer - 1]!;
    expect(h.state.round!.observers).toEqual([watcher]);
    h.dawn();
    const watched = notes(h, watcher).filter((n) => n.kind === 'watched');
    expect(watched.length).toBeGreaterThan(0);
    expect(watched.every((n) => n.step > h.state.round!.night!.loopFrom! - 1)).toBe(true);
  });

  it('repeat-role: the role (copies included) acts again, with fresh choices', () => {
    const h = table({
      players: ['doppelganger', 'psychic', W, V, V],
      center: ['synthetic-alien', V, V],
      settings: { weights: ws(STARE, only('ripple', 'repeat-role')) },
    });
    h.toStep('doppelganger');
    h.night('A', { players: ['B'] });
    h.toStep('ripple');
    const rp = h.state.round!.night!.ripple!;
    expect(rp).toEqual({ key: 'repeat-role', role: 'psychic' });
    expect(h.state.round!.night!.plan.at(-1)).toBe('repeat:psychic');
    h.tick();
    expect(h.step()).toBe('repeat:psychic');
    expect(actors(h)).toEqual(['A', 'B']);
    expect(told(h, 'B')).toMatchObject({ kind: 'psychic' });
  });

  it('repeat-role never names the Copycat or The Master', () => {
    for (let i = 0; i < 50; i++) {
      const rp = pickRipple({
        rng: createRng(i),
        n: 5,
        present: [1, 2, 3, 4, 5],
        weights: only('ripple', 'repeat-role'),
        roles: ['alien', 'copycat', 'the-master', 'seer'],
        guaranteed: false,
      });
      expect(rp.key).toBe('repeat-role');
      if (rp.key === 'repeat-role') expect(['seer', 'alien']).toContain(rp.role);
    }
  });
});

describe('epic battles with aliens', () => {
  it('aliens, werewolves and the village: two sides must lose a player for the village', () => {
    const h = table({
      players: ['alien', W, V, V, 'seer', V],
      settings: { weights: ws(STARE, NO_RIPPLE) },
    });
    h.vote(votes('C,D,E>B; B,F>A; A>C'));
    expect(h.state.round!.result!.epic).toBe(true);
    expect(dead(h)).toBe('AB');
    expect(winners(h)).toBe('CDEF');
  });

  it('only a werewolf dies: the aliens win, the village doesn’t', () => {
    const h = table({
      players: ['alien', W, V, V, 'seer', V],
      settings: { weights: ws(STARE, NO_RIPPLE) },
    });
    h.vote(votes('C,D,E,F>B; B>C; A>C'));
    expect(dead(h)).toBe('BC');
    expect(winners(h)).toBe('A');
  });

  it('a dead Tanner blocks the aliens too', () => {
    const h = table({
      players: ['alien', 'tanner', V, 'seer'],
      settings: { weights: ws(STARE, NO_RIPPLE) },
    });
    h.vote(votes('A,C,D>B; B>A'));
    expect(winners(h)).toBe('B');
  });

  it('the Alien Artifact makes its holder an Alien', () => {
    const h = table({
      players: ['curator', W, 'alien', V],
      settings: { weights: ws(STARE, NO_RIPPLE), artifacts: ['alien-artifact'] },
    });
    h.toStep('curator');
    h.night('A', { players: ['D'] });
    h.vote(votes('A,C,D>B; B>A'));
    expect(h.state.round!.result!.identities.D).toMatchObject({
      role: 'alien',
      team: 'alien',
      artifact: 'alien-artifact',
    });
  });
});

// ---- The security boundary and the clock ----

const EVERY_ROLE = ROLE_IDS.map((r) => `"${r}"`);

/** A full Alien table with random choices everywhere, recording every view. */
function playAlienNight(seed: number, rippleKey?: string) {
  const h = table({
    players: [
      'oracle',
      'alien',
      'cow',
      'synthetic-alien',
      'psychic',
      'rascal',
      'empath',
      'nostradamus',
      'mortician',
      'doppelganger',
    ],
    center: ['exposer', 'body-snatcher', 'blob'],
    seed,
    settings: rippleKey ? { weights: only('ripple', rippleKey) } : {},
  });
  const rng = createRng(seed);
  const views: {
    step: number;
    acting: Set<string>;
    views: Record<string, ReturnType<Harness['view']>>;
  }[] = [];
  const snap = () => {
    const night = h.state.round!.night!;
    views.push({
      step: night.index,
      acting: new Set(night.actors),
      views: Object.fromEntries(
        [...h.ids, 'watcher'].map((id) => [id, h.view(id === 'watcher' ? null : id)]),
      ),
    });
  };
  while (h.state.stage === 'night') {
    snap();
    for (const p of h.state.round!.night!.actors)
      for (let i = 0; i < 3; i++) {
        const pr = h.view(p).night?.acting?.prompt;
        if (!pr) break;
        const pick = pr.choices
          ? { choice: pr.choices[rng.int(pr.choices.length)]! }
          : pr.sides
            ? { side: rng.int(2) ? ('left' as const) : ('right' as const) }
            : pr.players && (!pr.center || rng.int(2))
              ? { players: rng.shuffle(pr.players.ids).slice(0, pr.players.min) }
              : pr.center
                ? { center: rng.shuffle(pr.center.slots).slice(0, pr.center.min) }
                : { pass: true as const };
        try {
          h.night(p, pick);
        } catch {
          break;
        }
        snap();
      }
    h.tick();
  }
  return { h, views };
}

describe('what each player is sent in an Alien night', () => {
  const runs: [number, string | undefined][] = [
    [1, undefined],
    [2, 'repeat-night'],
    [3, 'shuffle'],
    [4, 'repeat-role'],
    [5, 'view-2'],
  ];

  it.each(runs)(
    'names no card but your own, nor anyone’s instruction (seed %i, %s)',
    (seed, key) => {
      const { h, views } = playAlienNight(seed, key);
      for (const { views: byViewer, acting } of views)
        for (const [id, v] of Object.entries(byViewer)) {
          const { settings: _s, notes: _n, myRole: _m, announcements: _a, ...rest } = v;
          if (rest.night) rest.night = { ...rest.night, acting: null };
          const json = JSON.stringify(rest);
          for (const role of EVERY_ROLE) expect(json, `${id} sees ${role}`).not.toContain(role);
          for (const k of [
            '"cards"',
            '"center"',
            '"timeline"',
            '"seed"',
            '"work"',
            '"picks"',
            '"oracle"',
          ])
            expect(json).not.toContain(k);
          if (!acting.has(id)) expect(v.night!.acting).toBeNull();
          const own = new Set((h.state.round!.notes[id] ?? []).map((n) => n.id));
          for (const n of v.notes) expect(own.has(n.id)).toBe(true);
        }
    },
  );

  it.each(runs)(
    'is the same for everyone not acting, and never changes mid-step (seed %i, %s)',
    (seed, key) => {
      const { h, views } = playAlienNight(seed, key);
      const shared = (v: ReturnType<Harness['view']>) => {
        const { me: _me, myRole: _r, notes: _n, ...rest } = v;
        return JSON.stringify(rest);
      };
      for (const { acting, views: byViewer } of views) {
        const idle = [...h.ids, 'watcher'].filter((id) => !acting.has(id));
        const first = idle[0];
        if (!first) continue;
        for (const id of idle) expect(shared(byViewer[id]!), id).toBe(shared(byViewer[first]!));
      }
      for (const id of [...h.ids, 'watcher']) {
        let last: [number, string] | null = null;
        for (const { step, acting, views: byViewer } of views) {
          if (acting.has(id) || h.state.round!.observers?.includes(id)) {
            last = null;
            continue;
          }
          const now = JSON.stringify(byViewer[id]);
          if (last && last[0] === step) expect(now, `${id} at step ${step}`).toBe(last[1]);
          last = [step, now];
        }
      }
    },
  );

  it('runs every Alien step for its full length, whether or not anyone holds the card', () => {
    const roles: RoleId[] = [
      'oracle',
      'psychic',
      'rascal',
      'exposer',
      'empath',
      'nostradamus',
      'mortician',
      'leader',
    ];
    const durations = (players: RoleId[], center: RoleId[]) => {
      const h = table({
        players: [...players, 'alien'],
        center,
        settings: { stepSeconds: 10, weights: ws(STARE, NO_RIPPLE) },
      });
      const out: number[] = [];
      while (h.state.stage === 'night') {
        const start = h.now;
        for (const p of h.state.round!.night!.actors) {
          const pr = h.view(p).night!.acting?.prompt;
          if (pr && !pr.mandatory) h.night(p, { pass: true });
        }
        h.tick();
        out.push(h.now - start);
      }
      return out;
    };
    const held = durations(roles.slice(0, 5), roles.slice(5));
    const centred = durations(roles.slice(3, 8), roles.slice(0, 3));
    expect(centred).toEqual(held);
    const plan = buildNightPlan([...roles, 'alien']);
    expect(held.slice(1)).toEqual(plan.map((id) => stepFactor(id) * 10_000));
  });
});

describe('the Alien setups', () => {
  it('offer alien games, a full-table one and an epic battle with all three evil sides', () => {
    const alien = SCENARIOS.filter((p) => p.roles.some((r) => ROLES[r].alien));
    expect(alien.length).toBeGreaterThanOrEqual(4);
    for (const p of alien)
      expect(
        p.roles.some((r) => ROLES[r].wakesWithAliens),
        p.id,
      ).toBe(true);
    expect(alien.some((p) => hostileGroupsIn(p.roles).length === 3)).toBe(true);
    for (const p of alien)
      for (let n = p.minPlayers; n <= MAX_PLAYERS; n++) {
        const roles = scenarioRoles(p, n);
        if (roles) expect(setupProblem(roles, n), `${p.id} for ${n}`).toBeNull();
      }
  });
});
