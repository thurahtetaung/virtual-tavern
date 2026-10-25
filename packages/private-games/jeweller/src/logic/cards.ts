import type { Gem } from './types.ts';

/**
 * The 90 development cards and 10 nobles. Ids and numbers only: what the table calls a noble and
 * every card's art come from the private manifest. Costs are in gem order (white, blue, green,
 * red, black).
 */
export interface CardDef {
  id: string;
  level: 1 | 2 | 3;
  bonus: Gem;
  points: number;
  cost: Record<Gem, number>;
}

export interface NobleDef {
  id: string;
  points: number;
  requires: Record<Gem, number>;
}

type Five = readonly [number, number, number, number, number];

const costOf = ([white, blue, green, red, black]: Five): Record<Gem, number> => ({
  white,
  blue,
  green,
  red,
  black,
});

const card = (id: string, level: 1 | 2 | 3, bonus: Gem, points: number, cost: Five): CardDef => ({
  id,
  level,
  bonus,
  points,
  cost: costOf(cost),
});

export const CARDS: readonly CardDef[] = [
  card('L1-01', 1, 'white', 0, [0, 0, 0, 2, 1]),
  card('L1-02', 1, 'white', 0, [0, 3, 0, 0, 0]),
  card('L1-03', 1, 'white', 0, [0, 1, 1, 1, 1]),
  card('L1-04', 1, 'white', 0, [0, 2, 0, 0, 2]),
  card('L1-05', 1, 'white', 0, [0, 1, 2, 1, 1]),
  card('L1-06', 1, 'white', 0, [0, 2, 2, 0, 1]),
  card('L1-07', 1, 'white', 0, [3, 1, 0, 0, 1]),
  card('L1-08', 1, 'white', 1, [0, 0, 4, 0, 0]),
  card('L1-09', 1, 'blue', 0, [0, 0, 0, 0, 3]),
  card('L1-10', 1, 'blue', 0, [1, 0, 0, 0, 2]),
  card('L1-11', 1, 'blue', 0, [0, 0, 2, 0, 2]),
  card('L1-12', 1, 'blue', 0, [1, 0, 1, 1, 1]),
  card('L1-13', 1, 'blue', 0, [0, 1, 3, 1, 0]),
  card('L1-14', 1, 'blue', 0, [1, 0, 1, 2, 1]),
  card('L1-15', 1, 'blue', 0, [1, 0, 2, 2, 0]),
  card('L1-16', 1, 'blue', 1, [0, 0, 0, 4, 0]),
  card('L1-17', 1, 'green', 0, [0, 0, 0, 3, 0]),
  card('L1-18', 1, 'green', 0, [2, 1, 0, 0, 0]),
  card('L1-19', 1, 'green', 0, [0, 2, 0, 2, 0]),
  card('L1-20', 1, 'green', 0, [1, 1, 0, 1, 1]),
  card('L1-21', 1, 'green', 0, [0, 1, 0, 2, 2]),
  card('L1-22', 1, 'green', 0, [1, 1, 0, 1, 2]),
  card('L1-23', 1, 'green', 0, [1, 3, 1, 0, 0]),
  card('L1-24', 1, 'green', 1, [0, 0, 0, 0, 4]),
  card('L1-25', 1, 'red', 0, [0, 2, 1, 0, 0]),
  card('L1-26', 1, 'red', 0, [3, 0, 0, 0, 0]),
  card('L1-27', 1, 'red', 0, [1, 1, 1, 0, 1]),
  card('L1-28', 1, 'red', 0, [2, 0, 0, 2, 0]),
  card('L1-29', 1, 'red', 0, [1, 0, 0, 1, 3]),
  card('L1-30', 1, 'red', 0, [2, 0, 1, 0, 2]),
  card('L1-31', 1, 'red', 0, [2, 1, 1, 0, 1]),
  card('L1-32', 1, 'red', 1, [4, 0, 0, 0, 0]),
  card('L1-33', 1, 'black', 0, [0, 0, 2, 1, 0]),
  card('L1-34', 1, 'black', 0, [0, 0, 3, 0, 0]),
  card('L1-35', 1, 'black', 0, [1, 1, 1, 1, 0]),
  card('L1-36', 1, 'black', 0, [2, 0, 2, 0, 0]),
  card('L1-37', 1, 'black', 0, [0, 0, 1, 3, 1]),
  card('L1-38', 1, 'black', 0, [1, 2, 1, 1, 0]),
  card('L1-39', 1, 'black', 0, [2, 2, 0, 1, 0]),
  card('L1-40', 1, 'black', 1, [0, 4, 0, 0, 0]),
  card('L2-01', 2, 'white', 1, [0, 0, 3, 2, 2]),
  card('L2-02', 2, 'white', 1, [2, 3, 0, 3, 0]),
  card('L2-03', 2, 'white', 2, [0, 0, 0, 5, 0]),
  card('L2-04', 2, 'white', 2, [0, 0, 1, 4, 2]),
  card('L2-05', 2, 'white', 2, [0, 0, 0, 5, 3]),
  card('L2-06', 2, 'white', 3, [6, 0, 0, 0, 0]),
  card('L2-07', 2, 'blue', 1, [0, 2, 2, 3, 0]),
  card('L2-08', 2, 'blue', 1, [0, 2, 3, 0, 3]),
  card('L2-09', 2, 'blue', 2, [0, 5, 0, 0, 0]),
  card('L2-10', 2, 'blue', 2, [2, 0, 0, 1, 4]),
  card('L2-11', 2, 'blue', 2, [5, 3, 0, 0, 0]),
  card('L2-12', 2, 'blue', 3, [0, 6, 0, 0, 0]),
  card('L2-13', 2, 'green', 1, [2, 3, 0, 0, 2]),
  card('L2-14', 2, 'green', 1, [3, 0, 2, 3, 0]),
  card('L2-15', 2, 'green', 2, [0, 0, 5, 0, 0]),
  card('L2-16', 2, 'green', 2, [4, 2, 0, 0, 1]),
  card('L2-17', 2, 'green', 2, [0, 5, 3, 0, 0]),
  card('L2-18', 2, 'green', 3, [0, 0, 6, 0, 0]),
  card('L2-19', 2, 'red', 1, [2, 0, 0, 2, 3]),
  card('L2-20', 2, 'red', 1, [0, 3, 0, 2, 3]),
  card('L2-21', 2, 'red', 2, [0, 0, 0, 0, 5]),
  card('L2-22', 2, 'red', 2, [1, 4, 2, 0, 0]),
  card('L2-23', 2, 'red', 2, [3, 0, 0, 0, 5]),
  card('L2-24', 2, 'red', 3, [0, 0, 0, 6, 0]),
  card('L2-25', 2, 'black', 1, [3, 2, 2, 0, 0]),
  card('L2-26', 2, 'black', 1, [3, 0, 3, 0, 2]),
  card('L2-27', 2, 'black', 2, [5, 0, 0, 0, 0]),
  card('L2-28', 2, 'black', 2, [0, 1, 4, 2, 0]),
  card('L2-29', 2, 'black', 2, [0, 0, 5, 3, 0]),
  card('L2-30', 2, 'black', 3, [0, 0, 0, 0, 6]),
  card('L3-01', 3, 'white', 3, [0, 3, 3, 5, 3]),
  card('L3-02', 3, 'white', 4, [0, 0, 0, 0, 7]),
  card('L3-03', 3, 'white', 4, [3, 0, 0, 3, 6]),
  card('L3-04', 3, 'white', 5, [3, 0, 0, 0, 7]),
  card('L3-05', 3, 'blue', 3, [3, 0, 3, 3, 5]),
  card('L3-06', 3, 'blue', 4, [7, 0, 0, 0, 0]),
  card('L3-07', 3, 'blue', 4, [6, 3, 0, 0, 3]),
  card('L3-08', 3, 'blue', 5, [7, 3, 0, 0, 0]),
  card('L3-09', 3, 'green', 3, [5, 3, 0, 3, 3]),
  card('L3-10', 3, 'green', 4, [0, 7, 0, 0, 0]),
  card('L3-11', 3, 'green', 4, [3, 6, 3, 0, 0]),
  card('L3-12', 3, 'green', 5, [0, 7, 3, 0, 0]),
  card('L3-13', 3, 'red', 3, [3, 5, 3, 0, 3]),
  card('L3-14', 3, 'red', 4, [0, 0, 7, 0, 0]),
  card('L3-15', 3, 'red', 4, [0, 3, 6, 3, 0]),
  card('L3-16', 3, 'red', 5, [0, 0, 7, 3, 0]),
  card('L3-17', 3, 'black', 3, [3, 3, 5, 3, 0]),
  card('L3-18', 3, 'black', 4, [0, 0, 0, 7, 0]),
  card('L3-19', 3, 'black', 4, [0, 0, 3, 6, 3]),
  card('L3-20', 3, 'black', 5, [0, 0, 0, 7, 3]),
];

