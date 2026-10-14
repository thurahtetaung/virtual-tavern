import { describe, expect, it } from 'vitest';
import { breakPoint, estimate, fitSize, longerLine, softBreaks } from './fit.ts';

const chars = (text: string) => text.length;

describe('longerLine', () => {
  it('keeps a single word on one line', () => {
    expect(longerLine('Microphone', chars)).toBe(10);
  });

  it('splits a phrase between its words as evenly as possible', () => {
    expect(longerLine('Fortress of Solitude', chars)).toBe(11); // FORTRESS OF / SOLITUDE
    expect(longerLine('Ice Cream', chars)).toBe(5);
    expect(longerLine('Lady of the Lake', chars)).toBe(8); // LADY OF / THE LAKE
  });
});

describe('fitSize', () => {
  it('shrinks longer words, down to a 7px floor', () => {
    expect(fitSize('Cat', estimate)).toBe('max(0.4375rem, 39.17cqw)');
    expect(fitSize('Microphone', estimate)).toBe('max(0.4375rem, 11.75cqw)');
  });
});

describe('softBreaks', () => {
  const shown = (word: string) => softBreaks(word).replace('\u00ad', '|');

  it('never touches words of up to 10 letters', () => {
    for (const word of ['Cat', 'Potion', 'Kangaroo', 'Microphone', 'Watermelon', 'Flashlight']) {
      expect(softBreaks(word), word).toBe(word);
    }
    expect(softBreaks('Fortress of Solitude')).toBe('Fortress of Solitude');
  });

  it('puts one soft hyphen in a long word, at a syllable-ish point', () => {
    expect(shown('Stormtrooper')).toBe('Storm|trooper');
    expect(shown('Skateboarding')).toBe('Skateboar|ding');
    expect(shown('Constellation')).toBe('Constel|lation');
    expect(shown('PlayStation')).toBe('Play|Station');
    expect(shown('Cheerleader')).toBe('Cheer|leader');
    expect(shown('Commissioner Gordon')).toBe('Commis|sioner Gordon');
  });

  it('leaves hyphenated words to break at their own hyphen', () => {
    expect(softBreaks('Harley-Davidson')).toBe('Harley-Davidson');
  });

  it('keeps the split at least four letters from either end', () => {
    for (const word of ['Microtransaction', 'Photosynthesis', 'Deathstroke']) {
      const at = breakPoint(word);
      expect(at, word).toBeGreaterThanOrEqual(4);
      expect(at, word).toBeLessThanOrEqual(word.length - 4);
    }
  });
});
