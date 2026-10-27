// The manual's rules from a seed, as the original's rule generators make them
// (`RuleManager.GenerateBombRules`: one `System.Random(seed)` per module's generator). Seed 1 is
// the printed manual (the tables in data.ts, tested). The original runs on Mono, so its
// `System.Random` and `List.Sort` are Mono's, reproduced here.
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
import type { ButtonCond, ButtonRule, WireColour, WireCond, WireRule } from './data-types.ts';

export type MemoryRule = (typeof MEMORY_RULES)[number][number];
export type VennLetter = 'C' | 'D' | 'S' | 'P' | 'B';

/** Everything the manual says, in the shapes of data.ts. */
export interface Rules {
  wires: Record<3 | 4 | 5 | 6, WireRule[]>;
  button: ButtonRule[];
  release: Record<string, string>;
  keypad: number[][];
  simon: Record<'vowel' | 'none', Record<'0' | '1' | '2', string[]>>;
  wofDisplays: [string, number][];
  wofLists: Record<string, string[]>;
  memory: Record<number, MemoryRule[]>;
  morse: [number, string][];
  venn: Record<string, VennLetter>;
  sequence: Record<'red' | 'blue' | 'black', number[][]>;
  mazes: { circles: [number, number][]; walls: string[] }[];
  passwords: string[];
  knob: { pos: 'up' | 'down' | 'left' | 'right'; leds: string }[];
}

/** The printed manual (manual version 1, seed 1). */
export const PRINTED: Rules = {
  wires: WIRE_RULES,
  button: BUTTON_RULES,
  release: RELEASE_DIGIT,
  keypad: KEYPAD_COLUMNS,
  simon: SIMON_MAP,
  wofDisplays: WOF_DISPLAYS,
  wofLists: WOF_LISTS,
  memory: MEMORY_RULES,
  morse: MORSE,
  venn: VENN,
  sequence: SEQUENCE,
  mazes: MAZES,
  passwords: PASSWORDS,
  knob: KNOB,
};

export const PRINTED_SEED = 1;

// ---- Mono's System.Random (Knuth's subtractive generator, `inextp` 31) ----

const MBIG = 2147483647;
const MSEED = 161803398;

export class MonoRandom {
  private seeds = new Int32Array(56);
  private inext = 0;
  private inextp = 31;

  constructor(seed: number) {
    seed |= 0;
    let mj = MSEED - (seed === -2147483648 ? 2147483647 : Math.abs(seed));
    this.seeds[55] = mj;
    let mk = 1;
    for (let i = 1; i < 55; i++) {
      const ii = (21 * i) % 55;
      this.seeds[ii] = mk;
      mk = mj - mk;
      if (mk < 0) mk += MBIG;
      mj = this.seeds[ii]!;
    }
    for (let k = 1; k < 5; k++)
      for (let i = 1; i < 56; i++) {
        this.seeds[i] = this.seeds[i]! - this.seeds[1 + ((i + 30) % 55)]!;
        if (this.seeds[i]! < 0) this.seeds[i] = this.seeds[i]! + MBIG;
      }
  }

  nextDouble(): number {
    if (++this.inext >= 56) this.inext = 1;
    if (++this.inextp >= 56) this.inextp = 1;
    let v = this.seeds[this.inext]! - this.seeds[this.inextp]!;
    if (v < 0) v += MBIG;
    this.seeds[this.inext] = v;
    return v * (1 / MBIG);
  }

  /** `Next(max)`: always draws. */
  next(max: number): number {
    return Math.floor(this.nextDouble() * max);
  }

  /** `Next(min, max)`: a range of one (or none) returns `min` without drawing. */
  range(min: number, max: number): number {
    const diff = max - min;
    if (diff <= 1) return min;
    return Math.floor(this.nextDouble() * diff) + min;
  }
}

