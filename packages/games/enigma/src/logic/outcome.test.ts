import { describe, expect, it } from 'vitest';
import { type Tallies, tokenWords, winReason, winnerFrom } from './outcome.ts';

const tallies = (red: [number, number], blue: [number, number]): Tallies => ({
  red: { intercepts: red[0], misses: red[1] },
  blue: { intercepts: blue[0], misses: blue[1] },
});

describe('winnerFrom and winReason', () => {
  it('is undecided before anyone reaches 2 tokens and before round 8', () => {
    expect(winnerFrom(tallies([1, 1], [1, 0]), 3)).toBeNull();
    expect(winReason(tallies([1, 1], [1, 0]), 3)).toBeNull();
  });

  it('names two interceptions as the reason', () => {
    expect(winnerFrom(tallies([2, 0], [0, 0]), 3)).toBe('red');
    expect(winReason(tallies([2, 0], [0, 0]), 3)).toBe('Red intercepted 2 codes.');
  });

  it("names the other team's two miscommunications as the reason", () => {
    expect(winnerFrom(tallies([0, 0], [0, 2]), 4)).toBe('red');
    expect(winReason(tallies([0, 0], [0, 2]), 4)).toBe('Blue had 2 miscommunications.');
  });

  it('settles both teams reaching 2 tokens by score', () => {
    expect(winnerFrom(tallies([2, 1], [2, 0]), 4)).toBe('blue');
    expect(winReason(tallies([2, 1], [2, 0]), 4)).toMatch(/Both teams .*Red \+1, Blue \+2/);
  });

  it('settles round 8 by score, and calls a level score a draw', () => {
    expect(winnerFrom(tallies([1, 1], [1, 1]), 8)).toBe('draw');
    expect(winReason(tallies([1, 1], [1, 1]), 8)).toMatch(/After round 8 .*level/);
  });

  it('spells out tokens in words', () => {
    expect(tokenWords(1, 2)).toBe('🕵️ 1 interception · 💥 2 miscommunications');
  });
});
