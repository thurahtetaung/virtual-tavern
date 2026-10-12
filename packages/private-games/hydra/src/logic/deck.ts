import type { Rng } from '@vt/game-sdk';
import type { Policy } from './types.ts';

/**
 * End-to-end tests only: policies to put on top of every new deck (in this order), so a browser
 * test can reach the powers. The server sets it from `HYDRA_TEST_DECK` outside production; it is
 * empty everywhere else.
 */
let testDeck: readonly Policy[] = [];
export function setTestDeck(cards: readonly Policy[]) {
  testDeck = [...cards];
}

/** A fresh, shuffled deck: `blue` blue and `red` red policies, top first. */
export function newDeck(blue: number, red: number, rng: Rng): Policy[] {
  const left = { blue, red };
  const top: Policy[] = [];
  for (const c of testDeck) {
    if (left[c] <= 0) break;
    left[c]--;
    top.push(c);
  }
  return [
    ...top,
    ...rng.shuffle([
      ...Array.from({ length: left.blue }, () => 'blue' as const),
      ...Array.from({ length: left.red }, () => 'red' as const),
    ]),
  ];
}

/** Below three cards the discard pile is shuffled back in (enacted policies stay on the board). */
export const RESHUFFLE_BELOW = 3;

/** Shuffles the discard back in when fewer than three cards are left; returns whether it did. */
export function topUp(
  deck: readonly Policy[],
  discard: readonly Policy[],
  rng: Rng,
): { deck: Policy[]; discard: Policy[]; reshuffled: boolean } {
  if (deck.length >= RESHUFFLE_BELOW)
    return { deck: [...deck], discard: [...discard], reshuffled: false };
  return { deck: rng.shuffle([...deck, ...discard]), discard: [], reshuffled: true };
}

export const countBlue = (cards: readonly Policy[]) => cards.filter((c) => c === 'blue').length;
