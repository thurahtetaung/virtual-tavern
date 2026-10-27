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
      const hooks = (window as unknown as { __defuse3d: { bomb: () => { activated: boolean } } })
        .__defuse3d;
      return hooks.bomb().activated;
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
