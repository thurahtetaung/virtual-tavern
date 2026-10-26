import type { Rng } from '@vt/game-sdk';
import { COLOURS, type Special, type SpecialKind, type Tile } from './types.ts';

/**
 * The special factories option: nine gold faces (one `sf1`, five `sf2` with a colour each, one
 * `sf3`, `sf4` and `sf5`). Each round the factories in play are drawn from all nine at random and
 * as many as there are players are turned to their gold side.
 */
export const FACES: readonly Special[] = [
  { kind: 'sf1' },
  ...COLOURS.map((colour): Special => ({ kind: 'sf2', colour })),
  { kind: 'sf3' },
  { kind: 'sf4' },
  { kind: 'sf5' },
];

/** What each face does, in a few words (the table, the pick sheet, the guide). */
export const SPECIAL_SHORT: Record<SpecialKind, string> = {
  sf1: '+1 tile',
  sf2: 'Gathers its colour',
  sf3: 'Leftovers stay',
  sf4: 'Leftovers go to its neighbours',
  sf5: 'Floor shield',
};

/** The label on a factory's chip, short enough for a phone. */
export const SPECIAL_CHIP: Record<SpecialKind, string> = {
  sf1: '+1',
  sf2: 'Gather',
  sf3: 'Keep',
  sf4: 'Split',
  sf5: 'Shield',
};

export const SPECIAL_TEXT: Record<SpecialKind, string> = {
  sf1: 'When the round is set up, it gets one more tile from the bag.',
  sf2: 'When the round is set up, it takes one tile of its colour from each neighbour, if they have one.',
  sf3: 'Whoever takes from it leaves the other tiles on it, not in the centre.',
  sf4: 'Whoever takes from it sends the other tiles to its left and right neighbours, each colour kept together.',
  sf5: 'Whoever takes from it keeps it by their floor this round: the next tile (or the marker) that would land on their floor goes on it instead, at no cost.',
};

/** The faces of `n` factories for a round: drawn from all nine, `players` of them turned gold. */
export function flipSpecials(n: number, players: number, rng: Rng): (Special | null)[] {
  const faces = rng.shuffle([...FACES]).slice(0, n);
  const gold = new Set(
    rng.shuffle(Array.from({ length: n }, (_, i) => i)).slice(0, Math.min(players, n)),
  );
  return faces.map((f, i) => (gold.has(i) ? { ...f } : null));
}

/** Whether a factory has left the circle: a floor shield someone took this round. */
export const gone = (specials: readonly (Special | null)[] | null | undefined, i: number) =>
  !!specials?.[i]?.holder;

/**
 * A factory's left and right neighbours round the circle (`i − 1` and `i + 1`, wrapping): the
 * nearest factories still on the table, or null when there is none but itself.
 */
export function neighbours(
  specials: readonly (Special | null)[] | null | undefined,
  n: number,
  i: number,
): { left: number | null; right: number | null } {
  const find = (step: number) => {
    for (let k = 1; k < n; k++) {
      const j = (((i + step * k) % n) + n) % n;
      if (!gone(specials, j)) return j;
    }
    return null;
  };
  return { left: find(-1), right: find(1) };
}

/** The leftover tiles of a take, grouped by kind, in table order. */
export function leftoverGroups(tiles: readonly Tile[]): { tile: Tile; count: number }[] {
  const out: { tile: Tile; count: number }[] = [];
  for (const t of tiles) {
    const g = out.find((x) => x.tile === t);
    if (g) g.count += 1;
    else out.push({ tile: t, count: 1 });
  }
  return out;
}
