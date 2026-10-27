// Playtest bots (owner, 2026-10-27): a bot defuser works each module out from what its own view
// shows (it reads the printed manual, so it needs nothing hidden), taking 6–20 s a module and
// getting about one in eight wrong; bot experts only claim a page.
import type { BotCtx } from '@vt/game-sdk';
import { NEEDY_TIME, leftAt, timerText } from './bomb.ts';
import { KEYPAD_COLUMNS, KNOB, MAZES, MORSE, MORSE_ALPHABET, SEQUENCE, WOF_DISPLAYS } from './data.ts';
import {
  type BombInfo,
  SIMON_COLOURS,
  STEP,
  buttonHold,
  memoryAnswer,
  releaseDigit,
  simonPress,
  spellable,
  vennCut,
  wallAt,
  wiresAnswer,
  wofAnswer,
} from './modules.ts';
import { type Action, type Dir, type ModuleOp, SOLVABLE, isNeedy } from './types.ts';
import type { BombView, DefuseView, ModuleView } from './view.ts';

let wrongRate = 1 / 8;
/** Tests only: how often the bot defuser makes a mistake. */
export function setBotMistakes(rate: number) {
  wrongRate = rate;
}
const THINK_MIN = 6000;
const THINK_SPAN = 14_000;

/** A steady 0…1 per module and bomb, so a bot's pace doesn't change between looks. */
function steady(key: string): number {
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return (h % 1000) / 1000;
}

const act = (module: string, op: ModuleOp, at?: number): Action => ({
  type: 'act',
  module,
  ...op,
  ...(at !== undefined && { at }),
});

const infoOf = (b: BombView): BombInfo => ({
  serial: b.serial,
  widgets: b.widgets,
  strikes: b.strikes,
  timerText: (t) => timerText(leftAt(b, t)),
});

/** Moves through the maze from `at` to `goal`, the first step of a shortest path. */
function mazeStep(maze: number, at: [number, number], goal: [number, number]): Dir | null {
  const key = (p: readonly number[]) => `${p[0]},${p[1]}`;
  const seen = new Map<string, Dir | null>([[key(at), null]]);
  const queue: [number, number][] = [at];
  while (queue.length) {
    const p = queue.shift()!;
    if (p[0] === goal[0] && p[1] === goal[1]) {
      let k = key(p);
      let first: Dir | null = null;
      // Walk back to the start, keeping the first step.
      for (let cur = p; k !== key(at); ) {
        const d = seen.get(k)!;
        first = d;
        const [dx, dy] = STEP[d!];
        cur = [cur[0] - dx, cur[1] - dy];
        k = key(cur);
      }
      return first;
    }
    for (const d of ['up', 'right', 'down', 'left'] as Dir[]) {
      const [dx, dy] = STEP[d];
      const n: [number, number] = [p[0] + dx, p[1] + dy];
      if (n[0] < 0 || n[0] > 5 || n[1] < 0 || n[1] > 5 || seen.has(key(n))) continue;
      if (wallAt(maze, p, d)) continue;
      seen.set(key(n), d);
      queue.push(n);
    }
  }
  return null;
}

/** The right move on a solvable module now, or null when there is nothing to do yet. */
function rightMove(m: ModuleView, b: BombView, now: number): ModuleOp | null {
  const info = infoOf(b);
  switch (m.kind) {
    case 'wires':
      return { op: 'cut', wire: wiresAnswer(m, info) };
    case 'button': {
      const hold = buttonHold(m.colour, m.label, info);
      if (!hold) return { op: 'tap' };
      if (m.downAt === null) return { op: 'down' };
      if (now - m.downAt <= 600) return null;
      return info.timerText(now).includes(releaseDigit(m.strip!)) ? { op: 'up' } : null;
    }
    case 'keypad': {
      const column = KEYPAD_COLUMNS.find((c) => m.symbols.every((s) => c.includes(s)))!;
      const left = m.symbols.flatMap((s, i) => (m.down[i] ? [] : [{ i, at: column.indexOf(s) }]));
      left.sort((a, z) => a.at - z.at);
      return left.length ? { op: 'press', button: left[0]!.i } : null;
    }
    case 'simon': {
      if (!('shown' in m) || now < m.playAt - 2000) return null;
      const progress = now >= m.playAt ? 0 : m.progress;
      const flash = m.shown[progress];
      if (!flash) return null;
      return { op: 'press', button: SIMON_COLOURS.indexOf(simonPress(flash, info)) };
    }
    case 'whos-on-first': {
      if (m.change || now < m.upAt || m.display === null) return null;
      const display = WOF_INDEX.get(m.display) ?? -1;
      const i = wofAnswer(display, m.labels);
      return i < 0 ? null : { op: 'press', button: i };
    }
    case 'memory': {
      if (m.change || !m.valid || !('display' in m) || m.display === null) return null;
      const i = memoryAnswer({ ...m, digits: [] }, m.display);
      return i < 0 ? null : { op: 'press', button: i };
    }
    case 'morse': {
      const signal = 'signal' in m ? m.signal.join(' ') : '';
      const target = MORSE.findIndex(
        ([, w]) => [...w].map((c) => MORSE_ALPHABET[c]).join(' ') === signal,
      );
      if (target < 0) return null;
      if (m.dial < target) return { op: 'dial', by: 1 };
      if (m.dial > target) return { op: 'dial', by: -1 };
      return { op: 'tx' };
    }
    case 'complicated-wires': {
      const i = m.wires.findIndex((w) => !w.cut && vennCut(w, info));
      return i < 0 ? null : { op: 'cut', wire: i };
    }
    case 'wire-sequence': {
      if (!('panels' in m) || now < m.turningUntil || m.page >= 4) return null;
      const counts = { red: 0, blue: 0, black: 0 };
      for (let i = 0; i < 12; i++) {
        const e = m.panels[i]!;
        const n = e.colour ? counts[e.colour]++ : 0;
        if (Math.floor(i / 3) !== m.page || !e.colour || e.cut) continue;
        if (SEQUENCE[e.colour][n]?.includes(e.to)) return { op: 'cut', wire: i % 3 };
      }
      return { op: 'next' };
    }
    case 'maze': {
      if (!('circles' in m)) return null;
      const maze = MAZES.findIndex((z) =>
        z.circles.some((c) => c[0] === m.circles[0]![0] && c[1] === m.circles[0]![1]),
      );
      const d = mazeStep(maze, m.at, m.goal);
      return d ? { op: 'move', dir: d } : null;
    }
    case 'password': {
      if (!m.columns.length) return null;
      const word = spellable(m.columns)[0];
      if (!word) return null;
      for (let c = 0; c < 5; c++)
        if (m.columns[c]![m.pos[c]!] !== word[c]) return { op: 'spin', column: c, by: 1 };
      return { op: 'submit' };
    }
    default:
      return null;
  }
}

