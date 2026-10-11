import { describe, expect, it } from 'vitest';
import { pageTitle, roomTitle } from './title.ts';

describe('roomTitle', () => {
  it('names the game and the site', () => {
    expect(roomTitle('Codenames', false)).toBe('Codenames · Virtual Tavern');
  });

  it('leads with a marker when it is your move', () => {
    expect(roomTitle('Enigma', true)).toBe('● Your turn · Enigma · Virtual Tavern');
  });
});

describe('pageTitle', () => {
  it('puts the page before the site, and the landing page is just the site', () => {
    expect(pageTitle('How to play Echo')).toBe('How to play Echo · Virtual Tavern');
    expect(pageTitle()).toBe('Virtual Tavern');
  });
});
