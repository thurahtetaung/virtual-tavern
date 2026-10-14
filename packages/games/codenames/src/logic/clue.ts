import type { ClueCount } from './types.ts';

/** Whether a clue's number caps the guesses (0 and unlimited don't). */
export function hasGuessLimit(count: ClueCount): count is number {
  return count !== null && count > 0;
}

/** A clue's number as players say it: "∞" for unlimited. */
export const countText = (count: ClueCount) => (count === null ? '∞' : String(count));
