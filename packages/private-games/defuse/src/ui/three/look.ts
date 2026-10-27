// What the 3D bomb shows at a moment, as plain data: the bomb view and the server time in, every
// part's state out. Pure (no three.js), so the mapping is tested on its own; the scene only
// applies it.
import { NEEDY_TIME, leftAt, needyLeft, timerText } from '../../logic/bomb.ts';
import { MORSE } from '../../logic/data.ts';
import { HOLD_AFTER, SIMON_COLOURS, SIMON_NOTE, SIMON_REPLAY } from '../../logic/modules.ts';
import {
  type ButtonColour,
  type Dir,
  type Kind,
  type NeedyModule,
  type SimonColour,
  type VennColour,
  type WireColour,
  isNeedy,
} from '../../logic/types.ts';
import type { BombView, ModuleView } from '../../logic/view.ts';

/** `StatusLight.FlashStrike`: a strike lights the module's LED red for a second. */
export const STRIKE_FLASH = 1000;
/** `MorseCodeComponent`: the light's unit (`DotLength`). */
export const MORSE_UNIT = 270;

export type Led = 'off' | 'pass' | 'strike';

/** Where each Simon colour sits (`SimonComponent.buttons`: left, top, bottom, right). */
export const SIMON_PLACE: Record<SimonColour, 'left' | 'top' | 'bottom' | 'right'> = {
  red: 'left',
  blue: 'top',
  green: 'bottom',
  yellow: 'right',
};

export const DIRS: Dir[] = ['up', 'right', 'down', 'left'];

/** A strike on this module in the last second (its LED flashes red). */
export const struckNow = (m: ModuleView, b: BombView, now: number) =>
  b.log.some(
    (e) => e.module === m.id && e.what === 'strike' && now >= e.at && now - e.at < STRIKE_FLASH,
  );

/** The status light: green once disarmed, red for a moment on a strike. */
export const ledOf = (m: ModuleView, b: BombView, now: number): Led =>
  m.solved ? 'pass' : struckNow(m, b, now) ? 'strike' : 'off';

/** Which pad flashes now, from Simon's playback schedule (or -1). */
export function simonFlash(m: Extract<ModuleView, { kind: 'simon' }>, now: number): number {
  if (m.solved || now < m.playAt) return -1;
  const period = m.shown.length * SIMON_NOTE + SIMON_REPLAY;
  const into = (now - m.playAt) % period;
  const i = Math.floor(into / SIMON_NOTE);
  return i < m.shown.length ? SIMON_COLOURS.indexOf(m.shown[i]!) : -1;
}

/** Whether the Morse light is on at `now` (`MorseCodeComponent.PlayWord`, looping from the lights). */
export function morseLit(signal: readonly string[], since: number, now: number): boolean {
  const parts: [boolean, number][] = [];
  signal.forEach((letter, li) => {
    [...letter].forEach((s, si) => {
      parts.push([true, s === '-' ? 3 : 1]);
      if (si < letter.length - 1) parts.push([false, 1]);
    });
    parts.push([false, li < signal.length - 1 ? 4 : 10]);
  });
  const total = parts.reduce((n, [, u]) => n + u, 0) * MORSE_UNIT;
  if (!total || now < since) return false;
  let t = (now - since) % total;
  for (const [on, u] of parts) {
    if (t < u * MORSE_UNIT) return on;
    t -= u * MORSE_UNIT;
  }
  return false;
}

/** The three wires of the Wire Sequence panel on show, or null while it turns or is done. */
export function seqRow(m: ModuleView, now: number) {
  if (m.kind !== 'wire-sequence' || !('panels' in m)) return null;
  if (now < m.turningUntil || m.page >= 4) return null;
  return [0, 1, 2].map((r) => m.panels[m.page * 3 + r]!);
}

/** The needy display: two digits while it runs, dark otherwise; `warn` in its last seconds. */
export function needyClock(
  m: Pick<NeedyModule, 'state' | 'kind' | 'left' | 'leftAt'> & { heldAt?: number | null },
  now: number,
): { text: string | null; warn: boolean } {
  if (m.state !== 'running') return { text: null, warn: false };
  const left = needyLeft(m as NeedyModule, now);
  const warn = left <= (m.kind === 'venting-gas' ? 3000 : 5000);
  return { text: String(Math.max(0, Math.round(left / 1000))).padStart(2, '0'), warn };
}