export const NOBLES: readonly NobleDef[] = [
  { id: 'N01', points: 3, requires: costOf([0, 0, 0, 4, 4]) },
  { id: 'N02', points: 3, requires: costOf([0, 0, 3, 3, 3]) },
  { id: 'N03', points: 3, requires: costOf([0, 0, 4, 4, 0]) },
  { id: 'N04', points: 3, requires: costOf([0, 3, 3, 3, 0]) },
  { id: 'N05', points: 3, requires: costOf([0, 4, 4, 0, 0]) },
  { id: 'N06', points: 3, requires: costOf([3, 0, 0, 3, 3]) },
  { id: 'N07', points: 3, requires: costOf([3, 3, 0, 0, 3]) },
  { id: 'N08', points: 3, requires: costOf([3, 3, 3, 0, 0]) },
  { id: 'N09', points: 3, requires: costOf([4, 0, 0, 0, 4]) },
  { id: 'N10', points: 3, requires: costOf([4, 4, 0, 0, 0]) },
];

const byId = new Map(CARDS.map((c) => [c.id, c]));
const nobleById = new Map(NOBLES.map((n) => [n.id, n]));

export const cardOf = (id: string): CardDef => byId.get(id)!;
export const nobleOf = (id: string): NobleDef => nobleById.get(id)!;
export const isCard = (id: string) => byId.has(id);
export const isNoble = (id: string) => nobleById.has(id);
