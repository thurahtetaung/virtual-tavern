import { GEMS, type Gem } from './types.ts';

/**
 * The 14 City sides (7 double-sided tiles, `C1a`/`C1b` … `C7a`/`C7b`), read from the printed
 * tiles: the points a player needs, the cards they need by colour, and `any`: that many cards of
 * one colour of the player's choice, which can't be a colour the side already asks for. Ids and
 * numbers only: the art comes from the private manifest.
 */
export interface CityDef {
  id: string;
  /** The tile (1–7): its two sides never meet on one table. */
  tile: number;
  points: number;
  requires: Record<Gem, number>;
  /** Cards of one more colour, any colour not already in `requires`; 0 when the side has none. */
  any: number;
}

type Five = readonly [number, number, number, number, number];

const city = (id: string, points: number, [white, blue, green, red, black]: Five, any = 0) => ({
  id,
  tile: Number(id[1]),
  points,
  requires: { white, blue, green, red, black },
  any,
});

export const CITIES: readonly CityDef[] = [
  city('C1a', 16, [1, 1, 1, 1, 1]),
  city('C1b', 17, [0, 0, 0, 0, 0]),
  city('C2a', 11, [3, 0, 3, 3, 3]),
  city('C2b', 11, [3, 3, 0, 3, 3]),
  city('C3a', 13, [3, 4, 0, 0, 0]),
  city('C3b', 13, [4, 0, 0, 3, 0]),
  city('C4a', 15, [0, 0, 0, 0, 0], 5),
  city('C4b', 12, [0, 0, 0, 0, 0], 6),
  city('C5a', 13, [0, 3, 4, 0, 0]),
  city('C5b', 14, [0, 0, 4, 0, 0], 4),
  city('C6a', 13, [2, 2, 2, 2, 2]),
  city('C6b', 14, [2, 1, 1, 2, 2]),
  city('C7a', 13, [0, 0, 0, 4, 3]),
  city('C7b', 13, [0, 0, 3, 0, 4]),
];

/** Cities dealt for a game. */
export const CITIES_IN_PLAY = 3;
export const CITY_TILES = [1, 2, 3, 4, 5, 6, 7] as const;

const byId = new Map(CITIES.map((c) => [c.id, c]));
export const cityOf = (id: string): CityDef => byId.get(id)!;
export const isCity = (id: string) => byId.has(id);

/** Colours that may stand in for a side's "any colour" cards. */
export const anyColours = (c: CityDef): Gem[] => GEMS.filter((g) => c.requires[g] === 0);

/** Whether cards (`bonuses`) and points meet a City side. */
export function meetsCity(c: CityDef, bonuses: Record<Gem, number>, points: number): boolean {
  if (points < c.points) return false;
  if (GEMS.some((g) => bonuses[g] < c.requires[g])) return false;
  return c.any === 0 || anyColours(c).some((g) => bonuses[g] >= c.any);
}

/** How far a player is from a City side: points short plus cards short (the best "any" colour). */
export function cityGap(c: CityDef, bonuses: Record<Gem, number>, points: number): number {
  const cards = GEMS.reduce((n, g) => n + Math.max(0, c.requires[g] - bonuses[g]), 0);
  const any = c.any ? Math.min(...anyColours(c).map((g) => Math.max(0, c.any - bonuses[g]))) : 0;
  return Math.max(0, c.points - points) + cards + any;
}