/** Mono's `List.Sort` (its unstable quicksort, `Array.qsort`). */
export function monoSort<T>(xs: T[], cmp: (a: T, b: T) => number) {
  const qsort = (low0: number, high0: number) => {
    if (low0 >= high0) return;
    let low = low0;
    let high = high0;
    const pivot = xs[low + Math.floor((high - low) / 2)]!;
    for (;;) {
      while (low < high0 && cmp(xs[low]!, pivot) < 0) ++low;
      while (high > low0 && cmp(pivot, xs[high]!) < 0) --high;
      if (low <= high) {
        [xs[low], xs[high]] = [xs[high]!, xs[low]!];
        ++low;
        --high;
      } else break;
    }
    if (low0 < high) qsort(low0, high);
    if (low < high0) qsort(low, high0);
  };
  qsort(0, xs.length - 1);
}

// ---- AbstractRuleSetGenerator ----

const f = Math.fround;

/** The weights a generator keeps between picks (float, as the original's). */
class Weights<K> {
  private map = new Map<K, number>();
  has = (k: K) => this.map.has(k);
  get = (k: K) => this.map.get(k)!;
  set = (k: K, w: number) => this.map.set(k, f(w));
  init = (k: K, w = 1) => {
    if (!this.map.has(k)) this.set(k, w);
  };
  clear = () => this.map.clear();
}

/** `SelectSolution` / `SelectQueryableProperty`: weighted, the pick's weight × `cut`. */
function weighted<K>(rand: MonoRandom, items: readonly K[], weights: Weights<K>, cut: number): K {
  let total = 0;
  for (const k of items) {
    weights.init(k);
    total = f(total + weights.get(k));
  }
  let x = rand.nextDouble() * total;
  for (const k of items) {
    if (x < weights.get(k)) {
      weights.set(k, f(weights.get(k) * f(cut)));
      return k;
    }
    x -= weights.get(k);
  }
  return items[rand.range(0, items.length)]!;
}

const numRules = (rand: MonoRandom) => (rand.nextDouble() < 0.6 ? 3 : 4);
const numQueries = (rand: MonoRandom) => (rand.nextDouble() < 0.6 ? 1 : 2);

// ---- Wires (`WireRuleSetGenerator`) ----

const WIRE_COLOURS: WireColour[] = ['black', 'blue', 'red', 'white', 'yellow'];

interface WireProp {
  name: 'serialLetter' | 'serialOdd' | 'one' | 'none' | 'last' | 'many';
  compound: boolean;
  colour: boolean;
  forSolution: boolean;
  wires: number;
  extra: WireSolution[];
}
type WireSolution = 'i0' | 'i1' | 'i2' | 'i3' | 'i4' | 'last' | 'only' | 'first' | 'lastOf';

const WIRE_PROPS: WireProp[] = [
  // `QuerySet.GetSerialNumberQueries`, then `GetWireQueries`.
  { name: 'serialLetter', compound: true, colour: false, forSolution: false, wires: 0, extra: [] },
  { name: 'serialOdd', compound: true, colour: false, forSolution: false, wires: 0, extra: [] },
  { name: 'one', compound: false, colour: true, forSolution: true, wires: 1, extra: ['only'] },
  { name: 'none', compound: false, colour: true, forSolution: false, wires: 0, extra: [] },
  { name: 'last', compound: false, colour: true, forSolution: true, wires: 1, extra: [] },
  {
    name: 'many',
    compound: false,
    colour: true,
    forSolution: true,
    wires: 2,
    extra: ['first', 'lastOf'],
  },
];

