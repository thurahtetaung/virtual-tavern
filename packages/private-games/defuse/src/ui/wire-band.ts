import type { Box } from './assets.ts';

/**
 * A wire's hit area that follows the wire, as the original's per-wire colliders do: the render is
 * a full-module layer, so its opaque pixels trace the wire in module units. Each column's opaque
 * span gives the wire's centre line there, and the hit area is a band of `half` either side of it
 * (wide enough for a finger), so crossing wires only share the spot where they cross. Where bands
 * overlap, `wireAt` gives the tap to the wire the player sees there.
 */

/** Half the band's height, in module units (about 13 px each side on a phone). */
export const BAND_HALF = 0.036;

export interface Band {
  /** The button's box, in module units. */
  box: Box;
  /** The band as a `clip-path` polygon in the button's own percentages. */
  clip: string;
  /** The centre line, in module units. */
  line: [number, number][];
  /** The render's alpha mask it was read from (`w` × `h`, row-major). */
  alpha: ArrayLike<number>;
  w: number;
  h: number;
}

/** The alpha a pixel needs to count as part of the wire. */
const OPAQUE = 96;

/**
 * The band of a wire in an alpha mask `w` × `h` (row-major, 0–255) of the whole module, or null
 * when the mask has no wire.
 */
export function bandOf(
  alpha: ArrayLike<number>,
  w: number,
  h: number,
  half = BAND_HALF,
): Band | null {
  const line: [number, number][] = [];
  for (let x = 0; x < w; x++) {
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < h; y++) {
      if (alpha[y * w + x]! < OPAQUE) continue;
      if (top < 0) top = y;
      bottom = y;
    }
    if (top >= 0) line.push([(x + 0.5) / w, (top + bottom + 1) / 2 / h]);
  }
  if (line.length < 2) return null;
  const x0 = line[0]![0] - 0.5 / w;
  const x1 = line.at(-1)![0] + 0.5 / w;
  const ys = line.map(([, y]) => y);
  const y0 = Math.max(0, Math.min(...ys) - half);
  const y1 = Math.min(1, Math.max(...ys) + half);
  const box: Box = [x0, y0, x1 - x0, y1 - y0];
  const px = (x: number) => `${(((x - x0) / (x1 - x0)) * 100).toFixed(2)}%`;
  const py = (y: number) =>
    `${(((Math.max(y0, Math.min(y1, y)) - y0) / (y1 - y0)) * 100).toFixed(2)}%`;
  // Ends square to the box's sides; the line's own ends fill the band to them.
  const pts = [
    [x0, line[0]![1]] as [number, number],
    ...line,
    [x1, line.at(-1)![1]] as [number, number],
  ];
  const upper = pts.map(([x, y]) => `${px(x)} ${py(y - half)}`);
  const lower = [...pts].reverse().map(([x, y]) => `${px(x)} ${py(y + half)}`);
  return { box, clip: `polygon(${[...upper, ...lower].join(', ')})`, line, alpha, w, h };
}

/** The centre line's height at module x, or null outside the band's box. */
function centreAt(band: Band, x: number): number | null {
  const { line } = band;
  if (x < band.box[0] || x > band.box[0] + band.box[2]) return null;
  let k = line.findIndex(([lx]) => lx >= x);
  if (k < 0) k = line.length - 1;
  const [ax, ay] = line[Math.max(0, k - 1)]!;
  const [bx, by] = line[k]!;
  return bx === ax ? by : ay + ((x - ax) / (bx - ax)) * (by - ay);
}

/** Whether module point (`x`, `y`) is inside a band. */
export function inBand(band: Band, x: number, y: number): boolean {
  const cy = centreAt(band, x);
  return cy !== null && Math.abs(y - cy) <= BAND_HALF;
}

/** Whether the wire's render shows at module point (`x`, `y`). */
export function shows(band: Band, x: number, y: number): boolean {
  const px = Math.floor(x * band.w);
  const py = Math.floor(y * band.h);
  if (px < 0 || py < 0 || px >= band.w || py >= band.h) return false;
  return band.alpha[py * band.w + px]! >= OPAQUE;
}

/**
 * Which wire a tap at module point (`x`, `y`) is for, given the wires' bands in drawing order
 * (later ones on top): the topmost wire whose render shows there, as the player sees it, else the
 * wire whose centre line is nearest among the bands that reach the point (the upper one on a tie).
 * Null when no band reaches it.
 */
export function wireAt(bands: readonly (Band | null)[], x: number, y: number): number | null {
  for (let i = bands.length - 1; i >= 0; i--) {
    const b = bands[i];
    if (b && shows(b, x, y)) return i;
  }
  let best: number | null = null;
  let gap = Infinity;
  for (let i = bands.length - 1; i >= 0; i--) {
    const b = bands[i];
    const cy = b ? centreAt(b, x) : null;
    if (cy === null) continue;
    const d = Math.abs(y - cy);
    if (d <= BAND_HALF && d < gap) {
      best = i;
      gap = d;
    }
  }
  return best;
}

const cache = new Map<string, Promise<Band | null>>();

/** Reads a render's alpha (once per file) and works out its band. */
export function loadBand(src: string): Promise<Band | null> {
  let p = cache.get(src);
  if (!p) {
    p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const w = 160;
          const h = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * w));
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const g = c.getContext('2d', { willReadFrequently: true });
          if (!g) return resolve(null);
          g.drawImage(img, 0, 0, w, h);
          const data = g.getImageData(0, 0, w, h).data;
          const alpha = new Uint8Array(w * h);
          for (let i = 0; i < w * h; i++) alpha[i] = data[i * 4 + 3]!;
          resolve(bandOf(alpha, w, h));
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
    cache.set(src, p);
  }
  return p;
}
