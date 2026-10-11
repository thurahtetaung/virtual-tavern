import { GameError, createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { explainResult } from './explain.ts';
import { dealGame, nightfall } from './game.ts';
import { marksInPlay, villageWin, winFor } from './roles.ts';
import { type Harness, NOW, dead, table, votes, winners } from './test-utils.ts';
import type { NightfallState } from './types.ts';

// The round-2 audit: three rule bugs, the spec cases nobody had tested yet, and players leaving
// at every stage. Seats are A, B, C…; the left of A is B. "X>Y" is X voting for Y.

const W = 'werewolf';
const V = 'villager';

const mark = (h: Harness, seat: string) => h.state.round!.marks?.[seat]?.id ?? null;
const notesOf = (h: Harness, seat: string) => h.state.round!.notes[seat] ?? [];
const lastNote = (h: Harness, seat: string) => notesOf(h, seat).at(-1);
const actors = (h: Harness) => h.state.round!.night!.actors;
const prompt = (h: Harness, seat: string) => h.view(seat).night?.acting?.prompt ?? null;
const identity = (h: Harness, seat: string) => h.state.round!.result!.identities[seat]!;
/** Puts a shield on these players' cards (as if a Sentinel had). */
const shield = (h: Harness, ...seats: string[]) => {
  for (const s of seats) h.state.round!.cards[s]!.shield = 'normal';
};
const leave = (h: Harness, seat: string) => {
  h.state = nightfall.playerLeft(h.state, seat, h.now);
};

const NAMES = {
  player: (id: string) => ({ A: 'Ana', B: 'Ben', C: 'Cy', D: 'Dee', E: 'Eve' })[id] ?? id,
  role: (role: string) => role.charAt(0).toUpperCase() + role.slice(1).replace(/-/g, ' '),
  team: (team: string) => team,
};
const explain = (h: Harness) =>
  explainResult(h.state.round!.result!, NAMES, h.state.round!.marks ?? null);

describe('bug 1: a Vampire holding an Assassin card stays a Vampire', () => {
  it.each(['assassin', 'apprentice-assassin'] as const)(
    'the Mark of the Vampire keeps the %s card on the vampire team',
    (card) => {
      const h = table({ players: ['vampire', 'drunk', V, V, V], center: [card, V, V] });
      h.toStep('vampires');
      h.night('A', { players: ['B'] });
      h.toStep('drunk');
      h.night('B', { center: [0] });
      expect(h.role('B')).toBe(card);
      h.vote(votes('A,C,D>B; B>C; E>C'));
      expect(dead(h)).toBe('B');
      expect(identity(h, 'B')).toMatchObject({ role: card, team: 'vampire', vampireMark: true });
      // A Vampire died: the village wins, and the dead Vampire doesn't win with it.
      expect(winners(h)).toBe('CDE');
    },
  );
});

describe('bug 2: dormant and departed players show no thumbs', () => {
  /** A Copycat copies centre card 1, then the Doppelgänger copies the Copycat. */
  const dormant = (watcher: 'minion' | 'beholder' | 'apprentice-tanner', centre: string) => {
    const h = table({
      players: ['copycat', 'doppelganger', watcher, V, V],
      center: [centre as 'werewolf', V, V],
    });
    h.toStep('copycat');
    h.night('A', { center: [0] });
    h.toStep('doppelganger');
    h.night('B', { players: ['A'] });
    expect(h.state.round!.players.B!.dormant).toBe(true);
    return h;
  };

  it('the Minion sees only the Copycat as a werewolf', () => {
    const h = dormant('minion', W);
    h.toStep('minion');
    expect(lastNote(h, 'C')).toMatchObject({ kind: 'thumbs', of: 'werewolves', players: ['A'] });
  });

  it('the Beholder sees only the Copycat as a seer, and may look only at her card', () => {
    const h = dormant('beholder', 'seer');
    h.toStep('beholder');
    expect(lastNote(h, 'C')).toMatchObject({ kind: 'thumbs', of: 'seers', players: ['A'] });
    expect(prompt(h, 'C')!.players!.ids).toEqual(['A']);
  });

  it('the Apprentice Tanner sees only the Copycat as the Tanner', () => {
    const h = dormant('apprentice-tanner', 'tanner');
    h.toStep('apprentice-tanner');
    expect(lastNote(h, 'C')).toMatchObject({ kind: 'thumbs', of: 'tanner', players: ['A'] });
  });

  it('a werewolf who left the room shows no thumb to the Minion or the Squire', () => {
    const h = table({ players: [W, 'minion', 'squire', V, V] });
    leave(h, 'A');
    h.toStep('minion');
    expect(lastNote(h, 'B')).toMatchObject({ kind: 'thumbs', players: [] });
    h.toStep('squire');
    expect(notesOf(h, 'C').find((n) => n.kind === 'thumbs')).toMatchObject({ players: [] });
  });
});

describe('bug 3 (ruling 14): the Apprentice Assassin wins on the Mark she placed', () => {
  it('wins when her Mark’s holder dies, though the Assassin card reached a player', () => {
    const h = table({
      players: ['apprentice-assassin', 'drunk', W, V, V],
      center: ['assassin', V, V],
    });
    h.toStep('apprentice-assassin');
    h.night('A', { players: ['C'] });
    expect(h.state.round!.marks!.C).toEqual({ id: 'assassin', doppel: false, by: 'A' });
    h.toStep('drunk');
    h.night('B', { center: [0] });
    h.vote(votes('A,B,D,E>C; C>A'));
    expect(dead(h)).toBe('C');
    // She, the Assassin (C held his Mark) and the village win.
    expect(winners(h)).toBe('ABDE');
    expect(explain(h).personal).toContain(
      'Ana (Apprentice assassin) won: Cy, who held the Mark of the Assassin she placed, died.',
    );
  });

  it('still wins when her card moves later, and so does its new holder', () => {
    const h = table({ players: ['apprentice-assassin', 'robber', W, V, V] });
    h.toStep('apprentice-assassin');
    h.night('A', { players: ['D'] });
    h.toStep('robber');
    h.night('B', { players: ['A'] });
    expect(h.role('A')).toBe('robber');
    h.vote(votes('A,B,C,E>D; D>C'));
    expect(dead(h)).toBe('D');
    // A is a Robber now (the village lost), but the holder of her Mark died. B holds her card.
    expect(winners(h)).toBe('ABC');
    expect(explain(h).personal.join(' ')).toMatch(/Ana placed the Mark of the Assassin/);
  });

  it('loses when her Mark’s holder lives, even if an Assassin dies', () => {
    const h = table({
      players: ['apprentice-assassin', 'drunk', W, V, V],
      center: ['assassin', V, V],
    });
    h.toStep('apprentice-assassin');
    h.night('A', { players: ['D'] });
    h.toStep('drunk');
    h.night('B', { center: [0] });
    h.vote(votes('A,C,D,E>B; B>A'));
    expect(dead(h)).toBe('B');
    expect(h.state.round!.result!.winners).not.toContain('A');
  });

  it('only her own Mark records who placed it', () => {
    const h = table({ players: ['assassin', W, V, V] });
    h.toStep('assassin');
    h.night('A', { players: ['C'] });
    expect(h.state.round!.marks!.C).toEqual({ id: 'assassin', doppel: false });
  });
});

describe('rule mismatches', () => {
  it('words the village’s win for the setup', () => {
    expect(villageWin(['werewolf'])).toMatch(/one Werewolf dies/);
    expect(villageWin(['vampire'])).toMatch(/one Vampire dies/);
    expect(villageWin(['werewolf', 'vampire'])).toMatch(/epic battle.*one of each/);
    expect(villageWin([])).toMatch(/nobody dies/);
    expect(winFor('seer', ['vampire', 'seer', V])).toMatch(/Vampire dies/);
    expect(winFor('seer', ['vampire', 'seer', V])).not.toMatch(/Werewolf/);
    expect(winFor('seer', [W, 'seer', V])).toMatch(/Werewolf dies/);
    // The Claw of the Werewolf can make a Werewolf with no werewolf card in the game.
    expect(winFor('seer', ['vampire', 'curator', V], ['claw-of-the-werewolf'])).toMatch(/epic/);
    expect(winFor(W, [W, 'vampire'])).toMatch(/Vampire must die/);
    expect(winFor('tanner', [W])).toMatch(/no evil team/);
  });

  it('lists the Marks a setup can bring', () => {
    expect(marksInPlay([W, V])).toEqual([]);
    expect(marksInPlay(['the-count', 'cupid', V])).toEqual(['clarity', 'vampire', 'fear', 'love']);
    expect(marksInPlay(['apprentice-assassin', 'renfield'])).toEqual([
      'clarity',
      'bat',
      'assassin',
    ]);
  });

  it('refuses a vote for a player who has left', () => {
    const h = table({ players: [W, V, V, V] });
    h.dawn();
    leave(h, 'D');
    for (const p of ['A', 'B', 'C']) h.act({ type: 'ready-to-vote', ready: true }, p);
    expect(h.state.stage).toBe('vote');
    expect(h.reject({ type: 'vote', target: 'D' }, 'B')).toBe('left');
  });

  it('tells a Robber with no one to rob so, instead of an empty prompt', () => {
    const h = table({ players: ['robber', 'sentinel', 'doppelganger'] });
    h.toStep('doppelganger');
    h.night('C', { players: ['B'] });
    h.night('C', { players: ['B'] });
    h.toStep('sentinel');
    h.night('B', { players: ['C'] });
    h.toStep('robber');
    expect(prompt(h, 'A')).toBeNull();
    expect(lastNote(h, 'A')).toMatchObject({
      kind: 'blocked',
      reason: 'no-target',
      role: 'robber',
    });
  });

  it('lets the Doppelgänger’s Alpha Wolf hand the card to any player but the Alpha', () => {
    const h = table({ players: ['doppelganger', 'alpha-wolf', W, V], wolf: W });
    h.toStep('doppelganger');
    h.night('A', { players: ['B'] });
    const p = prompt(h, 'A')!;
    expect(p.stage).toBe('give-wolf-any');
    expect(p.players!.ids).toEqual(['C', 'D']);
  });

  it('shows the vampires each other’s tentative picks, and only them', () => {
    const h = table({ players: ['vampire', 'the-master', V, V] });
    h.toStep('vampires');
    h.night('A', { point: true, players: ['C'] });
    expect(mark(h, 'C')).toBe('clarity');
    expect(h.view('B').night!.acting!.team).toEqual([{ player: 'A', pick: 'C' }]);
    expect(h.view('A').night!.acting!.team).toEqual([{ player: 'B', pick: null }]);
    expect(h.view('C').night!.acting).toBeNull();
    expect(h.nightReject('A', { point: true, players: ['B'] })).toBe('bad-target');
    h.night('B', { players: ['D'] });
    expect(mark(h, 'D')).toBe('vampire');
    expect(lastNote(h, 'A')).toMatchObject({ targets: ['D'], chosenBy: 'B' });
    // Pointing is only for the vampires.
    const w = table({ players: ['seer', V, V] });
    w.toStep('seer');
    expect(w.nightReject('A', { point: true, players: ['B'] })).toBe('bad-pick');
  });

  it('tells a feared player at daybreak that they slept through their turn', () => {
    const h = table({ players: ['the-count', V, 'seer', V] });
    h.toStep('vampires');
    h.night('A', { players: ['B'] });
    h.toStep('the-count');
    h.night('A', { players: ['C'] });
    h.toStep('seer');
    expect(actors(h)).toEqual([]);
    const entry = h.state.round!.night!.timeline.find((t) => t.stepId === 'seer');
    expect(entry).toMatchObject({ by: 'C', note: { kind: 'feared', role: 'seer' } });
    // Nothing reaches the screen at night; it comes at daybreak.
    expect(notesOf(h, 'C').some((n) => n.kind === 'feared')).toBe(false);
    h.dawn();
    expect(notesOf(h, 'C')).toContainEqual(expect.objectContaining({ kind: 'feared', step: -1 }));
  });
});

describe('spec cases nobody had tested', () => {
  it('the Witch, with every player card shielded, looks but can’t swap', () => {
    const h = table({ players: ['witch', V, V] });
    h.toStep('witch');
    shield(h, 'A', 'B', 'C');
    h.night('A', { center: [0] });
    expect(lastNote(h, 'A')).toMatchObject({ kind: 'blocked', reason: 'no-target' });
    expect(prompt(h, 'A')).toBeNull();
    expect(h.role('A')).toBe('witch');
  });

  it('the Alpha Wolf with no legal target is told so', () => {
    const h = table({ players: ['alpha-wolf', W, V, V], wolf: W });
    shield(h, 'C', 'D');
    h.toStep('alpha-wolf');
    expect(prompt(h, 'A')).toBeNull();
    expect(lastNote(h, 'A')).toMatchObject({ kind: 'blocked', reason: 'no-target' });
  });

  it('a lone werewolf may look at the centre only with the Lone Wolf option on', () => {
    const on = table({ players: [W, V, V] });
    on.toStep('werewolves');
    expect(prompt(on, 'A')).toMatchObject({ stage: 'lone-wolf' });
    const off = table({ players: [W, V, V], settings: { loneWolf: false } });
    off.toStep('werewolves');
    expect(prompt(off, 'A')).toBeNull();
    expect(off.state.round!.loneWolf).toBeNull();
  });

  it('the Curator with an empty bag does nothing; a card with an artifact can’t take another', () => {
    const empty = table({ players: ['curator', V, V], settings: { artifacts: [] } });
    empty.toStep('curator');
    expect(prompt(empty, 'A')).toBeNull();
    const full = table({ players: ['curator', V, V] });
    full.state.round!.cards.B!.artifact = 'void-of-nothingness';
    full.toStep('curator');
    expect(prompt(full, 'A')!.players!.ids).toEqual(['A', 'C']);
  });

  it.each([
    ['paranormal-investigator', true],
    ['tanner', false],
    ['apprentice-tanner', false],
  ] as const)('the Revealer on a %s card: stays face up = %s', (card, stays) => {
    const h = table({ players: ['revealer', card, V] });
    h.toStep('revealer');
    h.night('A', { players: ['B'] });
    expect(lastNote(h, 'A')).toMatchObject({ kind: 'revealed', role: card, stayed: stays });
    expect(h.state.round!.cards.B!.faceUp).toBe(stays);
  });

  it('the Squire and the Beholder can’t look at shielded cards', () => {
    const sq = table({ players: ['squire', W, W, V] });
    shield(sq, 'B');
    sq.toStep('squire');
    expect(prompt(sq, 'A')!.players!.ids).toEqual(['C']);
    const be = table({ players: ['beholder', 'seer', 'apprentice-seer', V] });
    shield(be, 'C');
    be.toStep('beholder');
    expect(prompt(be, 'A')!.players!.ids).toEqual(['B']);
  });

  it('the Cloak of the Prince protects; the Mist of the Vampire unmakes a Prince', () => {
    const cloak = table({ players: [V, W, V, V] });
    cloak.state.round!.cards.A!.artifact = 'cloak-of-the-prince';
    cloak.vote(votes('B,C,D>A; A>B'));
    expect(identity(cloak, 'A').role).toBe('prince');
    expect(cloak.state.round!.result!.protectedPlayers).toEqual(['A']);
    expect(dead(cloak)).toBe('');
    const mist = table({ players: ['prince', W, V, V], center: ['vampire', V, V] });
    mist.state.round!.cards.A!.artifact = 'mist-of-the-vampire';
    mist.vote(votes('B,C,D>A; A>B'));
    expect(identity(mist, 'A')).toMatchObject({ role: 'vampire', team: 'vampire' });
    expect(dead(mist)).toContain('A');
  });

  it('a Doppelgänger-Master is protected by the Master’s vote (B13)', () => {
    const h = table({ players: ['doppelganger', 'the-master', W, V, V] });
    h.toStep('doppelganger');
    h.night('A', { players: ['B'] });
    h.toStep('vampires');
    h.night('A', { players: ['D'] });
    h.vote(votes('B,C,D>A; A,E>C'));
    expect(h.state.round!.result!.protectedPlayers).toContain('A');
    expect(dead(h)).toBe('C');
    expect(explain(h).reasons[0]!.text).toMatch(/Ana survived: .*fellow vampire \(Ben and Dee\)/);
  });

  it('an epic battle with a dead Tanner: only the Tanner wins', () => {
    const h = table({ players: [W, 'vampire', 'tanner', V, V] });
    h.toStep('vampires');
    h.night('B', { players: ['E'] });
    h.vote(votes('A,B,D>C; C,E>A'));
    expect(h.state.round!.result!.epic).toBe(true);
    expect(dead(h)).toBe('AC');
    expect(winners(h)).toBe('C');
  });

  it('a Werewolf with the Mark of the Vampire turns the Cursed into a Vampire (S8)', () => {
    const h = table({ players: [W, 'vampire', 'cursed', V, V] });
    h.toStep('vampires');
    h.night('B', { players: ['A'] });
    h.vote(votes('A>C; B,C>D; D>E; E>A'));
    expect(identity(h, 'C')).toMatchObject({ converted: 'vampire', team: 'vampire' });
  });

  it('the Priest lifts the Mark of Fear, so the Seer wakes (S19)', () => {
    const h = table({ players: ['the-count', 'priest', 'seer', V, V] });
    h.toStep('vampires');
    h.night('A', { players: ['D'] });
    h.toStep('the-count');
    h.night('A', { players: ['C'] });
    expect(mark(h, 'C')).toBe('fear');
    h.toStep('priest');
    h.night('B', { players: ['C'] });
    expect(mark(h, 'C')).toBe('clarity');
    h.toStep('seer');
    expect(actors(h)).toEqual(['C']);
  });
});

describe('explaining the reveal', () => {
  it('names the Disease behind every disqualified vote', () => {
    const h = table({ players: [W, 'diseased', V, V, V] });
    h.toStep('diseased');
    h.night('B', { side: 'left' });
    expect(mark(h, 'C')).toBe('disease');
    h.vote(votes('B,C,E>A; A>B; D>C'));
    expect(explain(h).personal).toEqual([
      'Ana voted for Ben, the Diseased, so Ana can’t win.',
      'Dee voted for Cy, who held the Mark of Disease, so Dee can’t win.',
    ]);
  });

  it('says why a traitor lost while their side won', () => {
    const h = table({ players: [W, 'instigator', V, V, V] });
    h.toStep('instigator');
    h.night('B', { players: ['C'] });
    h.vote(votes('B,C,D,E>A; A>B'));
    expect(h.state.round!.result!.winners).not.toContain('C');
    expect(explain(h).personal).toContain(
      'Cy was a traitor: nobody else on their side died, so Cy lost though their side won.',
    );
  });

  it('says why the Assassin lost', () => {
    const h = table({ players: ['assassin', W, V, V] });
    h.toStep('assassin');
    h.night('A', { players: ['C'] });
    h.vote(votes('A,C,D>B; B>A'));
    expect(explain(h).personal).toContain(
      'Ana (Assassin) lost: nobody with the Mark of the Assassin died.',
    );
  });

  it('shows a Bodyguard’s protection even when nobody voted for that player', () => {
    const h = table({ players: ['bodyguard', W, V, V, V] });
    h.vote(votes('A>C; C,D,E>B; B>D'));
    expect(explain(h).reasons.map((r) => r.text)).toContain(
      'Ana (Bodyguard) protected Cy, though nobody voted for them.',
    );
  });

  it('never says a side won when Disease left nobody on it a winner', () => {
    const h = table({ players: ['vampire', 'diseased', V, V] });
    h.toStep('vampires');
    h.night('A', { players: ['B'] });
    h.toStep('diseased');
    h.night('B', { side: 'right' });
    expect(mark(h, 'A')).toBe('disease');
    // Nobody dies (one vote each). Both vampires voted for the Disease: A for the Diseased, B
    // for the holder of the Mark of Disease.
    h.vote(votes('A>B; B>A; C>D; D>C'));
    const result = h.state.round!.result!;
    expect(result.teams.find((t) => t.team === 'vampire')!.won).toBe(true);
    expect(result.winners).toEqual([]);
    const why = explain(h).why.join(' ');
    expect(why).not.toMatch(/vampire won/i);
    expect(why).toMatch(/would have won/);
  });
});

describe('a player leaving, at every stage', () => {
  const lobby = (n: number): NightfallState => {
    const rng = createRng(3);
    return nightfall.create(
      { now: NOW, rng, content: { wordLists: () => [], words: () => [] } },
      Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` })),
    );
  };

  it('in the lobby: they simply go', () => {
    const s = nightfall.playerLeft(lobby(4), 'p3', NOW);
    expect(Object.keys(s.seats)).toEqual(['p0', 'p1', 'p2']);
    expect(s.round).toBeNull();
  });

  it('while getting ready: the night starts once everyone left is ready', () => {
    let s = lobby(4);
    s = dealGame(s, { players: [W, V, V, 'seer'], center: [V, V, V] }, ['p0', 'p1', 'p2', 'p3']);
    for (const p of ['p0', 'p1', 'p2'])
      s = nightfall.reduce(
        s,
        { type: 'ready' },
        {
          by: p,
          isHost: p === 'p0',
          now: NOW,
          rng: createRng(1),
          content: { wordLists: () => [], words: () => [] },
        },
      ) as NightfallState;
    expect(s.stage).toBe('ready');
    s = nightfall.playerLeft(s, 'p3', NOW);
    expect(s.stage).toBe('night');
    expect(s.round!.players.p3!.left).toBe(true);
  });

  it('at night: their card stays and their step still runs, but they never wake', () => {
    const h = table({ players: [W, 'seer', 'robber', V] });
    leave(h, 'B');
    h.toStep('seer');
    expect(actors(h)).toEqual([]);
    h.toStep('robber');
    expect(prompt(h, 'C')!.players!.ids).toContain('B');
    h.night('C', { players: ['B'] });
    expect(h.role('C')).toBe('seer');
    h.dawn();
    expect(h.state.stage).toBe('day');
  });

  it('in the day: the vote opens once everyone still here is ready', () => {
    const h = table({ players: [W, V, V, V] });
    h.dawn();
    for (const p of ['A', 'B', 'C']) h.act({ type: 'ready-to-vote', ready: true }, p);
    expect(h.state.stage).toBe('day');
    leave(h, 'D');
    expect(h.state.stage).toBe('vote');
  });

  it('in the vote: the count happens once everyone still here has voted, without them', () => {
    const h = table({ players: [W, V, V, V] });
    h.dawn();
    h.act({ type: 'start-vote' }, 'A');
    for (const [p, t] of [
      ['A', 'B'],
      ['B', 'A'],
      ['C', 'A'],
    ] as const)
      h.act({ type: 'vote', target: t }, p);
    expect(h.state.stage).toBe('vote');
    leave(h, 'D');
    expect(h.state.stage).toBe('reveal');
    expect(h.state.round!.result!.votes.D).toBeNull();
    expect(dead(h)).toBe('A');
    // A player who left can't vote either.
    expect(h.state.round!.players.D!.left).toBe(true);
  });

  it('at the reveal: they leave the seats, and the result stays', () => {
    const h = table({ players: [W, V, V, V] });
    h.vote(votes('B,C,D>A; A>B'));
    leave(h, 'D');
    expect(h.state.stage).toBe('reveal');
    expect(h.state.seats.D).toBeUndefined();
    expect(h.state.round!.result).not.toBeNull();
  });

  it('when everyone has left mid-game, the room goes back to the lobby', () => {
    const h = table({ players: [W, V, V] });
    for (const p of ['A', 'B', 'C']) leave(h, p);
    expect(h.state.stage).toBe('lobby');
    expect(h.state.round).toBeNull();
  });

  it('a leaver’s late action is refused', () => {
    const h = table({ players: ['seer', V, V] });
    leave(h, 'A');
    h.toStep('seer');
    const r = nightfall.reduce(
      h.state,
      { type: 'night', step: h.state.round!.night!.index, players: ['B'] },
      {
        by: 'A',
        isHost: false,
        now: h.now,
        rng: createRng(1),
        content: { wordLists: () => [], words: () => [] },
      },
    );
    expect(r).toBeInstanceOf(GameError);
  });
});
