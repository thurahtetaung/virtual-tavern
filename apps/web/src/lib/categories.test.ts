import { describe, expect, it } from 'vitest';
import { chipsOf, shows } from './categories.ts';

const loud = { id: 'loud', name: 'Loud', emoji: '📣', order: 0 };
const quiet = { id: 'quiet', name: 'Quiet', emoji: '🤫', order: 1 };
const odd = { id: 'odd', name: 'Odd', emoji: '🦄', order: 2 };

describe('category chips', () => {
  it('offer each category a listed game has once, in the admin’s order', () => {
    expect(chipsOf([{ categories: [odd, quiet] }, { categories: [loud, quiet] }, {}])).toEqual([
      loud,
      quiet,
      odd,
    ]);
    expect(chipsOf([{ categories: [] }])).toEqual([]);
  });

  it('show every game with none chosen, else only games with every chosen category', () => {
    expect(shows([], [])).toBe(true);
    expect(shows(['loud'], [loud, quiet])).toBe(true);
    expect(shows(['loud', 'quiet'], [loud, quiet, odd])).toBe(true);
    expect(shows(['odd', 'quiet'], [quiet])).toBe(false);
    expect(shows(['odd'], [loud, quiet])).toBe(false);
    expect(shows(['odd'], [])).toBe(false);
  });
});
