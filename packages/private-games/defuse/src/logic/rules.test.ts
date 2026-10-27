import { describe, expect, it } from 'vitest';
import { LIGHTS, act, createBomb, infoOf, runTo } from './bomb.ts';
import {
  BUTTON_RULES,
  KEYPAD_COLUMNS,
  KNOB,
  MAZES,
  MEMORY_RULES,
  MORSE,
  PASSWORDS,
  RELEASE_DIGIT,
  SEQUENCE,
  SIMON_MAP,
  VENN,
  WIRE_RULES,
  WOF_DISPLAYS,
  WOF_GROUPS,
  WOF_LISTS,
} from './data.ts';
import { DEFAULT_SETTINGS } from './game.ts';
import { mazePath } from './helpers.ts';
import { memoryAnswer, vennCut, wiresAnswer } from './modules.ts';
import { MonoRandom, PRINTED, generateRules, monoSort, rulesFor } from './rules.ts';
import type { Bomb, Module, Settings, WiresModule } from './types.ts';

// The different manual: the original's rule generators from a seed. Seed 1 is the printed
// manual, table for table; other seeds make manuals as valid as the printed one.

const SEEDS = [2, 3, 42, 418, 7777, 123_456_789, 2_000_000_000];

describe('seed 1 is the printed manual', () => {
  const g = generateRules(1);
  it.each([
    ['wires', g.wires, WIRE_RULES],
    ['button', g.button, BUTTON_RULES],
    ['release', g.release, RELEASE_DIGIT],
    ['keypad', g.keypad, KEYPAD_COLUMNS],
    ['simon', g.simon, SIMON_MAP],
    ['wofDisplays', g.wofDisplays, WOF_DISPLAYS],
    ['wofLists', g.wofLists, WOF_LISTS],
    ['memory', g.memory, MEMORY_RULES],
    ['morse', g.morse, MORSE],
    ['venn', g.venn, VENN],
    ['sequence', g.sequence, SEQUENCE],
    ['mazes', g.mazes, MAZES],
    ['passwords', g.passwords, PASSWORDS],
    ['knob', g.knob, KNOB],
  ])('%s', (_name, made, printed) => {
    expect(JSON.parse(JSON.stringify(made))).toEqual(JSON.parse(JSON.stringify(printed)));
  });

  it('rulesFor(1) and bombs saved before seeds read the printed manual', () => {
    expect(rulesFor(1)).toBe(PRINTED);
    expect(rulesFor(undefined)).toBe(PRINTED);
    expect(rulesFor(null)).toBe(PRINTED);
  });
});

describe('Mono’s Random and sort', () => {
  it('a one-wide range draws nothing, as Mono’s Next(min, max) does', () => {
    const a = new MonoRandom(5);
    const b = new MonoRandom(5);
    expect(a.range(3, 4)).toBe(3);
    expect(a.nextDouble()).toBe(b.nextDouble());
    expect(a.next(1)).toBe(0);
    expect(a.nextDouble()).not.toBe(b.nextDouble());
  });

  it('draws in [0, 1) and repeats for a seed', () => {
    const a = new MonoRandom(99);
    const b = new MonoRandom(99);
    for (let i = 0; i < 1000; i++) {
      const x = a.nextDouble();
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
      expect(b.nextDouble()).toBe(x);
    }
  });

  it('sorts like any sort on distinct keys', () => {
    const xs = [5, 1, 4, 2, 3, 9, 0];
    monoSort(xs, (a, b) => a - b);
    expect(xs).toEqual([0, 1, 2, 3, 4, 5, 9]);
  });
});

