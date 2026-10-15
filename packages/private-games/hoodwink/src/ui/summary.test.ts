import { fitSummary, summaryFits, summaryText } from '@vt/ui';
import { describe, expect, it } from 'vitest';
import type { HoodwinkView } from '../logic/types.ts';
import { settingsSummary } from './summary.ts';

const deck = (id: string, name: string) =>
  ({
    id,
    name,
    description: '',
    questionCount: 100,
    adult: false,
    updatedAt: 0,
    games: [],
  }) as HoodwinkView['decks'][number];

describe('the guests’ settings summary', () => {
  it('counts several decks (the list is one tap away), in two lines at 360 and 390 px', () => {
    const view = {
      decks: [
        deck('a', 'Strange but True Animals'),
        deck('b', 'History’s Oddities'),
        deck('c', 'Food'),
        deck('d', 'Science'),
      ],
      settings: {
        rounds: 10,
        deckIds: ['a', 'b', 'c', 'd'],
        clueSeconds: 90,
        guessSeconds: 45,
        timerMode: 'strict',
      },
    } as Pick<HoodwinkView, 'decks' | 'settings'>;
    const parts = settingsSummary(view);
    expect(parts).toEqual(['10 rounds', '4 decks', 'lies 90 s, votes 45 s, strict']);
    for (const width of [360, 390]) {
      const text = summaryText(
        parts,
        fitSummary(parts, (t) => summaryFits(t, 'Settings', width)),
      );
      expect(text).toBe(parts.join(' · '));
      expect(summaryFits(text, 'Settings', width)).toBe(true);
    }
    const one = { ...view, settings: { ...view.settings, deckIds: ['a'] } };
    expect(settingsSummary(one)[1]).toBe('Strange but True Animals');
  });
});
