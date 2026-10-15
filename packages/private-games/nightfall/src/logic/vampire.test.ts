import { createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { STEPS, buildNightPlan, isDusk, stepFactor, stepLines } from './plan.ts';
import { SCENARIOS, scenarioRoles } from './presets.ts';
import { MARK_IDS, ROLES, ROLE_IDS, type RoleId } from './roles.ts';
import { setupProblem } from './game.ts';
import { type Harness, dead, table, votes, winners } from './test-utils.ts';
import { MAX_PLAYERS } from './types.ts';
import type { NightfallView } from './types.ts';

// The Vampire set (wave 2): Marks, the dusk, the lovers, epic battles, and every copy of its
// roles. Seats are A, B, C…; the left of A is B. "X>Y" is X voting for Y.

const W = 'werewolf';
const V = 'villager';

const mark = (h: Harness, seat: string) => h.state.round!.marks?.[seat]?.id ?? null;
const lastNote = (h: Harness, seat: string) => h.state.round!.notes[seat]!.at(-1);
const actors = (h: Harness) => h.state.round!.night!.actors;

/** The vampires (any one of them) give their Mark to `target`. */
function vampiresMark(h: Harness, target: string) {
  h.toStep('vampires');
  h.night(actors(h)[0]!, { players: [target] });
}

describe('the dusk in the wake order', () => {
  it('runs the dusk and the Vampire steps only for the roles selected', () => {
    expect(
      buildNightPlan(['vampire', 'the-count', 'renfield', 'cupid', 'priest', 'gremlin', W, V]),
    ).toEqual([
      'vampires',
      'the-count',
      'renfield',
      'cupid',
      'priest',
      'dusk',
      'lovers',
      'werewolves',
      'gremlin',
    ]);
    // Marks in play without the narrator's dusk: nobody looks at a Mark (they're all Clarity).
    expect(buildNightPlan(['marksman', 'pickpocket', 'renfield', V])).toEqual([
      'renfield',
      'marksman',
      'pickpocket',
    ]);
    expect(
      buildNightPlan(['doppelganger', 'assassin', 'apprentice-assassin', 'the-count', V]),
    ).toEqual([
      'doppelganger',
      'vampires',
      'the-count',
      'doppelganger-the-count',
      'assassin',
      'apprentice-assassin',
      'doppelganger-apprentice-assassin',
      'doppelganger-assassin',
      'dusk',
    ]);
    expect(buildNightPlan(['copycat', V, V])).toEqual(['copycat']);
  });

  it('counts every step before the night proper as dusk', () => {
    for (const s of STEPS) expect(isDusk(s.id), s.id).toBe(s.order < 0);
    expect(isDusk('lovers')).toBe(true);
    expect(isDusk('sentinel')).toBe(false);
    expect(stepFactor('cupid')).toBe(2);
    expect(stepFactor('lovers')).toBe(1);
    expect(stepFactor('dusk')).toBe(1);
    expect(stepFactor('priest')).toBe(2);
    expect(stepFactor('marksman')).toBe(2);
  });

  it('narrates the vampire group, the Assassins and the dusk with the manifest’s keys', () => {
    const lines = (id: string, roles: RoleId[]) => stepLines(id, roles, { loneWolf: true });
    expect(lines('vampires', ['vampire'])).toEqual({
      open: ['vampire:wake'],
      close: ['vampire:close'],
    });
    expect(lines('vampires', ['vampire', 'renfield'])).toEqual({
      open: ['vampire:wake'],
      close: ['vampire:close:renfield'],
    });
    expect(lines('renfield', ['vampire', 'renfield']).close).toEqual([
      'renfield:close',
      'renfield:hands-away',
    ]);
    expect(lines('renfield', ['vampire', 'renfield', 'doppelganger']).close).toEqual([
      'renfield:close',
    ]);
    expect(lines('doppelganger-renfield', ['vampire', 'renfield', 'doppelganger']).close).toEqual([
      'doppelganger:renfield:close',
      'renfield:hands-away',
    ]);
    // Assassin + Apprentice, no Doppelgänger: one shared close after the Apprentice.
    const pair: RoleId[] = ['assassin', 'apprentice-assassin'];
    expect(lines('assassin', pair)).toEqual({ open: ['assassin:wake'], close: [] });
    expect(lines('apprentice-assassin', pair)).toEqual({
      open: ['apprentice-assassin:wake:with-assassin'],
      close: ['assassin:close:with-apprentice'],
    });
    // …with the Doppelgänger: the Assassin closes after her copy of the Apprentice.
    const all: RoleId[] = [...pair, 'doppelganger'];
    expect(lines('apprentice-assassin', all).close).toEqual(['apprentice-assassin:close']);
    expect(lines('doppelganger-apprentice-assassin', all)).toEqual({
      open: ['doppelganger:apprentice-assassin:wake:with-assassin'],
      close: ['doppelganger:apprentice-assassin:close', 'assassin:close'],
    });
    expect(lines('doppelganger-assassin', all)).toEqual({
      open: ['doppelganger:assassin:wake'],
      close: ['doppelganger:assassin:close'],
    });
    expect(lines('apprentice-assassin', ['apprentice-assassin']).open).toEqual([
      'apprentice-assassin:wake',
    ]);
    expect(lines('dusk', ['cupid'])).toEqual({ open: ['dusk:wake'], close: ['dusk:close'] });
    expect(lines('lovers', ['cupid'])).toEqual({ open: ['lovers:wake'], close: ['lovers:close'] });
    expect(lines('aura-seer', ['aura-seer', 'cupid']).open).toEqual(['aura-seer:wake:marks']);
    expect(lines('doppelganger-aura-seer', ['aura-seer', 'priest', 'doppelganger']).open).toEqual([
      'doppelganger:aura-seer:wake:marks',
    ]);
    expect(lines('copycat', ['copycat'])).toEqual({
      open: ['copycat:wake'],
      close: ['copycat:close'],
    });
  });
});

// ---- The rules spec's Vampire cases (§5) ----

describe('Vampire vote and win cases', () => {
  it('T36: a Vampire’s vote protects The Master; the next most voted dies', () => {
    const h = table({ players: ['the-master', 'vampire', V, V, V] });
    vampiresMark(h, 'E');
    h.vote(votes('B,C,D>A; A>C; E>C'));
    expect(h.state.round!.result!.protectedPlayers).toEqual(['A']);
    expect(dead(h)).toBe('C');
    expect(winners(h)).toBe('ABE');
  });

  it('T37: a lover dies, so the protected Master dies with her', () => {
    const h = table({ players: ['the-master', 'vampire', 'cupid', V, V, V] });
    vampiresMark(h, 'F');
    h.toStep('cupid');
    h.night('C', { players: ['A', 'D'] });
    h.vote(votes('B,D,E>A; A>D; C>D; F>E'));
    expect(dead(h)).toBe('AD');
    expect(h.state.round!.result!.deaths).toContainEqual({ player: 'A', cause: 'love', by: 'D' });
    expect(winners(h)).toBe('CDE');
  });

  it('T38: the Doppelgänger-Cupid’s lovers and Cupid’s are all linked', () => {
    const h = table({ players: ['doppelganger', 'cupid', W, V, V, V] });
    h.toStep('doppelganger');
    h.night('A', { players: ['B'] });
    h.night('A', { players: ['C', 'D'] });
    expect(h.state.round!.marks!.C).toEqual({ id: 'love', doppel: true });
    h.toStep('cupid');
    h.night('B', { players: ['E', 'F'] });
    expect(h.state.round!.marks!.E).toEqual({ id: 'love', doppel: false });
    h.vote(votes('A,B,C,D>E; E>A; F>A'));
    expect(dead(h)).toBe('CDEF');
    expect(winners(h)).toBe('ABDEF');
  });

  it('T39: voting for the Mark of Disease loses you the game', () => {
    const h = table({ players: ['diseased', W, V, V, V] });
    h.toStep('diseased');
    h.night('A', { side: 'left' });
    expect(mark(h, 'B')).toBe('disease');
    h.vote(votes('A,C,D>B; B>C; E>C'));
    expect(dead(h)).toBe('B');
    expect(h.state.round!.result!.teams.find((t) => t.team === 'village')!.won).toBe(true);
    expect(h.state.round!.result!.disqualified).toEqual(['A', 'C', 'D']);
    expect(winners(h)).toBe('E');
  });

  it('T40: the Traitor wins only if a teammate dies', () => {
    const h = table({ players: ['instigator', W, V, V, 'seer'] });
    h.toStep('instigator');
    h.night('A', { players: ['C'] });
    h.vote(votes('A,C,D,E>B; B>A'));
    expect(dead(h)).toBe('B');
    expect(winners(h)).toBe('ADE');
  });

  it('T41: the Assassin wins when the marked player dies, alongside the village', () => {
    const h = table({ players: ['assassin', W, V, V, V] });
    h.toStep('assassin');
    h.night('A', { players: ['D'] });
    h.vote(votes('B,C>D; A,D>B; E>C'));
    expect(dead(h)).toBe('BD');
    expect(winners(h)).toBe('ACDE');
  });

  it('T42: the Apprentice Assassin alone must place the Mark, and wins if it dies', () => {
    const h = table({ players: ['apprentice-assassin', W, V, V], center: ['assassin', V, V] });
    h.toStep('apprentice-assassin');
    expect(lastNote(h, 'A')).toMatchObject({ kind: 'group', group: 'assassins', players: [] });
    expect(h.view('A').night!.acting!.prompt).toMatchObject({
      stage: 'give-assassin',
      mandatory: true,
    });
    expect(h.nightReject('A', { pass: true })).toBe('mandatory');
    h.night('A', { players: ['B'] });
    h.vote(votes('A,C,D>B; B>A'));
    expect(winners(h)).toBe('ACD');
  });

  it('T43: a frightened Seer stays asleep', () => {
    const h = table({ players: ['the-count', 'vampire', 'seer', W, V] });
    vampiresMark(h, 'E');
    h.toStep('the-count');
    expect(h.view('A').night!.acting!.prompt!.players!.ids).toEqual(['C', 'D']);
    h.night('A', { players: ['C'] });
    h.toStep('seer');
    expect(actors(h)).toEqual([]);
    expect(h.nightReject('C', { players: ['A'] })).toBe('not-your-step');
    expect(h.view('C').night!.acting).toBeNull();
  });

  it('T44: a frightened Dream Wolf hides from the wolves but not from the Minion', () => {
    const h = table({ players: ['the-count', 'vampire', 'dream-wolf', W, 'minion', V] });
    vampiresMark(h, 'F');
    h.toStep('the-count');
    h.night('A', { players: ['C'] });
    h.toStep('werewolves');
    expect(lastNote(h, 'D')).toMatchObject({ kind: 'group', players: ['D'], thumbs: [] });
    expect(h.view('D').night!.acting!.prompt).toMatchObject({ stage: 'lone-wolf' });
    h.toStep('minion');
    expect(lastNote(h, 'E')).toMatchObject({ kind: 'thumbs', players: ['C', 'D'] });
  });

  it('T45: Renfield with no vampires sees nobody, takes the Bat, and is village', () => {
    const h = table({
      players: ['renfield', 'seer', V, V],
      center: ['vampire', 'the-master', 'the-count'],
    });
    h.toStep('vampires');
    expect(actors(h)).toEqual([]);
    h.toStep('renfield');
    expect(lastNote(h, 'A')).toMatchObject({ kind: 'saw-vampires', players: [], target: null });
    expect(mark(h, 'A')).toBe('bat');
    h.vote(votes('A>B; B>C; C>D; D>A'));
    expect(dead(h)).toBe('');
    expect(h.state.round!.result!.identities.A!.team).toBe('village');
    expect(winners(h)).toBe('ABCD');
  });

  it('T46: the Copycat becomes a centre Seer, and the Seer travels with his card', () => {
    const h = table({ players: ['copycat', W, V, 'robber', V], center: ['seer', V, V] });
    h.toStep('copycat');
    h.night('A', { center: [0] });
    expect(lastNote(h, 'A')).toMatchObject({ kind: 'copied-centre', center: 0, role: 'seer' });
    h.toStep('seer');
    expect(actors(h)).toEqual(['A']);
    h.night('A', { players: ['B'] });
    expect(lastNote(h, 'A')).toMatchObject({ kind: 'saw', role: W });
    h.toStep('robber');
    h.night('D', { players: ['A'] });
    expect(lastNote(h, 'D')).toMatchObject({ kind: 'robbed', role: 'copycat' });
    h.vote(votes('A,C,D,E>B; B>A'));
    expect(h.state.round!.result!.identities.D!.role).toBe('seer');
    expect(winners(h)).toBe('ACDE');
  });

  it('T47: a Copycat card that never woke is a plain Villager', () => {
    const h = table({ players: ['drunk', W, 'seer', V], center: ['copycat', V, V] });
    h.toStep('copycat');
    expect(actors(h)).toEqual([]);
    h.toStep('drunk');
    h.night('A', { center: [0] });
    h.vote(votes('A,C,D>B; B>A'));
    expect(h.state.round!.result!.identities.A!.role).toBe(V);
    expect(winners(h)).toBe('ACD');
  });

  it('T48: the Doppelgänger who copies the Copycat becomes its copy, and never wakes', () => {
    const h = table({
      players: ['copycat', 'doppelganger', W, V, 'troublemaker'],
      center: ['seer', V, V],
    });
    h.toStep('copycat');
    h.night('A', { center: [0] });
    h.toStep('doppelganger');
    h.night('B', { players: ['A'] });
    // She learns only the card she saw, not what the Copycat copied.
    expect(lastNote(h, 'B')).toEqual(
      expect.objectContaining({ kind: 'copied', role: 'copycat', blind: true }),
    );
    expect(JSON.stringify({ ...h.view('B'), settings: null })).not.toContain('"seer"');
    h.toStep('seer');
    expect(actors(h)).toEqual(['A']);
    h.vote(votes('A,B,D,E>C; C>A'));
    expect(h.state.round!.result!.identities.B).toMatchObject({ role: 'seer', team: 'village' });
  });

  it('T49: an epic battle kills first and second place', () => {
    const h = table({ players: [W, 'vampire', V, V, V, 'seer'] });
    vampiresMark(h, 'F');
    h.vote(votes('C,D,E>A; A>B; F>B; B>C'));
    const r = h.state.round!.result!;
    expect(r.epic).toBe(true);
    expect(r.deaths).toEqual([
      { player: 'A', cause: 'vote', place: 1 },
      { player: 'B', cause: 'vote', place: 2 },
    ]);
    expect(winners(h)).toBe('CDE');
  });

  it('T50: one vote is enough for second place, and ties for second all die', () => {
    const h = table({ players: [W, 'vampire', 'the-master', V, V, V] });
    vampiresMark(h, 'F');
    h.vote(votes('D,E,B>A; A>D; C>E; F>B'));
    expect(dead(h)).toBe('ABDE');
    expect(winners(h)).toBe('DE');
  });

  it('T51: a tie for most votes kills only those tied', () => {
    const h = table({ players: [W, 'vampire', 'the-master', V, V, V] });
    vampiresMark(h, 'F');
    h.vote(votes('D>A; E>A; A>B; F>B; B>C; C>D'));
    expect(dead(h)).toBe('AB');
    expect(winners(h)).toBe('DE');
  });

  it('T52: werewolves only in the centre is not an epic battle', () => {
    const h = table({ players: ['minion', 'vampire', V, V, V], center: [W, W, V] });
    vampiresMark(h, 'E');
    h.vote(votes('C,D>B; B>C; A>C; E>D'));
    expect(h.state.round!.result!.epic).toBe(false);
    expect(dead(h)).toBe('BC');
    expect(winners(h)).toBe('ACD');
  });

  it('T80: the Gremlin moves the Mark of the Vampire to someone else', () => {
    const h = table({ players: ['vampire', 'gremlin', V, V, V] });
    vampiresMark(h, 'C');
    h.toStep('gremlin');
    expect(h.view('B').night!.acting!.prompt).toMatchObject({ choices: ['marks', 'cards'] });
    h.night('B', { choice: 'marks' });
    h.night('B', { players: ['C', 'D'] });
    expect([mark(h, 'C'), mark(h, 'D')]).toEqual(['clarity', 'vampire']);
    h.vote(votes('A,B,D,E>C; C>A'));
    expect(dead(h)).toBe('C');
    expect(winners(h)).toBe('AD');
  });

  it('T81: the Priest wipes out the Mark of the Vampire', () => {
    const h = table({ players: ['vampire', 'priest', V, V, V] });
    vampiresMark(h, 'C');
    h.toStep('priest');
    expect(mark(h, 'B')).toBe('clarity');
    h.night('B', { players: ['C'] });
    expect(mark(h, 'C')).toBe('clarity');
    h.vote(votes('B,C,D,E>A; A>B'));
    expect(winners(h)).toBe('BCDE');
  });

  it('T82: a Prince with the Mark of the Vampire is a Vampire who can’t die', () => {
    const h = table({ players: ['vampire', 'prince', V, V, V] });
    vampiresMark(h, 'B');
    h.vote(votes('C,D,E>B; B>C; A>C'));
    expect(h.state.round!.result!.identities.B).toMatchObject({ role: 'prince', team: 'vampire' });
    expect(dead(h)).toBe('C');
    expect(winners(h)).toBe('AB');
  });

  it('T83: the Cudgel beats the Mark of the Vampire', () => {
    const h = table({
      players: ['vampire', 'prince', V, V, V, 'curator'],
      settings: { artifacts: ['cudgel-of-the-tanner'] },
    });
    vampiresMark(h, 'B');
    h.toStep('curator');
    h.night('F', { players: ['B'] });
    h.vote(votes('C,D,E,F>B; B>C; A>C'));
    expect(h.state.round!.result!.identities.B).toMatchObject({
      role: 'tanner',
      team: 'tanner',
      mark: 'vampire',
    });
    expect(dead(h)).toBe('B');
    expect(winners(h)).toBe('B');
  });

  it('T88: the two Love Marks go to two players, and a lone lover dies alone', () => {
    const h = table({ players: ['cupid', 'priest', W, 'seer'] });
    h.toStep('cupid');
    expect(h.nightReject('A', { players: ['B', 'B'] })).toBe('duplicate');
    expect(h.nightReject('A', { players: ['B'] })).toBe('bad-count');
    h.night('A', { players: ['B', 'C'] });
    // The Priest's own Clarity replaces his Love, so C is the only lover left.
    h.toStep('priest');
    expect(mark(h, 'B')).toBe('clarity');
    h.vote(votes('A,B,D>C; C>A'));
    expect(dead(h)).toBe('C');
  });
});

// ---- Each Vampire role's step ----

describe('Vampire role steps', () => {
  it('everyone starts with a Mark of Clarity; games without Vampire roles have none', () => {
    const h = table({ players: ['vampire', V, V] });
    expect(Object.values(h.state.round!.marks!)).toEqual([
      { id: 'clarity', doppel: false },
      { id: 'clarity', doppel: false },
      { id: 'clarity', doppel: false },
    ]);
    expect(table({ players: [W, V, V] }).state.round!.marks).toBeNull();
    // The Copycat alone doesn't bring Marks.
    expect(table({ players: ['copycat', W, V] }).state.round!.marks).toBeNull();
  });

  it('the vampires wake together and must mark one non-vampire; the first pick decides', () => {
    const h = table({ players: ['vampire', 'the-master', 'the-count', V, V] });
    h.toStep('vampires');
    expect(actors(h)).toEqual(['A', 'B', 'C']);
    expect(lastNote(h, 'B')).toMatchObject({ kind: 'group', players: ['A', 'B', 'C'] });
    expect(h.view('B').night!.acting!.prompt).toMatchObject({
      stage: 'give-vampire',
      mandatory: true,
      players: { ids: ['D', 'E'] },
    });
    expect(h.nightReject('A', { players: ['B'] })).toBe('bad-target');
    h.night('B', { players: ['D'] });
    expect(mark(h, 'D')).toBe('vampire');
    for (const p of ['A', 'C']) {
      expect(h.view(p).night!.acting!.prompt).toBeNull();
      expect(lastNote(h, p)).toMatchObject({ kind: 'marked', mark: 'vampire', targets: ['D'] });
    }
    // A fellow vampire's pick a moment too late is no error: it simply doesn't count.
    h.night('A', { players: ['E'] });
    expect(mark(h, 'D')).toBe('vampire');
    expect(mark(h, 'E')).toBe('clarity');
    expect(lastNote(h, 'A')).toMatchObject({ kind: 'marked', targets: ['D'], chosenBy: 'B' });
    // The Count's Fear can't go to a vampire or to the player they just marked.
    h.toStep('the-count');
    expect(h.view('C').night!.acting!.prompt!.players!.ids).toEqual(['E']);
  });

  it('the vampires’ Mark is placed at random when time runs out', () => {
    const h = table({ players: ['vampire', V, V, V] });
    h.toStep('vampires');
    h.tick();
    const marked = h.state.round!.order.filter((p) => mark(h, p) === 'vampire');
    expect(marked).toHaveLength(1);
    expect(marked[0]).not.toBe('A');
    expect(h.state.round!.notes.A!.find((n) => n.kind === 'marked')).toMatchObject({ auto: true });
  });

  it('Renfield sees the vampires and their pick, and takes the Bat', () => {
    const h = table({ players: ['vampire', 'renfield', V, V], center: ['the-count', V, V] });
    vampiresMark(h, 'D');
    h.toStep('renfield');
    expect(lastNote(h, 'B')).toMatchObject({ kind: 'saw-vampires', players: ['A'], target: 'D' });
    expect(mark(h, 'B')).toBe('bat');
    expect(h.view('B').night!.acting!.prompt).toBeNull();
  });

  it('Renfield wins with the vampires even if he dies, and loses if a vampire dies', () => {
    const won = table({ players: ['vampire', 'renfield', V, V, V] });
    vampiresMark(won, 'E');
    won.vote(votes('A,C,D>B; B>C; E>C'));
    expect(dead(won)).toBe('B');
    expect(winners(won)).toBe('ABE');
    const lost = table({ players: ['vampire', 'renfield', V, V, V] });
    vampiresMark(lost, 'E');
    lost.vote(votes('B,C,D>A; A>C; E>C'));
    expect(winners(lost)).toBe('CD');
  });

  it('a Renfield given the Mark of the Vampire loses it to his own Bat', () => {
    const h = table({ players: ['vampire', 'renfield', V, V] });
    vampiresMark(h, 'B');
    h.toStep('renfield');
    expect(mark(h, 'B')).toBe('bat');
  });

  it('the Diseased must mark a neighbour; time running out picks a side', () => {
    const h = table({ players: [V, 'diseased', V, V] });
    h.toStep('diseased');
    expect(h.view('B').night!.acting!.prompt).toMatchObject({ sides: true, mandatory: true });
    h.tick();
    expect(['A', 'C'].filter((p) => mark(h, p) === 'disease')).toHaveLength(1);
  });

  it('voting for the Diseased herself disqualifies too', () => {
    const h = table({ players: ['diseased', W, V, V, V] });
    h.toStep('diseased');
    h.night('A', { side: 'right' });
    expect(mark(h, 'E')).toBe('disease');
    h.vote(votes('B,C>A; A,D,E>B'));
    expect(dead(h)).toBe('B');
    expect(h.state.round!.result!.disqualified).toEqual(['B', 'C']);
    expect(winners(h)).toBe('ADE');
  });

  it('Cupid may pass, or give Love to himself', () => {
    const h = table({ players: ['cupid', V, W] });
    h.toStep('cupid');
    h.night('A', { players: ['A', 'C'] });
    expect([mark(h, 'A'), mark(h, 'C')]).toEqual(['love', 'love']);
    const p = table({ players: ['cupid', V, W] });
    p.toStep('cupid');
    p.night('A', { pass: true });
    expect(Object.values(p.state.round!.marks!).every((m) => m.id === 'clarity')).toBe(true);
  });

  it('the Instigator may mark himself; alone on a team, the Traitor changes nothing', () => {
    const h = table({ players: ['instigator', W, V, V] });
    h.toStep('instigator');
    h.night('A', { players: ['B'] });
    h.vote(votes('A,B,D>C; C>A'));
    // B is the only werewolf: his Mark of the Traitor has no effect.
    expect(dead(h)).toBe('C');
    expect(winners(h)).toBe('B');
  });

  it('the Priest must take Clarity, then may give another', () => {
    const h = table({ players: ['cupid', 'priest', V, V] });
    h.toStep('cupid');
    h.night('A', { players: ['B', 'C'] });
    h.toStep('priest');
    expect(mark(h, 'B')).toBe('clarity');
    expect(h.state.round!.notes.B!.at(-1)).toMatchObject({ kind: 'marked', targets: ['B'] });
    expect(h.view('B').night!.acting!.prompt).toMatchObject({ stage: 'give-clarity' });
    expect(h.nightReject('B', { players: ['B'] })).toBe('bad-target');
    h.tick();
    expect(mark(h, 'C')).toBe('love');
    // He did something, so time running out isn't "did nothing".
    expect(h.state.round!.notes.B!.some((n) => n.kind === 'passed')).toBe(false);
  });

  it('an Assassin who marks himself wins only by dying', () => {
    const h = table({ players: ['assassin', W, V, V] });
    h.toStep('assassin');
    h.night('A', { players: ['A'] });
    h.vote(votes('B,C,D>A; A>B'));
    expect(winners(h)).toBe('AB');
  });

  it('with no Mark of the Assassin in play, the Assassins are plain villagers', () => {
    const h = table({
      players: ['drunk', W, 'apprentice-assassin', V],
      center: ['assassin', V, V],
    });
    h.toStep('apprentice-assassin');
    h.night('C', { players: ['D'] });
    h.toStep('drunk');
    h.night('A', { center: [0] });
    h.vote(votes('A,C,D>B; B>A'));
    // An Assassin Mark is in play (the Apprentice's), and A now holds the Assassin card.
    expect(h.state.round!.result!.identities.A!.team).toBe('assassin');
    const none = table({ players: ['drunk', W, V, V], center: ['assassin', V, V] });
    none.toStep('drunk');
    none.night('A', { center: [0] });
    none.vote(votes('A,C,D>B; B>A'));
    expect(none.state.round!.result!.identities.A).toMatchObject({
      role: 'assassin',
      team: 'village',
    });
    expect(winners(none)).toBe('ACD');
  });

  it('the Assassin and the Apprentice see each other; she then has nothing to do', () => {
    const h = table({ players: ['assassin', 'apprentice-assassin', W, V] });
    h.toStep('assassin');
    h.night('A', { players: ['C'] });
    h.toStep('apprentice-assassin');
    expect(actors(h)).toEqual(['A', 'B']);
    expect(lastNote(h, 'B')).toMatchObject({ kind: 'group', group: 'assassins', players: ['A'] });
    expect(lastNote(h, 'A')).toMatchObject({ group: 'apprentices', players: ['B'] });
    expect(h.view('B').night!.acting!.prompt).toBeNull();
    // She wins when the Assassin dies (and the werewolf, with no wolf dead).
    h.vote(votes('B,C,D>A; A>C'));
    expect(winners(h)).toBe('BC');
  });

  it('the Marksman looks at one player’s Mark and another’s card, even a shielded one’s Mark', () => {
    const h = table({ players: ['marksman', 'vampire', V, 'sentinel'] });
    vampiresMark(h, 'C');
    h.toStep('sentinel');
    h.night('D', { players: ['C'] });
    h.toStep('marksman');
    expect(h.view('A').night!.acting!.prompt).toMatchObject({ stage: 'view-mark' });
    h.night('A', { players: ['C'] });
    expect(lastNote(h, 'A')).toMatchObject({ kind: 'saw-mark', target: 'C', mark: 'vampire' });
    // The card must be someone else's, and not a shielded one.
    expect(h.view('A').night!.acting!.prompt!.players!.ids).toEqual(['B', 'D']);
    h.night('A', { players: ['B'] });
    expect(lastNote(h, 'A')).toMatchObject({ kind: 'saw', role: 'vampire' });
  });

  it('the Marksman may skip the Mark and still look at a card, or skip both', () => {
    const h = table({ players: ['marksman', W, V] });
    h.toStep('marksman');
    h.night('A', { pass: true });
    expect(h.view('A').night!.acting!.prompt).toMatchObject({ stage: 'view' });
    h.night('A', { players: ['B'] });
    expect(lastNote(h, 'A')).toMatchObject({ kind: 'saw', role: W });
    const both = table({ players: ['marksman', W, V] });
    both.toStep('marksman');
    both.night('A', { pass: true });
    both.night('A', { pass: true });
    expect(lastNote(both, 'A')).toMatchObject({ kind: 'passed' });
  });

  it('the Pickpocket swaps Marks and sees the one he got', () => {
    const h = table({ players: ['pickpocket', 'vampire', V, V] });
    vampiresMark(h, 'C');
    h.toStep('pickpocket');
    h.night('A', { players: ['C'] });
    expect(lastNote(h, 'A')).toMatchObject({ kind: 'pickpocketed', target: 'C', mark: 'vampire' });
    expect([mark(h, 'A'), mark(h, 'C')]).toEqual(['vampire', 'clarity']);
    h.vote(votes('B,C,D>A; A>C'));
    expect(h.state.round!.result!.identities.A).toMatchObject({ team: 'vampire' });
  });

  it('the Gremlin may swap cards instead, but never a shielded one', () => {
    const h = table({ players: ['gremlin', W, V, 'sentinel'] });
    h.toStep('sentinel');
    h.night('D', { players: ['B'] });
    h.toStep('gremlin');
    expect(h.nightReject('A', { players: ['B', 'C'] })).toBe('bad-pick');
    h.night('A', { choice: 'cards' });
    expect(h.view('A').night!.acting!.prompt!.players!.ids).toEqual(['A', 'C', 'D']);
    h.night('A', { players: ['A', 'C'] });
    expect([h.role('A'), h.role('C')]).toEqual([V, 'gremlin']);
    expect(lastNote(h, 'A')).toMatchObject({ kind: 'swapped' });
  });

  it('the dusk shows everyone their own Mark at once, and the lovers then meet', () => {
    const h = table({ players: ['cupid', 'vampire', V, W] });
    vampiresMark(h, 'C');
    h.toStep('cupid');
    h.night('A', { players: ['A', 'D'] });
    h.toStep('dusk');
    expect(actors(h)).toEqual(['A', 'B', 'C', 'D']);
    expect(h.state.round!.notes.C!.at(-1)).toMatchObject({ kind: 'mark', mark: 'vampire' });
    expect(h.state.round!.notes.A!.at(-1)).toMatchObject({ kind: 'mark', mark: 'love' });
    expect(h.state.round!.notes.B!.at(-1)).toMatchObject({ kind: 'mark', mark: 'clarity' });
    expect(h.view('B').night!.acting).toMatchObject({ step: 'dusk', as: 'vampire', prompt: null });
    h.toStep('lovers');
    expect(actors(h)).toEqual(['A', 'D']);
    expect(lastNote(h, 'D')).toMatchObject({ kind: 'group', group: 'lovers', players: ['A', 'D'] });
    expect(h.view('B').night!.acting).toBeNull();
  });

  it('Fear never reaches the dusk: a frightened player still sees their Mark and loves', () => {
    const h = table({ players: ['the-count', 'vampire', 'cupid', V, W] });
    vampiresMark(h, 'D');
    h.toStep('the-count');
    h.night('A', { players: ['C'] });
    h.toStep('cupid');
    expect(actors(h)).toEqual(['C']);
    h.night('C', { players: ['D', 'E'] });
    h.toStep('dusk');
    expect(actors(h)).toContain('C');
    expect(lastNote(h, 'C')).toMatchObject({ kind: 'mark', mark: 'fear' });
  });

  it('a frightened Mason stays asleep, so the other Mason wakes alone', () => {
    const h = table({ players: ['the-count', 'vampire', 'mason', 'mason', V] });
    vampiresMark(h, 'E');
    h.toStep('the-count');
    h.night('A', { players: ['C'] });
    h.toStep('mason');
    expect(actors(h)).toEqual(['D']);
  });

  it('the Aura Seer sees who gave, took, moved or looked at a Mark, but not the dusk', () => {
    const h = table({ players: ['cupid', 'instigator', 'priest', 'aura-seer', V, 'pickpocket'] });
    h.toStep('cupid');
    h.night('A', { players: ['E', 'F'] });
    h.toStep('instigator');
    h.night('B', { pass: true });
    h.toStep('pickpocket');
    h.night('F', { players: ['E'] });
    h.toStep('aura-seer');
    expect(lastNote(h, 'D')).toMatchObject({ kind: 'thumbs', players: ['A', 'C', 'F'] });
  });

  it('a Werewolf with the Mark of the Vampire still wakes with the wolves, but is a Vampire', () => {
    const h = table({ players: ['vampire', W, W, V, V] });
    vampiresMark(h, 'B');
    h.toStep('werewolves');
    expect(actors(h)).toEqual(['B', 'C']);
    h.vote(votes('A,C,D,E>B; B>A'));
    const r = h.state.round!.result!;
    expect(r.identities.B).toMatchObject({ role: W, team: 'vampire', vampireMark: true });
    expect(r.epic).toBe(true);
    // B first, A second: two vampires dead. C, a wolf, wins with a vampire dead; the village
    // needed two sides dead.
    expect(dead(h)).toBe('AB');
    expect(winners(h)).toBe('C');
  });

  it('a Bodyguard with the Mark of the Vampire still protects', () => {
    const h = table({ players: ['vampire', 'bodyguard', V, V, V] });
    vampiresMark(h, 'B');
    h.vote(votes('B>A; C,D,E>A; A>C'));
    expect(h.state.round!.result!.protectedPlayers).toEqual(['A']);
    expect(dead(h)).toBe('');
  });

  it('Mist of the Vampire is in the bag only with vampire roles, and makes a Vampire', () => {
    const h = table({
      players: ['vampire', V, V, V, 'curator'],
      settings: { artifacts: ['mist-of-the-vampire'] },
    });
    expect(h.state.round!.night!.bag).toEqual(['mist-of-the-vampire']);
    expect(
      table({ players: [W, V, 'curator'], settings: { artifacts: ['mist-of-the-vampire'] } }).state
        .round!.night!.bag,
    ).toEqual([]);
    vampiresMark(h, 'C');
    h.toStep('curator');
    h.night('E', { players: ['B'] });
    h.vote(votes('A,C,D,E>B; B>D'));
    expect(h.state.round!.result!.identities.B).toMatchObject({
      role: 'vampire',
      artifact: 'mist-of-the-vampire',
    });
    // The Mist-made Vampire died: the vampires lose.
    expect(winners(h)).toBe('DE');
  });

  it('the Dagger and the Mark of the Traitor both make a Traitor', () => {
    const h = table({
      players: ['instigator', W, V, V, 'curator'],
      settings: { artifacts: ['dagger-of-the-traitor'] },
    });
    h.toStep('instigator');
    h.night('A', { players: ['C'] });
    h.toStep('curator');
    h.night('E', { players: ['D'] });
    h.vote(votes('A,C,D,E>B; B>A'));
    expect(h.state.round!.result!.identities.C!.traitor).toBe(true);
    expect(h.state.round!.result!.identities.D!.traitor).toBe(true);
    expect(winners(h)).toBe('AE');
  });

  it('a Traitor on the vampire team wins only if another vampire dies', () => {
    const h = table({ players: ['vampire', 'instigator', V, V, V] });
    vampiresMark(h, 'C');
    h.toStep('instigator');
    h.night('B', { players: ['A'] });
    h.vote(votes('B,D,E>C; C>A'));
    // C (a vampire by Mark) died: A, the Traitor, wins; the vampire team doesn't; the village does.
    expect(dead(h)).toBe('C');
    expect(winners(h)).toBe('ABDE');
  });
});

// ---- The Cursed between werewolves and vampires (ruling 10) ----

describe('the Cursed and the vampires', () => {
  it('a Vampire’s vote turns the Cursed into a Vampire', () => {
    const h = table({ players: ['cursed', 'vampire', V, V, V] });
    vampiresMark(h, 'C');
    h.vote(votes('B,D,E>A; A>B; C>D'));
    expect(h.state.round!.result!.identities.A).toMatchObject({
      team: 'vampire',
      converted: 'vampire',
    });
    expect(winners(h)).toBe('DE');
  });

  it('voted by both, the Cursed joins the side with more votes; a tie makes a Werewolf', () => {
    const more = table({ players: ['cursed', 'vampire', W, V, V, V] });
    vampiresMark(more, 'D');
    more.vote(votes('B,D,C>A; A>E; E>B; F>C'));
    expect(more.state.round!.result!.identities.A!.converted).toBe('vampire');
    const tie = table({ players: ['cursed', 'vampire', W, V, V, V] });
    vampiresMark(tie, 'D');
    tie.vote(votes('B,C>A; A>E; D>E; E>B; F>C'));
    expect(tie.state.round!.result!.identities.A!.converted).toBe('werewolf');
  });

  it('a Cursed with the Mark of the Vampire stays a Vampire', () => {
    const h = table({ players: ['cursed', 'vampire', W, V, V] });
    vampiresMark(h, 'A');
    h.vote(votes('C,D>A; A>E; B>E; E>C'));
    expect(h.state.round!.result!.identities.A).toMatchObject({ team: 'vampire' });
    expect(h.state.round!.result!.identities.A!.converted).toBeUndefined();
  });
});

// ---- Epic battles (ruling 2) ----

describe('epic battles', () => {
  const epic = () => {
    const h = table({ players: [W, 'vampire', 'the-master', V, V, V] });
    vampiresMark(h, 'F');
    return h;
  };

  it('first place still needs two votes', () => {
    const h = epic();
    h.vote(votes('A>B; B>C; C>D; D>E; E>F; F>A'));
    expect(h.state.round!.result!.epic).toBe(true);
    expect(dead(h)).toBe('');
  });

  it('a protected Master is skipped before the ranking', () => {
    const h = epic();
    // C (the Master) has 3 votes, one from B, a Vampire: protected. A is then first with 2,
    // D second with 1.
    h.vote(votes('B,D,E>C; C>A; F>A; A>D'));
    const r = h.state.round!.result!;
    expect(r.protectedPlayers).toEqual(['C']);
    expect(r.deaths).toEqual([
      { player: 'A', cause: 'vote', place: 1 },
      { player: 'D', cause: 'vote', place: 2 },
    ]);
    // A Werewolf died, no Vampire did: the vampires win; the village needs two sides dead.
    expect(winners(h)).toBe('BCF');
  });

  it('the Master isn’t protected by a werewolf’s vote, or by his own Mark', () => {
    const h = epic();
    h.vote(votes('A,D,E>C; C>A; F>D; B>D'));
    expect(h.state.round!.result!.protectedPlayers).toEqual([]);
    expect(dead(h)).toBe('CD');
  });

  it('the lovers die with the second place too, protected or not', () => {
    const h = table({ players: [W, 'vampire', 'the-master', 'cupid', V, V] });
    vampiresMark(h, 'F');
    h.toStep('cupid');
    h.night('D', { players: ['C', 'E'] });
    h.vote(votes('D,E,F>A; A>E; B>C; C>D'));
    // C is protected (B voted for him); A first (3), D and E second (1 each); E's love takes C.
    expect(dead(h)).toBe('ACDE');
    expect(h.state.round!.result!.deaths.find((d) => d.player === 'C')!.cause).toBe('love');
  });
});

// ---- Every copy of a Vampire role ----

describe('the Doppelgänger copies every Vampire role', () => {
  /** A table where the Doppelgänger (A) copies `role` from B. */
  const copying = (role: RoleId, extra: RoleId[] = []) => {
    const h = table({ players: ['doppelganger', role, W, V, V, ...extra], center: [V, V, 'seer'] });
    h.toStep('doppelganger');
    h.night('A', { players: ['B'] });
    return h;
  };

  it.each(['vampire', 'the-master'] as RoleId[])('%s: wakes with the vampires', (role) => {
    const h = copying(role);
    expect(h.view('A').night!.acting!.prompt).toBeNull();
    h.toStep('vampires');
    expect(actors(h)).toEqual(['A', 'B']);
    h.night('A', { players: ['D'] });
    // The vampires' Mark is never a Doppelgänger Mark.
    expect(h.state.round!.marks!.D).toEqual({ id: 'vampire', doppel: false });
  });

  it('the-count: wakes with the vampires, then gives her own Fear after the Count', () => {
    const h = copying('the-count');
    h.toStep('vampires');
    expect(actors(h)).toEqual(['A', 'B']);
    h.night('B', { players: ['D'] });
    h.toStep('the-count');
    expect(actors(h)).toEqual(['B']);
    h.night('B', { players: ['C'] });
    h.toStep('doppelganger-the-count');
    expect(actors(h)).toEqual(['A']);
    // Not a vampire, not the marked player.
    expect(h.view('A').night!.acting!.prompt!.players!.ids).toEqual(['C', 'E']);
    h.night('A', { players: ['E'] });
    expect(h.state.round!.marks!.E).toEqual({ id: 'fear', doppel: true });
  });

  it('renfield: wakes after Renfield, sees the same, and takes her own Bat', () => {
    const h = copying('renfield', ['vampire']);
    h.toStep('vampires');
    h.night('F', { players: ['D'] });
    h.toStep('renfield');
    expect(actors(h)).toEqual(['B']);
    h.toStep('doppelganger-renfield');
    expect(actors(h)).toEqual(['A']);
    expect(lastNote(h, 'A')).toMatchObject({ kind: 'saw-vampires', players: ['F'], target: 'D' });
    expect(h.state.round!.marks!.A).toEqual({ id: 'bat', doppel: true });
  });

  const immediate: [RoleId, Parameters<Harness['night']>[1], string[], string][] = [
    ['diseased', { side: 'left' }, ['B'], 'disease'],
    ['cupid', { players: ['C', 'D'] }, ['C', 'D'], 'love'],
    ['instigator', { players: ['C'] }, ['C'], 'traitor'],
  ];
  it.each(immediate)('%s: acts at once with her own Marks', (role, pick, targets, id) => {
    const h = copying(role);
    expect(h.view('A').night!.acting!.prompt!.as).toBe(role);
    h.night('A', pick);
    for (const t of targets) expect(h.state.round!.marks![t]).toEqual({ id, doppel: true });
    h.toStep(role);
    expect(actors(h)).toEqual(['B']);
  });

  it.each([
    ['priest', 'doppelganger-priest'],
    ['assassin', 'doppelganger-assassin'],
    ['apprentice-assassin', 'doppelganger-apprentice-assassin'],
    ['marksman', 'doppelganger-marksman'],
    ['pickpocket', 'doppelganger-pickpocket'],
    ['gremlin', 'doppelganger-gremlin'],
  ] as const)('%s: wakes again right after the original', (role, step) => {
    const h = copying(role);
    expect(h.view('A').night!.acting!.prompt).toBeNull();
    h.toStep(role);
    expect(actors(h)).toEqual(['B']);
    h.toStep(step);
    expect(actors(h)).toEqual(['A']);
  });

  it('priest: her Clarity is a Doppelgänger Mark', () => {
    const h = copying('priest');
    h.toStep('doppelganger-priest');
    expect(h.state.round!.marks!.A).toEqual({ id: 'clarity', doppel: true });
  });

  it('assassin: places her own Mark, and wins when any Assassin Mark’s holder dies', () => {
    const h = copying('assassin');
    h.toStep('assassin');
    h.night('B', { players: ['D'] });
    h.toStep('doppelganger-assassin');
    h.night('A', { players: ['E'] });
    // Only the Apprentice Assassin's own Mark records who placed it.
    expect(h.state.round!.marks!.E).toEqual({ id: 'assassin', doppel: true });
    h.vote(votes('A,B,C,D>E; E>D'));
    expect(dead(h)).toBe('E');
    // Both Assassins win, and so do the werewolves (no Werewolf died).
    expect(winners(h)).toBe('ABC');
  });

  it('apprentice-assassin: her copy sees the Assassin, who is still awake', () => {
    const h = copying('apprentice-assassin', ['assassin']);
    h.toStep('apprentice-assassin');
    expect(actors(h)).toEqual(['B', 'F']);
    h.toStep('doppelganger-apprentice-assassin');
    expect(actors(h)).toEqual(['A', 'F']);
    expect(lastNote(h, 'A')).toMatchObject({ group: 'assassins', players: ['F'] });
    expect(lastNote(h, 'F')).toMatchObject({ group: 'apprentices', players: ['A'] });
  });

  it('apprentice-assassin with no Assassin: she must place her own Mark', () => {
    const h = copying('apprentice-assassin');
    h.toStep('doppelganger-apprentice-assassin');
    expect(h.view('A').night!.acting!.prompt).toMatchObject({ mandatory: true });
    h.tick();
    const marked = Object.values(h.state.round!.marks!).filter((m) => m.id === 'assassin');
    expect(marked).toContainEqual({ id: 'assassin', doppel: true, by: 'A' });
  });

  it('copycat: she becomes what the Copycat copied without seeing it, and never wakes', () => {
    const h = table({ players: ['copycat', 'doppelganger', W, V], center: ['robber', V, V] });
    h.toStep('copycat');
    h.night('A', { center: [0] });
    h.toStep('doppelganger');
    h.night('B', { players: ['A'] });
    expect(h.state.round!.players.B!.dormant).toBe(true);
    expect(h.view('B').night!.acting!.as).toBe('copycat');
    h.toStep('robber');
    expect(actors(h)).toEqual(['A']);
    h.vote(votes('A,B,D>C; C>A'));
    expect(h.state.round!.result!.identities.B!.role).toBe('robber');
  });
});

describe('the Copycat copies every role', () => {
  /** The step a role's player wakes in, if any. */
  const wakeStep = (role: RoleId, selected: RoleId[]): string | null => {
    if (ROLES[role].wakesWithWerewolves) return 'werewolves';
    if (ROLES[role].wakesWithVampires) return 'vampires';
    // The Cow's fist is out in the aliens' step; a Copycat-Oracle never wakes (the Oracle's step
    // is over), and the Blob never wakes at all.
    const plan = buildNightPlan(selected);
    if (ROLES[role].wakesWithAliens || role === 'cow')
      return plan.includes('aliens') ? 'aliens' : null;
    if (role === 'oracle' || role === 'blob') return null;
    return plan.includes(role) ? role : null;
  };
  const copyable = ROLE_IDS.filter((r) => r !== 'copycat' && r !== 'alpha-wolf');

  it.each(copyable)('%s: the Copycat wakes when it is called', (role) => {
    const extra: RoleId[] =
      role === 'apprentice-tanner' ? ['tanner'] : role === 'beholder' ? ['seer'] : [];
    const players: RoleId[] = ['copycat', 'seer', V, V, ...extra];
    const h = table({ players, center: [role, V, V] });
    h.toStep('copycat');
    h.night('A', { center: [0] });
    expect(h.state.round!.players.A!.night).toBe(role);
    const step = role === 'doppelganger' ? 'doppelganger' : wakeStep(role, [...players, role]);
    if (step === null) {
      h.dawn();
      expect(h.state.round!.cards.A!.copied).toBe(role);
      return;
    }
    h.toStep(step);
    expect(actors(h)).toContain('A');
  });

  it('alpha-wolf: wakes with the wolves, then moves the centre werewolf at 2B', () => {
    const h = table({ players: ['copycat', 'seer', V, V], center: ['alpha-wolf', V, V], wolf: W });
    h.toStep('copycat');
    h.night('A', { center: [0] });
    h.toStep('werewolves');
    expect(actors(h)).toEqual(['A']);
    h.toStep('alpha-wolf');
    expect(actors(h)).toEqual(['A']);
    h.night('A', { players: ['C'] });
    expect(h.role('C')).toBe(W);
  });

  it('the-count: wakes with the vampires and gives Fear at -6B beside the Count', () => {
    const h = table({ players: ['copycat', 'the-count', V, V], center: ['the-count', V, V] });
    // (Two Count cards can't be dealt, but the engine reads the copy, not the box.)
    h.toStep('copycat');
    h.night('A', { center: [0] });
    h.toStep('vampires');
    expect(actors(h)).toEqual(['A', 'B']);
    h.night('A', { players: ['C'] });
    h.toStep('the-count');
    expect(actors(h)).toEqual(['A', 'B']);
    h.night('A', { players: ['D'] });
    expect(h.state.round!.marks!.D).toEqual({ id: 'fear', doppel: false });
  });

  it('doppelganger: the Copycat acts as the Doppelgänger, and her re-wakes are his', () => {
    const h = table({ players: ['copycat', 'insomniac', W, V], center: ['doppelganger', V, V] });
    h.toStep('copycat');
    h.night('A', { center: [0] });
    h.toStep('doppelganger');
    expect(actors(h)).toEqual(['A']);
    h.night('A', { players: ['B'] });
    h.toStep('doppelganger-insomniac');
    expect(actors(h)).toEqual(['A']);
    expect(lastNote(h, 'A')).toMatchObject({ kind: 'saw-own', role: 'copycat' });
    h.vote(votes('A,B,D>C; C>A'));
    expect(h.state.round!.result!.identities.A!.role).toBe('insomniac');
  });

  it('doppelganger: a Copycat who copies the Sentinel through her places her shield', () => {
    const h = table({ players: ['copycat', 'sentinel', W, V], center: ['doppelganger', V, V] });
    h.toStep('copycat');
    h.night('A', { center: [0] });
    h.toStep('doppelganger');
    h.night('A', { players: ['B'] });
    expect(h.view('A').night!.acting!.prompt!.players!.ids).toContain('D');
    h.night('A', { players: ['D'] });
    expect(h.state.round!.cards.D!.shield).toBe('doppel');
  });

  it('must copy: time running out picks a centre card', () => {
    const h = table({ players: ['copycat', W, V], center: ['seer', 'seer', 'seer'] });
    h.toStep('copycat');
    h.tick();
    expect(h.state.round!.players.A!.night).toBe('seer');
    expect(lastNote(h, 'A')).toMatchObject({ kind: 'copied-centre', auto: true });
  });
});

// ---- The security boundary: Marks ----

const VAMPIRE_TABLE: RoleId[] = [
  'vampire',
  'the-count',
  'cupid',
  'priest',
  'marksman',
  'pickpocket',
  'gremlin',
  W,
  'diseased',
  'doppelganger',
];

/** A full Vampire table with random choices in every step, recording every view on the way. */
function playRandomNight(seed: number, players = VAMPIRE_TABLE) {
  const h = table({
    players,
    center: ['renfield', 'assassin', 'instigator'],
    seed,
  });
  const rng = createRng(seed);
  const views: { step: number; acting: Set<string>; views: Record<string, NightfallView> }[] = [];
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
    for (const p of h.state.round!.night!.actors) {
      for (let i = 0; i < 4; i++) {
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
        h.night(p, pick);
        snap();
      }
    }
    h.tick();
  }
  return { h, views };
}

