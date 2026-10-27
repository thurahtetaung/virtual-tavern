// Where things sit on the table screen's 1280 × 720 paper, as pure numbers (Stage.tsx draws them;
// layout.test.ts checks everything stays on the paper and clear of the subtitle band).

/** Paper size in stage units. */
export const PAPER_W = 1280;

/**
 * The subtitle's own band at the bottom of the paper: every room keeps its words and pieces above
 * it (the number row, the drawing's poses, the pencils, the board's footer).
 */
export const SUBTITLE_TOP = 656;

/**
 * The drawing while the answers are turned over: the original's reveal pose (`RevealMove`) a
 * little smaller and higher (its 240 × 320 canvas from y 330 to 634), so it stays clear of the
 * subtitle band and of the card above it.
 */
export const REVEAL_POSE = 'matrix(0.95,0,0,0.95,514,330)';

/** How many rows run right to left per player count (the original's: the rest run left to right). */
const LEFTWARD: Record<number, number> = { 3: 3, 4: 4, 5: 3, 6: 3, 7: 4, 8: 4 };
/** The pencil's art across its own units (eraser to tip), and where the tip draws. */
export const PENCIL_FROM = 20;
export const PENCIL_TO = 128;
const PENCIL_TIP = 120;
/** The drawn line's art width in its own units. */
export const LINE_W = 884;
/** Rows keep this clear of the paper's sides, the title above and the subtitle band below. */
const SIDE = 40;
export const ROWS_TOP = 150;
export const ROWS_BOTTOM = 600;
/** The pencils' scale (the original's 2.147 leaves too little paper for the names). */
const PENCIL_K = 1.4;
/** The widest a name over a pencil gets (it is cut short beyond). */
export const NAME_W = 260;

type Places = Record<string, unknown> | undefined;

/** A place from the rig (one matrix, or the first of a list). */
function place(places: Places, key: string): number[] | undefined {
  const p = places?.[key] as number[] | number[][] | undefined;
  if (!p) return undefined;
  return Array.isArray(p[0]) ? (p as number[][])[0] : (p as number[]);
}

export interface DrawRow {
  y: number;
  /** Runs right to left (the pencil unmirrored, its line trailing on the right). */
  leftward: boolean;
  k: number;
}

/**
 * Where drawing time's rows run, from the original's layouts: its rows' heights per player count
 * and which way each pencil travels. The original's pencils start off the paper; ours travel the
 * width of the screen with the whole pencil and its name on it.
 */
export function drawRows(places: Places, n: number): DrawRow[] {
  const count = Math.min(8, Math.max(3, n));
  const list = (places?.[`drawIn.Players${count}`] as number[][] | undefined) ?? [];
  const at = place(places, 'drawIn.at') ?? [1, 0, 0, 1, 0, 0];
  // The pencil sits 9 units down its row (the original's scale 2.147).
  const ys = Array.from({ length: n }, (_, i) => {
    const m = list[i];
    return m ? at[5]! + m[5]! + 2.147 * 9 : null;
  });
  const known = ys.every((y) => y !== null);
  const top = known ? Math.min(...ys) : 0;
  const bottom = known ? Math.max(...ys) : 0;
  const from = known ? Math.max(ROWS_TOP, top) : ROWS_TOP;
  const to = known ? Math.min(ROWS_BOTTOM, bottom) : ROWS_BOTTOM;
  return ys.map((y, i) => ({
    // In the original's order down the screen, fitted between the title and the subtitle band.
    y:
      n === 1
        ? (from + to) / 2
        : known && bottom > top
          ? from + ((y! - top) * (to - from)) / (bottom - top)
          : from + (i * (to - from)) / (n - 1),
    leftward: i < (LEFTWARD[count] ?? n),
    k: PENCIL_K,
  }));
}

/**
 * A row's pencil `share` (0…1) of the way through drawing time: its origin (`x`; a rightward
 * pencil is mirrored, its art running back from there), the middle of the pencil (where the name
 * rides) and the line drawn so far, which trails behind the tip back to where the tip started.
 * The whole pencil stays on the paper from start to end.
 */
export function pencilAt(row: DrawRow, share: number) {
  const { leftward, k } = row;
  const dir = leftward ? 1 : -1;
  const from = leftward ? PAPER_W - SIDE - PENCIL_TO * k : SIDE + PENCIL_TO * k;
  const to = leftward ? SIDE - PENCIL_FROM * k : PAPER_W - SIDE + PENCIL_FROM * k;
  const x = from + (to - from) * share;
  const tip = (o: number) => o + dir * PENCIL_TIP * k;
  return {
    x,
    /** Where the player's name and dot ride: over the pencil, the whole name on the paper. */
    mid: Math.min(
      PAPER_W - NAME_W / 2 - 10,
      Math.max(NAME_W / 2 + 10, x + dir * ((PENCIL_FROM + PENCIL_TO) / 2) * k),
    ),
    /** The pencil's art from its eraser to its tip, left to right on the paper. */
    left: leftward ? x + PENCIL_FROM * k : x - PENCIL_TO * k,
    right: leftward ? x + PENCIL_TO * k : x - PENCIL_FROM * k,
    lineFrom: leftward ? tip(x) : tip(from),
    lineTo: leftward ? tip(from) : tip(x),
  };
}

/**
 * Where the answer being turned over sits: the original's centre of the choices (each answer
 * slides there to be turned over), above the drawing in its reveal pose.
 */
export function choiceCentre(places: Places): number[] {
  const list = places?.['choices.ThreeChoices'] as number[][] | undefined;
  const at = place(places, 'choices.at') ?? [1, 0, 0, 1, 39, 194];
  const m = list?.[0];
  return m ? [1, 0, 0, 1, at[4]! + m[4]!, at[5]! + m[5]!] : [1, 0, 0, 1, 470, 157];
}
