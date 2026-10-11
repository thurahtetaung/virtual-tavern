import { describe, expect, it } from 'vitest';
import { isNumberOnly, isSingleWord, normaliseWord, wordKey, wordPool } from './words.ts';

describe('normaliseWord', () => {
  it('lowercases, trims and collapses spaces', () => {
    expect(normaliseWord('  Ice   CREAM ')).toBe('ice cream');
  });

  it('removes accents, precomposed or not', () => {
    expect(normaliseWord('Café')).toBe('cafe');
    expect(normaliseWord('Café')).toBe('cafe');
    expect(normaliseWord('naïve')).toBe('naive');
  });

  it('strips punctuation at either end but not inside', () => {
    expect(normaliseWord('"hello!"')).toBe('hello');
    expect(normaliseWord('...well?')).toBe('well');
    expect(normaliseWord('ice-cream')).toBe('ice-cream');
  });

  it('drops a possessive with either apostrophe', () => {
    expect(normaliseWord("dog's")).toBe('dog');
    expect(normaliseWord('Dog’s')).toBe('dog');
    expect(normaliseWord("dogs'")).toBe('dogs');
  });
});

describe('wordKey', () => {
  const same = (...words: string[]) => {
    const keys = new Set(words.map(wordKey));
    expect(keys.size, `${words.join(' / ')} -> ${[...keys].join(', ')}`).toBe(1);
  };
  const apart = (a: string, b: string) => {
    expect(wordKey(a), `${a} vs ${b}`).not.toBe(wordKey(b));
  };

  it('matches case and plural variants', () => {
    same('Cat', 'cats', 'CAT', 'Cats!');
    same('berries', 'berry');
    same('boxes', 'box');
    same('buses', 'bus');
    same('glass', 'glasses');
    same('horse', 'horses');
    same('egg', 'eggs');
  });

  it('matches accented and plain spellings', () => {
    same('café', 'cafe', 'CAFÉ', 'cafes');
  });

  it('matches possessives', () => {
    same("dog's", 'dog', 'dogs', 'Dog’s');
  });

  it('matches common word endings', () => {
    same('run', 'runs', 'runner', 'running');
    same('play', 'played', 'playing', 'player');
    same('bake', 'baking', 'baker', 'baked');
  });

  it('matches plurals of words with an ending', () => {
    same('crossing', 'crossings');
    same('Zebra crossing', 'zebra crossings');
    same('player', 'players', 'play');
    same('bakers', 'baker');
    expect(wordKey('beds')).toBe('bed');
  });

  it('matches -ie words with their -ies plurals', () => {
    same('Gaberlunzie', 'gaberlunzies', 'GABERLUNZIE');
    same('pixie', 'pixies');
    same('movie', 'movies');
    same('cookie', 'cookies');
    same('pie', 'pies');
    same('berry', 'berries');
  });

  it('drops a leading article from a phrase', () => {
    same('Gaberlunzie', 'A gaberlunzie', 'the Gaberlunzies', 'an gaberlunzie');
    same('The Moon', 'moon');
    expect(wordKey('a')).toBe('a');
    expect(wordKey('The')).toBe('the');
    apart('a cat', 'a dog');
  });

  it('keeps short and merely similar words apart', () => {
    apart('bus', 'busy');
    apart('cat', 'catalog');
    apart('sing', 'song');
    apart('red', 'reed');
    apart('bed', 'bad');
  });

  // The stemmer has no dictionary: it would rather cancel two near-identical clues than let
  // them both through. These pairs are accepted over-cancelling, not bugs.
  it('over-cancels some pairs on purpose', () => {
    same('sing', 'singer', 'singing');
    same('hat', 'hate', 'hated');
  });

  it('never stems below three letters', () => {
    expect(wordKey('bed')).toBe('bed');
    expect(wordKey('ties')).toBe('tie');
    expect(wordKey('is')).toBe('is');
  });
});

describe('isSingleWord / isNumberOnly', () => {
  it('accepts letters, digits, apostrophes and hyphens', () => {
    for (const w of ['moon', "dog's", 'ice-cream', 'café', 'Café', 'R2D2', '42']) {
      expect(isSingleWord(w), w).toBe(true);
    }
  });

  it('rejects spaces and other punctuation', () => {
    for (const w of ['ice cream', 'moon!', 'a.b', '', 'a/b'])
      expect(isSingleWord(w), w).toBe(false);
  });

  it('spots number-only clues', () => {
    expect(isNumberOnly('42')).toBe(true);
    expect(isNumberOnly('R2')).toBe(false);
    expect(isNumberOnly('seven')).toBe(false);
  });
});

describe('wordPool', () => {
  it('drops blanks and case-insensitive duplicates', () => {
    expect(wordPool([' Moon', 'moon', '', 'Sun'])).toEqual(['Moon', 'Sun']);
  });
});