const MARK_NOTES = new Set(['mark', 'saw-mark', 'pickpocketed']);

describe('what each player is sent about Marks', () => {
  it.each([1, 2, 3, 4])('names no Mark but what you saw, at any step (seed %i)', (seed) => {
    const { h, views } = playRandomNight(seed);
    const plan = h.state.round!.night!.plan;
    const dusk = plan.indexOf('dusk');
    expect(dusk).toBeGreaterThan(0);
    for (const { step, views: byViewer } of views) {
      for (const [id, v] of Object.entries(byViewer)) {
        const { notes, ...rest } = v;
        const json = JSON.stringify(rest);
        expect(json, `${id} at step ${step}`).not.toContain('"marks":');
        expect(json, `${id} at step ${step}`).not.toContain('"mark":');
        for (const n of notes) {
          // Your own Mark first shows at the dusk, never before.
          if (n.kind === 'mark') expect(n.step).toBe(dusk);
          if (MARK_NOTES.has(n.kind)) expect(n.step).toBeGreaterThanOrEqual(dusk);
        }
        // The Marks other players hold appear only in notes you made yourself.
        const own = new Set((h.state.round!.notes[id] ?? []).map((n) => n.id));
        for (const n of notes) expect(own.has(n.id)).toBe(true);
        for (const n of notes) if (n.kind === 'mark') expect(MARK_IDS).toContain(n.mark);
      }
    }
  });

  it.each([1, 2, 3, 4])('is identical for everyone not acting, dusk included (seed %i)', (seed) => {
    const { h, views } = playRandomNight(seed);
    const strip = (v: NightfallView) =>
      JSON.stringify({ ...v, night: { ...v.night!, index: 0, start: 0, deadline: 0 } });
    for (const id of [...h.ids, 'watcher']) {
      let last: string | null = null;
      for (const { acting, views: byViewer } of views) {
        if (acting.has(id)) {
          last = null;
          continue;
        }
        const now = strip(byViewer[id]!);
        expect(byViewer[id]!.night!.acting).toBeNull();
        if (last !== null) expect(now).toBe(last);
        last = now;
      }
    }
  });

  it('shows every Mark at the reveal, to everyone', () => {
    const { h } = playRandomNight(5);
    h.vote(Object.fromEntries(h.ids.map((id, i) => [id, h.ids[(i + 1) % h.ids.length]!])));
    for (const id of [...h.ids, null]) {
      const reveal = h.view(id).reveal!;
      expect(reveal.marks).toEqual(h.state.round!.marks);
      for (const p of h.ids)
        expect(reveal.result.identities[p]!.mark).toBe(h.state.round!.marks![p]!.id);
    }
  });

  it('runs every dusk step for its full length, whether or not anyone holds the card', () => {
    const durations = (players: RoleId[], center: RoleId[]) => {
      const h = table({ players, center, settings: { stepSeconds: 10 } });
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
    const roles: RoleId[] = [
      'copycat',
      'the-count',
      'cupid',
      'priest',
      'assassin',
      'apprentice-assassin',
      'renfield',
      'marksman',
    ];
    const held = durations(roles.slice(0, 5), roles.slice(5));
    const centred = durations([...roles.slice(3, 8)], roles.slice(0, 3));
    expect(centred).toEqual(held);
    const plan = buildNightPlan(roles);
    expect(plan).toContain('dusk');
    expect(plan).toContain('lovers');
    expect(held.slice(1)).toEqual(plan.map((id) => stepFactor(id) * 10_000));
  });
});

describe('presets', () => {
  it('every scenario deals a legal setup at every table size it suits', () => {
    for (const p of SCENARIOS)
      for (let n = p.minPlayers; n <= MAX_PLAYERS; n++) {
        const roles = scenarioRoles(p, n);
        if (roles) expect(setupProblem(roles, n), `${p.id} for ${n}`).toBeNull();
        else expect(n, `${p.id} for ${n}`).toBeGreaterThan(p.minPlayers);
      }
  });

  it('offers Vampire setups with two vampires, and an epic battle', () => {
    const vampire = SCENARIOS.filter((p) => p.roles.some((r) => ROLES[r].vampire));
    expect(vampire.length).toBeGreaterThanOrEqual(3);
    for (const p of vampire)
      expect(p.roles.filter((r) => ROLES[r].vampire).length, p.id).toBeGreaterThanOrEqual(2);
    expect(vampire.some((p) => p.roles.some((r) => ROLES[r].werewolf))).toBe(true);
  });
});
