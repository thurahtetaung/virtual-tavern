import { describe, expect, it } from 'vitest';
import { CITIES } from '../logic/cities.ts';
import { cityLabel } from './text.ts';

describe('cityLabel', () => {
  it('reads well for every City side', () => {
    expect(Object.fromEntries(CITIES.map((c) => [c.id, cityLabel(c.id)]))).toEqual({
      C1a: 'City C1a: 16 points, plus cards: 1 Diamond, 1 Sapphire, 1 Emerald, 1 Ruby and 1 Onyx',
      C1b: 'City C1b: 17 points, no cards needed',
      C2a: 'City C2a: 11 points, plus cards: 3 Diamond, 3 Emerald, 3 Ruby and 3 Onyx',
      C2b: 'City C2b: 11 points, plus cards: 3 Diamond, 3 Sapphire, 3 Ruby and 3 Onyx',
      C3a: 'City C3a: 13 points, plus cards: 3 Diamond and 4 Sapphire',
      C3b: 'City C3b: 13 points, plus cards: 4 Diamond and 3 Ruby',
      C4a: 'City C4a: 15 points, plus cards: 5 of one colour',
      C4b: 'City C4b: 12 points, plus cards: 6 of one colour',
      C5a: 'City C5a: 13 points, plus cards: 3 Sapphire and 4 Emerald',
      C5b: 'City C5b: 14 points, plus cards: 4 Emerald and 4 of one other colour',
      C6a: 'City C6a: 13 points, plus cards: 2 Diamond, 2 Sapphire, 2 Emerald, 2 Ruby and 2 Onyx',
      C6b: 'City C6b: 14 points, plus cards: 2 Diamond, 1 Sapphire, 1 Emerald, 2 Ruby and 2 Onyx',
      C7a: 'City C7a: 13 points, plus cards: 4 Ruby and 3 Onyx',
      C7b: 'City C7b: 13 points, plus cards: 3 Emerald and 4 Onyx',
    });
    for (const c of CITIES) expect(cityLabel(c.id)).not.toMatch(/ {2}|\(|undefined/);
  });

  it('says when the viewer meets it', () => {
    expect(cityLabel('C1b', true)).toBe('City C1b: 17 points, no cards needed. You meet it');
  });
});
