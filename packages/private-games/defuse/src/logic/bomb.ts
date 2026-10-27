// The bomb as `Bomb`, `BombGenerator`, `TimerComponent` and `NeedyComponent` run it, on the
// server clock. `runTo` plays every timed change up to a moment; actions happen at their own
// moment after it, so the order is always the original's.
import { makeWidgets } from './edgework.ts';
import {
  type BombInfo,
  type Outcome,
  actSolvable,
  activate,
  createSolvable,
  nextSolvableAt,
  tickSolvable,
} from './modules.ts';
import { KNOB } from './data.ts';
import { between, int, next, type Stream } from './rand.ts';
import {
  type Bomb,
  type Dir,
  type Kind,
  type Module,
  type ModuleOp,
  NEEDY,
  type NeedyKind,
  type NeedyModule,
  SOLVABLE,
  type Settings,
  type SolvableKind,
  isNeedy,
} from './types.ts';

/** `GameplayState.StartRound`: the timer lights after 2 s, modules wake 4 s later, the clock runs 2 s after that. */
export const LIGHTS = { timer: 2000, active: 6000, clock: 8000 };
/** Seconds of bomb time before needy modules wake by themselves (`TimeBeforeNeedyActivation`). */
export const NEEDY_AFTER = 90_000;
/** `NeedyComponent`: countdowns, the cooldown between runs, the warning. */
export const NEEDY_TIME: Record<NeedyKind, number> = { 'venting-gas': 40_000, capacitor: 45_000, knob: 40_000 };
export const NEEDY_WARN: Record<NeedyKind, number> = { 'venting-gas': 3000, capacitor: 5000, knob: 5000 };
const RESET_MIN = 10_000;
const RESET_MAX = 40_000;
/** `PlayerChangedBomb`: the delay after a solve or a strike, and the first time's chance. */
const CHANGE_AFTER = { solve: 250, strike: 750 };
const FIRST_CHANCE = 0.85;
/** `NeedyDischargeComponent`: the lever pushes the timer up at 275/45 s a second, against its own second. */
export const DISCHARGE = 275 / 45;
/** `NeedyVentComponent`: typing YES takes 1.5 s, NO 1 s, then 0.5 s; "venting prevents explosions" 3.3 s. */
const VENT_YES = 1500;
const VENT_NO = 1000;
const VENT_AFTER = 500;
const VENT_WARNING = 750 + 400 + 750 + 400 + 1000;
/** `Bomb.OnStrike`: the clock's rate after each strike. */
const RATES = [1, 1.25, 1.5, 1.75, 2];

const ANCHORS = [0, 1, 2, 3, 4, 5];
/** The anchors that can hold the timer (`BombFace.TimerAnchors`), the same on both faces. */
const TIMER_ANCHORS = [0, 1, 3, 4];

// ---- Generation ----

/** `SelectWeightedRandomComponentType`: each pick multiplies its kind's weight by 0.2. */
function weighted<K extends string>(kinds: readonly K[], weights: Map<K, number>, r: Stream): K {
  let total = 0;
  for (const k of kinds) {
    if (!weights.has(k)) weights.set(k, 1);
    total += weights.get(k)!;
  }
  let x = next(r) * total;
  for (const k of kinds) {
    const w = weights.get(k)!;
    if (x < w) {
      weights.set(k, w * 0.2);
      return k;
    }
    x -= w;
  }
  return kinds[int(r, kinds.length)]!;
}

/** The Free Play pools (`FreeplayMissionGenerator.Generate`). */
export function freePlayPools(s: Settings): { count: number; kinds: Kind[] }[] {
  const needy = s.needy ? 1 : 0;
  const kinds = SOLVABLE.filter((k) => !s.vetoes.includes(k));
  return [
    { count: s.modules - needy, kinds },
    ...(needy ? [{ count: 1, kinds: [...NEEDY] as Kind[] }] : []),
  ];
}

