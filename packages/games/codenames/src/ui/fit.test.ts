import { describe, expect, it } from 'vitest';
import { estimate, fitSize, longerLine } from './fit.ts';

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
