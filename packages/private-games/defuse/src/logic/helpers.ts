// The experts' interactive helpers (a host option): pure lookups over the manual's rules.
import { batteries, hasPort, serialOdd } from './edgework.ts';
import { STEP, wallAt } from './modules.ts';
import type { Rules, VennLetter } from './rules.ts';
import type { Dir, Widget } from './types.ts';

export type Cell = [number, number];

/** The shortest way through a maze from `at` to `goal` (cells, `at` first), or null. */
export function mazePath(maze: number, at: Cell, goal: Cell, rules: Rules): Cell[] | null {
  const key = (p: readonly number[]) => `${p[0]},${p[1]}`;
  const from = new Map<string, Cell | null>([[key(at), null]]);
  const queue: Cell[] = [at];
  while (queue.length) {
    const p = queue.shift()!;
    if (p[0] === goal[0] && p[1] === goal[1]) {
      const path: Cell[] = [];
      for (let cur: Cell | null = p; cur; cur = from.get(key(cur))!) path.unshift(cur);
      return path;
    }
    for (const d of ['up', 'right', 'down', 'left'] as Dir[]) {
      const [dx, dy] = STEP[d];
      const n: Cell = [p[0] + dx, p[1] + dy];
      if (n[0] < 0 || n[0] > 5 || n[1] < 0 || n[1] > 5 || from.has(key(n))) continue;
      if (wallAt(maze, p, d, rules)) continue;
      from.set(key(n), p);
      queue.push(n);
    }
  }
  return null;
}

/** The direction of each step along a path. */
export function pathDirs(path: readonly Cell[]): Dir[] {
  const dirs: Dir[] = [];
  for (let i = 1; i < path.length; i++) {
    const [dx, dy] = [path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]];
    dirs.push(dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up');
  }
  return dirs;
}

/** The mazes a circle at that cell can mean (its marking circles). */
export const mazesWithCircle = (rules: Rules, [x, y]: Cell) =>
  rules.mazes.flatMap((z, i) => (z.circles.some((c) => c[0] === x && c[1] === y) ? [i] : []));

/** A Complicated Wires wire as the lookup asks for it. */
export interface VennWire {
  red: boolean;
  blue: boolean;
  star: boolean;
  led: boolean;
}

export const vennKey = (w: VennWire) =>
  `${w.red ? 'r' : ''}${w.blue ? 'b' : ''}${w.star ? 's' : ''}${w.led ? 'l' : ''}` || '-';

export const vennLetter = (w: VennWire, rules: Rules): VennLetter => rules.venn[vennKey(w)]!;

/** What the edgework questions a letter asks; null when the letter needs no question. */
export const VENN_QUESTION: Record<VennLetter, string | null> = {
  C: null,
  D: null,
  S: 'Is the last digit of the serial number even?',
  P: 'Does the bomb have a parallel port?',
  B: 'Does the bomb have two or more batteries?',
};

/** Whether to cut, given the answer to the letter's question (ignored for C and D). */
export const vennCutWith = (letter: VennLetter, yes: boolean) =>
  letter === 'C' ? true : letter === 'D' ? false : yes;

/** Whether to cut, given the edgework itself (for tests). */
export function vennCutFor(w: VennWire, rules: Rules, serial: string, widgets: readonly Widget[]) {
  const letter = vennLetter(w, rules);
  if (letter === 'S') return !serialOdd(serial);
  if (letter === 'P') return hasPort(widgets, 'parallel');
  if (letter === 'B') return batteries(widgets) > 1;
  return letter === 'C';
}
