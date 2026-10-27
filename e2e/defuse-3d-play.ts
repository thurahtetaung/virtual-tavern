import { type Page, expect } from '@playwright/test';

// Shared steps for the 3D defuser view's specs: the test hooks on `window.__defuse3d` (only
// while the server runs the test seed) and waiting for the server's answer to a move.

export type Op = { op: string; [k: string]: unknown };
export type Hooks = {
  where: (id: string, i?: number) => { x: number; y: number } | null;
  focus: (id: string) => void;
  press: (i: number) => void;
  release: () => void;
  pickUp: () => void;
  back: () => void;
  turn: (d: 'up' | 'down' | 'left' | 'right') => void;
  pose: () => { pose: string; module: string | null; face: 0 | 1 };
  partFor: (id: string, op: Op) => number;
  look: (id: string) => Record<string, unknown> | null;
  next: () => { module: string; op: Op } | 'wait' | null;
  bomb: () => {
    modules: { id: string; kind: string; solved: boolean; face: 0 | 1; state?: string }[];
    log: { at: number; module: string; kind: string; what: string }[];
    end: unknown;
  };
  edges: () => Record<string, unknown>[];
  lit: () => string[];
  zoom: () => {
    zoom: number;
    max: number;
    pan: { x: number; y: number };
    surface: number;
    pointers: number;
  };
  haptics: () => { type: string; pattern: number[]; route: string; ok: boolean }[];
  thing: (name: 'case' | 'start' | 'clock' | 'snooze') => { x: number; y: number } | null;
  config: () => string | null;
  configAt: (t: number) => string;
  room: () => boolean;
  glance: () => [number, number];
  pickAt: (x: number, y: number) => { kind: string; path: string | null } | null;
  dial: (d: 'time-up' | 'time-down' | 'modules-up' | 'modules-down' | 'needy' | 'hardcore') => void;
};

/** Calls one of the 3D view's test hooks. */
export const call = <K extends keyof Hooks>(p: Page, name: K, ...args: Parameters<Hooks[K]>) =>
  p.evaluate(
    ([n, a]) => {
      // The hooks go with the 3D view (at the bomb's end): then every call answers null.
      const hooks = (
        window as unknown as { __defuse3d?: Record<string, (...x: unknown[]) => unknown> }
      ).__defuse3d;
      return hooks?.[n]?.(...a) ?? null;
    },
    [name, args] as [string, unknown[]],
  ) as Promise<ReturnType<Hooks[K]>>;

/** Waits for the 3D bomb, its hooks and the lights. */
export async function ready(p: Page) {
  await expect(p.getByTestId('bomb-3d')).toHaveAttribute('data-ready', /ready|failed/, {
    timeout: 30_000,
  });
  await p.waitForFunction(() => !!(window as unknown as { __defuse3d?: unknown }).__defuse3d);
  await p.waitForFunction(
    () => {
      const hooks = (
        window as unknown as { __defuse3d: { bomb: () => { activated: boolean } | null } }
      ).__defuse3d;
      return !!hooks.bomb()?.activated;
    },
    undefined,
    { timeout: 15_000 },
  );
}

/** A fingerprint of the bomb, to wait for the server's answer to a move. */
export const stamp = (p: Page) => call(p, 'bomb').then((b) => JSON.stringify(b));

export async function changed(p: Page, before: string) {
  await expect.poll(() => stamp(p), { timeout: 5000, intervals: [50] }).not.toBe(before);
}

/** Solves the bomb through the scene with the bot's solver, a move at a time. */
export async function solve(p: Page) {
  for (let guard = 0; guard < 300; guard++) {
    const b = await call(p, 'bomb');
    if (!b || b.end) return;
    const mv = await call(p, 'next');
    if (mv === null) return;
    if (mv === 'wait') {
      await p.waitForTimeout(250);
      continue;
    }
    await call(p, 'focus', mv.module);
    await p.waitForTimeout(250);
    if (mv.op.op === 'up') await call(p, 'release');
    else {
      await call(p, 'press', await call(p, 'partFor', mv.module, mv.op));
      if (mv.op.op === 'tap') await call(p, 'release');
    }
    await p.waitForTimeout(400);
  }
}

/** Taps a point of the scene with a real pointer (mouse or touch). */
export async function tapAt(p: Page, at: { x: number; y: number } | null) {
  expect(at).not.toBeNull();
  if (await p.evaluate(() => matchMedia('(pointer: coarse)').matches))
    await p.touchscreen.tap(at!.x, at!.y);
  else await p.mouse.click(at!.x, at!.y);
}
