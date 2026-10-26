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
  type PlayerScore,
  ROW_BONUS,
  SIZE,
  type Target,
  type Tile,
} from './types.ts';

/**
 * The pure board rules, shared by the engine, the bot and the pick sheet's preview. The wall is a
 * plain 5 × 5 grid of tiles; the coloured wall fixes where each colour goes (`columnOf`), the
 * grey wall lets its owner choose (`wallSpaces`).
 */

export type Wall = readonly (readonly (Tile | null)[])[];

export const noCounts = (): Counts => ({ blue: 0, yellow: 0, red: 0, black: 0, aqua: 0 });
/** Jokers in a count (missing in rooms saved before the option). */
export const jokersIn = (c: Counts) => c.joker ?? 0;
export const countOf = (c: Counts, t: Tile) => (t === 'joker' ? jokersIn(c) : c[t]);
export const totalOf = (c: Counts) => COLOURS.reduce((n, k) => n + c[k], 0) + jokersIn(c);
export const addTo = (c: Counts, t: Tile, n = 1) => {
  if (t === 'joker') c.joker = jokersIn(c) + n;
  else c[t] += n;
};
export const countsOf = (tiles: readonly Tile[], withJokers = false): Counts => {
  const c = noCounts();
  if (withJokers) c.joker = 0;
  for (const t of tiles) addTo(c, t);
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
    wall: Array.from({ length: SIZE }, () => Array<Tile | null>(SIZE).fill(null)),
    floor: [],
    score: 0,
  };
}

/** Whether a colour may still go in a wall row: its space free (coloured wall), or not in the row. */
function rowTakes(wall: Wall, row: number, colour: Colour, grey: boolean) {
  return grey ? !wall[row]!.includes(colour) : !wall[row]![columnOf(row, colour)];
}

/**
 * Why tiles can't go in a pattern line, or null when they can. `colour` is the colour taken, or
 * `joker` for jokers alone (which join any line with room).
 */
export function lineProblem(board: Board, row: number, colour: Tile, grey = false): string | null {
  const line = board.lines[row];
  if (!line) return 'There is no such line.';
  if (line.count >= capacity(row)) return 'That line is full.';
  if (colour === 'joker') return null;
  if (!rowTakes(board.wall, row, colour, grey))
    return board.wall[row]!.includes(colour)
      ? 'That row of your wall already has this colour.'
      : 'A joker already sits on this colour’s space in that row.';
  if (line.colour && line.colour !== colour) return 'That line already holds another colour.';
  return null;
}

/** The lines a colour (or jokers alone) may go in. */
export const linesFor = (board: Board, colour: Tile, grey = false) =>
  Array.from({ length: SIZE }, (_, r) => r).filter((r) => !lineProblem(board, r, colour, grey));

/** The points `added` new floor items cost on a floor already holding `filled`. */
export function floorCost(filled: number, added: number): number {
  let cost = 0;
  for (let i = filled; i < Math.min(FLOOR.length, filled + added); i++) cost += FLOOR[i]!;
  return cost;
}

/** What a floor costs in all (0 or negative). */
export const floorPenalty = (floor: readonly FloorItem[]) => floorCost(0, floor.length);

/**
 * Items landing on a floor (changing it): an empty floor shield catches the first; the rest fill
 * the floor; past seven they go to the lid. Returns the tiles for the lid and whether the shield
 * caught one.
 */
export function toFloor(board: Board, items: readonly FloorItem[]) {
  const lid: Tile[] = [];
  let shielded = false;
  for (const it of items) {
    if (board.shield === null) {
      board.shield = it;
      shielded = true;
    } else if (board.floor.length < FLOOR.length) board.floor.push(it);
    else if (it !== 'first') lid.push(it);
  }
  return { lid, shielded };
}

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
  /** The floor shield caught the first item. */
  shielded: boolean;
  /** That item was the first-player marker (else, with `shielded`, it was one of the tiles). */
  markerShielded: boolean;
}

/**
 * Puts tiles on a board (changing it): `count` of a colour (or of jokers, for `joker`) plus
 * `jokers` jokers with a colour. The marker goes first when it comes with them, then the line
 * (the colour's tiles first, then jokers), then the floor, then the lid. The target must be legal.
 */
