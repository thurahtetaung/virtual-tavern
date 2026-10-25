import { z } from 'zod';

// Drawings: vector strokes on a 4:5 portrait page, for games where players draw (Going Once).
// The pad in `@vt/ui` (`DrawingPad`) records strokes in page units, simplifies them and sends them
// encoded; games keep the encoded form in their state, check it with `validateDrawing`, and any
// screen renders it at any size (`DrawingView`). Strokes, never bitmaps: small, crisp everywhere,
// and nobody can paste in a picture.

/** The page, in logical units (4:5 portrait). */
export const DRAW_W = 800;
export const DRAW_H = 1000;
/** Points are stored on a grid this many units apart (plenty for a finger). */
export const DRAW_GRID = 2;

/** The pens: colour-blind-safe (Okabe–Ito) and named for screen readers. */
export const DRAWING_COLORS = [
  { id: 'ink', name: 'Ink', hex: '#1c1917' },
  { id: 'blue', name: 'Blue', hex: '#0072b2' },
  { id: 'orange', name: 'Orange', hex: '#e69f00' },
  { id: 'green', name: 'Green', hex: '#009e73' },
] as const;

/** Line widths in page units. */
export const DRAWING_WIDTHS = [
  { id: 'thin', name: 'Thin', size: 8 },
  { id: 'medium', name: 'Medium', size: 18 },
  { id: 'thick', name: 'Thick', size: 36 },
] as const;

/** One stroke as drawn: a pen, a width and its points as a flat `[x0, y0, x1, y1, …]`. */
export interface Stroke {
  c: number;
  w: number;
  points: number[];
}

/** One stroke as sent and stored: `p` is its points encoded by `encodePoints`. */
export interface EncodedStroke {
  c: number;
  w: number;
  p: string;
}

/** A drawing as sent and stored: its strokes in drawing order. */
export type Drawing = EncodedStroke[];

export interface DrawingLimits {
  /** Most strokes in one drawing. */
  strokes: number;
  /** Most points in one drawing, all strokes together. */
  points: number;
  /** Most characters of encoded points in one drawing. */
  bytes: number;
}

export const DEFAULT_DRAWING_LIMITS: DrawingLimits = { strokes: 300, points: 2500, bytes: 12_000 };

/** The shape of a drawing in an action (the limits and the encoding are checked by `validateDrawing`). */
export const drawingSchema = z
  .array(
    z.object({
      c: z.number().int().min(0).max(DRAWING_COLORS.length - 1),
      w: z.number().int().min(0).max(DRAWING_WIDTHS.length - 1),
      p: z.string().min(1).max(DEFAULT_DRAWING_LIMITS.bytes),
    }),
  )
  .max(DEFAULT_DRAWING_LIMITS.strokes);

// ---- Simplifying ----

function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * Ramer–Douglas–Peucker: drops points that lie within `tolerance` page units of the line through
 * their neighbours, keeping the first and last. Takes and returns a flat `[x0, y0, …]`.
 */
export function simplifyPoints(points: readonly number[], tolerance = 2.5): number[] {
  const n = Math.floor(points.length / 2);
  if (n <= 2) return points.slice(0, n * 2);
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: [number, number][] = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let far = 0;
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistance(
        points[i * 2]!,
        points[i * 2 + 1]!,
        points[a * 2]!,
        points[a * 2 + 1]!,
        points[b * 2]!,
        points[b * 2 + 1]!,
      );
      if (d > far) {
        far = d;
        worst = i;
      }
    }
    if (worst >= 0 && far > tolerance) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i * 2]!, points[i * 2 + 1]!);
  return out;
}

// ---- Encoding ----

// Each number is zigzagged and written 5 bits per character, the sixth bit saying "more follows".
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const INDEX = new Map([...ALPHABET].map((ch, i) => [ch, i]));
const MAX_X = DRAW_W / DRAW_GRID;
const MAX_Y = DRAW_H / DRAW_GRID;

const clamp = (v: number, max: number) => Math.max(0, Math.min(max, Math.round(v)));

