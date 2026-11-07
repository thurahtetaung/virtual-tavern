import { describe, expect, it } from 'vitest';
import { resolveTextFor } from './resolve.ts';

const names = new Map([
  ['a', 'Ana'],
  ['h', 'Hana'],
]);

describe('resolveTextFor', () => {
  it('names the viewer "you", with the verb and possessive to match', () => {
    expect(resolveTextFor('{p:h} was dead last, then took the crown', names, null, 'h')).toBe(
      'You were dead last, then took the crown',
    );
    expect(resolveTextFor('{p:a} & {p:h} matched 4 times', names, null, 'h')).toBe(
      'Ana & you matched 4 times',
    );
    expect(resolveTextFor('Even liars got {p:h}’s art', names, null, 'h')).toBe(
      'Even liars got your art',
    );
    expect(resolveTextFor('{p:h}’s drawings spoke clearly', names, null, 'h')).toBe(
      'Your drawings spoke clearly',
    );
  });

  it('leaves everyone else’s lines as they are', () => {
    expect(resolveTextFor('{p:a} would not stop', names, null, 'h')).toBe('Ana would not stop');
    expect(resolveTextFor('{p:a} would not stop', names, null, undefined)).toBe(
      'Ana would not stop',
    );
  });
});
