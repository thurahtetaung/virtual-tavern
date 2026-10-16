import { PLAYER_COLORS } from '@vt/protocol';
import { describe, expect, it } from 'vitest';
import { freeColor, withColors } from './colors.ts';

describe('player colours', () => {
  it('picks among the colours nobody has', () => {
    const taken = PLAYER_COLORS.filter((c) => c !== 'teal' && c !== 'lime');
    expect(freeColor(taken, () => 0)).toBe('teal');
    expect(freeColor(taken, (n) => n - 1)).toBe('lime');
  });

  it('shares the least used colours once every colour is taken', () => {
    const taken = [...PLAYER_COLORS, ...PLAYER_COLORS.filter((c) => c !== 'grey')];
    expect(freeColor(taken, () => 0)).toBe('grey');
  });

  it('colours players saved without one, in join order, the same way every time', () => {
    const players = [
      { id: 'a', name: 'Ana' },
      { id: 'b', name: 'Ben', color: 'red' as const },
      { id: 'c', name: 'Cy' },
    ];
    expect(withColors(players).map((p) => p.color)).toEqual(['blue', 'red', 'green']);
    expect(withColors(players)).toEqual(withColors(players));
  });
});