function writeNumber(out: string[], value: number) {
  let v = value < 0 ? -value * 2 - 1 : value * 2;
  do {
    const chunk = v & 31;
    v = Math.floor(v / 32);
    out.push(ALPHABET[v > 0 ? chunk | 32 : chunk]!);
  } while (v > 0);
}

/**
 * Points (page units, flat) to a compact string: snapped to the grid and clamped to the page, the
 * first point absolute and the rest as steps from the one before.
 */
export function encodePoints(points: readonly number[]): string {
  const out: string[] = [];
  let px = 0;
  let py = 0;
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = clamp(points[i]! / DRAW_GRID, MAX_X);
    const y = clamp(points[i + 1]! / DRAW_GRID, MAX_Y);
    writeNumber(out, x - px);
    writeNumber(out, y - py);
    px = x;
    py = y;
  }
  return out.join('');
}

/** The reverse of `encodePoints`, or null if the string isn't a valid stroke on the page. */
export function decodePoints(encoded: string): number[] | null {
  const nums: number[] = [];
  let value = 0;
  let scale = 1;
  let open = false;
  for (const ch of encoded) {
    const d = INDEX.get(ch);
    if (d === undefined) return null;
    value += (d & 31) * scale;
    if (d & 32) {
      scale *= 32;
      open = true;
      if (scale > 32 ** 4) return null;
      continue;
    }
    nums.push(value % 2 ? -(value + 1) / 2 : value / 2);
    value = 0;
    scale = 1;
    open = false;
  }
  if (open || nums.length === 0 || nums.length % 2) return null;
  const out: number[] = [];
  let x = 0;
  let y = 0;
  for (let i = 0; i < nums.length; i += 2) {
    x += nums[i]!;
    y += nums[i + 1]!;
    if (x < 0 || x > MAX_X || y < 0 || y > MAX_Y) return null;
    out.push(x * DRAW_GRID, y * DRAW_GRID);
  }
  return out;
}

/** Strokes as drawn to the form that is sent: simplified, snapped and encoded (empty strokes dropped). */
export function encodeDrawing(strokes: readonly Stroke[], tolerance = 2.5): Drawing {
  return strokes
    .filter((s) => s.points.length >= 2)
    .map((s) => ({ c: s.c, w: s.w, p: encodePoints(simplifyPoints(s.points, tolerance)) }));
}

/** A stored drawing back to strokes, skipping any that don't decode. */
export function decodeDrawing(drawing: Drawing): Stroke[] {
  return drawing.flatMap((s) => {
    const points = decodePoints(s.p);
    return points ? [{ c: s.c, w: s.w, points }] : [];
  });
}

export type DrawingCheck =
  | { ok: true; drawing: Drawing }
  | { ok: false; code: 'drawing-invalid' | 'drawing-empty' | 'drawing-too-big'; message: string };

/**
 * Checks a drawing from a player: the shape, every stroke decodes onto the page, and it is within
 * the limits. Returns a clean copy (only the known fields) to store.
 */
export function validateDrawing(
  raw: unknown,
  limits: DrawingLimits = DEFAULT_DRAWING_LIMITS,
): DrawingCheck {
  const parsed = drawingSchema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, code: 'drawing-invalid', message: 'That drawing could not be read.' };
  const drawing = parsed.data.map((s) => ({ c: s.c, w: s.w, p: s.p }));
  if (drawing.length === 0)
    return { ok: false, code: 'drawing-empty', message: 'You have to draw something!' };
  if (drawing.length > limits.strokes)
    return { ok: false, code: 'drawing-too-big', message: 'That drawing has too many lines.' };
  let points = 0;
  let bytes = 0;
  for (const s of drawing) {
    const decoded = decodePoints(s.p);
    if (!decoded)
      return { ok: false, code: 'drawing-invalid', message: 'That drawing could not be read.' };
    points += decoded.length / 2;
    bytes += s.p.length;
  }
  if (points > limits.points || bytes > limits.bytes)
    return { ok: false, code: 'drawing-too-big', message: 'That drawing is too detailed to send.' };
  return { ok: true, drawing };
}

/** How many points a drawing holds (for the pad's "nearly full" warning). */
export const drawingPoints = (strokes: readonly Stroke[]) =>
  strokes.reduce((n, s) => n + Math.floor(s.points.length / 2), 0);