/** A plausible wrong move on a module (the one in eight). */
function wrongMove(m: ModuleView, right: ModuleOp, ctx: BotCtx): ModuleOp | null {
  if (right.op === 'cut' && 'wires' in m) {
    const others = m.wires.flatMap((w, i) => (!w.cut && i !== right.wire ? [i] : []));
    return others.length ? { op: 'cut', wire: others[ctx.rng.int(others.length)]! } : null;
  }
  if (right.op === 'press') {
    const n = m.kind === 'whos-on-first' ? 6 : 4;
    return { op: 'press', button: (right.button + 1 + ctx.rng.int(n - 1)) % n };
  }
  if (right.op === 'tx' || right.op === 'submit') return null;
  return null;
}

/** What needs doing on a needy module, urgently. */
function needyMove(m: ModuleView, now: number): ModuleOp | null {
  if (m.kind === 'venting-gas') {
    if (m.state !== 'running' || m.reply || !m.question) return null;
    return { op: 'answer', yes: m.question === 'vent' };
  }
  if (m.kind === 'capacitor') {
    if (m.state !== 'running' || m.exploded) return null;
    const left = m.heldAt === null ? m.left - (now - m.leftAt) : NEEDY_TIME.capacitor;
    if (m.heldAt === null && left < 15_000) return { op: 'down' };
    if (m.heldAt !== null && now - m.heldAt > 5000) return { op: 'up' };
    return null;
  }
  if (m.kind === 'knob') {
    if (m.state !== 'running' || !('leds' in m) || !m.leds) return null;
    const want = KNOB_BY_LEDS.get(m.leds);
    return want && want !== m.pos ? { op: 'turn' } : null;
  }
  return null;
}

const KNOB_BY_LEDS = new Map(KNOB.map((k) => [k.leds, k.pos]));
const WOF_INDEX = new Map(WOF_DISPLAYS.map(([w], i) => [w, i]));

export function defuseBot(v: DefuseView, ctx: BotCtx): Action | null {
  if (v.stage !== 'bomb') return null;
  if (v.role === 'expert') {
    const mine = Object.values(v.claims ?? {}).some((list) => list?.includes(ctx.me));
    if (mine) return null;
    const free = SOLVABLE.filter((p) => !v.claims?.[p]?.length);
    const page = free[ctx.rng.int(free.length)] ?? SOLVABLE[0];
    return { type: 'claim', page, on: true };
  }
  const b = v.bomb;
  if (v.role !== 'defuser' || !b || b.end || !b.activated) return null;
  const now = ctx.now;
  for (const m of b.modules) {
    if (!isNeedy(m.kind)) continue;
    const op = needyMove(m, now);
    if (op) return act(m.id, op, now);
  }
  const since = Math.max(b.activeAt, ...b.log.filter((e) => e.what !== 'needy').map((e) => e.at));
  for (const m of b.modules) {
    if (isNeedy(m.kind) || m.solved) continue;
    const right = rightMove(m, b, now);
    if (!right) return { type: 'ponder' };
    const think = THINK_MIN + steady(`${b.no}:${m.id}:${m.strikes}`) * THINK_SPAN;
    const started = m.kind === 'button' && m.downAt !== null;
    if (!started && now - since < think) return { type: 'ponder' };
    if (ctx.rng.next() < wrongRate) {
      const wrong = wrongMove(m, right, ctx);
      if (wrong) return act(m.id, wrong, now);
    }
    return act(m.id, right, now);
  }
  return null;
}
