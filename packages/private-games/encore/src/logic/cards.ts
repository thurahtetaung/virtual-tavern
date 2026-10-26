/**
 * The deck: one card for every pair of different numbers from 1 to 10 (45 cards, all unique).
 * A card's id is its two numbers, low first: `"3-8"`.
 */
export interface CardDef {
  id: string;
  /** The lower number. */
  a: number;
  /** The higher number. */
  b: number;
}

export const NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;

export const CARDS: readonly CardDef[] = NUMBERS.flatMap((a) =>
  NUMBERS.filter((b) => b > a).map((b) => ({ id: `${a}-${b}`, a, b })),
);

const BY_ID = new Map(CARDS.map((c) => [c.id, c]));

export function cardOf(id: string): CardDef {
  const c = BY_ID.get(id);
  if (!c) throw new Error(`unknown card ${id}`);
  return c;
}

export const isCard = (id: string) => BY_ID.has(id);

/** The card whose holder starts the first round. */
export const START_CARD = '1-2';

/** Cards in play by player count: 3 players leave out every 10, 2 and 4 the 9/10 card. */
export function deckFor(players: number): string[] {
  return CARDS.filter((c) =>
    players === 3 ? c.b !== 10 : players === 5 ? true : c.id !== '9-10',
  ).map((c) => c.id);
}

/** Cards dealt to each player by player count. */
export const HAND_SIZE: Record<number, number> = { 2: 11, 3: 12, 4: 11, 5: 9 };
