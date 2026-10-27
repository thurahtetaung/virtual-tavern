// Every module as the original's component class does it. Times are server ms; `t` is the moment
// an action or event happens. Each handler returns what happened; the bomb applies strikes and
// solves (bomb.ts), so a module never touches the clock itself.
import {
  BUTTON_RULES,
  KEYPAD_COLUMNS,
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
import type { ButtonCond, WireCond } from './data-types.ts';
import { batteries, hasPort, litIndicator, serialOdd, serialVowel } from './edgework.ts';
import { int, next, pick, shuffle, type Stream } from './rand.ts';
import type {
  ButtonColour,
  ButtonLabel,
  Dir,
  MemoryModule,
  ModuleOp,
  SequenceEntry,
  SimonColour,
  SolvableKind,
  SolvableModule,
  VennColour,
  VennModule,
  WireColour,
  WiresModule,
  Widget,
} from './types.ts';

/** What the rest of the bomb is, for the rules a module reads. */
export interface BombInfo {
  serial: string;
  widgets: readonly Widget[];
  strikes: number;
  /** The timer's text at a moment (`TimerComponent.GetFormattedTime`). */
  timerText: (t: number) => string;
}

export type Outcome = 'strike' | 'solve' | null;

const WIRE_COLOURS: WireColour[] = ['black', 'blue', 'red', 'white', 'yellow'];
const BUTTON_COLOURS: ButtonColour[] = ['red', 'blue', 'yellow', 'white'];
const BUTTON_LABELS: ButtonLabel[] = ['press', 'hold', 'abort', 'detonate'];
export const SIMON_COLOURS: SimonColour[] = ['red', 'blue', 'green', 'yellow'];
const VENN_COLOURS: VennColour[] = ['red', 'blue', 'white', 'red-blue', 'red-white', 'blue-white'];

/** Simon (prefab): each flash, the wait before a replay, the wait after a passed stage. */
export const SIMON_NOTE = 650;
export const SIMON_REPLAY = 4500;
export const SIMON_PASS = 2000;
/** Who's on First and Memory button animations (`SinkButtons`, `EmergeButtons`). */
const WOF_SINK = 6 * 50 + 1000;
const WOF_EMERGE = 6 * 50 + 750;
const MEM_SINK = 4 * 50 + 1000;
const MEM_EMERGE = 4 * 50 + 750;
const BLANK_WAIT = 750;
/** Wire Sequence's panel change (`ChangePage`: two 0.7 s waits). */
export const PAGE_TURN = 1400;
/** The Button: a press longer than this is a hold (`pressThreshold`). */
export const HOLD_AFTER = 500;

// ---- Creation (each module's Awake/Start; anything its Activate does waits for `activate`) ----

const base = (kind: SolvableKind, face: 0 | 1, anchor: number) => ({
  id: `m${face}${anchor}`,
  kind,
  face,
  anchor,
  solved: false,
  strikes: 0,
});

export function createSolvable(kind: SolvableKind, face: 0 | 1, anchor: number, r: Stream): SolvableModule {
  const b = base(kind, face, anchor);
  switch (kind) {
    case 'wires': {
      // WireSetComponent.Start: (int)(value · 6) + 3, clamped to 3–6; random wires removed.
      const count = Math.min(6, Math.max(3, Math.floor(next(r) * 6) + 3));
      const slots = [0, 1, 2, 3, 4, 5];
      while (slots.length > count) slots.splice(int(r, slots.length), 1);
      return {
        ...b,
        kind,
        wires: slots.map((slot) => ({
          slot,
          colour: WIRE_COLOURS[Math.min(4, Math.floor(next(r) * 5))]!,
          cut: false,
        })),
      };
    }
    case 'button': {
      const label = BUTTON_LABELS[int(r, 4)]!;
      const colour = BUTTON_COLOURS[int(r, 4)]!;
      return { ...b, kind, colour, label, downAt: null, strip: null };
    }
    case 'keypad': {
      // KeypadRuleSet.GetPListIndex + GetSymbols: four different symbols of one column.
      const column = int(r, KEYPAD_COLUMNS.length);
      const pool = [...KEYPAD_COLUMNS[column]!];
      const symbols: number[] = [];
      for (let i = 0; i < 4; i++) symbols.push(pool.splice(int(r, pool.length), 1)[0]!);
      return { ...b, kind, column, symbols, down: [false, false, false, false] };
    }
    case 'simon': {
      const n = 3 + int(r, 3);
      const sequence = Array.from({ length: n }, () => SIMON_COLOURS[int(r, 4)]!);
      return { ...b, kind, sequence, stage: 0, progress: 0, playAt: Number.MAX_SAFE_INTEGER };
    }
    case 'whos-on-first':
      return { ...b, kind, stage: 0, display: -1, labels: [], upAt: Number.MAX_SAFE_INTEGER, change: null };
    case 'memory':
      return {
        ...b,
        kind,
        stage: 0,
        digits: [],
        labels: [],
        pressedPos: [],
        pressedLabel: [],
        valid: false,
        change: null,
      };
    case 'morse':
      return { ...b, kind, word: int(r, MORSE.length), dial: 0 };
    case 'complicated-wires':
      return createVenn(b, r);
    case 'wire-sequence':
      return { ...b, kind, entries: createSequence(r), page: 0, turningUntil: 0 };
    case 'maze': {
      const maze = int(r, MAZES.length);
      const cell = (): [number, number] => [int(r, 6), int(r, 6)];
      const at = cell();
      let goal = cell();
      while (Math.abs(goal[0] - at[0]) <= 1 && Math.abs(goal[1] - at[1]) <= 1) goal = cell();
      return { ...b, kind, maze, at, goal };
    }
    case 'password':
      return { ...b, kind, word: '', columns: [], pos: [0, 0, 0, 0, 0] };
  }
}

function createVenn(b: ReturnType<typeof base>, r: Stream): VennModule {
  // VennWireComponent.Start: (int)(value · 6) + 4, clamped to 4–6; the shuffled rest removed.
  const count = Math.min(6, Math.max(4, Math.floor(next(r) * 6) + 4));
  const removed = new Set(shuffle(r, [0, 1, 2, 3, 4, 5]).slice(count));
  const slots = [0, 1, 2, 3, 4, 5].filter((s) => !removed.has(s));
  const wires = slots.map((slot) => {
    const colour = VENN_COLOURS[int(r, VENN_COLOURS.length)]!;
    const led = next(r) > 0.5;
    const star = next(r) > 0.5;
    return { slot, colour, led, star, cut: false };
  });
  // SetRandomWireStates: one random wire is forced into a state whose rule is a plain Cut.
  const cuts = Object.entries(VENN).flatMap(([k, v]) => (v === 'C' ? [k] : []));
  const state = pick(r, cuts);
  const red = state.includes('r');
  const blue = state.includes('b');
  const colour: VennColour = red ? (blue ? 'red-blue' : 'red') : blue ? 'blue' : 'white';
  const w = wires[int(r, wires.length)]!;
  Object.assign(w, { colour, led: state.includes('l'), star: state.includes('s') });
  return { ...b, kind: 'complicated-wires', wires };
}

function createSequence(r: Stream): SequenceEntry[] {
  // WireSequenceComponent.PopulateWireSequence: 9 wires a colour, shuffled, all but 10 removed,
  // 3 blanks added, shuffled again; panel 1 must have a wire.
  const list: SequenceEntry[] = [];
  for (const colour of ['red', 'blue', 'black'] as const)
    for (let j = 0; j < 9; j++) list.push({ colour, to: int(r, 3), n: 0, cut: false });
  const kept = shuffle(r, list);
  kept.splice(9, kept.length - 9 - 1);
  const blank = (): SequenceEntry => ({ colour: null, to: 0, n: 0, cut: false });
  const seq = shuffle(r, [...kept, blank(), blank(), blank()]);
  if (!seq.slice(0, 3).some((e) => e.colour)) {
    for (let m = 2; m < seq.length; m++) {
      if (seq[m]!.colour) {
        const index = int(r, 3);
        seq[index] = seq[m]!;
        seq[m] = blank();
        break;
      }
    }
  }
  const counts = { red: 0, blue: 0, black: 0 };
  for (const e of seq) if (e.colour) e.n = counts[e.colour]++;
  return seq;
}

/** What each module's `Activate` does, when the lights come on. */
export function activate(m: SolvableModule, t: number, r: Stream) {
  switch (m.kind) {
    case 'simon':
      m.playAt = t + SIMON_PASS;
      break;
    case 'whos-on-first':
      m.labels = shuffle(r, pick(r, WOF_GROUPS)).slice(0, 6);
      m.display = int(r, WOF_DISPLAYS.length);
      m.upAt = t + WOF_EMERGE;
      break;
    case 'memory':
      memoryReset(m, r);
      break;
    case 'wire-sequence':
      m.turningUntil = t + PAGE_TURN;
      break;
    case 'password': {
      m.word = pick(r, PASSWORDS);
      m.columns = passwordColumns(m.word, r);
      m.pos = [0, 0, 0, 0, 0];
      break;
    }
    default:
      break;
  }
}

function memoryReset(m: MemoryModule, r: Stream) {
  m.stage = 0;
  m.pressedPos = [];
  m.pressedLabel = [];
  m.digits = Array.from({ length: 5 }, () => 1 + int(r, 4));
  m.labels = shuffle(r, [1, 2, 3, 4]);
  m.valid = true;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** Which of the 35 words the columns can spell (`PasswordRuleSet.GetMatches`). */
export function spellable(columns: readonly (readonly string[])[]): string[] {
  return PASSWORDS.filter((w) => columns.every((col, i) => col.length === 1 || col.includes(w[i]!)));
}

/** `PasswordRuleSet.GetCharacterValues`: prune false matches, then cut each column to 6. */
function passwordColumns(word: string, r: Stream): string[][] {
  const cols = Array.from({ length: 5 }, () => [...ALPHABET]);
  let falses = spellable(cols).filter((w) => w !== word);
  while (falses.length) {
    const text = falses[0]!;
    const wrong = [...text].flatMap((c, i) => (c !== word[i] ? [i] : []));
    if (wrong.length) {
      const index = wrong[int(r, wrong.length)]!;
      cols[index]!.splice(cols[index]!.indexOf(text[index]!), 1);
    }
    falses = spellable(cols).filter((w) => w !== word);
  }
  return cols.map((col, i) => {
    const right = word[i]!;
    const rest = col.filter((c) => c !== right);
    while (rest.length > 5) rest.splice(int(r, rest.length), 1);
    return shuffle(r, [...rest, right]);
  });
}

// ---- The rules (each module's rule set) ----

function wireCond(c: WireCond, m: WiresModule, info: BombInfo): boolean {
  if ('serialOdd' in c) return serialOdd(info.serial);
  if ('last' in c) return m.wires[m.wires.length - 1]!.colour === c.last;
  const n = m.wires.filter((w) => w.colour === c.count).length;
  return 'is' in c ? n === c.is : n > c.over;
}

/** `WireRuleSet.GetSolutionIndex`: the first rule whose conditions all hold. */
export function wiresAnswer(m: WiresModule, info: BombInfo): number {
  const rules = WIRE_RULES[m.wires.length as 3 | 4 | 5 | 6];
  for (const rule of rules) {
    if (!rule.when.every((c) => wireCond(c, m, info))) continue;
    if (rule.cut !== 'last') return rule.cut;
    if (!rule.of) return m.wires.length - 1;
    return m.wires.map((w) => w.colour).lastIndexOf(rule.of);
  }
  return m.wires.length - 1;
}

function buttonCond(c: ButtonCond, colour: string, label: string, info: BombInfo): boolean {
  if ('colour' in c) return colour === c.colour;
  if ('label' in c) return label === c.label;
  if ('batteriesOver' in c) return batteries(info.widgets) > c.batteriesOver;
  return litIndicator(info.widgets, c.lit);
}

/** Whether the Button's first matching rule says hold. */
export function buttonHold(colour: string, label: string, info: BombInfo): boolean {
  for (const rule of BUTTON_RULES)
    if (rule.when.every((c) => buttonCond(c, colour, label, info))) return rule.hold;
  return true;
}

export const releaseDigit = (strip: ButtonColour) => RELEASE_DIGIT[strip] ?? RELEASE_DIGIT.other!;

/** `SimonComponent.MapToSolution`, with the strikes at the moment of the press. */
export function simonPress(flash: SimonColour, info: BombInfo): SimonColour {
  const row = SIMON_MAP[serialVowel(info.serial) ? 'vowel' : 'none'][String(Math.min(2, info.strikes)) as '0' | '1' | '2'];
  return row[SIMON_COLOURS.indexOf(flash)] as SimonColour;
}

/** `WhosOnFirstRuleSet.ButtonPushed`: which button is right now, or -1 with a dark display. */
export function wofAnswer(display: number, labels: readonly string[]): number {
  if (display < 0 || labels.length < 6) return -1;
  const read = labels[WOF_DISPLAYS[display]![1]]!;
  for (const word of WOF_LISTS[read] ?? []) {
    const i = labels.findIndex((l) => l.toLowerCase() === word.toLowerCase());
    if (i >= 0) return i;
  }
  return -1;
}

/** `MemoryRuleSet.ButtonPushed`: the right position (0–3) at this stage. */
export function memoryAnswer(m: Pick<MemoryModule, 'stage' | 'digits' | 'labels' | 'pressedPos' | 'pressedLabel'>, digit = m.digits[m.stage]!): number {
  const rule = MEMORY_RULES[m.stage + 1]![digit - 1]!;
  switch (rule.press) {
    case 'position':
      return rule.n - 1;
    case 'label':
      return m.labels.indexOf(rule.n);
    case 'samePositionAsStage':
      return rule.n - 1 < m.stage ? m.pressedPos[rule.n - 1]! : -1;
    case 'sameLabelAsStage':
      return rule.n - 1 < m.stage ? m.labels.indexOf(m.pressedLabel[rule.n - 1]!) : -1;
  }
}

/** `VennWireRuleSet.ShouldWireBeSnipped`. */
export function vennCut(w: VennModule['wires'][number], info: BombInfo): boolean {
  const red = w.colour.includes('red');
  const blue = w.colour.includes('blue');
  const key = `${red ? 'r' : ''}${blue ? 'b' : ''}${w.star ? 's' : ''}${w.led ? 'l' : ''}` || '-';
  switch (VENN[key]) {
    case 'C':
      return true;
    case 'S':
      return !serialOdd(info.serial);
    case 'P':
      return hasPort(info.widgets, 'parallel');
    case 'B':
      return batteries(info.widgets) > 1;
    default:
      return false;
  }
}

/** `WireSequenceRuleSet.ShouldBeSnipped`. */
export const sequenceCut = (e: SequenceEntry) =>
  !!e.colour && e.n < 9 && SEQUENCE[e.colour][e.n]!.includes(e.to);

const WALL: Record<Dir, number> = { up: 1, right: 2, down: 4, left: 8 };
export const STEP: Record<Dir, [number, number]> = { up: [0, -1], right: [1, 0], down: [0, 1], left: [-1, 0] };

/** Whether a maze has a wall on that side of a cell. */
export const wallAt = (maze: number, [x, y]: readonly [number, number], dir: Dir) =>
  (parseInt(MAZES[maze]!.walls[y]![x]!, 16) & WALL[dir]) !== 0;

// ---- Actions ----

/**
 * The defuser's action on a solvable module at time `t`, as the component handles it; `active`
 * is whether the lights are on. Returns the outcome, or a refusal code for input the module
 * ignores (so nothing is recorded).
 */
export function actSolvable(
  m: SolvableModule,
  a: ModuleOp,
  t: number,
  active: boolean,
  info: BombInfo,
  r: Stream,
): Outcome | 'ignored' {
  switch (m.kind) {
    case 'wires': {
      if (a.op !== 'cut') return 'ignored';
      const w = m.wires[a.wire];
      if (!w || w.cut) return 'ignored';
      w.cut = true;
      // WireSnipped: the right wire solves it; any other cut is a strike, even once solved.
      if (a.wire === wiresAnswer(m, info)) return m.solved ? null : 'solve';
      return 'strike';
    }
    case 'button': {
      // The strip's colour is drawn as the press starts (StartHolding draws it 0.5 s in); it only
      // lights, and only counts, once the press has lasted past the threshold.
      if (a.op === 'down' || a.op === 'tap') {
        if (m.downAt !== null) return 'ignored';
        m.downAt = t;
        m.strip = BUTTON_COLOURS[int(r, 4)]!;
        if (a.op === 'down') return null;
      }
      if ((a.op !== 'up' && a.op !== 'tap') || m.downAt === null) return 'ignored';
      const holding = a.op === 'up' && t - m.downAt > HOLD_AFTER;
      const strip = m.strip!;
      m.downAt = null;
      m.strip = null;
      // ButtonRuleSet.ButtonReleased: the rule's press or hold, then the timer's digit.
      const hold = buttonHold(m.colour, m.label, info);
      if (hold !== holding) return 'strike';
      if (hold && !info.timerText(t).includes(releaseDigit(strip))) return 'strike';
      return 'solve';
    }
    case 'keypad': {
      if (a.op !== 'press' || m.down[a.button] !== false) return 'ignored';
      const order = KEYPAD_COLUMNS[m.column]!;
      const mine = order.indexOf(m.symbols[a.button]!);
      if (m.symbols.some((s, i) => !m.down[i] && order.indexOf(s) < mine)) return 'strike';
      m.down[a.button] = true;
      return m.down.every(Boolean) ? 'solve' : null;
    }
    case 'simon': {
      if (a.op !== 'press' || a.button < 0 || a.button > 3) return 'ignored';
      if (!active) return 'strike';
      if (m.solved) return 'ignored';
      if (t >= m.playAt) m.progress = 0;
      m.playAt = t + SIMON_REPLAY;
      const want = simonPress(m.sequence[m.progress]!, info);
      if (SIMON_COLOURS[a.button] !== want) {
        m.progress = 0;
        return 'strike';
      }
      m.progress++;
      if (m.progress > m.stage) {
        m.stage++;
        m.progress = 0;
        m.playAt = t + SIMON_PASS;
        if (m.stage >= m.sequence.length) return 'solve';
      }
      return null;
    }
    case 'whos-on-first': {
      if (a.op !== 'press' || a.button < 0 || a.button > 5) return 'ignored';
      const up = m.change ? t < m.change.sinkAt : t >= m.upAt;
      if (!active || !up || m.solved) return 'ignored';
      const right = a.button === wofAnswer(m.display, m.labels);
      const change = () => {
        m.display = -1;
        const sinkAt = t + BLANK_WAIT;
        m.change = { sinkAt, labelsAt: sinkAt + WOF_SINK, readyAt: sinkAt + WOF_SINK + WOF_EMERGE };
      };
      if (right) {
        m.stage++;
        if (m.stage === 3) {
          m.display = -1;
          m.change = null;
          return 'solve';
        }
        change();
        return null;
      }
      change();
      return 'strike';
    }
    case 'memory': {
      if (a.op !== 'press' || a.button < 0 || a.button > 3) return 'ignored';
      if (!active || !m.valid || m.change || m.solved) return 'ignored';
      m.pressedPos.push(a.button);
      m.pressedLabel.push(m.labels[a.button]!);
      const sinkAt = t + BLANK_WAIT;
      if (a.button === memoryAnswer(m)) {
        if (m.stage < 4) {
          m.valid = false;
          m.stage++;
          m.change = {
            kind: 'next',
            sinkAt,
            labelsAt: sinkAt + MEM_SINK,
            readyAt: sinkAt + MEM_SINK + MEM_EMERGE,
          };
          return null;
        }
        return 'solve';
      }
      m.valid = false;
      m.change = { kind: 'reset', sinkAt, labelsAt: sinkAt + MEM_SINK, readyAt: sinkAt + MEM_SINK };
      return 'strike';
    }
    case 'morse': {
      if (a.op === 'dial') {
        const to = m.dial + a.by;
        if (to < 0 || to >= MORSE.length) return 'ignored';
        m.dial = to;
        return null;
      }
      if (a.op !== 'tx') return 'ignored';
      // OnButtonTransmitPushed: a wrong frequency strikes, even once solved.
      if (m.dial !== m.word) return 'strike';
      return m.solved ? null : 'solve';
    }
    case 'complicated-wires': {
      if (a.op !== 'cut') return 'ignored';
      const w = m.wires[a.wire];
      if (!w || w.cut) return 'ignored';
      w.cut = true;
      if (!vennCut(w, info)) return 'strike';
      if (!m.solved && m.wires.every((x) => x.cut || !vennCut(x, info))) return 'solve';
      return null;
    }
    case 'wire-sequence': {
      const turning = t < m.turningUntil;
      if (a.op === 'cut') {
        if (!active || turning || m.page >= 4 || a.wire < 0 || a.wire > 2) return 'ignored';
        const e = m.entries[m.page * 3 + a.wire]!;
        if (!e.colour || e.cut) return 'ignored';
        e.cut = true;
        return sequenceCut(e) ? null : 'strike';
      }
      if (a.op === 'next') {
        if (!active || m.page >= 4 || turning) return 'ignored';
        const panel = m.entries.slice(m.page * 3, m.page * 3 + 3);
        if (panel.some((e) => sequenceCut(e) && !e.cut)) return 'strike';
        m.page++;
        m.turningUntil = t + PAGE_TURN;
        return m.page === 4 && !m.solved ? 'solve' : null;
      }
      if (a.op === 'back') {
        if (m.page <= 0 || turning || m.solved || !active) return 'ignored';
        m.page--;
        m.turningUntil = t + PAGE_TURN;
        return null;
      }
      return 'ignored';
    }
    case 'maze': {
      if (a.op !== 'move' || m.solved) return 'ignored';
      const [dx, dy] = STEP[a.dir];
      const to: [number, number] = [m.at[0] + dx, m.at[1] + dy];
      if (to[0] < 0 || to[0] > 5 || to[1] < 0 || to[1] > 5) return 'ignored';
      if (wallAt(m.maze, m.at, a.dir)) return 'strike';
      m.at = to;
      return to[0] === m.goal[0] && to[1] === m.goal[1] ? 'solve' : null;
    }
    case 'password': {
      if (!m.columns.length) return 'ignored';
      if (a.op === 'spin') {
        const col = m.columns[a.column];
        if (!col) return 'ignored';
        m.pos[a.column] = (m.pos[a.column]! + a.by + col.length) % col.length;
        return null;
      }
      if (a.op !== 'submit') return 'ignored';
      const word = m.columns.map((c, i) => c[m.pos[i]!]).join('');
      if (word === m.word) return m.solved ? null : 'solve';
      return 'strike';
    }
  }
}

/** The module's next timed change (animations finishing, the Button's strip), or null. */
export function nextSolvableAt(m: SolvableModule): number | null {
  switch (m.kind) {
    case 'whos-on-first':
    case 'memory':
      if (!m.change) return null;
      return m.change.relabelled ? m.change.readyAt : m.change.labelsAt;
    default:
      return null;
  }
}

/** Runs the module's timed change due at `t`. */
export function tickSolvable(m: SolvableModule, t: number, r: Stream) {
  switch (m.kind) {
    case 'whos-on-first':
      if (!m.change) break;
      if (!m.change.relabelled && t >= m.change.labelsAt) {
        m.labels = shuffle(r, pick(r, WOF_GROUPS)).slice(0, 6);
        m.change.relabelled = true;
      }
      if (m.change.relabelled && t >= m.change.readyAt) {
        m.display = int(r, WOF_DISPLAYS.length);
        m.upAt = m.change.readyAt;
        m.change = null;
      }
      break;
    case 'memory':
      if (!m.change) break;
      if (!m.change.relabelled && t >= m.change.labelsAt) {
        if (m.change.kind === 'reset') memoryReset(m, r);
        else m.labels = shuffle(r, [1, 2, 3, 4]);
        m.change.relabelled = true;
      }
      if (m.change.relabelled && t >= m.change.readyAt) {
        m.valid = true;
        m.change = null;
      }
      break;
    default:
      break;
  }
}