describe.each(SEEDS)('seed %i makes a valid manual', (seed) => {
  const r = generateRules(seed);

  it('differs from the printed one and repeats', () => {
    expect(JSON.stringify(r)).not.toBe(JSON.stringify(PRINTED));
    expect(generateRules(seed)).toEqual(r);
  });

  it('wires: 3–4 rules and an otherwise per count, cutting a wire that exists', () => {
    for (const n of [3, 4, 5, 6] as const) {
      const list = r.wires[n];
      expect(list.length).toBeGreaterThanOrEqual(4);
      expect(list.length).toBeLessThanOrEqual(5);
      expect(list.at(-1)!.when).toEqual([]);
      for (const rule of list) {
        if (typeof rule.cut === 'number') expect(rule.cut).toBeLessThan(n - 1);
        if (rule.of) {
          // A colour to cut is always one the rule's own conditions say is there.
          const named = rule.when.flatMap((c) =>
            'last' in c ? [c.last] : 'count' in c && ('over' in c || c.is === 1) ? [c.count] : [],
          );
          expect(named).toContain(rule.of);
        }
        // Conditions on the serial never come first.
        expect('serialOdd' in (rule.when[0] ?? {}) || 'serialLetter' in (rule.when[0] ?? {})).toBe(
          false,
        );
      }
      // The generator sorts two-condition rules first.
      const counts = list.slice(0, -1).map((x) => x.when.length);
      expect([...counts].sort((a, b) => b - a)).toEqual(counts);
    }
  });

  it('the button: up to six rules, an otherwise to hold, release digits for every strip', () => {
    expect(r.button.length).toBeLessThanOrEqual(7);
    expect(r.button.at(-1)).toEqual({ when: [], hold: true });
    expect(Object.keys(r.release)).toHaveLength(4);
    expect(r.release.other).toMatch(/^[1-5]$/);
  });

  it('keypad: six columns of seven different symbols', () => {
    expect(r.keypad).toHaveLength(6);
    for (const col of r.keypad) {
      expect(new Set(col).size).toBe(7);
      for (const s of col) expect(s >= 1 && s <= 31).toBe(true);
    }
  });

  it('Simon, Who’s on First, Memory, Morse, Complicated Wires, Wire Sequence', () => {
    for (const k of ['vowel', 'none'] as const)
      for (const s of ['0', '1', '2'] as const) expect(r.simon[k][s]).toHaveLength(4);
    expect(r.wofDisplays.map(([w]) => w)).toEqual(WOF_DISPLAYS.map(([w]) => w));
    for (const [, i] of r.wofDisplays) expect(i >= 0 && i < 6).toBe(true);
    for (const group of WOF_GROUPS)
      for (const w of group) expect([...r.wofLists[w]!].sort()).toEqual([...group].sort());
    for (let s = 1; s <= 5; s++)
      for (const rule of r.memory[s]!) {
        if (rule.press.startsWith('same')) expect(rule.n).toBeLessThan(s);
        else expect(rule.n >= 1 && rule.n <= 4).toBe(true);
      }
    expect(r.morse).toHaveLength(16);
    expect(new Set(r.morse.map(([, w]) => w)).size).toBe(16);
    expect(r.morse.map(([f]) => f)).toEqual([...r.morse.map(([f]) => f)].sort((a, b) => a - b));
    expect(Object.keys(r.venn)).toEqual(Object.keys(VENN));
    expect(r.venn['-']).toBe('C');
    for (const c of ['red', 'blue', 'black'] as const) expect(r.sequence[c]).toHaveLength(9);
  });

  it('mazes: nine perfect mazes, every cell reachable, eighteen different circles', () => {
    expect(r.mazes).toHaveLength(9);
    const circles = r.mazes.flatMap((z) => z.circles.map(([x, y]) => `${x},${y}`));
    expect(new Set(circles).size).toBe(18);
    r.mazes.forEach((_, i) => {
      for (let x = 0; x < 6; x++)
        for (let y = 0; y < 6; y++) expect(mazePath(i, [0, 0], [x, y], r)).not.toBeNull();
      // A perfect maze (a spanning tree) has exactly 35 passages.
      const open = r.mazes[i]!.walls.join('')
        .split('')
        .reduce((n, h) => n + 4 - bits(h), 0);
      expect(open / 2).toBe(35);
    });
  });

  it('the knob: eight different patterns, two for each position', () => {
    expect(new Set(r.knob.map((k) => k.leds)).size).toBe(8);
    for (const pos of ['up', 'down', 'left', 'right'])
      expect(r.knob.filter((k) => k.pos === pos)).toHaveLength(2);
  });
});

/** The walls a hex cell has (each open passage shows in both of its cells). */
function bits(h: string) {
  const v = parseInt(h, 16);
  return (v & 1) + ((v >> 1) & 1) + ((v >> 2) & 1) + ((v >> 3) & 1);
}

// ---- A bomb judged by its manual ----

const S = (o: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...o });

function lit(seed: number, manual: number): Bomb {
  const b = createBomb(1, seed, S({ modules: 11, needy: false }), 0, manual);
  runTo(b, LIGHTS.clock);
  return b;
}

