import { describe, expect, it } from 'vitest';
import { belowBoard, rowHeight } from './Board.tsx';

describe('belowBoard', () => {
  it('measures to the foot of the last part under the board', () => {
    // The clue line above, the board ending at 576, the guess bar in the column down to 874.
    const parts = [
      { bottom: 332, fixed: false },
      { bottom: 874.2, fixed: false },
    ];
    expect(belowBoard(parts, 576)).toBe(299);
    expect(belowBoard([{ bottom: 300, fixed: false }], 576)).toBe(0);
    expect(belowBoard([], 576)).toBe(0);
  });

  it('leaves out a fixed bar at the foot of the window, which is not in the column', () => {
    // Measured as the window turned wide, the guess bar was still the phone's fixed bar at the
    // window's foot (900): counting it left the rows at their 40 px floor.
    const parts = [
      { bottom: 332, fixed: false },
      { bottom: 694, fixed: false },
      { bottom: 900, fixed: true },
    ];
    expect(belowBoard(parts, 576)).toBe(118);
    expect(rowHeight(900 - 344 - 24 - 324, 120)).toBe(40);
  });
});
