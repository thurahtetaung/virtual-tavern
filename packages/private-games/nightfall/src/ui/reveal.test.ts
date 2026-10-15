import { describe, expect, it } from 'vitest';
import { explainResult } from '../logic/explain.ts';
import { ARTIFACTS } from '../logic/roles.ts';
import { DEFAULT_WEIGHTS, type WeightTable, type Weights } from '../logic/tables.ts';
import { type Harness, dead, table, votes, winners } from '../logic/test-utils.ts';
import { deckFor } from './assets.ts';
import {
  TEAM_LABEL,
  describeEntry,
  describeNote,
  foretoldBadge,
  foretoldInCentre,
  teamLines,
} from './text.ts';

// The end screen after an Alien-set playtest: who Nostradamus was announced for, steps whose card
// was in the centre, the Exposer, the Oracle's failed number, Groob and Zerb, and the village.

const W = 'werewolf';
const V = 'villager';
const deck = deckFor(null, (id) => ARTIFACTS[id].summary);
const NAMES: Record<string, string> = { A: 'Ana', B: 'Ben', C: 'Cy', D: 'Dee', E: 'Eve', F: 'Fay' };
const nameOf = (id: string | null | undefined) => NAMES[id ?? ''] ?? 'Someone';
const names = {
  player: nameOf,
  role: deck.name,
  team: (t: keyof typeof TEAM_LABEL) => TEAM_LABEL[t],
};
const only = (t: WeightTable, key: string): Weights => ({
  [t]: Object.fromEntries(Object.keys(DEFAULT_WEIGHTS[t]).map((k) => [k, k === key ? 1 : 0])),
});
const ws = (...all: Weights[]): Weights => all.reduce<Weights>((a, b) => ({ ...a, ...b }), {});
const STARE = only('alien', 'stare');
const NO_RIPPLE = only('ripple', 'none');
const explain = (h: Harness) => explainResult(h.state.round!.result!, names);
/** The reveal's lines for one step, by role id. */
const stepLines = (h: Harness, stepId: string) =>
  h.state
    .round!.night!.timeline.filter((t) => t.stepId === stepId)
    .map((t) => describeEntry(t, nameOf, deck));

describe('Nostradamus announced on a side whose card ended in the centre', () => {
  const setup = () => {
    const h = table({ players: ['nostradamus', W, 'seer', V], center: ['synthetic-alien', V, V] });
    h.toStep('nostradamus');
    h.tick();
    // The narrator drew the Synthetic Alien, whose only card is in the centre.
    const r = h.state.round!;
    r.cards.A!.foretold = { team: 'synthetic', card: r.center[0]!.card.id };
    h.vote(votes('A,C,D>B; B>A'));
    return h;
  };

  it('names that side, not "Nostradamus", and says nobody could win it', () => {
    const h = setup();
    const id = h.state.round!.result!.identities.A!;
    expect(id).toMatchObject({ team: 'nostradamus', foretold: { team: 'synthetic' } });
    expect(explain(h).personal).toContain(
      `Ana (${deck.name('nostradamus')}) was announced on the side of the ${deck.name('synthetic-alien')}, whose card ended in the centre, so nobody could win it.`,
    );
    expect(explain(h).personal.join(' ')).not.toMatch(/foresaw/);
    expect(foretoldInCentre(id)).toBe(true);
    expect(foretoldBadge(id, deck, nameOf)).toBe(
      `side of the ${deck.name('synthetic-alien')} (card in the centre)`,
    );
  });

  it('names the holder on the badge when someone holds the card', () => {
    const h = table({
      players: ['nostradamus', 'mortician', W, 'seer', V],
      settings: { weights: only('mortician', 'pretend') },
    });
    h.toStep('nostradamus');
    h.night('A', { players: ['B'] });
    h.tick();
    h.vote(votes('A,B,D,E>C; C>A'));
    const id = h.state.round!.result!.identities.A!;
    expect(foretoldInCentre(id)).toBe(false);
    expect(foretoldBadge(id, deck, nameOf)).toBe(`side of the ${deck.name('mortician')} (Ben)`);
  });

  it('says the side once in the timeline: the announcement, not a second line for him', () => {
    const h = table({ players: ['nostradamus', V, W, 'seer'] });
    h.toStep('nostradamus');
    h.night('A', { players: ['C'] });
    h.tick();
    const lines = stepLines(h, 'nostradamus');
    expect(lines.filter((l) => /on the side of/.test(l))).toHaveLength(1);
    expect(lines.at(-1)).toMatch(/^Announced: /);
    // His own note still tells him.
    expect(h.state.round!.notes.A!.some((n) => n.kind === 'foretold')).toBe(true);
  });
});