function wireRules(rand: MonoRandom): Rules['wires'] {
  const props = new Weights<WireProp>();
  const sols = new Weights<WireSolution>();
  const solutions = (n: number, queries: WireProp[]): WireSolution[] => {
    const list: WireSolution[] = ['i0', 'i1', 'last'];
    if (n >= 4) list.push('i2');
    if (n >= 5) list.push('i3');
    if (n >= 6) list.push('i4');
    for (const q of queries) list.push(...q.extra);
    for (const s of list) sols.init(s);
    return list;
  };
  const out = {} as Rules['wires'];
  for (const n of [3, 4, 5, 6] as const) {
    props.clear();
    sols.clear();
    const rules: {
      queries: { p: WireProp; colour?: WireColour }[];
      sol: WireSolution;
      colour?: WireColour;
    }[] = [];
    const count = numRules(rand);
    for (let j = 0; j < count; j++) {
      const colours = [...WIRE_COLOURS];
      const queries: { p: WireProp; colour?: WireColour }[] = [];
      const forSolution: WireColour[] = [];
      let available = n - 1;
      const qn = numQueries(rand);
      for (let k = 0; k < qn; k++) {
        const possible = WIRE_PROPS.filter(
          (p) => (!p.compound || k > 0) && (p.wires === 0 || p.wires <= available),
        );
        for (const p of possible) props.init(p);
        const p = weighted(rand, possible, props, 0.1);
        const q: { p: WireProp; colour?: WireColour } = { p };
        if (p.colour) {
          available -= p.wires;
          const c = colours[rand.range(0, colours.length)]!;
          colours.splice(colours.indexOf(c), 1);
          q.colour = c;
          if (p.forSolution) forSolution.push(c);
        } else available -= p.wires;
        queries.push(q);
      }
      const sol = weighted(
        rand,
        solutions(
          n,
          queries.map((q) => q.p),
        ),
        sols,
        0.05,
      );
      const rule: (typeof rules)[number] = { queries, sol };
      if (forSolution.length) rule.colour = forSolution[rand.range(0, forSolution.length)];
      rules.push(rule);
    }
    monoSort(rules, (a, b) => b.queries.length - a.queries.length);
    const otherwise = solutions(n, []);
    rules.push({ queries: [], sol: otherwise[rand.range(0, otherwise.length)]! });
    out[n] = rules.map((r) => toWireRule(r.queries, r.sol, r.colour));
  }
  return out;
}

function toWireRule(
  queries: { p: WireProp; colour?: WireColour }[],
  sol: WireSolution,
  colour?: WireColour,
): WireRule {
  const when: WireCond[] = queries.map(({ p, colour: c }): WireCond => {
    switch (p.name) {
      case 'serialLetter':
        return { serialLetter: true };
      case 'serialOdd':
        return { serialOdd: true };
      case 'one':
        return { count: c!, is: 1 };
      case 'none':
        return { count: c!, is: 0 };
      case 'last':
        return { last: c! };
      case 'many':
        return { count: c!, over: 1 };
    }
  });
  if (sol === 'last') return { when, cut: 'last' };
  if (sol === 'only') return { when, cut: 'only', of: colour! };
  if (sol === 'first') return { when, cut: 'first', of: colour! };
  if (sol === 'lastOf') return { when, cut: 'last', of: colour! };
  return { when, cut: Number(sol.slice(1)) };
}

// ---- The Button (`ButtonRuleSetGenerator`) ----

const BUTTON_COLOURS = ['red', 'blue', 'yellow', 'white'];
const LABELS = ['press', 'hold', 'abort', 'detonate'];
const INDICATORS = ['SND', 'CLR', 'CAR', 'IND', 'FRQ', 'SIG', 'NSA', 'MSA', 'TRN', 'BOB', 'FRK'];

function buttonRules(rand: MonoRandom): Pick<Rules, 'button' | 'release'> {
  const pop = <T>(xs: T[]): T => xs.splice(rand.next(xs.length), 1)[0]!;
  // BuildQueryLists
  const primary: ButtonCond[] = [
    ...BUTTON_COLOURS.map((colour) => ({ colour })),
    { batteriesOver: 1 },
    { batteriesOver: 2 },
  ];
  const strips = [...BUTTON_COLOURS];
  const secondary: ButtonCond[] = LABELS.map((label) => ({ label }));
  for (let m = 0; m < 3; m++) secondary.push({ lit: INDICATORS[rand.next(INDICATORS.length)]! });
  const sols = new Weights<string>();
  const pressOrHold = () => {
    sols.init('press', 0.1);
    sols.init('hold');
    return weighted(rand, ['hold', 'press'], sols, 0.05) === 'hold';
  };
  // A fresh solution for each digit every time, so the hold rules always draw evenly.
  const digit = () => {
    const fresh = new Weights<string>();
    return weighted(rand, ['5', '1', '2', '3', '4'], fresh, 0.05);
  };
  const button: ButtonRule[] = [];
  while (button.length < 7 && primary.length) {
    const base = pop(primary);
    const n = rand.next(2);
    if (n === 0) button.push({ when: [base], hold: pressOrHold() });
    for (let i = 0; i < n; i++) {
      const second = pop(secondary);
      button.push({ when: [base, second], hold: pressOrHold() });
    }
  }
  button.push({ when: [], hold: true });
  const release: Record<string, string> = {};
  while (Object.keys(release).length < 3 && strips.length) {
    const strip = pop(strips);
    release[strip] = digit();
  }
  release.other = digit();
  return { button, release };
}

