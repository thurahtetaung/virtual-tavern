import { describe, expect, it } from 'vitest';
import { dead, table, votes, winners } from './test-utils.ts';

// The wave-1 cases from the rules spec (§5): base, Daybreak and bonus packs 1 and 2. Seats are
// A, B, C…; "X>Y" is X voting for Y (a Bodyguard's vote is the protection pick).

const W = 'werewolf';
const V = 'villager';

describe('vote and win cases', () => {
  it('T01: the werewolf most voted dies', () => {
    const h = table({ players: [W, W, 'seer', 'robber', 'troublemaker'] });
    h.vote(votes('B,C,D,E>A; A>C'));
    expect(dead(h)).toBe('A');
    expect(winners(h)).toBe('CDE');
  });

  it('T02: a tie for most votes kills everyone tied', () => {
    const h = table({ players: [W, V, 'seer', V, V], center: [W, 'robber', 'troublemaker'] });
    h.vote(votes('A>B; C>B; B>A; D>A; E>C'));
    expect(dead(h)).toBe('AB');
    expect(winners(h)).toBe('BCDE');
  });

  it('T03: nobody with more than one vote means nobody dies', () => {
    const h = table({ players: [W, 'seer', V, V] });
    h.vote(votes('A>B; B>C; C>D; D>A'));
    expect(dead(h)).toBe('');
    expect(winners(h)).toBe('A');
  });

  it('T04: no werewolf and nobody dies: the village wins', () => {
    const h = table({ players: ['seer', 'robber', 'troublemaker'], center: [W, W, V] });
    h.vote(votes('A>B; B>C; C>A'));
    expect(winners(h)).toBe('ABC');
  });

  it('T05: no werewolf, someone dies: nobody wins', () => {
    const h = table({ players: ['seer', 'robber', 'troublemaker'], center: [W, W, V] });
    h.vote(votes('A,B>C; C>A'));
    expect(dead(h)).toBe('C');
    expect(winners(h)).toBe('');
  });

  it('T06: the Robber takes the werewolf card', () => {
    const h = table({ players: [W, 'robber', 'seer', V] });
    h.toStep('robber');
    h.night('B', { players: ['A'] });
    expect(h.role('B')).toBe(W);
    h.vote(votes('B,C,D>A; A>B'));
    expect(dead(h)).toBe('A');
    expect(winners(h)).toBe('B');
  });

  it('T07: the Troublemaker swaps the werewolf away', () => {
    const h = table({ players: [W, 'troublemaker', V, V] });
    h.toStep('troublemaker');
    h.night('B', { players: ['A', 'C'] });
    h.vote(votes('B,C,D>A; A>C'));
    expect(winners(h)).toBe('C');
  });

  it('T08: the Drunk takes the centre werewolf', () => {
    const h = table({ players: ['seer', 'drunk', V], center: [W, V, V] });
    h.toStep('drunk');
    h.night('B', { center: [0] });
    h.vote(votes('A,C>B; B>A'));
    expect(winners(h)).toBe('AC');
  });

  it('T09: the Tanner dies alone: only the Tanner wins', () => {
    const h = table({ players: [W, 'tanner', 'seer', V] });
    h.vote(votes('A,C,D>B; B>A'));
    expect(winners(h)).toBe('B');
  });

  it('T10: the Tanner and a werewolf die: the Tanner and the village win', () => {
    const h = table({ players: [W, 'tanner', 'seer', V, V] });
    h.vote(votes('A>B; C>B; B>A; D>A; E>C'));
    expect(dead(h)).toBe('AB');
    expect(winners(h)).toBe('BCDE');
  });

  it('T11: the Tanner dies with no werewolf in play', () => {
    const h = table({ players: ['tanner', 'seer', V], center: [W, W, 'robber'] });
    h.vote(votes('B,C>A; A>B'));
    expect(winners(h)).toBe('A');
  });

  it('T12: the Minion dies, the werewolves win', () => {
    const h = table({ players: [W, 'minion', 'seer', V, V] });
    h.vote(votes('C,D,E>B; A,B>C'));
    expect(dead(h)).toBe('B');
    expect(winners(h)).toBe('AB');
  });

  it('T13: no werewolves, someone else dies: the Minion wins', () => {
    const h = table({ players: ['minion', 'seer', V, V], center: [W, W, 'robber'] });
    h.vote(votes('A,B,D>C; C>A'));
    expect(winners(h)).toBe('A');
  });

  it('T14: no werewolves, only the Minion dies: nobody wins', () => {
    const h = table({ players: ['minion', 'seer', V, V], center: [W, W, 'robber'] });
    h.vote(votes('B,C,D>A; A>B'));
    expect(winners(h)).toBe('');
  });

  it('T15: the Hunter takes the werewolf with him', () => {
    const h = table({ players: [W, 'hunter', 'seer', V, V] });
    h.vote(votes('A,C,D>B; B>A; E>C'));
    expect(dead(h)).toBe('AB');
    expect(h.state.round!.result!.deaths).toContainEqual({ player: 'A', cause: 'hunter', by: 'B' });
    expect(winners(h)).toBe('BCDE');
  });

  it('T16: the Bow makes a Hunter, and Hunters chain', () => {
    const h = table({
      players: [W, V, 'hunter', V, 'curator'],
      settings: { artifacts: ['bow-of-the-hunter'] },
    });
    h.toStep('curator');
    h.night('E', { players: ['B'] });
    expect(h.state.round!.cards.B!.artifact).toBe('bow-of-the-hunter');
    h.vote(votes('A,D,E>B; B>C; C>A'));
    expect(dead(h)).toBe('ABC');
    expect(winners(h)).toBe('BCDE');
  });

  it('T17: a Doppelgänger who copies a werewolf wakes with the werewolves', () => {
    const h = table({ players: ['doppelganger', W, 'seer', V, V], center: [W, 'robber', V] });
    h.toStep('doppelganger');
    h.night('A', { players: ['B'] });
    h.toStep('werewolves');
    expect(h.state.round!.night!.actors).toEqual(['A', 'B']);
    h.vote(votes('C,D,E>B; A,B>C'));
    expect(winners(h)).toBe('CDE');
  });

  it('T18: a Doppelgänger-Robber robs straight away; the werewolf still wakes', () => {
    const h = table({ players: ['doppelganger', W, 'robber', V] });
    h.toStep('doppelganger');
    h.night('A', { players: ['C'] });
    h.night('A', { players: ['B'] });
    expect(h.role('A')).toBe(W);
    expect(h.state.round!.cards.B).toMatchObject({ role: 'doppelganger', copied: 'robber' });
    h.toStep('werewolves');
    expect(h.state.round!.night!.actors).toEqual(['B']);
    h.toStep('robber');
    expect(h.state.round!.night!.actors).toEqual(['C']);
    h.night('C', { players: ['D'] });
    h.vote(votes('B,C,D>A; A>B'));
    expect(winners(h)).toBe('BCD');
  });

  it('T19: the Doppelgänger-Insomniac wakes after the Insomniac and sees her new card', () => {
    const h = table({ players: ['doppelganger', 'insomniac', 'troublemaker', W] });
    h.toStep('doppelganger');
    h.night('A', { players: ['B'] });
    h.toStep('troublemaker');
    h.night('C', { players: ['A', 'D'] });
    h.toStep('insomniac');
    expect(h.state.round!.night!.actors).toEqual(['B']);
    h.toStep('doppelganger-insomniac');
    expect(h.state.round!.night!.actors).toEqual(['A']);
    expect(h.state.round!.notes.A!.at(-1)).toMatchObject({ kind: 'saw-own', role: W });
    h.vote(votes('B,C,D>A; A>B'));
    expect(winners(h)).toBe('BCD');
  });

  it('T20: a Doppelgänger-Minion sees the thumbs; a Dream Wolf stops the lone-wolf peek', () => {
    const h = table({ players: ['doppelganger', 'minion', W, 'dream-wolf', V] });
    h.toStep('doppelganger');
    h.night('A', { players: ['B'] });
    expect(h.state.round!.notes.A!.at(-1)).toMatchObject({
      kind: 'thumbs',
      of: 'werewolves',
      players: ['C', 'D'],
    });
    h.toStep('werewolves');
    expect(h.view('C').night!.acting!.prompt).toBeNull();
    h.vote(votes('A,B,C,D>E; E>A'));
    expect(winners(h)).toBe('ABCD');
  });

  it('T21: a lone werewolf may look at exactly one centre card', () => {
    const h = table({ players: [W, 'seer', V, V], center: [V, 'robber', V] });
    h.toStep('werewolves');
    expect(h.nightReject('A', { center: [0, 1] })).toBe('bad-count');
    h.night('A', { center: [1] });
    expect(h.state.round!.notes.A!.at(-1)).toMatchObject({
      kind: 'saw',
      slot: { center: 1 },
      role: 'robber',
    });
  });

  it('T22: a shielded Drunk does nothing', () => {
    const h = table({ players: ['sentinel', 'drunk', W, V] });
    h.toStep('sentinel');
    h.night('A', { players: ['B'] });
    h.toStep('drunk');
    expect(h.view('B').night!.acting!.prompt).toBeNull();
    h.vote(votes('A,B,D>C; C>A'));
    expect(h.role('B')).toBe('drunk');
    expect(winners(h)).toBe('ABD');
  });

  it('T23: the Doppelgänger-Sentinel shields first; a shielded Robber cannot rob', () => {
    const h = table({ players: ['doppelganger', 'sentinel', 'robber', W, V] });
    h.toStep('doppelganger');
    h.night('A', { players: ['B'] });
    h.night('A', { players: ['C'] });
    expect(h.state.round!.cards.C!.shield).toBe('doppel');
    h.toStep('sentinel');
    h.night('B', { players: ['D'] });
    h.toStep('robber');
    expect(h.view('C').night!.acting!.prompt).toBeNull();
    expect(h.state.round!.notes.C!.at(-1)).toMatchObject({ kind: 'blocked', reason: 'shielded' });
    expect(h.nightReject('C', { players: ['E'] })).toBe('done');
  });

  it('T24: the Alpha Wolf hands the centre werewolf to a villager', () => {
    const h = table({
      players: ['alpha-wolf', 'seer', V, 'insomniac', V],
      center: [V, 'troublemaker', 'drunk'],
      wolf: W,
    });
    h.toStep('alpha-wolf');
    expect(h.nightReject('A', { players: ['A'] })).toBe('bad-target');
    h.night('A', { players: ['D'] });
    h.toStep('insomniac');
    expect(h.state.round!.notes.D!.at(-1)).toMatchObject({ kind: 'saw-own', role: W });
    h.vote(votes('B,C,E>A; A>D; D>A'));
    expect(winners(h)).toBe('BCE');
  });

  it('T25: after a Doppelgänger-Alpha, the real Alpha moves whatever is in the slot', () => {
    const h = table({ players: ['doppelganger', 'alpha-wolf', 'seer', V, V], wolf: W });
    h.toStep('doppelganger');
    h.night('A', { players: ['B'] });
    expect(h.nightReject('A', { players: ['B'] })).toBe('bad-target');
    h.night('A', { players: ['D'] });
    expect(h.role('D')).toBe(W);
    h.toStep('werewolves');
    expect(h.state.round!.night!.actors).toEqual(['A', 'B']);
    h.toStep('alpha-wolf');
    expect(h.state.round!.night!.actors).toEqual(['B']);
    h.night('B', { players: ['E'] });
    expect(h.role('E')).toBe(V);
    h.vote(votes('A,B,D>C; C,E>D'));
    expect(dead(h)).toBe('C');
    expect(winners(h)).toBe('ABD');
  });

  it('T26: the P.I. stops on a werewolf, and the change travels with the card', () => {
    const h = table({ players: ['paranormal-investigator', V, W, 'robber', 'seer'] });
    h.toStep('paranormal-investigator');
    h.night('A', { players: ['B'] });
    h.night('A', { players: ['C'] });
    expect(h.state.round!.cards.A!.became).toBe(W);
    h.toStep('robber');
    h.night('D', { players: ['A'] });
    expect(h.state.round!.notes.D!.at(-1)).toMatchObject({ role: 'paranormal-investigator' });
    h.vote(votes('A,B,E>C; C,D>A'));
    expect(dead(h)).toBe('C');
    expect(winners(h)).toBe('ABE');
  });

  it('T27: a Doppelgänger card reads as village to the P.I.', () => {
    const h = table({ players: ['doppelganger', W, 'paranormal-investigator', V, V] });
    h.toStep('doppelganger');
    h.night('A', { players: ['B'] });
    h.toStep('paranormal-investigator');
    h.night('C', { players: ['A'] });
    expect(h.view('C').night!.acting!.prompt).not.toBeNull();
    h.night('C', { players: ['D'] });
    expect(h.state.round!.cards.C!.became).toBeNull();
  });

  it('T28: the Witch takes the centre werewolf herself', () => {
    const h = table({ players: ['witch', 'seer', V, V], center: [W, V, V] });
    h.toStep('witch');
    h.night('A', { center: [0] });
    h.night('A', { players: ['A'] });
    h.vote(votes('B,C,D>A; A>B'));
    expect(winners(h)).toBe('BCD');
  });

  it('T29: the Village Idiot moves cards around the shield', () => {
    const h = table({ players: ['village-idiot', 'sentinel', W, V, 'seer', V] });
    h.toStep('sentinel');
    h.night('B', { players: ['D'] });
    h.toStep('village-idiot');
    h.night('A', { side: 'left' });
    expect(['B', 'C', 'D', 'E', 'F'].map((x) => h.role(x))).toEqual([V, 'sentinel', V, W, 'seer']);
  });

  it('T30: the Revealer leaves village and Doppelgänger cards face up', () => {
    const run = (target: string) => {
      const h = table({ players: ['revealer', W, V, 'doppelganger'] });
      h.toStep('doppelganger');
      h.night('D', { players: ['B'] });
      h.toStep('revealer');
      h.night('A', { players: [target] });
      return h.state.round!.cards[target]!.faceUp;
    };
    expect(run('B')).toBe(false);
    expect(run('C')).toBe(true);
    expect(run('D')).toBe(true);
  });

  it('T31: the Claw makes a werewolf', () => {
    const h = table({
      players: ['curator', V, W, 'seer', V],
      settings: { artifacts: ['claw-of-the-werewolf'] },
    });
    h.toStep('curator');
    h.night('A', { players: ['B'] });
    h.vote(votes('A,D,E>C; C>A; B>A'));
    expect(winners(h)).toBe('ADE');
  });

  it('T32: the Bodyguard protects the werewolf', () => {
    const h = table({ players: ['bodyguard', W, V, V, V, V] });
    h.vote(votes('A,C,D,E>B; B,F>C'));
    expect(dead(h)).toBe('C');
    expect(winners(h)).toBe('B');
  });

  it('T33: with the Brand, the Bodyguard’s pick is a vote', () => {
    const h = table({
      players: ['bodyguard', W, V, V, 'curator', V],
      settings: { artifacts: ['brand-of-the-villager'] },
    });
    h.toStep('curator');
    h.night('E', { players: ['A'] });
    h.vote(votes('A,C,D,E>B; B,F>C'));
    expect(dead(h)).toBe('B');
    expect(winners(h)).toBe('ACDEF');
  });

  it('T34: votes for the Prince don’t count', () => {
    const h = table({ players: ['prince', W, V, V, V] });
    h.vote(votes('B,C,D>A; A,E>B'));
    expect(dead(h)).toBe('B');
    expect(winners(h)).toBe('ACDE');
  });

  it('T35: the Prince is protected; the rest have one vote each', () => {
    const h = table({ players: ['prince', W, V, V, V] });
    h.vote(votes('B,C,D>A; A>B; E>C'));
    expect(dead(h)).toBe('');
    expect(winners(h)).toBe('B');
  });

  it('T63: the Cursed voted by a werewolf turns, and dies a werewolf', () => {
    const h = table({ players: ['cursed', W, V, V, 'seer'] });
    h.vote(votes('B,C,D>A; A,E>B'));
    expect(dead(h)).toBe('A');
    expect(h.state.round!.result!.identities.A).toMatchObject({ converted: true });
    expect(winners(h)).toBe('CDE');
  });

  it('T64: the Cursed turns but survives, and loses with the werewolves', () => {
    const h = table({ players: ['cursed', W, V, V, 'seer'] });
    h.vote(votes('B>A; C,D,E>B; A>C'));
    expect(dead(h)).toBe('B');
    expect(winners(h)).toBe('CDE');
  });

  it('T74: the Apprentice Tanner sees the Tanner and wins when he dies', () => {
    const h = table({ players: ['apprentice-tanner', 'tanner', W, V, 'seer'] });
    h.toStep('apprentice-tanner');
    expect(h.state.round!.notes.A!.at(-1)).toMatchObject({ kind: 'thumbs', players: ['B'] });
    h.vote(votes('A,C,D>B; B,E>C'));
    expect(winners(h)).toBe('AB');
  });

  it('T75: an Apprentice Tanner with no Tanner at the table counts as one', () => {
    const h = table({ players: ['apprentice-tanner', W, V, 'seer'], center: ['tanner', V, V] });
    h.toStep('apprentice-tanner');
    expect(h.state.round!.notes.A!.at(-1)).toMatchObject({ kind: 'thumbs', players: [] });
    h.vote(votes('B,C,D>A; A>B'));
    expect(winners(h)).toBe('A');
  });

  it('T76: the Squire with no werewolves wins if someone else dies', () => {
    const h = table({ players: ['squire', V, 'seer', V], center: [W, W, 'minion'] });
    h.toStep('squire');
    expect(h.state.round!.notes.A!.at(-1)).toMatchObject({ kind: 'thumbs', players: [] });
    h.vote(votes('A,B,C>D; D>A'));
    expect(winners(h)).toBe('A');
  });

  it('T77: the Aura Seer sees who looked or moved', () => {
    const h = table({ players: ['seer', 'robber', 'troublemaker', 'aura-seer', W, V] });
    h.toStep('seer');
    h.night('A', { players: ['E'] });
    h.toStep('robber');
    h.night('B', { pass: true });
    h.toStep('troublemaker');
    h.night('C', { players: ['E', 'F'] });
    h.toStep('aura-seer');
    expect(h.state.round!.notes.D!.at(-1)).toMatchObject({ kind: 'thumbs', players: ['A', 'C'] });
  });

  it('T78: the Beholder checks the Seer’s card', () => {
    const h = table({ players: ['seer', 'beholder', 'troublemaker', W, V] });
    h.toStep('troublemaker');
    h.night('C', { players: ['A', 'D'] });
    h.toStep('beholder');
    h.night('B', { players: ['A'] });
    expect(h.state.round!.notes.B!.at(-1)).toMatchObject({ kind: 'saw', role: W });
  });

  it('T79: protection stops the Hunter’s shot', () => {
    const h = table({ players: ['hunter', W, 'bodyguard', V, V, V] });
    h.vote(votes('B,D,E>A; A>B; C>B; F>D'));
    expect(dead(h)).toBe('A');
    expect(winners(h)).toBe('B');
  });
});
