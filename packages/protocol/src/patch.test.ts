import { createRng, type Rng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { type Patch, PatchError, applyPatch, diff, jsonEqual } from './patch.ts';

/** Diffs, applies, and checks the round trip (and that the base was left alone). */
function roundTrip(a: unknown, b: unknown): Patch {
  const base = JSON.parse(JSON.stringify(a)) as unknown;
  const before = JSON.stringify(base);
  // Over the wire, like the real thing.
  const patch = JSON.parse(JSON.stringify(diff(a, b))) as Patch;
  const out = applyPatch(base, patch);
  expect(out).toEqual(b);
  expect(JSON.stringify(base)).toBe(before);
  return patch;
}

describe('diff and applyPatch', () => {
  it('sends nothing for equal values', () => {
    expect(diff({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toEqual([]);
  });

  it('sets, adds and deletes object keys', () => {
    const a = { x: 1, y: { z: 'old', keep: [1, 2, 3, 4, 5, 6, 7] }, gone: true };
    const b = { x: 1, y: { z: 'new', keep: [1, 2, 3, 4, 5, 6, 7] }, added: null };
    expect(roundTrip(a, b)).toEqual([
      [1, ['gone']],
      [0, ['y', 'z'], 'new'],
      [0, ['added'], null],
    ]);
  });

  it('appends to a growing log', () => {
    const log = Array.from({ length: 20 }, (_, i) => ({ kind: 'move', by: `p${i % 3}`, n: i }));
    const more = [...log, { kind: 'move', by: 'p1', n: 20 }];
    expect(roundTrip({ log }, { log: more })).toEqual([[2, ['log'], 20, 0, [more[20]]]]);
  });

  it('drops the front and appends to a capped log', () => {
    const entry = (i: number) => ({ text: `entry number ${i}`, at: i });
    const a = Array.from({ length: 30 }, (_, i) => entry(i));
    const b = Array.from({ length: 30 }, (_, i) => entry(i + 2));
    expect(roundTrip({ log: a }, { log: b })).toEqual([
      [2, ['log'], 0, 2, []],
      [2, ['log'], 28, 0, [entry(30), entry(31)]],
    ]);
  });

  it('edits items in place and removes from the middle', () => {
    const a = { hand: ['a1', 'b2', 'c3', 'd4', 'e5'], seats: [{ hp: 10 }, { hp: 9 }] };
    const b = { hand: ['a1', 'b2', 'd4', 'e5'], seats: [{ hp: 10 }, { hp: 7 }] };
    expect(roundTrip(a, b)).toEqual([
      [2, ['hand'], 2, 1, []],
      [0, ['seats', 1, 'hp'], 7],
    ]);
  });

  it('replaces a value whole when that is smaller', () => {
    const a = { grid: [1, 2, 3, 4, 5, 6, 7, 8] };
    const b = { grid: [9, 9, 9, 9, 9, 9, 9, 9] };
    expect(roundTrip(a, b)).toEqual([[0, ['grid'], b.grid]]);
  });

  it('handles type changes and the root', () => {
    roundTrip({ a: [1] }, { a: { 0: 1 } });
    roundTrip({ a: null }, { a: [] });
    roundTrip([1, 2], { x: 1 });
    roundTrip(1, 'two');
  });

  it('keeps the identity of everything a patch did not touch', () => {
    const a = { left: { deep: [1, 2] }, right: { n: 1 }, list: [{ id: 1 }, { id: 2 }] };
    const out = applyPatch(a, diff(a, { ...a, right: { n: 2 }, list: [{ id: 1 }, { id: 3 }] }));
    expect(out.left).toBe(a.left);
    expect(out.list[0]).toBe(a.list[0]);
    expect(out.right).not.toBe(a.right);
    expect(a.right.n).toBe(1);
  });

  it('refuses patches that do not fit', () => {
    const bad: unknown[] = [
      [[0, ['missing', 'x'], 1]],
      [[1, ['nope']]],
      [[2, ['list'], 5, 1, []]],
      [[2, ['obj'], 0, 0, []]],
      [[0, ['list', 9], 1]],
      [[0, ['__proto__', 'polluted'], 1]],
      [[1, []]],
      [[7, ['obj']]],
      'nonsense',
    ];
    for (const patch of bad)
      expect(() => applyPatch({ list: [1], obj: {} }, patch as Patch)).toThrow(PatchError);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('replaces an object holding __proto__ whole instead of patching through it', () => {
    const a = JSON.parse('{"o":{"__proto__":{"x":1},"y":1}}') as unknown;
    const b = JSON.parse('{"o":{"__proto__":{"x":2},"y":1}}') as unknown;
    const out = applyPatch(a, diff(a, b));
    expect(JSON.stringify(out)).toBe(JSON.stringify(b));
  });
});

/** A random JSON value, and a random edit of one, shaped like room views (objects, lists, logs). */
function randomValue(rng: Rng, depth = 0): unknown {
  const r = rng.next();
  if (depth > 3 || r < 0.35) {
    const p = rng.int(6);
    return [null, true, rng.int(100), `s${rng.int(20)}`, rng.next(), false][p];
  }
  if (r < 0.65) return Array.from({ length: rng.int(8) }, () => randomValue(rng, depth + 1));
  const o: Record<string, unknown> = {};
  for (let i = rng.int(6); i > 0; i--) o[`k${rng.int(10)}`] = randomValue(rng, depth + 1);
  return o;
}

function mutate(rng: Rng, v: unknown, depth = 0): unknown {
  if (rng.next() < 0.15 || depth > 4) return randomValue(rng, depth);
  if (Array.isArray(v)) {
    const out = (v as unknown[]).map((x) => (rng.next() < 0.3 ? mutate(rng, x, depth + 1) : x));
    const r = rng.next();
    if (r < 0.25) out.push(randomValue(rng, depth + 1));
    else if (r < 0.4 && out.length) out.splice(rng.int(out.length), 1);
    else if (r < 0.5) out.splice(0, Math.min(out.length, 1 + rng.int(2)));
    else if (r < 0.6) out.splice(rng.int(out.length + 1), 0, randomValue(rng, depth + 1));
    return out;
  }
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      const r = rng.next();
      if (r < 0.1) continue;
      out[k] = r < 0.4 ? mutate(rng, x, depth + 1) : x;
    }
    if (rng.next() < 0.3) out[`n${rng.int(5)}`] = randomValue(rng, depth + 1);
    return out;
  }
  return rng.next() < 0.5 ? v : randomValue(rng, depth);
}

describe('random round trips', () => {
  it('rebuilds every edit of 3,000 random values', () => {
    const rng = createRng(42);
    for (let i = 0; i < 3000; i++) {
      let a = randomValue(rng);
      // A chain of edits, applied one after another like a game's updates.
      let copy = JSON.parse(JSON.stringify(a)) as unknown;
      for (let step = 0; step < 5; step++) {
        const b = mutate(rng, a);
        copy = applyPatch(copy, JSON.parse(JSON.stringify(diff(a, b))) as Patch);
        expect(jsonEqual(copy, b)).toBe(true);
        a = b;
      }
    }
  });
});
