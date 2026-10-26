import {
  BASE_SUITS,
  type Card,
  type DeckOptions,
  type MultiMode,
  RANKS,
  type Rank,
  type Suit,
  copiesOf,
  suitsFor,
} from './cards.ts';

/** The colours a clue may name: the five, and multicolour when it is its own colour. */
export const CLUE_COLOURS = [...BASE_SUITS, 'multi'] as const;
export type ClueColour = (typeof CLUE_COLOURS)[number];

export type Clue = { colour: ClueColour; rank?: undefined } | { rank: Rank; colour?: undefined };

/** The colours the clue picker offers: never black, and never multicolour when it is wild. */
export function colourChoices(multi: MultiMode): ClueColour[] {
  return multi === '6th' || multi === 'one-each' ? [...CLUE_COLOURS] : [...BASE_SUITS];
}

/**
 * Whether a clue touches a card: a number clue its number; a colour clue its colour, and with
 * wild multicolour every multicolour card too. Black powder is colourless: no colour reaches it.
 */
export function touches(clue: Clue, card: Card, multi: MultiMode): boolean {
  if (clue.rank !== undefined) return card.rank === clue.rank;
  if (card.suit === 'black') return false;
  return card.suit === clue.colour || (multi === 'wild' && card.suit === 'multi');
}

/** "red", "3": a clue as it reads on a mark and in the log. */
export const clueWord = (clue: Clue) => (clue.rank !== undefined ? String(clue.rank) : clue.colour);

/**
 * What the clues told the holder about one card: the colours and numbers that touched it, and
 * those that were given to their hand and missed it.
 */
export interface Knowledge {
  colours: ClueColour[];
  ranks: Rank[];
  notColours: ClueColour[];
  notRanks: Rank[];
}

export const noKnowledge = (): Knowledge => ({
  colours: [],
  ranks: [],
  notColours: [],
  notRanks: [],
});

const add = <T>(xs: T[], x: T) => {
  if (!xs.includes(x)) xs.push(x);
};

/** Notes a clue on a card of the clued hand (touched or not). */
export function learn(k: Knowledge, clue: Clue, touched: boolean) {
  if (clue.rank !== undefined) add(touched ? k.ranks : k.notRanks, clue.rank);
  else add(touched ? k.colours : k.notColours, clue.colour);
}

/** Whether any clue ever touched the card. */
export const clued = (k: Knowledge) => k.colours.length > 0 || k.ranks.length > 0;

/** The suits a card may still be, given what the clues said. */
export function possibleSuits(k: Knowledge, o: DeckOptions): Suit[] {
  return suitsFor(o).filter(
    (suit) =>
      k.colours.every((c) => touches({ colour: c }, { suit, rank: 1 }, o.multi)) &&
      !k.notColours.some((c) => touches({ colour: c }, { suit, rank: 1 }, o.multi)),
  );
}

/** The numbers a card may still be, given what the clues said. */
export function possibleRanks(k: Knowledge): Rank[] {
  return RANKS.filter((r) => k.ranks.every((x) => x === r) && !k.notRanks.includes(r));
}

/** One identity a card may have, with how many of its copies the viewer can't account for. */
export interface Possibility {
  suit: Suit;
  rank: Rank;
  left: number;
}

const key = (c: Card) => `${c.suit}-${c.rank}`;

/**
 * Full help: every identity the card may have, from the clues, minus the copies the viewer can
 * see elsewhere (the discards, the fireworks and the teammates' hands). Identities with no copy
 * left drop out; if the counting rules everything out (it can't, unless a test rigs it), the
 * clue-only list is kept.
 */
export function possibilities(k: Knowledge, o: DeckOptions, seen: readonly Card[]): Possibility[] {
  const counts = new Map<string, number>();
  for (const c of seen) counts.set(key(c), (counts.get(key(c)) ?? 0) + 1);
  const ranks = possibleRanks(k);
  const all = possibleSuits(k, o).flatMap((suit) =>
    ranks.flatMap((rank) => {
      const total = copiesOf(suit, rank, o);
      return total ? [{ suit, rank, left: total - (counts.get(key({ suit, rank })) ?? 0) }] : [];
    }),
  );
  const open = all.filter((p) => p.left > 0);
  return open.length ? open : all;
}
