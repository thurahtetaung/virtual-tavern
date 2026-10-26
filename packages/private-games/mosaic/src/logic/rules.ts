import {
  type Board,
  type Bonus,
  COLOURS,
  COLOUR_BONUS,
  COLUMN_BONUS,
  type Colour,
  type Counts,
  FLOOR,
  type FloorItem,
  type Placement,
  ROW_BONUS,
  SIZE,
  type Target,
} from './types.ts';

/**
 * The pure board rules, shared by the engine, the bot and the pick sheet's preview. The wall is a
 * plain 5 × 5 grid of tiles, so a free-placement wall can later reuse everything here but
 * `columnOf`.
 */

export const noCounts = (): Counts => ({ blue: 0, yellow: 0, red: 0, black: 0, aqua: 0 });
export const totalOf = (c: Counts) => COLOURS.reduce((n, k) => n + c[k], 0);
export const countsOf = (tiles: readonly Colour[]): Counts => {
  const c = noCounts();
  for (const t of tiles) c[t] += 1;
  return c;
};

/** The coloured wall: the column of a colour in a row. */
export const columnOf = (row: number, colour: Colour) => (COLOURS.indexOf(colour) + row) % SIZE;
/** The coloured wall: the colour printed at a space. */
export const colourAt = (row: number, col: number): Colour =>
  COLOURS[(((col - row) % SIZE) + SIZE) % SIZE]!;

export const capacity = (row: number) => row + 1;

export function emptyBoard(): Board {
  return {
    lines: Array.from({ length: SIZE }, () => ({ colour: null, count: 0 })),
    wall: Array.from({ length: SIZE }, () => Array<Colour | null>(SIZE).fill(null)),
    floor: [],
    score: 0,
  };
}

/** Why a colour can't go in a pattern line, or null when it can. */
export function lineProblem(board: Board, row: number, colour: Colour): string | null {
  const line = board.lines[row];
  if (!line) return 'There is no such line.';
  if (board.wall[row]!.includes(colour)) return 'That row of your wall already has this colour.';
  if (line.colour && line.colour !== colour) return 'That line already holds another colour.';
  if (line.count >= capacity(row)) return 'That line is full.';
  return null;
}

/** The lines a colour may go in. */
export const linesFor = (board: Board, colour: Colour) =>
  Array.from({ length: SIZE }, (_, r) => r).filter((r) => !lineProblem(board, r, colour));

/** The points `added` new floor items cost on a floor already holding `filled`. */
export function floorCost(filled: number, added: number): number {
  let cost = 0;
  for (let i = filled; i < Math.min(FLOOR.length, filled + added); i++) cost += FLOOR[i]!;
  return cost;
}

/** What a floor costs in all (0 or negative). */
export const floorPenalty = (floor: readonly FloorItem[]) => floorCost(0, floor.length);

export interface PlaceResult {
  toLine: number;
  toFloor: number;
  toLid: number;
  /** The floor points this costs (0 or negative), the marker included. */
  penalty: number;
  /** The marker went on the floor (false when the floor was already full). */
  markerOnFloor: boolean;
  /** The line is now full. */
  fills: boolean;
}

/**
 * Puts `count` tiles of a colour on a board (changing it): the marker first when it comes with
 * them, then the line, then the floor, then the lid. The target must be legal.
 */
export function place(
  board: Board,
  colour: Colour,
  count: number,
  target: Target,
  marker: boolean,
): PlaceResult {
  const floorBefore = board.floor.length;
  let markerOnFloor = false;
  if (marker && board.floor.length < FLOOR.length) {
    board.floor.push('first');
    markerOnFloor = true;
  }
  let toLine = 0;
  let fills = false;
  if (target !== 'floor') {
    const line = board.lines[target]!;
    toLine = Math.min(count, capacity(target) - line.count);
    line.colour = colour;
    line.count += toLine;
    fills = line.count === capacity(target);
  }
  const rest = count - toLine;
  const toFloor = Math.min(rest, FLOOR.length - board.floor.length);
  for (let i = 0; i < toFloor; i++) board.floor.push(colour);
  return {
    toLine,
    toFloor,
    toLid: rest - toFloor,
    penalty: floorCost(floorBefore, board.floor.length - floorBefore),
    markerOnFloor,
    fills,
  };
}

/** A copy of a board, for previews. */
export const copyBoard = (b: Board): Board => ({
  lines: b.lines.map((l) => ({ ...l })),
  wall: b.wall.map((r) => [...r]),
  floor: [...b.floor],
  score: b.score,
});