/** `BombGenerator.CreateBomb` on the one casing, then the widgets. */
export function createBomb(no: number, seed: number, s: Settings, now: number): Bomb {
  const r: Stream = { r: seed >>> 0 };
  const free: number[][] = [[...ANCHORS], [...ANCHORS]];
  const faces: (0 | 1)[] = [0, 1];
  const room = () => faces.filter((f) => free[f]!.length > 0);
  const take = (face: 0 | 1, anchors: number[]) => {
    const anchor = anchors[int(r, anchors.length)]!;
    free[face]!.splice(free[face]!.indexOf(anchor), 1);
    return anchor;
  };
  const timerFace = faces[int(r, 2)]!;
  int(r, free[timerFace]!.length); // InstantiateComponent draws a spawn point before taking a timer one
  const timer = { face: timerFace, anchor: take(timerFace, TIMER_ANCHORS) };
  const picked: Kind[] = [];
  for (const pool of freePlayPools(s)) {
    const weights = new Map<Kind, number>();
    for (let i = 0; i < pool.count; i++) picked.push(weighted(pool.kinds, weights, r));
  }
  // Modules that need to see the timer (only the Button) go on its face first.
  const order = [...picked.filter((k) => k === 'button'), ...picked.filter((k) => k !== 'button')];
  const modules: Module[] = [];
  for (const kind of order) {
    const faceRoom = room();
    if (!faceRoom.length) break;
    const face =
      kind === 'button' && free[timerFace]!.length ? timerFace : faceRoom[int(r, faceRoom.length)]!;
    const anchor = take(face, free[face]!);
    modules.push(isNeedy(kind) ? createNeedy(kind, face, anchor) : createSolvable(kind, face, anchor, r));
  }
  const { serial, widgets } = makeWidgets(r);
  const strikeLimit = s.hardcore ? 1 : 3;
  const startedAt = now;
  return {
    no,
    r: r.r,
    startedAt,
    activeAt: startedAt + LIGHTS.active,
    clockAt: startedAt + LIGHTS.clock,
    total: s.time * 1000,
    leftAtAnchor: s.time * 1000,
    anchorAt: startedAt + LIGHTS.clock,
    rate: 1,
    strikes: 0,
    strikeLimit,
    timer,
    serial,
    widgets,
    modules,
    at: now,
    log: [],
    end: null,
    activated: false,
  };
}

function createNeedy(kind: NeedyKind, face: 0 | 1, anchor: number): NeedyModule {
  const base = {
    id: `m${face}${anchor}`,
    face,
    anchor,
    solved: false,
    strikes: 0,
    state: 'waiting' as const,
    left: NEEDY_TIME[kind],
    leftAt: 0,
    resumeAt: 0,
    changeAt: null,
    changes: 0,
    started: false,
  };
  if (kind === 'venting-gas') return { ...base, kind, question: 'vent', reply: null, warnedAt: null };
  if (kind === 'capacitor') return { ...base, kind, heldAt: null, exploded: false };
  return { ...base, kind, label: 'up', pattern: null, pos: 'up' };
}

// ---- The clock ----

/** Bomb time left (ms) at server time `t`. */
export function leftAt(b: Pick<Bomb, 'leftAtAnchor' | 'anchorAt' | 'rate' | 'end'>, t: number): number {
  if (b.end) return b.end.left;
  if (t <= b.anchorAt) return b.leftAtAnchor;
  return Math.max(0, b.leftAtAnchor - (t - b.anchorAt) * b.rate);
}

/** `TimerComponent.GetFormattedTime`: `MM:SS`, or `SS.cc` under a minute. */
export function timerText(ms: number): string {
  const time = Math.max(0, ms / 1000);
  const min = Math.floor(Math.floor(time) / 60);
  const sec = Math.floor(time) % 60;
  const cs = Math.floor((time - min * 60 - sec) * 100) % 100;
  const two = (n: number) => String(n).padStart(2, '0');
  return min >= 1 ? `${two(min)}:${two(sec)}` : `${two(sec)}.${two(cs)}`;
}

