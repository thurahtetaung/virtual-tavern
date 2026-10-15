import type { HoodwinkView } from '../logic/types.ts';

const seconds = (s: number) => (s % 60 === 0 ? `${s / 60} min` : `${s} s`);

/** One line for the folded timer settings, e.g. "lies 1 min, votes 30 s, strict". */
export function timerSummary(s: HoodwinkView['settings']): string {
  if (s.clueSeconds === null && s.guessSeconds === null) return 'no time limits';
  const parts = [
    s.clueSeconds !== null && `lies ${seconds(s.clueSeconds)}`,
    s.guessSeconds !== null && `votes ${seconds(s.guessSeconds)}`,
    s.timerMode === 'strict' ? 'strict' : 'reminder only',
  ];
  return parts.filter(Boolean).join(', ');
}

/** The guests' summary: rounds, the deck (or how many), then the timers. */
export function settingsSummary(view: Pick<HoodwinkView, 'decks' | 'settings'>): string[] {
  const names = view.decks.filter((d) => view.settings.deckIds.includes(d.id)).map((d) => d.name);
  return [
    `${view.settings.rounds} rounds`,
    names.length > 1 ? `${names.length} decks` : (names[0] ?? 'no deck'),
    timerSummary(view.settings),
  ];
}
