import { type CardDef, cardOf, nobleOf } from './cards.ts';
import {
  DOUBLE_MIN,
  GEMS,
  type Gem,
  MARKET_SIZE,
  MAX_RESERVED,
  type Pieces,
  TOKENS,
  type Token,
} from './types.ts';

/**
 * The pure arithmetic of the table, shared by the engine, the bot and the UI's assists: bonuses,
 * points, what a card still costs, how to pay for it, which takes are legal and which nobles
 * would visit.
 */

export const noPieces = (): Pieces => ({
  white: 0,
  blue: 0,
  green: 0,
  red: 0,
  black: 0,
  gold: 0,
});

export const noGems = (): Record<Gem, number> => ({
  white: 0,
  blue: 0,
  green: 0,
  red: 0,
  black: 0,
});

export const totalOf = (p: Partial<Record<Token, number>>) =>
  TOKENS.reduce((n, t) => n + (p[t] ?? 0), 0);

/** Permanent discounts: one per bought card of that colour. */
export function bonusesOf(cards: readonly string[]): Record<Gem, number> {
  const out = noGems();
  for (const id of cards) out[cardOf(id).bonus] += 1;
  return out;
}

export function pointsOf(cards: readonly string[], nobles: readonly string[]): number {
  return (
    cards.reduce((n, id) => n + cardOf(id).points, 0) +
    nobles.reduce((n, id) => n + nobleOf(id).points, 0)
  );
}

/** What a card still costs in each colour once bonuses are taken off. */
export function costAfter(card: CardDef, bonuses: Record<Gem, number>): Record<Gem, number> {
  const out = noGems();
  for (const g of GEMS) out[g] = Math.max(0, card.cost[g] - bonuses[g]);
  return out;
}

/** Gold the player would need on top of their gems, per colour. */
export function shortfall(
  card: CardDef,
  bonuses: Record<Gem, number>,
  tokens: Pieces,
): Record<Gem, number> {
  const need = costAfter(card, bonuses);
  const out = noGems();
  for (const g of GEMS) out[g] = Math.max(0, need[g] - tokens[g]);
  return out;
}

/** Whether the card can be bought now, gold included. */
export function canAfford(card: CardDef, bonuses: Record<Gem, number>, tokens: Pieces): boolean {
  return totalOf(shortfall(card, bonuses, tokens)) <= tokens.gold;
}

/** Whether the card can be bought with gems alone (no gold). */
export function affordableWithoutGold(
  card: CardDef,
  bonuses: Record<Gem, number>,
  tokens: Pieces,
): boolean {
  return totalOf(shortfall(card, bonuses, tokens)) === 0;
}

/** Gold used per colour when paying gems first: just the shortfall. */
export const autoGold = (card: CardDef, bonuses: Record<Gem, number>, tokens: Pieces) =>
  shortfall(card, bonuses, tokens);

/**
 * The pieces paid for a card, with `gold` standing in for each colour as chosen (gems first when
 * left out), or why that payment doesn't work.
 */
export function payment(
  card: CardDef,
  bonuses: Record<Gem, number>,
  tokens: Pieces,
  gold?: Partial<Record<Gem, number>>,
): Pieces | string {
  const need = costAfter(card, bonuses);
  const auto = autoGold(card, bonuses, tokens);
  const paid = noPieces();
  for (const g of GEMS) {
    const useGold = gold ? (gold[g] ?? 0) : auto[g];
    if (useGold > need[g]) return 'More gold than that colour still costs.';
    const gems = need[g] - useGold;
    if (gems > tokens[g]) return 'You don’t have the pieces for that.';
    paid[g] = gems;
    paid.gold += useGold;
  }
  if (paid.gold > tokens.gold) return 'You don’t have the pieces for that.';
  return paid;
}

/** Gem colours with at least one piece in the supply. */
export const colorsIn = (bank: Pieces) => GEMS.filter((g) => bank[g] > 0);

/** How many different colours a "take different" must be: 3, or all there are when fewer. */
export const differentToTake = (bank: Pieces) => Math.min(3, colorsIn(bank).length);

/** Why a take isn't allowed, or null when it is. */
export function takeProblem(bank: Pieces, gems: readonly Gem[]): string | null {
  if (gems.length === 0) return 'Pick the gems to take.';
  const distinct = new Set(gems);
  if (gems.length === 2 && distinct.size === 1) {
    const g = gems[0]!;
    return bank[g] >= DOUBLE_MIN
      ? null
      : `Two of one colour need at least ${DOUBLE_MIN} in that pile.`;
  }
  if (distinct.size !== gems.length) return 'Take different colours, or two of one colour.';
  for (const g of gems) if (bank[g] <= 0) return 'That pile is empty.';
  const need = differentToTake(bank);
  if (gems.length !== need)
    return need === 3
      ? 'Take 3 different colours.'
      : `Only ${need} ${need === 1 ? 'colour is' : 'colours are'} left: take ${need === 1 ? 'it' : 'one of each'}.`;
  return null;
}

/** Whether any take is possible. */
export const canTake = (bank: Pieces) =>
  colorsIn(bank).length > 0 || GEMS.some((g) => bank[g] >= DOUBLE_MIN);

/** Whether a reserve is possible: under 3 reserved, and a card to take. */
export function canReserve(
  reserved: number,
  market: Record<1 | 2 | 3, readonly (string | null)[]>,
  decks: Record<1 | 2 | 3, number>,
): boolean {
  if (reserved >= MAX_RESERVED) return false;
  return ([1, 2, 3] as const).some((l) => decks[l] > 0 || market[l].some((c) => c !== null));
}

/** Nobles whose requirement the bonuses meet. */
export function noblesFor(nobles: readonly string[], bonuses: Record<Gem, number>): string[] {
  return nobles.filter((id) => GEMS.every((g) => bonuses[g] >= nobleOf(id).requires[g]));
}

/** The market spaces, for iterating. */
export const SPACES = Array.from({ length: MARKET_SIZE }, (_, i) => i);