function each<K extends Module['kind']>(kind: K, manual: number, n = 40) {
  const out: { b: Bomb; m: Extract<Module, { kind: K }> }[] = [];
  for (let seed = 1; out.length < n && seed < 5000; seed++) {
    const b = lit(seed, manual);
    const m = b.modules.find((x) => x.kind === kind);
    if (m) out.push({ b, m: m as Extract<Module, { kind: K }> });
  }
  return out;
}

describe.each([2, 418, 99_999])('a bomb under manual %i', (manual) => {
  it('wires: the seed’s wire solves, the printed one strikes when they differ', () => {
    let differ = 0;
    for (const { b, m } of each('wires', manual)) {
      const right = wiresAnswer(m, infoOf(b));
      const printed = wiresAnswer(m, { ...infoOf(b), rules: PRINTED });
      if (printed !== right) {
        differ++;
        const c = structuredClone(b);
        expect(act(c, m.id, { op: 'cut', wire: printed }, LIGHTS.clock + 10)).toBe('strike');
      }
      expect(act(b, m.id, { op: 'cut', wire: right }, LIGHTS.clock + 10)).toBe('solve');
    }
    expect(differ).toBeGreaterThan(0);
  });

  it('keypad: symbols come from the seed’s columns, pressed in its order', () => {
    for (const { b, m } of each('keypad', manual)) {
      const col = rulesFor(manual).keypad[m.column]!;
      expect(m.symbols.every((s) => col.includes(s))).toBe(true);
      const order = [0, 1, 2, 3].sort(
        (x, y) => col.indexOf(m.symbols[x]!) - col.indexOf(m.symbols[y]!),
      );
      const out = order.map((i, k) => act(b, m.id, { op: 'press', button: i }, LIGHTS.clock + k));
      expect(out.at(-1)).toBe('solve');
      expect(out).not.toContain('strike');
    }
  });

  it('memory, complicated wires and the maze follow the seed', () => {
    for (const { b, m } of each('memory', manual, 10)) {
      const i = memoryAnswer(m, undefined, infoOf(b).rules);
      expect(act(b, m.id, { op: 'press', button: i }, LIGHTS.clock + 1)).toBeNull();
    }
    for (const { b, m } of each('complicated-wires', manual, 10)) {
      const info = infoOf(b);
      m.wires.forEach((w, i) => {
        if (vennCut(w, info))
          expect(act(b, m.id, { op: 'cut', wire: i }, LIGHTS.clock + 1)).not.toBe('strike');
      });
      expect(b.modules.find((x) => x.id === m.id)!.solved).toBe(true);
    }
    for (const { b, m } of each('maze', manual, 10)) {
      const path = mazePath(m.maze, m.at, m.goal, rulesFor(manual))!;
      let last: unknown = null;
      for (let i = 1; i < path.length; i++) {
        const [dx, dy] = [path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1]];
        const dir = dx > 0 ? 'right' : dx < 0 ? 'left' : dy > 0 ? 'down' : 'up';
        last = act(b, m.id, { op: 'move', dir }, LIGHTS.clock + i);
        expect(last).not.toBe('strike');
      }
      expect(last).toBe('solve');
    }
  });

  it('the same bomb seed makes the same modules under any manual but keypad columns', () => {
    const a = lit(5, 1).modules.map((m) => m.kind);
    const b = lit(5, manual).modules.map((m) => m.kind);
    expect(b).toEqual(a);
  });
});

it('a wires module with a "first red wire" rule cuts the first red', () => {
  // Find a seed with a rule that cuts the first or only wire of a colour, and check it.
  for (let seed = 2; seed < 400; seed++) {
    const r = rulesFor(seed);
    for (const n of [3, 4, 5, 6] as const) {
      const rule = r.wires[n].find((x) => x.cut === 'first' || x.cut === 'only');
      if (!rule || rule.when.some((c) => 'serialOdd' in c || 'serialLetter' in c)) continue;
      const colour = rule.of!;
      const m = {
        kind: 'wires',
        wires: Array.from({ length: n }, (_, slot) => ({ slot, colour, cut: false })),
      } as unknown as WiresModule;
      // Every wire the rule's colour: whichever rule matches, its wire is on the module.
      const info = { serial: '1A1AA2', widgets: [], strikes: 0, timerText: () => '', rules: r };
      const got = wiresAnswer(m, info);
      expect(got).toBeGreaterThanOrEqual(0);
      expect(got).toBeLessThan(n);
      return;
    }
  }
  throw new Error('no seed with a first-of-colour rule');
});
