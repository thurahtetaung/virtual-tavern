import { describe, expect, it } from 'vitest';
import { goingOnce } from '../logic/definition.ts';
import { PLACEHOLDER_NAMES } from '../logic/names.ts';
import { started } from '../logic/test-utils.ts';
import { statusFor, unquote } from './text.ts';

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

describe('the status line while drawing', () => {
  it('says to listen until the auctioneer calls for the drawings, then what to draw', () => {
    const h = started(3);
    const view = goingOnce.view(h.state, 'p1');
    const name = () => 'Someone';
    const waiting = statusFor(view, 'p1', name, PLACEHOLDER_NAMES, false);
    expect(waiting).toEqual({
      text: 'Listen to the auctioneer.',
      yourMove: false,
    });
    const open = statusFor(view, 'p1', name, PLACEHOLDER_NAMES);
    expect(open.text).toMatch(/^Draw “.+” \(1 of 2\)\.$/);
    expect(open.yourMove).toBe(true);
  });
});
