import { fitSummary, summaryFits, summaryText } from '@vt/ui';
import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_SETS } from '../logic/names.ts';
import { deckSummary } from './summary.ts';

const setName = (k: string) => PLACEHOLDER_SETS[k as keyof typeof PLACEHOLDER_SETS] ?? k;
const none = { x1: false, x2: false, x3: false, x4: false, faster: false };

describe('the guests’ deck summary', () => {
  it('names a single expansion and counts several', () => {
    expect(deckSummary({ ...none, x2: true }, 'Classic deck', setName)).toEqual([
      'Classic deck',
      'Expansion 2',
    ]);
    expect(deckSummary({ ...none, x1: true, x3: true }, null, setName)).toEqual([
      'Custom deck',
      '2 expansions',
    ]);
  });

  it('says everything in two lines at 360 and 390 px with every expansion on', () => {
    const all = { x1: true, x2: true, x3: true, x4: true, faster: true };
    const parts = deckSummary(all, 'Adult deck (18+)', setName);
    expect(parts).toEqual(['Adult deck (18+)', '4 expansions', 'faster game']);
    for (const width of [360, 390]) {
      expect(fitSummary(parts, (t) => summaryFits(t, 'The deck', width))).toBe(3);
      expect(summaryFits(summaryText(parts), 'The deck', width)).toBe(true);
    }
    // A long expansion name from the manifest still shows; the screen counts what follows.
    const long = deckSummary(
      { ...none, x4: true, faster: true },
      'Party deck',
      () => 'The Haunted Expansion',
    );
    expect(fitSummary(long, (t) => summaryFits(t, 'The deck', 360))).toBeGreaterThanOrEqual(2);
  });
});