export function place(
  board: Board,
  colour: Tile,
  count: number,
  target: Target,
  marker: boolean,
  jokers = 0,
): PlaceResult {
  const floorBefore = board.floor.length;
  const markerItems: FloorItem[] = marker ? ['first'] : [];
  const m = toFloor(board, markerItems);
  const markerOnFloor = marker && board.floor.length > floorBefore;
  const tiles: Tile[] = [...Array<Tile>(count).fill(colour), ...Array<Tile>(jokers).fill('joker')];
  let toLine = 0;
  let fills = false;
  if (target !== 'floor') {
    const line = board.lines[target]!;
    toLine = Math.min(tiles.length, capacity(target) - line.count);
    const placed = tiles.slice(0, toLine);
    const j = placed.filter((t) => t === 'joker').length;
    if (colour !== 'joker' && placed.some((t) => t !== 'joker')) line.colour = colour;
    line.count += toLine;
    if (j || line.jokers) line.jokers = (line.jokers ?? 0) + j;
    fills = line.count === capacity(target);
  }
  const rest = tiles.slice(toLine);
  const onFloor = board.floor.length;
  const r = toFloor(board, rest);
  return {
    toLine,
    toFloor: board.floor.length - onFloor + (r.shielded ? 1 : 0),
    toLid: r.lid.length,
    penalty: floorCost(floorBefore, board.floor.length - floorBefore),
    markerOnFloor,
    fills,
    shielded: m.shielded || r.shielded,
    markerShielded: m.shielded,
  };
}

/** A copy of a board, for previews. */
export const copyBoard = (b: Board): Board => ({
  lines: b.lines.map((l) => ({ ...l })),
  wall: b.wall.map((r) => [...r]),
  floor: [...b.floor],
  score: b.score,
  ...(b.shield !== undefined && { shield: b.shield }),
});