// ---- Keypad (`KeypadRuleSetGenerator`) ----

function keypadRules(rand: MonoRandom): number[][] {
  const symbols = Array.from({ length: 31 }, (_, i) => i + 1);
  const used: number[] = [];
  const lists: number[][] = [];
  for (let i = 0; i < 6; i++) {
    const list: number[] = [];
    let j = 0;
    if (i > 0)
      for (; j < 3 && used.length; j++) {
        const at = rand.next(used.length);
        list.push(used[at]!);
        used.splice(at, 1);
      }
    for (; j < 7; j++) {
      if (!symbols.length) continue;
      const at = rand.next(symbols.length);
      list.push(symbols[at]!);
      used.push(symbols[at]!);
      symbols.splice(at, 1);
    }
    // RandomizePList
    for (let k = 0; k < list.length; k++) {
      const at = rand.next(list.length);
      [list[k], list[at]] = [list[at]!, list[k]!];
    }
    lists.push(list);
  }
  return lists;
}

// ---- Simon Says (`SimonRuleSetGenerator`) ----

const SIMON = ['red', 'blue', 'green', 'yellow'];

function simonRules(rand: MonoRandom): Rules['simon'] {
  const rows = () => {
    const out = {} as Record<'0' | '1' | '2', string[]>;
    for (const s of ['0', '1', '2'] as const)
      out[s] = Array.from({ length: 4 }, () => SIMON[rand.next(4)]!);
    return out;
  };
  const vowel = rows();
  return { vowel, none: rows() };
}

// ---- Who's on First (`WhosOnFirstRuleSetGenerator`) ----

function wofRules(rand: MonoRandom): Pick<Rules, 'wofDisplays' | 'wofLists'> {
  const wofDisplays = WOF_DISPLAYS.map(([w]): [string, number] => [w, rand.range(0, 6)]);
  const wofLists: Record<string, string[]> = {};
  for (const group of WOF_GROUPS)
    for (const word of group) {
      const list = [...group];
      for (let n = list.length; n > 1;) {
        n--;
        const at = rand.next(n + 1);
        [list[at], list[n]] = [list[n]!, list[at]!];
      }
      wofLists[word] = list;
    }
  return { wofDisplays, wofLists };
}

// ---- Memory (`MemoryRuleSetGenerator`) ----

type MemorySolution = 'p0' | 'p1' | 'p2' | 'p3' | 'label' | 'samePos' | 'sameLabel';

function memoryRules(rand: MonoRandom): Rules['memory'] {
  const sols = new Weights<MemorySolution>();
  const out: Rules['memory'] = {};
  let previousIndex = true;
  for (let i = 0; i < 5; i++) {
    previousIndex = !previousIndex;
    out[i + 1] = [];
    for (let d = 1; d <= 4; d++) {
      const digit = rand.range(1, 5);
      const stage = i > 0 ? rand.range(1, i + 1) : 0;
      const list: MemorySolution[] = ['p0', 'p1', 'p2', 'p3', 'label'];
      if (i > 0) list.push(previousIndex ? 'samePos' : 'sameLabel');
      for (const s of list) sols.init(s);
      if (i > 2) {
        sols.set('samePos', 1);
        sols.set('sameLabel', 1);
      }
      const s = weighted(rand, list, sols, 0.05);
      out[i + 1]!.push(
        s === 'label'
          ? { press: 'label', n: digit }
          : s === 'samePos'
            ? { press: 'samePositionAsStage', n: stage }
            : s === 'sameLabel'
              ? { press: 'sameLabelAsStage', n: stage }
              : { press: 'position', n: Number(s.slice(1)) + 1 },
      );
    }
  }
  return out;
}

