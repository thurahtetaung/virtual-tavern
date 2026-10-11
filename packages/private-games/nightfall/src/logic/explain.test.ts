import { describe, expect, it } from 'vitest';
import { type ExplainNames, explainResult } from './explain.ts';
import { type Harness, table, votes } from './test-utils.ts';

const W = 'werewolf';
const V = 'villager';

const NAMES: ExplainNames = {
  player: (id) => ({ A: 'Ana', B: 'Ben', C: 'Cy', D: 'Dee', E: 'Eve', F: 'Fay' })[id] ?? id,
  role: (role) => role.charAt(0).toUpperCase() + role.slice(1).replace(/-/g, ' '),
  team: (team) =>
    ({ village: 'Village', werewolf: 'Werewolves', vampire: 'Vampires' })[team as 'village'] ??
    team,
};

const explain = (h: Harness) => {
  const e = explainResult(h.state.round!.result!, NAMES);
  return { ...e, reasons: e.reasons.map((r) => r.text) };
};

describe('explainResult', () => {
  it('gives the full tally, most votes first', () => {
    const h = table({ players: [W, 'seer', V, V, V] });
    h.vote(votes('B,C,D>A; A,E>B'));
    expect(explain(h).tally).toEqual([
      { player: 'A', votes: 3 },
      { player: 'B', votes: 2 },
    ]);
    expect(explain(h).reasons).toEqual(['Ana got the most votes (3) and died.']);
    expect(explain(h).why).toEqual(['Village won: Ana was on an evil side, and died.']);
  });

  it('names the Bodyguard who saved the most voted player', () => {
    const h = table({ players: ['bodyguard', W, V, V, V, V] });
    h.vote(votes('A,C,D,E>B; B,F>C'));
    const { reasons, why, tally } = explain(h);
    // The Bodyguard's pick is protection, not a vote.
    expect(tally).toEqual([
      { player: 'B', votes: 3 },
      { player: 'C', votes: 2 },
    ]);
    expect(reasons).toEqual([
      'Ben was protected by Ana (Bodyguard).',
      'Cy got the most votes (2) and died.',
    ]);
    expect(why).toEqual(['Werewolves won: no werewolf died.']);
  });

  it('explains why nobody died: protection, then nobody else above one vote', () => {
    const h = table({ players: ['prince', W, V, V, V] });
    h.vote(votes('B,C,D>A; A>B; E>C'));
    expect(explain(h).reasons).toEqual([
      'Ana is the Prince, so the vote couldn’t kill them.',
      'Nobody else got more than one vote, so nobody was voted out.',
    ]);
  });

  it('says when nobody got more than one vote', () => {
    const h = table({ players: [W, 'seer', V, V] });
    h.vote(votes('A>B; B>C; C>D; D>A'));
    expect(explain(h).reasons).toEqual(['Nobody got more than one vote, so nobody was voted out.']);
    expect(explain(h).why).toEqual(['Werewolves won: no werewolf died.']);
  });

  it('explains a tie', () => {
    const h = table({ players: [W, V, 'seer', V, V], center: [W, 'robber', 'troublemaker'] });
    h.vote(votes('A>B; C>B; B>A; D>A; E>C'));
    expect(explain(h).reasons).toEqual([
      'Ana tied for the most votes (2) and died.',
      'Ben tied for the most votes (2) and died.',
    ]);
    // Each death line carries its death, for the icons.
    expect(
      explainResult(h.state.round!.result!, NAMES).reasons.map((r) => r.death?.player),
    ).toEqual(['A', 'B']);
  });

  it('explains the Hunter’s shot, and a shot stopped by protection', () => {
    const h = table({ players: [W, 'hunter', 'seer', V, V] });
    h.vote(votes('A,C,D>B; B>A; E>C'));
    expect(explain(h).reasons).toEqual([
      'Ben got the most votes (3) and died.',
      'The Hunter (Ben) took Ana with them.',
    ]);
    const blocked = table({ players: ['hunter', W, 'bodyguard', V, V, V] });
    blocked.vote(votes('B,D,E>A; A>B; C>B; F>D'));
    expect(explain(blocked).reasons).toEqual([
      'Ben was protected by Cy (Bodyguard).',
      'Ana got the most votes (3) and died.',
      'The Hunter (Ana) aimed at Ben, but Ben was protected.',
    ]);
  });

  it('explains a lover dying with the other', () => {
    const h = table({ players: ['the-master', 'vampire', 'cupid', V, V, V] });
    h.toStep('vampires');
    h.night('B', { players: ['F'] });
    h.toStep('cupid');
    h.night('C', { players: ['A', 'D'] });
    h.vote(votes('B,D,E>A; A>D; C>D; F>E'));
    const { reasons } = explain(h);
    expect(reasons).toContain('Ana died as Dee’s lover.');
    expect(reasons).toContain('Dee got the most votes (2) and died.');
  });

  it('explains the Cursed turning', () => {
    const h = table({ players: ['cursed', W, V, V, 'seer'] });
    h.vote(votes('B,C,D>A; A,E>B'));
    expect(explain(h).reasons).toContain(
      'Ana (Cursed) got a werewolf’s vote, and joined the werewolves.',
    );
  });

  it('says why nobody won', () => {
    const h = table({ players: ['seer', 'robber', 'troublemaker'], center: [W, W, V] });
    h.vote(votes('A,B>C; C>A'));
    expect(explain(h).why).toEqual([
      'Nobody won: there was no werewolf or vampire among the players, yet someone died.',
    ]);
    const tanner = table({ players: [W, 'tanner', V, V, V] });
    tanner.vote(votes('A,C,D>B; B,E>C'));
    expect(explain(tanner).why).toEqual(['tanner won: Ben wanted to die, and did.']);
  });

  it('says the village won when there was nobody evil and nobody died', () => {
    const h = table({ players: ['seer', 'robber', 'troublemaker'], center: [W, W, V] });
    h.vote(votes('A>B; B>C; C>A'));
    expect(explain(h).why).toEqual([
      'Village won: there was no werewolf or vampire among the players, and nobody died.',
    ]);
  });
});