export type ModuleLook =
  | { kind: 'wires'; wires: { slot: number; colour: WireColour; cut: boolean }[] }
  | {
      kind: 'button';
      colour: ButtonColour;
      label: string;
      down: boolean;
      /** The strip's colour while lit (a press held past half a second). */
      strip: ButtonColour | null;
    }
  | { kind: 'keypad'; symbols: number[]; keys: ('off' | 'correct' | 'wrong')[] }
  | { kind: 'simon'; lit: number; stage: number }
  | {
      kind: 'whos-on-first';
      display: string;
      labels: string[];
      /** Buttons risen (pressable), sunk while the stage changes. */
      up: boolean;
      stages: number;
    }
  | {
      kind: 'memory';
      display: string;
      labels: string[];
      up: boolean;
      stages: number;
    }
  | { kind: 'morse'; lit: boolean; dial: number; freq: string }
  | {
      kind: 'complicated-wires';
      wires: { slot: number; colour: VennColour; led: boolean; star: boolean; cut: boolean }[];
    }
  | {
      kind: 'wire-sequence';
      /** The panel on show (null while the doors are closed or it is finished). */
      row: { colour: 'red' | 'blue' | 'black' | null; to: number; cut: boolean }[] | null;
      page: number;
      turning: boolean;
      done: boolean;
    }
  | {
      kind: 'maze';
      circles: [number, number][];
      at: [number, number];
      goal: [number, number];
      on: boolean;
    }
  | { kind: 'password'; letters: string[]; on: boolean }
  | {
      kind: 'venting-gas';
      clock: { text: string | null; warn: boolean };
      /** The screen's lines, as the original types them. */
      lines: string[];
    }
  | {
      kind: 'capacitor';
      clock: { text: string | null; warn: boolean };
      /** How charged it is, 0–1 (the bar). */
      charge: number;
      held: boolean;
      exploded: boolean;
    }
  | {
      kind: 'knob';
      clock: { text: string | null; warn: boolean };
      label: Dir;
      /** Where the knob points on the module (the label's place plus its position). */
      points: Dir;
      leds: boolean[];
    };

export type Look = ModuleLook & { id: string; face: 0 | 1; anchor: number; led: Led | null };

/** What one module shows at `now`. */
export function moduleLook(m: ModuleView, b: BombView, now: number): Look {
  const led = isNeedy(m.kind) ? null : ledOf(m, b, now);
  const base = { id: m.id, face: m.face, anchor: m.anchor, led };
  switch (m.kind) {
    case 'wires':
      return { ...base, kind: 'wires', wires: m.wires.map((w) => ({ ...w })) };
    case 'button': {
      const lit = m.downAt !== null && m.strip && now - m.downAt > HOLD_AFTER ? m.strip : null;
      return {
        ...base,
        kind: 'button',
        colour: m.colour,
        label: m.label.toUpperCase(),
        down: m.downAt !== null,
        strip: lit,
      };
    }
    case 'keypad': {
      const flash = struckNow(m, b, now);
      return {
        ...base,
        kind: 'keypad',
        symbols: [...m.symbols],
        keys: m.symbols.map((_, i) => (m.down[i] ? 'correct' : flash ? 'wrong' : 'off')),
      };
    }
    case 'simon':
      return {
        ...base,
        kind: 'simon',
        lit: 'shown' in m ? simonFlash(m, now) : -1,
        stage: m.stage,
      };
    case 'whos-on-first': {
      const up = m.change ? now < m.change.sinkAt : now >= m.upAt;
      return {
        ...base,
        kind: 'whos-on-first',
        display: b.activated ? (m.display ?? '') : '',
        labels: [...m.labels],
        up: up && b.activated,
        stages: m.stage + (m.solved ? 1 : 0),
      };
    }
    case 'memory': {
      const ready = m.valid && !m.change;
      const display = 'display' in m && m.display !== null ? String(m.display) : '';
      return {
        ...base,
        kind: 'memory',
        display: b.activated ? display : '',
        labels: m.labels.map(String),
        up: (ready || m.solved) && b.activated,
        stages: m.stage + (m.solved ? 1 : 0),
      };
    }
    case 'morse':
      return {
        ...base,
        kind: 'morse',
        lit: 'signal' in m && b.activated && !m.solved && morseLit(m.signal, b.activeAt, now),
        dial: m.dial,
        freq: (MORSE[m.dial]![0] / 1000).toFixed(3),
      };
    case 'complicated-wires':
      return {
        ...base,
        kind: 'complicated-wires',
        wires: m.wires.map((w) => ({ ...w, led: w.led && b.activated })),
      };
    case 'wire-sequence': {
      const turning = now < m.turningUntil;
      const row = seqRow(m, now);
      return {
        ...base,
        kind: 'wire-sequence',
        row: row && row.map((e) => ({ colour: e.colour, to: e.to, cut: e.cut })),
        page: Math.min(m.page, 3),
        turning,
        done: m.page >= 4,
      };
    }
    case 'maze':
      return {
        ...base,
        kind: 'maze',
        circles: 'circles' in m ? m.circles.map((c) => [c[0], c[1]] as [number, number]) : [],
        at: [m.at[0], m.at[1]],
        goal: [m.goal[0], m.goal[1]],
        on: b.activated,
      };
    case 'password':
      return {
        ...base,
        kind: 'password',
        letters: m.columns.map((c, i) => c[m.pos[i]!] ?? ''),
        on: b.activated && m.columns.length > 0,
      };
    case 'venting-gas': {
      const clock = needyClock(m, now);
      const lines: string[] = [];
      const reply = m.reply;
      const warning = m.warnedAt !== null && reply && now >= m.warnedAt && now < reply.lockUntil;
      if (warning) lines.push('VENTING', 'PREVENTS', 'EXPLOSIONS');
      else if (m.state === 'running' && 'question' in m && m.question) {
        const word = reply ? (reply.yes ? 'YES' : 'NO') : '';
        const typed = reply
          ? word.slice(
              0,
              Math.min(
                word.length,
                Math.floor(((now - reply.at) / (reply.yes ? 1500 : 1000)) * word.length) + 1,
              ),
            )
          : '';
        lines.push(m.question === 'vent' ? 'VENT GAS?' : 'DETONATE?', `Y/N ${typed}`.trimEnd());
      }
      return { ...base, kind: 'venting-gas', clock, lines };
    }
    case 'capacitor': {
      const running = m.state === 'running';
      const left = running ? needyLeft(m, now) : NEEDY_TIME.capacitor;
      return {
        ...base,
        kind: 'capacitor',
        clock: needyClock(m, now),
        charge: Math.max(0, Math.min(1, 1 - left / NEEDY_TIME.capacitor)),
        held: m.heldAt !== null,
        exploded: m.exploded,
      };
    }
    case 'knob': {
      const clock = needyClock(m, now);
      const leds = 'leds' in m ? m.leds : null;
      const panic = clock.warn && Math.floor(now / 150) % 2 === 0;
      return {
        ...base,
        kind: 'knob',
        clock,
        label: m.label,
        points: DIRS[(DIRS.indexOf(m.label) + DIRS.indexOf(m.pos)) % 4]!,
        leds: Array.from({ length: 12 }, (_, i) => !!leds && leds[i] === 'X' && !panic),
      };
    }
  }
}