// ---- Morse Code (`MorseCodeRuleSetGenerator`) ----

const FREQUENCIES = [
  502, 505, 512, 515, 522, 525, 532, 535, 542, 545, 552, 555, 562, 565, 572, 575, 582, 585, 592,
  595, 600,
];
/** The 21 words its terms hold (English), in term order. */
const MORSE_WORDS = [
  'trick',
  'bravo',
  'vector',
  'brain',
  'boxes',
  'alien',
  'beats',
  'bombs',
  'sting',
  'steak',
  'leaks',
  'verse',
  'brick',
  'break',
  'hello',
  'halls',
  'shell',
  'bistro',
  'strobe',
  'slick',
  'flick',
];

function morseRules(rand: MonoRandom): Rules['morse'] {
  const freqs = [...FREQUENCIES];
  const words = [...MORSE_WORDS];
  const map = new Map<number, string>();
  for (let i = 0; i < 16; i++) {
    const fi = rand.range(0, freqs.length);
    const freq = freqs.splice(fi, 1)[0]!;
    const wi = rand.range(0, words.length);
    map.set(freq, words.splice(wi, 1)[0]!);
  }
  return [...map.keys()].sort((a, b) => a - b).map((k) => [3000 + k, map.get(k)!]);
}

// ---- Complicated Wires (`VennWireRuleSetGenerator`) ----

const VENN_KEYS = Object.keys(VENN);
const CUTS: VennLetter[] = ['C', 'D', 'S', 'P', 'B'];

function vennRules(rand: MonoRandom): Rules['venn'] {
  const weights = new Weights<VennLetter>();
  for (const c of CUTS) weights.init(c);
  const out: Rules['venn'] = {};
  for (const k of VENN_KEYS) out[k] = k === '-' ? 'C' : weighted(rand, CUTS, weights, 0.1);
  return out;
}

// ---- Wire Sequence (`WireSequenceRuleSetGenerator`) ----

function sequenceRules(rand: MonoRandom): Rules['sequence'] {
  const colour = () =>
    Array.from({ length: 9 }, () => [0, 1, 2].filter(() => rand.nextDouble() > 0.55));
  const red = colour();
  const blue = colour();
  return { red, blue, black: colour() };
}

// ---- Mazes (`MazeRuleSetGenerator`, `MazeBuilder`) ----

function mazeRules(rand: MonoRandom): Rules['mazes'] {
  const points: [number, number][] = [];
  for (let x = 0; x < 6; x++) for (let y = 0; y < 6; y++) points.push([x, y]);
  const out: Rules['mazes'] = [];
  for (let k = 0; k < 9; k++) {
    // Walls as up 1, right 2, down 4, left 8; cells[x][y].
    const walls = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => 15));
    const seen = Array.from({ length: 6 }, () => Array.from({ length: 6 }, () => false));
    for (let x = 0; x < 6; x++)
      for (let y = 0; y < 6; y++) {
        // The hidden-wall chance is 0, but each cell still draws for it.
        if (x > 0) rand.nextDouble();
        if (y > 0) rand.nextDouble();
      }
    let cell: [number, number] = [rand.range(0, 6), rand.range(0, 6)];
    const stack: [number, number][] = [];
    for (;;) {
      const [x, y] = cell;
      seen[x]![y] = true;
      const around: [number, number][] = [];
      if (x > 0 && !seen[x - 1]![y]) around.push([x - 1, y]);
      if (x < 5 && !seen[x + 1]![y]) around.push([x + 1, y]);
      if (y > 0 && !seen[x]![y - 1]) around.push([x, y - 1]);
      if (y < 5 && !seen[x]![y + 1]) around.push([x, y + 1]);
      if (around.length) {
        const to = around[rand.range(0, around.length)]!;
        const [tx, ty] = to;
        if (tx < x) {
          walls[x]![y]! &= ~8;
          walls[tx]![ty]! &= ~2;
        } else if (tx > x) {
          walls[x]![y]! &= ~2;
          walls[tx]![ty]! &= ~8;
        } else if (ty < y) {
          walls[x]![y]! &= ~1;
          walls[tx]![ty]! &= ~4;
        } else {
          walls[x]![y]! &= ~4;
          walls[tx]![ty]! &= ~1;
        }
        stack.push(cell);
        cell = to;
      } else if (stack.length) cell = stack.pop()!;
      else break;
    }
    const a = points.splice(rand.range(0, points.length), 1)[0]!;
    const b = points.splice(rand.range(0, points.length), 1)[0]!;
    const circles = [a, b].sort((p, q) => p[1] - q[1] || p[0] - q[0]);
    out.push({
      circles,
      walls: Array.from({ length: 6 }, (_, y) =>
        Array.from({ length: 6 }, (_, x) => walls[x]![y]!.toString(16)).join(''),
      ),
    });
  }
  return out;
}