/** The points for a tile just placed at (row, col): its linked runs across and down. */
export function scoreAt(wall: readonly (readonly (Colour | null)[])[], row: number, col: number) {
  const run = (dr: number, dc: number) => {
    let n = 0;
    for (let r = row + dr, c = col + dc; wall[r]?.[c]; r += dr, c += dc) n++;
    return n;
  };
  const across = run(0, -1) + run(0, 1) + 1;
  const down = run(-1, 0) + run(1, 0) + 1;
  const a = across > 1 ? across : 0;
  const d = down > 1 ? down : 0;
  return { points: a + d || 1, across: a, down: d };
}

/**
 * The wall-tiling of one board (changing it): every full line, top to bottom, moves one tile to
 * the wall and scores it; the rest of those lines and the floor's tiles go to the lid. The score
 * never drops below 0. Returns what happened and the tiles for the lid.
 */
export function tileWall(board: Board): {
  placed: Placement[];
  floor: FloorItem[];
  penalty: number;
  lid: Colour[];
  before: number;
} {
  const before = board.score;
  const placed: Placement[] = [];
  const lid: Colour[] = [];
  for (let row = 0; row < SIZE; row++) {
    const line = board.lines[row]!;
    if (!line.colour || line.count < capacity(row)) continue;
    const colour = line.colour;
    const col = columnOf(row, colour);
    board.wall[row]![col] = colour;
    const s = scoreAt(board.wall, row, col);
    board.score += s.points;
    placed.push({ row, col, colour, ...s });
    for (let i = 1; i < line.count; i++) lid.push(colour);
    board.lines[row] = { colour: null, count: 0 };
  }
  const floor = [...board.floor];
  const penalty = floorPenalty(floor);
  board.score = Math.max(0, board.score + penalty);
  for (const f of floor) if (f !== 'first') lid.push(f);
  board.floor = [];
  return { placed, floor, penalty, lid, before };
}

export const fullRows = (wall: readonly (readonly (Colour | null)[])[]) =>
  wall.filter((r) => r.every(Boolean)).length;

export const fullColumns = (wall: readonly (readonly (Colour | null)[])[]) =>
  Array.from({ length: SIZE }, (_, c) => c).filter((c) => wall.every((r) => r[c])).length;

export const fullColours = (wall: readonly (readonly (Colour | null)[])[]) =>
  COLOURS.filter((k) => wall.flat().filter((t) => t === k).length === SIZE).length;

/** The end-of-game bonuses for a wall. */
export function bonusOf(wall: readonly (readonly (Colour | null)[])[]): Bonus {
  const rows = fullRows(wall);
  const columns = fullColumns(wall);
  const colours = fullColours(wall);
  return {
    rows,
    columns,
    colours,
    points: rows * ROW_BONUS + columns * COLUMN_BONUS + colours * COLOUR_BONUS,
  };
}

/** How close a wall is to each bonus: the best row, column and colour so far, out of 5. */
export function closeTo(wall: readonly (readonly (Colour | null)[])[]) {
  const row = Math.max(...wall.map((r) => r.filter(Boolean).length));
  const column = Math.max(
    ...Array.from({ length: SIZE }, (_, c) => wall.filter((r) => r[c]).length),
  );
  const colour = Math.max(...COLOURS.map((k) => wall.flat().filter((t) => t === k).length));
  return { row, column, colour };
}

/** What placing a group would do, without changing anything: the pick sheet's preview. */
export interface Preview extends PlaceResult {
  target: Target;
  /** Why it can't go there (a line only), or null. */
  problem: string | null;
  /** When the line fills: what its tile will score at the round's end on the wall as it is. */
  points: number | null;
}

export function previewOf(
  board: Board,
  colour: Colour,
  count: number,
  target: Target,
  marker: boolean,
): Preview {
  const problem = target === 'floor' ? null : lineProblem(board, target, colour);
  const b = copyBoard(board);
  if (problem)
    return {
      target,
      problem,
      points: null,
      toLine: 0,
      toFloor: 0,
      toLid: 0,
      penalty: 0,
      markerOnFloor: false,
      fills: false,
    };
  const r = place(b, colour, count, target, marker);
  let points: number | null = null;
  if (r.fills && target !== 'floor') {
    // Lines above that are already full tile first, so they count as neighbours.
    const wall = b.wall.map((row) => [...row]);
    for (let row = 0; row < target; row++) {
      const l = b.lines[row]!;
      if (l.colour && l.count === capacity(row)) wall[row]![columnOf(row, l.colour)] = l.colour;
    }
    const col = columnOf(target, colour);
    wall[target]![col] = colour;
    points = scoreAt(wall, target, col).points;
  }
  return { ...r, target, problem: null, points };
}
