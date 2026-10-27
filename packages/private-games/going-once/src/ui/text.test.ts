import { describe, expect, it } from 'vitest';
import { unquote } from './text.ts';

describe('a title in quotes', () => {
  it('drops the quote marks a title brings itself, so screens show one pair', () => {
    expect(unquote('“Quick! Clean this place before mom gets home!”')).toBe(
      'Quick! Clean this place before mom gets home!',
    );
    expect(unquote('"Fine print"')).toBe('Fine print');
    expect(unquote(' ‘Top hat’ ')).toBe('Top hat');
    expect(`“${unquote('“Hello”')}”`).toBe('“Hello”');
  });

  it('leaves quotes inside a title, and a title that is only quote marks, alone', () => {
    expect(unquote('Apple')).toBe('Apple');
    expect(unquote('The “best” apple')).toBe('The “best” apple');
    expect(unquote('Rock ’n’ roll')).toBe('Rock ’n’ roll');
    expect(unquote('""')).toBe('""');
    expect(unquote('Students’')).toBe('Students’');
  });
});
