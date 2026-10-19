import { CARD_SETS, STELLAR_SET } from '../logic/cards.ts';
import type { Manifest } from './assets.ts';

/** A set description that only lists card numbers ("Cards 000–084") means nothing to players. */
const plainDescription = (d: string | undefined) =>
  d && !/^cards?\s*#?\d+\s*[–—-]\s*#?\d+\.?$/i.test(d.trim()) ? d : undefined;

/** The card sets as a `ChoicePicker`'s choices, named from the private manifest when it has loaded. */
export function cardSetChoices(manifest: Manifest | null | 'unavailable') {
  const setNames = new Map(
    manifest && manifest !== 'unavailable' ? manifest.sets.map((s) => [s.id, s]) : [],
  );
  return CARD_SETS.map((s) => ({
    id: s.id,
    name:
      setNames.get(s.id)?.name ??
      (s.id === 'base'
        ? 'Base set'
        : s.id === 'extras'
          ? 'Extras'
          : s.id === STELLAR_SET
            ? 'Starlight cards'
            : `Set ${s.id.split('-')[1]}`),
    description: plainDescription(setNames.get(s.id)?.description),
    count: s.cards.length,
  }));
}
