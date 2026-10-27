import { MAZES, MORSE, MORSE_ALPHABET, KNOB, WOF_DISPLAYS } from './data.ts';
import type {
  Bomb,
  BombResult,
  CapacitorModule,
  KeypadModule,
  KnobModule,
  MazeModule,
  MemoryModule,
  Module,
  MorseModule,
  PasswordModule,
  Player,
  SequenceModule,
  Settings,
  SimonColour,
  SimonModule,
  State,
  VentModule,
  WhosOnFirstModule,
} from './types.ts';

type Hide<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type KeypadView = Hide<KeypadModule, 'column'>;
/** `shown`: the flashes the current stage plays (the rest only at the end). */
export type SimonView = Hide<SimonModule, 'sequence'> & { shown: SimonColour[] };
export type WhosOnFirstView = Omit<WhosOnFirstModule, 'display'> & { display: string | null };
/** `display`: the digit on show, or null while it is dark. */
export type MemoryView = Hide<MemoryModule, 'digits'> & { display: number | null };
/** `signal`: the light's letters as dots and dashes. */
export type MorseView = Hide<MorseModule, 'word'> & { signal: string[] };
export type SequenceView = Hide<SequenceModule, 'entries'> & {
  panels: { colour: 'red' | 'blue' | 'black' | null; to: number; cut: boolean }[];
};
export type MazeView = Hide<MazeModule, 'maze'> & { circles: [number, number][] };
export type PasswordView = Hide<PasswordModule, 'word'>;
export type VentView = Hide<VentModule, 'question'>;
/** `leds`: the lit pattern while it runs. */
export type KnobView = Hide<KnobModule, 'pattern'> & { leds: string | null };

export type ModuleView =
  | Exclude<
      Module,
      | KeypadModule
      | SimonModule
      | WhosOnFirstModule
      | MemoryModule
      | MorseModule
      | SequenceModule
      | MazeModule
      | PasswordModule
      | VentModule
      | KnobModule
    >
  | KeypadView
  | SimonView
  | WhosOnFirstView
  | MemoryView
  | MorseView
  | SequenceView
  | MazeView
  | PasswordView
  | VentView
  | KnobView
  | CapacitorModule;

export type BombView = Omit<Bomb, 'r' | 'modules'> & { modules: ModuleView[] };

export interface ClockView {
  anchorAt: number;
  leftAtAnchor: number;
  rate: number;
  clockAt: number;
  strikes: number;
  strikeLimit: number;
  end: Bomb['end'];
}

export type Role = 'defuser' | 'expert' | 'watcher' | 'stage';

export interface DefuseView {
  phase: State['phase'];
  stage: State['stage'];
  role: Role;
  settings: Settings;
  seats: Player[];
  watchers: Player[];
  defuser: string | null;
  volunteers: string[];
  bombNo: number;
  /** The bomb, for the defuser (and the table screen showing it), and for everyone at the end. */
  bomb: BombView | null;
  /** While a bomb is live and the host lets experts see them: the clock and strikes only. */
  clock: ClockView | null;
  /** When the live bomb's lights came on, for everyone (so expert screens know a bomb is on). */
  live: { startedAt: number; total: number } | null;
  /** Experts' page claims and notes (never the defuser's). */
  claims: State['claims'] | null;
  notes: State['notes'] | null;
  history: BombResult[];
}

const morseSignal = (word: string) => [...word].map((c) => MORSE_ALPHABET[c] ?? '');

/** A module as the bomb shows it; `reveal` adds what only the end may show. */
export function moduleView(m: Module, reveal: boolean): ModuleView {
  switch (m.kind) {
    case 'keypad': {
      const { column: _column, ...rest } = m;
      return reveal ? m : rest;
    }
    case 'simon': {
      const { sequence, ...rest } = m;
      const shown = sequence.slice(0, Math.min(sequence.length, m.stage + 1));
      return reveal ? { ...m, shown } : { ...rest, shown };
    }
    case 'whos-on-first':
      return { ...m, display: m.display < 0 ? null : WOF_DISPLAYS[m.display]![0] };
    case 'memory': {
      const { digits, ...rest } = m;
      const display = m.change || !m.valid || !digits.length ? null : digits[m.stage]!;
      return reveal ? { ...m, display } : { ...rest, display };
    }
    case 'morse': {
      const { word, ...rest } = m;
      const signal = morseSignal(MORSE[word]![1]);
      return reveal ? { ...m, signal } : { ...rest, signal };
    }
    case 'wire-sequence': {
      const { entries, ...rest } = m;
      const panels = entries.slice(0, 12).map((e) => ({ colour: e.colour, to: e.to, cut: e.cut }));
      return reveal ? { ...m, panels } : { ...rest, panels };
    }
    case 'maze': {
      const { maze, ...rest } = m;
      const circles = MAZES[maze]!.circles;
      return reveal ? { ...m, circles } : { ...rest, circles };
    }
    case 'password': {
      const { word: _word, ...rest } = m;
      return reveal ? m : rest;
    }
    case 'venting-gas': {
      const { question: _question, ...rest } = m;
      return reveal || m.state === 'running' ? m : rest;
    }
    case 'knob': {
      const { pattern, ...rest } = m;
      const leds = pattern === null ? null : KNOB[pattern]!.leds;
      return reveal ? { ...m, leds } : { ...rest, leds };
    }
    default:
      return m;
  }
}

export function bombView(b: Bomb, reveal: boolean): BombView {
  const { r: _r, modules, ...rest } = b;
  return { ...rest, modules: modules.map((m) => moduleView(m, reveal)) };
}

export function view(state: State, viewer: string | null): DefuseView {
  const b = state.bomb;
  const seated = viewer !== null && state.seats.some((p) => p.id === viewer);
  const role: Role =
    viewer === null
      ? 'stage'
      : state.stage === 'bomb' && viewer === state.defuser
        ? 'defuser'
        : seated
          ? 'expert'
          : 'watcher';
  const live = state.stage === 'bomb' && b;
  const ended = state.stage === 'result' && b;
  const seesBomb = role === 'defuser' || (role === 'stage' && state.settings.table === 'bomb');
  const bomb = b && (ended ? bombView(b, true) : live && seesBomb ? bombView(b, false) : null);
  const clock: ClockView | null =
    live && !seesBomb && state.settings.expertsSeeClock
      ? {
          anchorAt: b.anchorAt,
          leftAtAnchor: b.leftAtAnchor,
          rate: b.rate,
          clockAt: b.clockAt,
          strikes: b.strikes,
          strikeLimit: b.strikeLimit,
          end: b.end,
        }
      : null;
  const manual = role !== 'defuser' || !live;
  return {
    phase: state.phase,
    stage: state.stage,
    role,
    settings: state.settings,
    seats: state.seats,
    watchers: state.watchers,
    defuser: state.defuser,
    volunteers: state.volunteers,
    bombNo: state.bombNo,
    bomb,
    clock,
    live: live ? { startedAt: b.startedAt, total: b.total } : null,
    claims: manual ? state.claims : null,
    notes: manual ? state.notes : null,
    history: state.history,
  };
}