export interface TimerLook {
  face: 0 | 1;
  anchor: number;
  /** The digits (dark for the first two seconds, `GameplayState.StartRound`). */
  text: string;
  lit: boolean;
  /** Strike lamps: how many there are (none in Hardcore) and how many are lit. */
  lamps: number;
  struck: number;
  defused: boolean;
}

export interface BombLook {
  timer: TimerLook;
  modules: Look[];
  /** The modules are awake (the lights have come on). */
  awake: boolean;
  /** The last minute: the emergency light runs. */
  lastMinute: boolean;
  /** Bomb time left (ms). */
  left: number;
  rate: number;
  ended: BombView['end'];
}

export function bombLook(b: BombView, now: number): BombLook {
  const left = leftAt(b, now);
  return {
    timer: {
      face: b.timer.face,
      anchor: b.timer.anchor,
      text: timerText(left),
      lit: now >= b.startedAt + 2000,
      lamps: Math.max(0, Math.min(2, b.strikeLimit - 1)),
      struck: b.strikes,
      defused: b.end?.how === 'defused',
    },
    modules: b.modules.map((m) => moduleLook(m, b, now)),
    awake: b.activated || now >= b.activeAt,
    lastMinute: !b.end && now >= b.clockAt && left < 60_000,
    left,
    rate: b.rate,
    ended: b.end,
  };
}

/** The module kinds a slot can hold, for the scene's prefab names. */
export const PREFAB: Record<Kind, string> = {
  wires: 'WireSetComponent',
  button: 'ButtonComponent',
  keypad: 'KeypadComponent',
  simon: 'SimonComponent',
  'whos-on-first': 'WhosOnFirstComponent',
  memory: 'MemoryComponent',
  morse: 'MorseComponent',
  'complicated-wires': 'VennWiresComponent',
  'wire-sequence': 'WireSequenceComponent',
  maze: 'InvisibleWallsComponent',
  password: 'PasswordComponent',
  'venting-gas': 'NeedyVentComponent',
  capacitor: 'NeedyDischargeComponent',
  knob: 'NeedyKnobComponent',
};
