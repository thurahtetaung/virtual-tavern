import type { Power, Role } from './types.ts';

/** Red players (including the Leader) per table size (official). Everyone else is blue. */
export const RED_COUNT: Record<number, number> = { 5: 2, 6: 2, 7: 3, 8: 3, 9: 4, 10: 4 };

/** At 5–6 players the Leader knows their red teammate; from 7 on, the Leader knows nobody. */
export const leaderKnowsTeam = (players: number) => players <= 6;

/** The powers on the red board: index i is what the (i+1)th red policy gives the President. */
export type Track = readonly (Power | null)[];

const SMALL: Track = [null, null, 'peek', 'execute', 'execute', null];
const MEDIUM: Track = [null, 'investigate', 'special', 'execute', 'execute', null];
const LARGE: Track = ['investigate', 'investigate', 'special', 'execute', 'execute', null];

export type BoardSize = 'small' | 'medium' | 'large';

/** Which red board a table uses: 5–6, 7–8 or 9–10 players. */
export const boardFor = (players: number): BoardSize =>
  players <= 6 ? 'small' : players <= 8 ? 'medium' : 'large';

export const trackFor = (players: number): Track =>
  ({ small: SMALL, medium: MEDIUM, large: LARGE })[boardFor(players)];

/** The power the `count`th red policy gives (count is 1-based), or null. */
export const powerAt = (players: number, count: number): Power | null =>
  trackFor(players)[count - 1] ?? null;

export const BLUE_CARDS = 6;
export const RED_CARDS = 11;

/**
 * The deck and the red policies already on the board at the start. The community rebalance (off
 * by default): at 6 players a red policy starts on the board; at 7 and 9 the deck has one red fewer.
 */
export function setupFor(
  players: number,
  rebalance: boolean,
): { blue: number; red: number; redEnacted: number } {
  if (rebalance && players === 6) return { blue: BLUE_CARDS, red: RED_CARDS - 1, redEnacted: 1 };
  if (rebalance && (players === 7 || players === 9))
    return { blue: BLUE_CARDS, red: RED_CARDS - 1, redEnacted: 0 };
  return { blue: BLUE_CARDS, red: RED_CARDS, redEnacted: 0 };
}

/** The roles for a table, before shuffling: the Leader, the other reds, then blues. */
export function rolesFor(players: number): Role[] {
  const reds = RED_COUNT[players] ?? 2;
  return [
    'leader',
    ...Array.from({ length: reds - 1 }, () => 'red' as const),
    ...Array.from({ length: players - reds }, () => 'blue' as const),
  ];
}

/** Portraits per colour on the role sheet (the Leader has one). */
export const PORTRAITS = { blue: 6, red: 3, leader: 1 } as const;
