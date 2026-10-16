import { describe, expect, it } from 'vitest';
import { doorOf, lockedLine } from './backroom.ts';

describe('the back room door', () => {
  it('asks for the word until the browser is unlocked', () => {
    expect(doorOf(null)).toBe('waiting');
    expect(doorOf({ open: false, unlocked: false })).toBe('closed');
    expect(doorOf({ open: true, unlocked: false })).toBe('knock');
    expect(doorOf({ open: true, unlocked: true })).toBe('member');
  });

  it('always lets the admin in, password or not', () => {
    expect(doorOf({ open: true, unlocked: true, admin: true })).toBe('admin');
    expect(doorOf({ open: false, unlocked: true, admin: true })).toBe('admin');
  });

  it('tells a word change apart from an admin who signed out', () => {
    const line = (query: string) => lockedLine(new URLSearchParams(query));
    expect(line('next=/r/abc')).toBeNull();
    expect(line('next=/r/abc&locked=changed')).toBe('The word has changed — ask for the new one.');
    expect(line('changed=1')).toBe('The word has changed — ask for the new one.');
    expect(line('locked=signed-out')).toBe(
      "You signed out of the tavern keeper's room. Enter the word to come back in.",
    );
    expect(line('locked=none')).toBe('Your way in has run out. Enter the word to come back in.');
  });
});
