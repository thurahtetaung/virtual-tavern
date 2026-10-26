// The 40 playing cards: four colours valued 1–9 and four trumps valued 1–4. A card is a short id,
// its suit letter and value ("p3" is the pink 3, "t4" the top trump).

export const COLOURS = ['p', 'b', 'g', 'y'] as const;
export const TRUMP = 't';
export const SUITS = [...COLOURS, TRUMP] as const;
export type Colour = (typeof COLOURS)[number];
export type Suit = (typeof SUITS)[number];
export type CardId = string;

export const COLOUR_VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
export const TRUMP_VALUES = [1, 2, 3, 4] as const;
/** The trump that names the captain. */
export const TOP_TRUMP = 't4';

export const card = (suit: Suit, value: number): CardId => `${suit}${value}`;
export const suitOf = (id: CardId) => id[0] as Suit;
export const valueOf = (id: CardId) => Number(id.slice(1));
export const isTrump = (id: CardId) => suitOf(id) === TRUMP;

export const DECK: readonly CardId[] = [
  ...COLOURS.flatMap((s) => COLOUR_VALUES.map((v) => card(s, v))),
  ...TRUMP_VALUES.map((v) => card(TRUMP, v)),
];
const IN_DECK = new Set(DECK);
export const isCard = (id: unknown): id is CardId => typeof id === 'string' && IN_DECK.has(id);

const SUIT_ORDER: Record<Suit, number> = { p: 0, b: 1, g: 2, y: 3, t: 4 };

/** Hand order: by colour, trumps last, low to high. */
export const sortCards = (cards: readonly CardId[]) =>
  [...cards].sort(
    (a, b) => SUIT_ORDER[suitOf(a)] - SUIT_ORDER[suitOf(b)] || valueOf(a) - valueOf(b),
  );

/** Cards a player may play to a trick: they must follow the led suit if they can. */
export function legalCards(hand: readonly CardId[], led: Suit | null): CardId[] {
  if (led === null) return [...hand];
  const follow = hand.filter((c) => suitOf(c) === led);
  return follow.length ? follow : [...hand];
}

/** The index of the winning card: the highest trump, else the highest card of the led suit. */
export function winningIndex(cards: readonly CardId[]): number {
  // The best card so far is always of the led suit or a trump; anything else never wins.
  let best = 0;
  for (let i = 1; i < cards.length; i++) {
    const c = cards[i]!;
    const b = cards[best]!;
    if (suitOf(c) === suitOf(b) ? valueOf(c) > valueOf(b) : isTrump(c)) best = i;
  }
  return best;
}

/** Where a signalled card sits in its owner's colour: highest, only or lowest. */
export type Position = 'top' | 'only' | 'bottom';

/** The positions a colour card may be signalled with now (an only card is all three). */
export function signalPositions(hand: readonly CardId[], c: CardId): Position[] {
  if (isTrump(c) || !hand.includes(c)) return [];
  const same = hand.filter((h) => suitOf(h) === suitOf(c)).map(valueOf);
  const v = valueOf(c);
  if (same.length === 1) return ['top', 'only', 'bottom'];
  const out: Position[] = [];
  if (v === Math.max(...same)) out.push('top');
  if (v === Math.min(...same)) out.push('bottom');
  return out;
}

/** Card filters used by tasks: any of these suits and/or values (both must match when given). */
export interface CardMatch {
  suits?: Suit[];
  values?: number[];
  cards?: CardId[];
}

export function matches(m: CardMatch, c: CardId): boolean {
  if (m.cards && !m.cards.includes(c)) return false;
  if (m.suits && !m.suits.includes(suitOf(c))) return false;
  if (m.values && !m.values.includes(valueOf(c))) return false;
  return true;
}

/** How many cards in the deck a filter matches. */
export const deckCount = (m: CardMatch) => DECK.filter((c) => matches(m, c)).length;
