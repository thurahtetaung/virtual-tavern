/** Gaps of the full board, in px: between tiles (across, down), between groups, and its labels. */
export const GAP_X = 6;
export const GAP_Y = 8;
export const GROUP_GAP = 12;
export const LABEL = 20;
/** Tiles never grow past this, or shrink below the smallest that still reads. */
const MAX_TILE = 88;
const MIN_TILE = 30;

export interface BoardFit {
  /** Tiles across in each of the four big groups, and in the colours. */
  cols: number;
  colourCols: number;
  rows: number;
  /** The tile's side, in px. */
  tile: number;
}

/**
 * The biggest tiles that fit the whole board in `width` × `height`: the five groups stay side by
 * side as printed, each two, three, four or five tiles across (the colours as many as their rows
 * need), whichever gives the largest tiles.
 */
export function fitBoard(width: number, height: number): BoardFit {
  let best: BoardFit | null = null;
  for (const cols of [2, 3, 4, 5]) {
    const rows = Math.ceil(28 / cols);
    const colourCols = Math.ceil(12 / rows);
    const across = 4 * cols + colourCols;
    const gapsX = 4 * GROUP_GAP + (4 * (cols - 1) + (colourCols - 1)) * GAP_X;
    const byWidth = (width - gapsX) / across;
    const byHeight = (height - LABEL - (rows - 1) * GAP_Y) / rows;
    const tile = Math.floor(Math.min(byWidth, byHeight, MAX_TILE));
    if (!best || tile > best.tile) best = { cols, colourCols, rows, tile };
  }
  return { ...best!, tile: Math.max(MIN_TILE, best!.tile) };
}