// ---- The Knob (`NeedyKnobRuleSetGenerator`) ----

function knobRules(rand: MonoRandom): Rules['knob'] {
  const values = Array.from({ length: 64 }, (_, i) => i);
  const take = () => values.splice(rand.next(values.length), 1)[0]!;
  const configs: number[] = [];
  do {
    const n1 = take();
    const n2 = take();
    const n3 = take();
    const n4 = take();
    const n5 = take();
    const n6 = take();
    configs.push((n1 << 6) | n2, (n1 << 6) | n3, (n5 << 6) | n4, (n6 << 6) | n4);
  } while (configs.length < 8);
  const leds = (a: number) =>
    Array.from({ length: 12 }, (_, i) => ((a >> i) & 1 ? 'X' : 'O')).join('');
  const out: Rules['knob'] = [];
  for (const pos of ['up', 'down', 'left', 'right'] as const)
    for (let j = 0; j < 2; j++)
      out.push({ pos, leds: leds(configs.splice(rand.next(configs.length), 1)[0]!) });
  return out;
}

// ---- The manual ----

/** `RuleManager.GenerateBombRules`: every module's rules from the seed. */
export function generateRules(seed: number): Rules {
  const r = () => new MonoRandom(seed);
  const printed = seed === PRINTED_SEED;
  return {
    wires: wireRules(r()),
    ...wofRules(r()),
    memory: memoryRules(r()),
    keypad: keypadRules(r()),
    knob: knobRules(r()),
    ...buttonRules(r()),
    // `useDefault`: only these two keep hand-written tables for the printed manual.
    sequence: printed ? SEQUENCE : sequenceRules(r()),
    passwords: PASSWORDS,
    morse: morseRules(r()),
    venn: vennRules(r()),
    mazes: mazeRules(r()),
    simon: printed ? SIMON_MAP : simonRules(r()),
  };
}

const cache = new Map<number, Rules>();

/** The rules of a seed (the printed manual for 1 and for bombs saved before seeds). */
export function rulesFor(seed: number | null | undefined): Rules {
  if (seed === undefined || seed === null || seed === PRINTED_SEED) return PRINTED;
  let rules = cache.get(seed);
  if (!rules) {
    rules = generateRules(seed);
    if (cache.size > 64) cache.delete(cache.keys().next().value!);
    cache.set(seed, rules);
  }
  return rules;
}

// ---- Playtest bots ----

// A bot defuser plays from its own view, which never holds the manual; it reads the manual its
// bomb follows from here instead: server memory only, filled whenever the server runs a bomb.
const bombManuals = new Map<string, number>();
const bombKey = (b: { serial: string; startedAt: number }) => `${b.serial}:${b.startedAt}`;

export function rememberManual(b: { serial: string; startedAt: number; manual?: number }) {
  if (!b.manual || b.manual === PRINTED_SEED) return;
  if (bombManuals.size > 500) bombManuals.delete(bombManuals.keys().next().value!);
  bombManuals.set(bombKey(b), b.manual);
}

/** The rules a bomb (as its defuser sees it) follows, for a bot; the printed manual if unknown. */
export const rulesOfBomb = (b: { serial: string; startedAt: number }) =>
  rulesFor(bombManuals.get(bombKey(b)));
