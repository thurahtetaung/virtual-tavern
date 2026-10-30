/**
 * The card Pass moves to: the next one after the card now described, in square order, wrapping
 * round. Null when there is no other card to move to.
 */
export function passTarget<T>(cards: readonly T[], now: T | undefined): T | null {
  if (cards.length < 2) return null;
  const at = now === undefined ? -1 : cards.indexOf(now);
  return cards[(at + 1) % cards.length] ?? null;
}