describe('explainResult with the Alien set', () => {
  const STARE = {
    alien: { view: 0, 'all-view': 0, stare: 1, show: 0, timer: 0, left: 0, right: 0 },
    ripple: {
      none: 1,
      'one-minute': 0,
      'face-away': 0,
      'two-hand-vote': 0,
      'no-speak': 0,
      'view-1': 0,
      'view-2': 0,
      'dual-view': 0,
      insomniac: 0,
      troublemaker: 0,
      steal: 0,
      drunk: 0,
      witch: 0,
      reveal: 0,
      shuffle: 0,
      'repeat-night': 0,
      'repeat-observer': 0,
    },
  };
  const names: ExplainNames = {
    ...NAMES,
    team: (t) =>
      ({ alien: 'Aliens', village: 'Village', synthetic: 'Synthetic' })[t as 'alien'] ?? t,
  };
  const why = (h: Harness) => explainResult(h.state.round!.result!, names);

  it('says the aliens won with no alien dead', () => {
    const h = table({ players: ['alien', 'alien', 'seer', V, V], settings: { weights: STARE } });
    h.vote(votes('A,B,D>C; C>A; E>D'));
    expect(why(h).why).toEqual(['Aliens won: no alien died.']);
  });

  it('explains the Leader vote', () => {
    const h = table({
      players: ['alien', 'alien', 'leader', V, 'seer'],
      settings: { weights: STARE },
    });
    h.vote(votes('A,B>C; C,D,E>A'));
    expect(why(h).why).toEqual([
      'Aliens won: every player on their side voted for the Leader, so an alien dying didn’t matter.',
    ]);
  });

  it('explains the Synthetic Alien’s death', () => {
    const h = table({
      players: ['alien', 'synthetic-alien', 'seer', V, V],
      settings: { weights: STARE },
    });
    h.vote(votes('A,C,D,E>B; B>A'));
    expect(why(h).why).toEqual([
      'Synthetic won: Ben wanted to die, and did.',
      'Ben died as the Synthetic alien, so the aliens and the village can’t win.',
    ]);
  });

  it('names the Blob’s members, the Mortician’s neighbours and the Oracle’s failed number', () => {
    const h = table({
      players: ['blob', V, W, 'mortician', 'seer'],
      settings: { weights: { mortician: { 'one-card': 0, 'both-cards': 0, pretend: 1 } } },
    });
    h.toStep('blob');
    h.state.round!.blob = { left: 1, right: 0 };
    h.vote(votes('B,D,E>C; C>B; A>B'));
    expect(why(h).personal).toEqual([
      'Ana (Blob) won: nobody in the Blob died (Ben and the Blob).',
      'Dee (Mortician) won: Cy, next to them, died.',
    ]);
  });

  it('says who was on the aliens’ side without an alien card', () => {
    const h = table({
      players: ['body-snatcher', 'alien', V, 'seer', V],
      settings: { weights: { ...STARE, 'body-snatcher': { steal: 1, center: 0, pretend: 0 } } },
    });
    h.toStep('body-snatcher');
    const night = h.state.round!.night!;
    night.picks![night.index] = { kind: 'body-snatcher', action: 'steal', from: { kind: 'any' } };
    h.night('A', { players: ['C'] });
    h.vote(votes('A,B,D,E>C; C>A'));
    expect(explainResult(h.state.round!.result!, names).reasons.map((r) => r.text)).toContain(
      'Ana was on the aliens’ side: they hold the card the Body snatcher took, now an Alien card.',
    );
  });
});
