import { createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { autoGroups, editDistance, formsOf, groupLabel, sameAnswer } from './match.ts';

const groupsOf = (answers: string[]) => {
  const ids = answers.map((_, i) => `p${i + 1}`);
  const byId = Object.fromEntries(ids.map((id, i) => [id, answers[i]!]));
  return autoGroups(ids, byId).map((g) => g.members.map((id) => byId[id]!));
};

describe('sameAnswer: what counts as the same answer', () => {
  it.each([
    // Case, accents, punctuation, a leading article, plurals and simple stems (wordKey).
    ['Pizza', 'pizza'],
    ['Café', 'cafe'],
    ['the moon', 'Moon!'],
    ['Cats', 'cat'],
    // Spacing, hyphens and dashes.
    ['ice cream', 'ice-cream'],
    ['ice cream', 'icecream'],
    ['ice cream', 'ice — cream'],
    ['Spider-Man', 'spiderman'],
    ['New York', 'new-york'],
    // Word order.
    ['ice cream', 'cream ice'],
    ['salt and pepper', 'pepper and salt'],
    // One slip from 5 letters.
    ['pizza', 'pizzaa'],
    ['banana', 'banaa'],
    ['pepperoni', 'peperoni'],
    ['chocolate', 'chocolat'],
    ['flower', 'flowr'],
    ['the beach', 'teh beach'],
    ['Paris', 'Pairs'],
    // Two slips from 10 letters.
    ['chocolate cake', 'chocolat cak'],
    ['strawberries', 'strawberies'],
    ['watermelon slice', 'watermellon slise'],
    ['Leonardo DiCaprio', 'Leonardo Dicaprioo'],
  ])('"%s" = "%s"', (a, b) => {
    expect(sameAnswer(a, b)).toBe(true);
    expect(sameAnswer(b, a)).toBe(true);
  });

  it.each([
    // Under 5 letters only exact matches count.
    ['Mars', 'Mass'],
    ['Rome', 'Rose'],
    ['cat', 'cart'],
    ['red', 'bed'],
    ['dog', 'dig'],
    ['Leo', 'Lee'],
    ['tea', 'pea'],
    // Two slips are too many below 10 letters.
    ['flower', 'flour'],
    ['bread', 'beard'],
    ['pasta', 'pesto'],
    // Synonyms and abbreviations never match.
    ['USA', 'America'],
    ['Coke', 'Coca-Cola'],
    ['chips', 'fries'],
    ['TV', 'television'],
    ['NYC', 'New York'],
    // Different words.
    ['Tuesday', 'Thursday'],
    ['summer', 'winter'],
    ['apple pie', 'apple'],
  ])('"%s" ≠ "%s"', (a, b) => {
    expect(sameAnswer(a, b)).toBe(false);
    expect(sameAnswer(b, a)).toBe(false);
  });

  it('never matches an answer with no letters or digits', () => {
    expect(sameAnswer('!!!', '???')).toBe(false);
    expect(formsOf('—').plainRun).toBe('');
  });

  it('counts a swap of neighbours as one slip', () => {
    expect(editDistance('teh', 'the')).toBe(1);
    expect(editDistance('kitten', 'sitting')).toBe(3);
  });
});

describe('autoGroups', () => {
  it('groups by sameAnswer, in the order answers were first given, players in seat order', () => {
    expect(groupsOf(['Pizza', 'Soup', 'pizzaa', 'soup', 'Tacos'])).toEqual([
      ['Pizza', 'pizzaa'],
      ['Soup', 'soup'],
      ['Tacos'],
    ]);
  });

  it('links answers through one another', () => {
    // "pepperoni" ~ "peperoni" ~ "peperony": one group even though the ends are two apart.
    expect(groupsOf(['pepperoni', 'peperony', 'peperoni'])).toEqual([
      ['pepperoni', 'peperony', 'peperoni'],
    ]);
  });

  it('gives the same groups whoever typed what first', () => {
    const answers = [
      'ice cream',
      'Mars',
      'icecream',
      'Mass',
      'cream ice',
      'banana',
      'banaa',
      'USA',
      'America',
    ];
    const canonical = (groups: string[][]) => groups.map((g) => [...g].sort().join('|')).sort();
    const expected = canonical(groupsOf(answers));
    expect(expected).toEqual(
      ['America', 'Mars', 'Mass', 'USA', 'banaa|banana', 'cream ice|ice cream|icecream'].sort(),
    );
    const rng = createRng(3);
    for (let i = 0; i < 50; i++)
      expect(canonical(groupsOf(rng.shuffle(answers)))).toEqual(expected);
  });

  it('leaves players without an answer out', () => {
    expect(autoGroups(['p1', 'p2', 'p3'], { p1: 'a', p3: 'a' })).toEqual([
      { id: 'g1', members: ['p1', 'p3'] },
    ]);
  });

  it('labels each group with its most common spelling', () => {
    const answers = { p1: 'pizzaa', p2: 'Pizza', p3: 'pizza', p4: 'PIZZA ' };
    const [group] = autoGroups(['p1', 'p2', 'p3', 'p4'], answers);
    expect(groupLabel(group!, answers)).toBe('Pizza');
  });
});
