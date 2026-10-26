import { describe, expect, it } from 'vitest';
import { emptyBoard, previewOf } from '../logic/rules.ts';
import type { Board } from '../logic/types.ts';
import { placeDetail, spillOf } from './text.ts';

const shielded = (b: Board = emptyBoard()): Board => ({ ...b, shield: null });

describe('pick sheet: where the tiles and the marker go', () => {
  it('a shield that catches the marker leaves every spilled tile on the floor', () => {
    // 3 black + the marker into line 1: 1 on the line, 2 to the floor, the marker on the shield.
    const p = previewOf(shielded(), 'black', 3, 0, true);
    expect(spillOf(p)).toBe(2);
    expect(p.penalty).toBe(-2);
    expect(placeDetail(p, 3, true)).toBe(
      '1 here, fills it ✓; 2 spill to the floor; the marker onto your shield',
    );
  });

  it('a shield without the marker catches the first spilled tile', () => {
    const p = previewOf(shielded(), 'black', 3, 0, false);
    expect(spillOf(p)).toBe(2);
    expect(p.penalty).toBe(-1);
    expect(placeDetail(p, 3, false)).toBe(
      '1 here, fills it ✓; 2 spill: 1 to the floor, 1 onto your shield',
    );
  });

  it('the marker without a shield goes to the floor first', () => {
    const p = previewOf(emptyBoard(), 'red', 2, 0, true);
    expect(placeDetail(p, 2, true)).toBe(
      '1 here, fills it ✓; 1 spill to the floor; the marker to the floor',
    );
  });

  it('the floor target names the shield, the floor and the lid', () => {
    const b = shielded({ ...emptyBoard(), floor: ['red', 'red', 'red', 'red', 'red', 'red'] });
    const p = previewOf(b, 'blue', 4, 'floor', false);
    expect(placeDetail(p, 4, false)).toBe(
      'all 4: 1 to the floor, 1 onto your shield, 2 to the lid',
    );
    expect(placeDetail(previewOf(emptyBoard(), 'blue', 3, 'floor', false), 3, false)).toBe(
      'all 3 to the floor',
    );
  });

  it('a line that takes everything spills nothing', () => {
    const p = previewOf(emptyBoard(), 'red', 2, 3, false);
    expect(placeDetail(p, 2, false)).toBe('2 here');
  });
});
