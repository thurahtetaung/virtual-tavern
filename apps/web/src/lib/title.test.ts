import { describe, expect, it } from 'vitest';
import { roomTitle } from './title.ts';

describe('roomTitle', () => {
  it('names the game and the site', () => {
    expect(roomTitle('Codenames', false)).toBe('Codenames · Virtual Tavern');
  });

  it('leads with a marker when it is your move', () => {
    expect(roomTitle('Enigma', true)).toBe('● Your turn · Enigma · Virtual Tavern');
  });
});