const infoOf = (b: Bomb): BombInfo => ({
  serial: b.serial,
  widgets: b.widgets,
  strikes: b.strikes,
  timerText: (t) => timerText(leftAt(b, t)),
});

/** When the clock reaches `left` ms (it never runs backwards), or now if it already has. */
function whenLeft(b: Bomb, left: number): number {
  if (b.leftAtAnchor <= left) return Math.max(b.anchorAt, b.at);
  return b.anchorAt + (b.leftAtAnchor - left) / b.rate;
}

// ---- Strikes and solves ----

function end(b: Bomb, how: 'defused' | 'strikes' | 'time', t: number, by?: string) {
  b.end = { how, at: t, left: leftAt(b, t), ...(by && { by }) };
  for (const m of b.modules) if (isNeedy(m.kind)) (m as NeedyModule).state = 'off';
}

/** `Bomb.OnStrike` + `NeedyComponent.ComponentStrikeEvent`. */
function strike(b: Bomb, m: Module, t: number) {
  if (b.end) return;
  m.strikes++;
  b.log.push({ at: t, module: m.id, kind: m.kind, what: 'strike' });
  if (b.strikes === b.strikeLimit - 1) {
    end(b, 'strikes', t, m.id);
    return;
  }
  const left = leftAt(b, t);
  b.anchorAt = Math.max(t, b.clockAt);
  b.leftAtAnchor = left;
  b.strikes++;
  b.rate = RATES[Math.min(b.strikes, RATES.length - 1)]!;
  changed(b, m, t + CHANGE_AFTER.strike);
}

/** `BombComponent.HandlePass`: solvable modules count; a needy pass (the knob) only wakes others. */
function pass(b: Bomb, m: Module, t: number) {
  if (!isNeedy(m.kind)) {
    if (m.solved) return;
    m.solved = true;
    m.solvedAt = t;
    b.log.push({ at: t, module: m.id, kind: m.kind, what: 'solve' });
    if (b.modules.every((x) => isNeedy(x.kind) || x.solved)) {
      end(b, 'defused', t);
      return;
    }
  }
  changed(b, m, t + CHANGE_AFTER.solve);
}

/** `PlayerChangedBomb`: every needy module still waiting takes notice (once at a time). */
function changed(b: Bomb, by: Module, at: number) {
  for (const m of b.modules)
    if (isNeedy(m.kind) && m !== by) {
      const n = m as NeedyModule;
      if (n.state === 'waiting' && n.changeAt === null) n.changeAt = at;
    }
}

function apply(b: Bomb, m: Module, o: Outcome, t: number) {
  if (o === 'strike') strike(b, m, t);
  else if (o === 'solve') pass(b, m, t);
}

// ---- Needy modules ----

function capacitorLeft(m: NeedyModule & { kind: 'capacitor' }, t: number): number {
  if (m.state !== 'running') return m.left;
  const dt = t - m.leftAt;
  if (m.heldAt === null) return m.left - dt;
  return Math.min(NEEDY_TIME.capacitor, m.left + dt * (DISCHARGE - 1));
}

/** A needy module's countdown left (ms) at `t`. */
export function needyLeft(m: NeedyModule, t: number): number {
  if (m.state !== 'running') return m.left;
  if (m.kind === 'capacitor') return capacitorLeft(m, t);
  return m.left - (t - m.leftAt);
}