/** The points for a tile just placed at (row, col): its linked runs across and down. */
export function scoreAt(wall: Wall, row: number, col: number) {
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

/** The tile a full line sends to the wall: a joker when it holds any, else its colour. */
export const lineTile = (line: Board['lines'][number]): Tile =>
  (line.jokers ?? 0) > 0 || !line.colour ? 'joker' : line.colour;

/**
 * Where a full line's tile may go on the wall. A line of jokers alone: any free space of its row.
 * The coloured wall: its colour's space (where a joker goes too when the line has a colour). The
 * grey wall: any free space whose row and column don't hold the line's colour (jokers never count
 * for that).
 */
export function wallSpaces(
  wall: Wall,
  row: number,
  line: Board['lines'][number],
  grey: boolean,
): number[] {
  const free = Array.from({ length: SIZE }, (_, c) => c).filter((c) => !wall[row]![c]);
  const colour = line.colour;
  if (!colour) return free;
  if (!grey) return free.filter((c) => c === columnOf(row, colour));
  if (wall[row]!.includes(colour)) return [];
  return free.filter((c) => wall.every((r) => r[c] !== colour));
}

/** Whether a full line's tile needs its owner to choose a space. */
export const isFull = (line: Board['lines'][number], row: number) =>
  line.count > 0 && line.count >= capacity(row);

/**
 * A board's wall-tiling (changing it and `score`), from line `from` down: every full line moves
 * one tile to the wall and scores it, and the rest of the line goes to the lid; a line with no
 * legal space falls to the floor whole. Where there is more than one space, `choose` picks it; when
 * it can't (null, or no `choose`), the tiling stops and returns the waiting row. Once every line is done, the floor
 * is charged (never below 0), its tiles and the shield's go to the lid, and it returns null.
 */
export function runWall(
  board: Board,
  ps: PlayerScore,
  from: number,
  grey: boolean,
  lid: Tile[],
  choose: ((row: number, spaces: number[]) => number | null) | null,
): number | null {
  for (let row = from; row < SIZE; row++) {
    const line = board.lines[row]!;
    if (!isFull(line, row)) continue;
    const spaces = wallSpaces(board.wall, row, line, grey);
    let col = spaces[0];
    if (spaces.length > 1) {
      const c = choose?.(row, spaces) ?? null;
      if (c === null) return row;
      col = c;
    }
    const tile = lineTile(line);
    const items: Tile[] = [
      ...Array<Tile>(line.count - (line.jokers ?? 0)).fill(line.colour ?? 'joker'),
      ...Array<Tile>(line.jokers ?? 0).fill('joker'),
    ];
    board.lines[row] = { colour: null, count: 0 };
    if (col === undefined) {
      (ps.fell ??= []).push(row);
      lid.push(...toFloor(board, items).lid);
      continue;
    }
    items.splice(items.lastIndexOf(tile), 1);
    lid.push(...items);
    board.wall[row]![col] = tile;
    const s = scoreAt(board.wall, row, col);
    board.score += s.points;
    ps.placed.push({ row, col, colour: tile, ...s });
  }
  const floor = [...board.floor];
  ps.floor = floor;
  ps.penalty = floorPenalty(floor);
  board.score = Math.max(0, board.score + ps.penalty);
  for (const f of floor) if (f !== 'first') lid.push(f);
  if (board.shield !== undefined) {
    if (board.shield) {
      ps.shielded = board.shield;
      if (board.shield !== 'first') lid.push(board.shield);
    }
    delete board.shield;
  }
  board.floor = [];
  ps.after = board.score;
  return null;
}

/** A fresh round score for a board. */
export const startScore = (board: Board): PlayerScore => ({
  placed: [],
  floor: [],
  penalty: 0,
  before: board.score,
  after: board.score,
});

/**
 * The whole wall-tiling of one board at once (changing it), with `choose` for any choice (the
 * leftmost space by default). Returns what happened and the tiles for the lid.
 */
export function tileWall(
  board: Board,
  grey = false,
  choose: (row: number, spaces: number[]) => number = (_, s) => s[0]!,
): PlayerScore & { lid: Tile[] } {
  const ps = startScore(board);
  const lid: Tile[] = [];
  runWall(board, ps, 0, grey, lid, choose);
  return { ...ps, lid };
}

export const fullRows = (wall: Wall) => wall.filter((r) => r.every(Boolean)).length;

export const fullColumns = (wall: Wall) =>
  Array.from({ length: SIZE }, (_, c) => c).filter((c) => wall.every((r) => r[c])).length;

/** Colours with all 5 on the wall; jokers never count as a colour. */
export const fullColours = (wall: Wall) =>
  COLOURS.filter((k) => wall.flat().filter((t) => t === k).length === SIZE).length;

/** The end-of-game bonuses for a wall. */
export function bonusOf(wall: Wall): Bonus {
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
export function closeTo(wall: Wall) {
  const row = Math.max(...wall.map((r) => r.filter(Boolean).length));
  const column = Math.max(
    ...Array.from({ length: SIZE }, (_, c) => wall.filter((r) => r[c]).length),
  );
  const colour = Math.max(...COLOURS.map((k) => wall.flat().filter((t) => t === k).length));
  return { row, column, colour };
}

/**
 * The best a full line's tile could score on a wall, over the spaces it may take (null: none).
 * `scoreAt` only reads the neighbours, so the wall needn't hold the tile.
 */
export function bestSpace(wall: Wall, row: number, line: Board['lines'][number], grey: boolean) {
  let best: { col: number; points: number } | null = null;
  for (const col of wallSpaces(wall, row, line, grey)) {
    const points = scoreAt(wall, row, col).points;
    if (!best || points > best.points) best = { col, points };
  }
  return best;
}

/** What placing a group would do, without changing anything: the pick sheet's preview. */
export interface Preview extends PlaceResult {
  target: Target;
  /** Why it can't go there (a line only), or null. */
  problem: string | null;
  /**
   * When the line fills: what its tile will score at the round's end on the wall as it is (the
   * best space, when there is a choice), or null.
   */
  points: number | null;
  /** The filled line's tile will need a space chosen at the round's end. */
  choice: boolean;
  /** The filled line has no legal space on the wall: it would fall to the floor. */
  falls: boolean;
}

export function previewOf(
  board: Board,
  colour: Tile,
  count: number,
  target: Target,
  marker: boolean,
  jokers = 0,
  grey = false,
): Preview {
  return previewWith(board, colour, count, target, marker, jokers, grey).preview;
}

/** The preview, and the board as it would be after the move. */
export function previewWith(
  board: Board,
  colour: Tile,
  count: number,
  target: Target,
  marker: boolean,
  jokers = 0,
  grey = false,
): { preview: Preview; board: Board } {
  const problem = target === 'floor' ? null : lineProblem(board, target, colour, grey);
  const b = copyBoard(board);
  if (problem)
    return {
      board: b,
      preview: {
        target,
        problem,
        points: null,
        choice: false,
        falls: false,
        toLine: 0,
        toFloor: 0,
        toLid: 0,
        penalty: 0,
        markerOnFloor: false,
        fills: false,
        shielded: false,
        markerShielded: false,
      },
    };
  const r = place(b, colour, count, target, marker, jokers);
  let points: number | null = null;
  let choice = false;
  let falls = false;
  if (r.fills && target !== 'floor') {
    // Lines above that are already full tile first (at their best), so they count as neighbours.
    const wall = b.wall.map((row) => [...row]);
    for (let row = 0; row < target; row++) {
      const l = b.lines[row]!;
      if (!isFull(l, row)) continue;
      const best = bestSpace(wall, row, l, grey);
      if (best) wall[row]![best.col] = lineTile(l);
    }
    const line = b.lines[target]!;
    choice = wallSpaces(wall, target, line, grey).length > 1;
    const best = bestSpace(wall, target, line, grey);
    if (best) points = best.points;
    else falls = true;
  }
  return { board: b, preview: { ...r, target, problem: null, points, choice, falls } };
}
