// The picture cards, shared with Starlight (which plays the same art): ids only, no names.

/**
 * The card sets. The art lives in private storage as `cards/<n padded to 3>.jpg`; set *names* come
 * from the private manifest there, so the repo only knows ids and card numbers. The numbering has
 * a print-sheet quirk: eleven numbers were never used, so sets are 84-card blocks of the numbers
 * that exist rather than plain ranges.
 */
export interface CardSet {
  id: string;
  cards: number[];
}

export const LAST_CARD = 877;
const MISSING_CARDS = new Set([69, 139, 209, 279, 349, 419, 489, 559, 629, 699, 769]);
const SET_SIZE = 84;
const SET_IDS = [
  'base',
  'set-2',
  'set-3',
  'set-4',
  'set-5',
  'set-6',
  'set-7',
  'set-8',
  'set-9',
  'set-10',
  'extras',
];

export const ALL_CARDS: readonly number[] = Array.from(
  { length: LAST_CARD + 1 },
  (_, n) => n,
).filter((n) => !MISSING_CARDS.has(n));

export const CARD_SETS: readonly CardSet[] = SET_IDS.map((id, i) => ({
  id,
  cards: ALL_CARDS.slice(i * SET_SIZE, (i + 1) * SET_SIZE),
}));

export const cardsIn = (set: CardSet) => set.cards;