/** `ResetAndStart`. */
function run(b: Bomb, m: NeedyModule, t: number) {
  if (b.end) return;
  m.state = 'running';
  m.left = NEEDY_TIME[m.kind];
  m.leftAt = t;
  b.log.push({ at: t, module: m.id, kind: m.kind, what: 'needy' });
  if (m.kind === 'venting-gas') {
    m.question = next(b) < 0.1 ? 'detonate' : 'vent';
    m.reply = null;
    m.warnedAt = null;
  }
  if (m.kind === 'knob') {
    // Randomize: the backing turns to one of the five Direction values (None reads as up).
    const dirs: Dir[] = ['up', 'down', 'left', 'right', 'up'];
    m.label = dirs[int(b, 5)]!;
    m.pattern = int(b, KNOB.length);
  }
}

/** `WaitAndResetRoutine` (or `Terminated` for the capacitor, which never resets). */
function cool(b: Bomb, m: NeedyModule, t: number) {
  if (m.kind === 'capacitor') {
    m.state = 'off';
    return;
  }
  m.state = 'cooldown';
  m.left = NEEDY_TIME[m.kind];
  m.resumeAt = t + between(b, RESET_MIN, RESET_MAX);
}

/** `OnSolved`. */
function handled(b: Bomb, m: NeedyModule, t: number) {
  if (m.state !== 'running') return;
  m.left = needyLeft(m, t);
  m.leftAt = t;
  cool(b, m, t);
}

function expire(b: Bomb, m: NeedyModule, t: number) {
  m.left = 0;
  m.leftAt = t;
  if (m.kind === 'venting-gas') {
    cool(b, m, t);
    strike(b, m, t);
  } else if (m.kind === 'capacitor') {
    strike(b, m, t);
    m.exploded = true;
    m.heldAt = null;
    cool(b, m, t);
  } else {
    const right = m.pattern !== null && KNOB[m.pattern]!.pos === m.pos;
    m.pattern = null;
    if (right) pass(b, m, t);
    else strike(b, m, t);
    if (!b.end) cool(b, m, t);
  }
}

function nextNeedyAt(b: Bomb, m: NeedyModule): number | null {
  if (m.state === 'off') return null;
  const times: number[] = [];
  if (m.state === 'waiting') {
    if (!m.started) times.push(whenLeft(b, b.total - NEEDY_AFTER));
    if (m.changeAt !== null) times.push(m.changeAt);
  }
  if (m.state === 'cooldown') times.push(m.resumeAt);
  if (m.state === 'running') {
    if (m.kind === 'capacitor') {
      if (m.heldAt === null) times.push(m.leftAt + m.left);
    } else times.push(m.leftAt + m.left);
  }
  if (m.kind === 'venting-gas' && m.reply) times.push(m.reply.counted ? m.reply.lockUntil : m.reply.doneAt);
  return times.length ? Math.min(...times) : null;
}

function tickNeedy(b: Bomb, m: NeedyModule, t: number) {
  if (m.kind === 'venting-gas' && m.reply) {
    const reply = m.reply;
    if (t >= reply.doneAt && !reply.counted) {
      reply.counted = true;
      if (reply.yes) {
        if (m.question === 'detonate') strike(b, m, t);
        if (!b.end) handled(b, m, t);
      } else if (m.question === 'vent') {
        m.warnedAt = t;
        reply.lockUntil = t + VENT_WARNING;
      } else handled(b, m, t);
    }
    if (reply.counted && t >= reply.lockUntil) m.reply = null;
    if (b.end) return;
  }
  if (m.state === 'waiting') {
    if (!m.started && t >= whenLeft(b, b.total - NEEDY_AFTER) && t >= b.clockAt) {
      m.started = true;
      m.changeAt = null;
      run(b, m, t);
      return;
    }
    if (m.changeAt !== null && t >= m.changeAt) {
      m.changeAt = null;
      m.changes++;
      if (m.changes > 1 || next(b) <= FIRST_CHANCE) {
        if (!m.started) {
          m.started = true;
          run(b, m, t);
        }
      }
    }
    return;
  }
  if (m.state === 'cooldown' && t >= m.resumeAt) {
    run(b, m, t);
    return;
  }
  if (m.state === 'running' && needyLeft(m, t) <= 0) expire(b, m, t);
}

