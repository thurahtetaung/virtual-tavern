import type { Bomb } from './types.ts';

/**
 * The bomb's own random stream (mulberry32), kept in the state so deadlines, which get no `rng`,
 * draw from it too. Hidden from every view.
 */
export function next(b: { r: number }): number {
  b.r = (b.r + 0x6d2b79f5) >>> 0;
  let t = b.r;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** `Random.Range(0, n)` for ints: 0 … n − 1. */
export const int = (b: { r: number }, n: number) => Math.floor(next(b) * n);

/** `Random.Range(min, max)` for floats. */
export const between = (b: { r: number }, min: number, max: number) => min + next(b) * (max - min);

export const pick = <T>(b: { r: number }, xs: readonly T[]): T => xs[int(b, xs.length)]!;

/** The original's `List.Shuffle` (Fisher–Yates). */
export function shuffle<T>(b: { r: number }, xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = int(b, i + 1);
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

export type Stream = Pick<Bomb, 'r'>;
