import type { Settings } from '../logic/types.ts';

/**
 * The guests' summary of the deck: the preset (or a custom deck), the expansion by name, or how
 * many when there are several (the list is one tap away), then the faster game.
 */
export function deckSummary(
  s: Pick<Settings, 'x1' | 'x2' | 'x3' | 'x4' | 'faster'>,
  preset: string | null,
  setName: (set: string) => string,
): string[] {
  const sets = (['x1', 'x2', 'x3', 'x4'] as const).filter((x) => s[x]);
  return [
    preset ?? 'Custom deck',
    ...(sets.length > 1 ? [`${sets.length} expansions`] : sets.map((x) => setName(x))),
    ...(s.faster ? ['faster game'] : []),
  ];
}
