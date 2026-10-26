/**
 * The deck. Suits are plain colour ids; `multi` is the multicolour suit and `black` the black
 * powder suit, both host options. Display names here are plain words; art comes from the private
 * manifest.
 */

export const BASE_SUITS = ['red', 'yellow', 'green', 'blue', 'white'] as const;
export const SUITS = [...BASE_SUITS, 'multi', 'black'] as const;
export type Suit = (typeof SUITS)[number];
export type BaseSuit = (typeof BASE_SUITS)[number];

export const RANKS = [1, 2, 3, 4, 5] as const;
export type Rank = (typeof RANKS)[number];

/**
 * The multicolour options: `off`; `6th`, a sixth suit of 10 cards clued as its own colour;
 * `one-each`, the same with one card of each number (5 cards); `wild`, 10 cards that every colour
 * clue touches and no clue may name.
 */
export const MULTI_MODES = ['off', '6th', 'one-each', 'wild'] as const;
export type MultiMode = (typeof MULTI_MODES)[number];

export interface Card {
  suit: Suit;
  rank: Rank;
}

/** Copies of each number: 3/2/2/2/1 for a full suit, one of each for the short multicolour. */
const FULL: Record<Rank, number> = { 1: 3, 2: 2, 3: 2, 4: 2, 5: 1 };
const ONE_EACH: Record<Rank, number> = { 1: 1, 2: 1, 3: 1, 4: 1, 5: 1 };
/** Black powder is played 5 down to 1, so its copies run the other way. */
const BLACK: Record<Rank, number> = { 1: 1, 2: 2, 3: 2, 4: 2, 5: 3 };

export interface DeckOptions {
  multi: MultiMode;
  black: boolean;
}

/** The suits in play, in table order. */
export function suitsFor(o: DeckOptions): Suit[] {
  return [
    ...BASE_SUITS,
    ...(o.multi !== 'off' ? (['multi'] as const) : []),
    ...(o.black ? (['black'] as const) : []),
  ];
}

/** How many copies of a number a suit has in this game. */
export function copiesOf(suit: Suit, rank: Rank, o: DeckOptions): number {
  if (suit === 'black') return o.black ? BLACK[rank] : 0;
  if (suit === 'multi')
    return o.multi === 'off' ? 0 : o.multi === 'one-each' ? ONE_EACH[rank] : FULL[rank];
  return FULL[rank];
}

/** Every card of the deck, unshuffled, suit by suit. */
export function deckFor(o: DeckOptions): Card[] {
  return suitsFor(o).flatMap((suit) =>
    RANKS.flatMap((rank) =>
      Array.from({ length: copiesOf(suit, rank, o) }, () => ({ suit, rank })),
    ),
  );
}

/** Cards in each hand: 5 with 2 or 3 players, 4 with 4 or 5. */
export const handSize = (players: number) => (players <= 3 ? 5 : 4);

/** Black powder builds 5 → 1; every other firework 1 → 5. */
export const descending = (suit: Suit) => suit === 'black';

/** The number a firework of this height needs next, or null once it is complete. */
export function nextRank(suit: Suit, height: number): Rank | null {
  if (height >= 5) return null;
  return (descending(suit) ? 5 - height : height + 1) as Rank;
}

/** Whether a card of this number is already on its firework. */
export function played(suit: Suit, rank: Rank, height: number): boolean {
  return descending(suit) ? rank > 5 - height : rank <= height;
}

/** The highest possible score: 25, or 30 with a multicolour suit (black powder never adds). */
export const maxScore = (o: DeckOptions) => (o.multi !== 'off' ? 30 : 25);

/**
 * The show's score: every firework's height, except black powder, which takes 1 off for each of
 * its cards still missing (so it starts at −5 and a finished one adds nothing).
 */
export function scoreOf(fireworks: Partial<Record<Suit, number>>): number {
  let n = 0;
  for (const [suit, h] of Object.entries(fireworks) as [Suit, number][])
    n += suit === 'black' ? h - 5 : h;
  return n;
}

/** The rulebook's scale: what the crowd makes of a score. */
export function ratingOf(score: number, max: number): string {
  if (score >= 30) return 'Divine';
  if (score >= max || score >= 25) return 'Legendary';
  if (score >= 21) return 'Amazing';
  if (score >= 16) return 'Excellent';
  if (score >= 11) return 'Honourable';
  if (score >= 6) return 'Mediocre';
  return 'Booed';
}

/** What the crowd does at each rating, for the end screen. */
export const RATING_LINE: Record<string, string> = {
  Booed: 'Horrible, booed by the crowd.',
  Mediocre: 'Mediocre, just a hint of scattered applause.',
  Honourable: 'An honourable attempt, but quickly forgotten.',
  Excellent: 'Excellent, the crowd is pleased.',
  Amazing: 'Amazing: they will be talking about it for weeks.',
  Legendary: 'Legendary: everyone is speechless, with stars in their eyes.',
  Divine: 'Divine: a show for the ages.',
};

/** Plain names for the suits. */
export const SUIT_NAME: Record<Suit, string> = {
  red: 'Red',
  yellow: 'Yellow',
  green: 'Green',
  blue: 'Blue',
  white: 'White',
  multi: 'Multicolour',
  black: 'Black',
};

/** Each suit's symbol, printed on every card so colour is never the only clue. */
export const SUIT_SYMBOL: Record<Suit, string> = {
  red: '▲',
  yellow: '★',
  green: '♣',
  blue: '◆',
  white: '●',
  multi: '✦',
  black: '✸',
};

/** "Red 3", "Black 5". */
export const cardName = (c: Card) => `${SUIT_NAME[c.suit]} ${c.rank}`;

/** One-letter codes for the test rig: r y g b w, m for multicolour, k for black. */
export const SUIT_LETTER: Record<string, Suit> = {
  r: 'red',
  y: 'yellow',
  g: 'green',
  b: 'blue',
  w: 'white',
  m: 'multi',
  k: 'black',
};