describe('a step whose card was in the centre, in the timeline', () => {
  it('the Oracle: nobody had her card, and the narrator’s own answer', () => {
    const h = table({
      players: [W, 'seer', V, V],
      center: ['oracle', V, V],
      settings: { weights: only('oracle', 'even-odd') },
    });
    h.toStep('oracle');
    h.tick();
    const lines = stepLines(h, 'oracle');
    expect(lines[0]).toMatch(/^The narrator said: /);
    expect(lines[1]).toBe('Nobody at the table had this card.');
    expect(lines[2]).toMatch(/^The narrator answered for the Oracle: “(even|odd)”\.$/);
  });

  it('the Empath: nobody had her card, though the named players pointed', () => {
    const h = table({
      players: [W, 'seer', V, V, V],
      center: ['empath', V, V],
      settings: { weights: ws(only('empath', 'awesome'), NO_RIPPLE) },
    });
    h.toStep('empath');
    h.tick();
    const lines = stepLines(h, 'empath');
    expect(lines).toContain('Nobody at the table had this card.');
    expect(lines.some((l) => /pointed at/.test(l))).toBe(true);
  });

  it('an Empath at the table: no such line', () => {
    const h = table({
      players: ['empath', W, 'seer', V, V],
      settings: { weights: ws(only('empath', 'awesome'), NO_RIPPLE) },
    });
    h.toStep('empath');
    h.tick();
    expect(stepLines(h, 'empath')).not.toContain('Nobody at the table had this card.');
  });

  it('nothing in the night’s views: the timeline waits for the reveal', () => {
    const h = table({
      players: [W, 'seer', V, V],
      center: ['oracle', V, V],
      settings: { weights: only('oracle', 'even-odd') },
    });
    h.toStep('oracle');
    h.tick();
    for (const p of ['A', 'B', 'C', 'D'])
      expect(JSON.stringify(h.view(p))).not.toMatch(/"nobody"|answered for/);
  });
});

describe('the Exposer', () => {
  it('with every centre card already face up, turned none', () => {
    const h = table({
      players: ['exposer', W, 'seer', V],
      settings: { weights: only('exposer', 'flip-1') },
    });
    for (const c of h.state.round!.center) c.card.faceUp = true;
    h.toStep('exposer');
    const entry = h.state.round!.night!.timeline.find((t) => t.note.kind === 'blocked')!;
    expect(describeEntry(entry, nameOf, deck)).toBe(
      'Every centre card was already face up, so Ana turned none.',
    );
    expect(describeNote(entry.note as never, nameOf, deck, undefined, 'A')).toBe(
      'Every centre card was already face up, so you turned none.',
    );
  });

  it('lists the cards turned in card order, whatever order they were tapped in', () => {
    const h = table({
      players: ['exposer', W, 'seer', V],
      settings: { weights: only('exposer', 'flip-3') },
    });
    h.toStep('exposer');
    h.night('A', { center: [1, 2, 0] });
    const turned = h.state.round!.night!.timeline.flatMap((t) =>
      t.note.kind === 'exposed' ? [t.note.center] : [],
    );
    expect(turned).toEqual([0, 1, 2]);
  });
});

describe('the Oracle’s failed number on the end screen', () => {
  const setup = (vote: string) => {
    const h = table({
      players: ['oracle', W, 'seer', V, V],
      settings: { weights: only('oracle', 'number') },
      seed: 2,
    });
    h.toStep('oracle');
    h.night('A', { choice: '7' });
    expect(h.state.round!.oracle!.numberFail).toBe(true);
    h.vote(votes(vote));
    expect(h.state.round!.result!.oracleRule).toBe('oracle');
    return h;
  };

  it('she lived: only she won, and no side is credited', () => {
    const h = setup('A,C,D,E>B; B>C');
    expect(dead(h)).toBe('B');
    expect(winners(h)).toBe('A');
    expect(explain(h).why).toEqual(['The Oracle (Ana) lived, so only she won.']);
    const lines = teamLines(h.state.round!.result!);
    expect(lines.find((t) => t.team === 'village')).toMatchObject({
      won: false,
      sideWon: false,
      exceptions: ['A'],
    });
    expect(lines.find((t) => t.team === 'werewolf')).toMatchObject({ won: false });
  });

  it('she died: everyone else won', () => {
    const h = setup('B,C,D,E>A; A>B');
    expect(dead(h)).toBe('A');
    expect(explain(h).why).toEqual(['The Oracle (Ana) died, so everyone else won.']);
    const lines = teamLines(h.state.round!.result!);
    expect(lines.find((t) => t.team === 'village')).toMatchObject({ won: true, exceptions: ['A'] });
    expect(lines.find((t) => t.team === 'werewolf')).toMatchObject({ won: true });
  });
});

describe('Groob and Zerb with the Mark of Fear', () => {
  it('a Feared rival is still a player: the awake one only learns nobody else woke', () => {
    const h = table({
      players: ['groob', 'zerb', 'the-count', 'vampire', V, 'seer'],
      settings: { weights: ws(STARE, NO_RIPPLE) },
    });
    h.toStep('vampires');
    h.night('D', { players: ['E'] });
    h.toStep('the-count');
    h.night('C', { players: ['B'] });
    h.toStep('groob-zerb');
    const g = h.state.round!.notes.A!.at(-1)!;
    expect(g).toMatchObject({ kind: 'group', group: 'groob-zerb', players: ['A'] });
    expect(describeNote(g, nameOf, deck, undefined, 'A')).toBe('Your rival didn’t wake up.');
  });
});

describe('the village’s win, with aliens in the game', () => {
  it('names the aliens among the sides nobody held', () => {
    const h = table({
      players: ['seer', V, V, V],
      center: ['alien', 'alien', V],
      settings: { weights: ws(STARE, NO_RIPPLE) },
    });
    h.vote(votes('A>B; B>C; C>D; D>A'));
    const sides = ['alien'] as const;
    expect(explainResult(h.state.round!.result!, names, null, sides).why).toEqual([
      'Village won: there was no alien among the players, and nobody died.',
    ]);
    expect(explain(h).why.join(' ')).toMatch(/alien/);
  });
});
