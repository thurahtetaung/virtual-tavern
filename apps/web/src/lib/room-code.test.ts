import { describe, expect, it } from 'vitest';
import { EXAMPLE_ROOM_CODE, parseRoomCode } from './room-code.ts';

describe('parseRoomCode', () => {
  it('reads a bare code', () => {
    expect(parseRoomCode('rapid-willow-lute-e7en')).toBe('rapid-willow-lute-e7en');
    expect(parseRoomCode('  Rapid-Willow-Lute-E7EN  ')).toBe('rapid-willow-lute-e7en');
  });

  it('accepts spaces (or a mix) in place of hyphens', () => {
    expect(parseRoomCode('rapid willow lute e7en')).toBe('rapid-willow-lute-e7en');
    expect(parseRoomCode('rapid  willow-lute   e7en')).toBe('rapid-willow-lute-e7en');
    expect(parseRoomCode('rapid - willow - lute - e7en')).toBe('rapid-willow-lute-e7en');
  });

  it('reads a whole invite link', () => {
    expect(parseRoomCode('https://tavern.example/r/rapid-willow-lute-e7en')).toBe(
      'rapid-willow-lute-e7en',
    );
    expect(parseRoomCode('http://localhost:5173/r/rapid-willow-lute-e7en/?x=1')).toBe(
      'rapid-willow-lute-e7en',
    );
  });

  it('rejects anything else', () => {
    for (const bad of [
      '',
      'hello',
      'rapid willow lute',
      'rapid willow lute e7e',
      'a b c d e1234',
    ]) {
      expect(parseRoomCode(bad), bad).toBeNull();
    }
  });

  it('has a valid example', () => {
    expect(parseRoomCode(EXAMPLE_ROOM_CODE)).toBe(EXAMPLE_ROOM_CODE);
  });
});
