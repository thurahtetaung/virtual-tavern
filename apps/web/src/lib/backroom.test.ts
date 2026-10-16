import { describe, expect, it } from 'vitest';
import { doorOf } from './backroom.ts';

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
});