/** The defuser's action on a needy module. */
function actNeedy(b: Bomb, m: NeedyModule, a: ModuleOp, t: number): Outcome | 'ignored' {
  if (m.kind === 'venting-gas') {
    if (a.op !== 'answer' || m.reply || m.state !== 'running') return 'ignored';
    const doneAt = t + (a.yes ? VENT_YES : VENT_NO) + VENT_AFTER;
    m.reply = { yes: a.yes, at: t, doneAt, lockUntil: doneAt };
    m.warnedAt = null;
    return null;
  }
  if (m.kind === 'capacitor') {
    if (m.exploded) return 'ignored';
    if (a.op === 'down') {
      if (m.heldAt !== null) return 'ignored';
      m.left = capacitorLeft(m, t);
      m.leftAt = t;
      m.heldAt = t;
      return null;
    }
    if (a.op === 'up') {
      if (m.heldAt === null) return 'ignored';
      m.left = capacitorLeft(m, t);
      m.leftAt = t;
      m.heldAt = null;
      return null;
    }
    return 'ignored';
  }
  if (a.op !== 'turn') return 'ignored';
  const turn: Record<Dir, Dir> = { up: 'right', right: 'down', down: 'left', left: 'up' };
  m.pos = turn[m.pos];
  return null;
}

// ---- Running the bomb ----

function nextEvent(b: Bomb): { at: number; run: () => void } | null {
  if (b.end) return null;
  let best: { at: number; run: () => void } | null = null;
  const offer = (at: number | null, run: () => void) => {
    if (at === null || !Number.isFinite(at)) return;
    if (!best || at < best.at) best = { at, run };
  };
  if (!b.activated) {
    offer(b.activeAt, () => {
      b.activated = true;
      for (const m of b.modules) if (!isNeedy(m.kind)) activate(m as never, b.activeAt, b);
    });
  }
  for (const m of b.modules) {
    if (isNeedy(m.kind)) {
      const n = m as NeedyModule;
      offer(nextNeedyAt(b, n), () => tickNeedy(b, n, best!.at));
    } else {
      const s = m as Exclude<Module, NeedyModule>;
      offer(nextSolvableAt(s), () => tickSolvable(s, best!.at, b));
    }
  }
  offer(whenLeft(b, 0), () => end(b, 'time', best!.at));
  return best;
}

/** Plays every timed change up to `t`. */
export function runTo(b: Bomb, t: number) {
  for (let guard = 0; guard < 10_000; guard++) {
    const e = nextEvent(b);
    if (!e || e.at > t) break;
    b.at = Math.max(b.at, e.at);
    e.run();
  }
  if (!b.end) b.at = Math.max(b.at, t);
}

/** The bomb's next timed change, for the room's deadline. */
export function nextAt(b: Bomb): number | null {
  return nextEvent(b)?.at ?? null;
}

/** An action on a module at `t` (already run to). */
export function act(b: Bomb, id: string, a: ModuleOp, t: number): Outcome | 'ignored' | 'missing' {
  const m = b.modules.find((x) => x.id === id);
  if (!m) return 'missing';
  if (b.end) return 'ignored';
  const o = isNeedy(m.kind)
    ? actNeedy(b, m as NeedyModule, a, t)
    : actSolvable(m as Exclude<Module, NeedyModule>, a, t, b.activated, infoOf(b), b);
  if (o === 'ignored') return o;
  apply(b, m, o, t);
  return o;
}

export const solvableCount = (b: Bomb) => b.modules.filter((m) => !isNeedy(m.kind)).length;
export const solvedCount = (b: Bomb) => b.modules.filter((m) => !isNeedy(m.kind) && m.solved).length;
export const kindsOf = (b: Bomb): SolvableKind[] =>
  b.modules.flatMap((m) => (isNeedy(m.kind) ? [] : [m.kind as SolvableKind]));
export { infoOf };
