import { describe, expect, it } from 'vitest';
import { fitSummary, summaryText } from './summary-fit.ts';
import { linesAt, summaryFits, summaryWidth, textWidth } from './summary-width.ts';

describe('fitSummary', () => {
  const parts = ['12 cards', 'Werewolf ×2', 'Seer', 'Robber', 'Troublemaker'];

  it('shows every part that fits and counts the rest', () => {
    expect(summaryText(parts)).toBe('12 cards · Werewolf ×2 · Seer · Robber · Troublemaker');
    expect(summaryText(parts, 2)).toBe('12 cards · Werewolf ×2 · +3 more');
    expect(fitSummary(parts, () => true)).toBe(5);
    expect(fitSummary(parts, (t) => t.length <= 40)).toBe(3);
  });

  it('keeps the first part however little room there is', () => {
    expect(fitSummary(parts, () => false)).toBe(1);
    expect(fitSummary([], () => false)).toBe(0);
  });
});

describe('summary width estimate', () => {
  it('measures the live check’s cut Nightfall list as too long for 360 px but not 390 px', () => {
    const cut = '6 cards: Werewolf ×2, Seer, Robber, Troublemaker, Villager';
    expect(summaryFits(cut, 'The cards', 360)).toBe(false);
    expect(summaryFits(cut, 'The cards', 390)).toBe(true);
    const inquest =
      'Forensic Scientist: random · Accomplice · Witness · events · final accusations';
    expect(summaryFits(inquest, 'Settings', 390)).toBe(false);
    expect(summaryFits('Codenames: core words · no time limits')).toBe(true);
  });

  it('wraps at spaces', () => {
    expect(linesAt('a b', textWidth('a b'))).toBe(1);
    expect(linesAt('a b', textWidth('a b') - 1)).toBe(2);
    expect(summaryWidth('Settings')).toBeGreaterThan(summaryWidth('Game settings'));
  });
});
