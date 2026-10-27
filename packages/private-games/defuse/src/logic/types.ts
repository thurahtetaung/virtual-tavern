import type { PlayerId, TableVolumes } from '@vt/game-sdk';
import type { WireColour } from './data-types.ts';

export type { WireColour } from './data-types.ts';

export const SOLVABLE = [
  'wires',
  'button',
  'keypad',
  'simon',
  'whos-on-first',
  'memory',
  'morse',
  'complicated-wires',
  'wire-sequence',
  'maze',
  'password',
] as const;
export const NEEDY = ['venting-gas', 'capacitor', 'knob'] as const;

export type SolvableKind = (typeof SOLVABLE)[number];
export type NeedyKind = (typeof NEEDY)[number];
export type Kind = SolvableKind | NeedyKind;

export const isNeedy = (k: Kind): k is NeedyKind => (NEEDY as readonly string[]).includes(k);

// ---- Edgework ----

export type Side = 'top' | 'right' | 'bottom' | 'left';
export type PortKind = 'dvi' | 'parallel' | 'ps2' | 'rj45' | 'serial' | 'rca';

/**
 * One widget, in its widget area (the casing's 10 areas, `AREAS`) at a cell of the area's zone
 * grid; `turned` when it lies across the area (the original's `Rotate`).
 */
export type Widget = { area: number; x: number; z: number; turned: boolean } & (
  | { kind: 'serial' }
  | { kind: 'battery'; batteries: 1 | 2 }
  | { kind: 'indicator'; label: string; lit: boolean }
  | { kind: 'ports'; ports: PortKind[] }
);

// ---- Modules ----

export type ButtonColour = 'red' | 'blue' | 'yellow' | 'white';
export type ButtonLabel = 'press' | 'hold' | 'abort' | 'detonate';
export type SimonColour = 'red' | 'blue' | 'green' | 'yellow';
export type Dir = 'up' | 'right' | 'down' | 'left';
export type VennColour = 'white' | 'red' | 'blue' | 'red-white' | 'blue-white' | 'red-blue';

interface Base {
  /** `m<face><anchor>`: the casing's face (0 front, 1 rear) and anchor (0–5). */
  id: string;
  face: 0 | 1;
  anchor: number;
  solved: boolean;
  /** Strikes this module gave. */
  strikes: number;
  /** When it was solved (server time). */
  solvedAt?: number;
}

/** `slot`: the wire's place among the frame's six (the original removes wires at random). */
export interface WiresModule extends Base {
  kind: 'wires';
  wires: { slot: number; colour: WireColour; cut: boolean }[];
}

export interface ButtonModule extends Base {
  kind: 'button';
  colour: ButtonColour;
  label: ButtonLabel;
  /** When the current press began (the client's server-clock time), or null. */
  downAt: number | null;
  /** The strip's colour for this press; it lights once the press has lasted over half a second. */
  strip: ButtonColour | null;
}

export interface KeypadModule extends Base {
  kind: 'keypad';
  /** The column (0–5) the symbols come from: hidden from the defuser. */
  column: number;
  /** Glyph numbers (1–31), in button order (top left, top right, bottom left, bottom right). */
  symbols: number[];
  down: boolean[];
}

export interface SimonModule extends Base {
  kind: 'simon';
  /** Every flash (hidden past the stage being played). */
  sequence: SimonColour[];
  /** The original's `lastIndex`: stage k plays flashes 0…k. */
  stage: number;
  progress: number;
  /** When the next playback starts (progress resets then); it repeats every period after. */
  playAt: number;
}

export interface WhosOnFirstModule extends Base {
  kind: 'whos-on-first';
  stage: number;
  /** Index in `WOF_DISPLAYS`, or -1 for a dark display. */
  display: number;
  labels: string[];
  /** Buttons are up (`ButtonsEmerged`) from this time until the next change starts. */
  upAt: number;
  /** A stage change under way: buttons sink at `sinkAt`, new labels at `labelsAt`, all back at `readyAt`. */
  change: { sinkAt: number; labelsAt: number; readyAt: number; relabelled?: boolean } | null;
}

export interface MemoryModule extends Base {
  kind: 'memory';
  stage: number;
  /** The five display digits (hidden past the current stage). */
  digits: number[];
  labels: number[];
  pressedPos: number[];
  pressedLabel: number[];
  valid: boolean;
  /** A change under way: `next` stage or `reset` after a strike. */
  change: {
    kind: 'next' | 'reset';
    sinkAt: number;
    labelsAt: number;
    readyAt: number;
    relabelled?: boolean;
  } | null;
}

export interface MorseModule extends Base {
  kind: 'morse';
  /** Index in `MORSE`: hidden from the defuser (they see the light). */
  word: number;
  /** The dial's position in `MORSE`. */
  dial: number;
}

export interface VennModule extends Base {
  kind: 'complicated-wires';
  wires: { slot: number; colour: VennColour; led: boolean; star: boolean; cut: boolean }[];
}

export interface SequenceEntry {
  colour: 'red' | 'blue' | 'black' | null;
  /** Terminal 0 (A), 1 (B) or 2 (C). */
  to: number;
  /** Occurrence of its colour from 0 (hidden: the defuser counts). */
  n: number;
  cut: boolean;
}

export interface SequenceModule extends Base {
  kind: 'wire-sequence';
  /** 13 entries; panels show 0–11, three a panel. */
  entries: SequenceEntry[];
  /** The panel on show (4 = finished). */
  page: number;
  /** The panel change locks input until then. */
  turningUntil: number;
}

export interface MazeModule extends Base {
  kind: 'maze';
  /** Index in `MAZES`: hidden (the defuser sees its circles). */
  maze: number;
  at: [number, number];
  goal: [number, number];
}

export interface PasswordModule extends Base {
  kind: 'password';
  /** Hidden. */
  word: string;
  columns: string[][];
  pos: number[];
}

/** The needy cycle (`NeedyComponent`): waiting for its first start, running, cooling down, off. */
export interface NeedyBase extends Base {
  state: 'waiting' | 'running' | 'cooldown' | 'off';
  /** Running: time left (ms) at `leftAt`. */
  left: number;
  leftAt: number;
  /** Cooldown: the next run starts then. */
  resumeAt: number;
  /** The "player changed the bomb" response under way (`PlayerChangedBomb`), due then. */
  changeAt: number | null;
  changes: number;
  started: boolean;
}

export interface VentModule extends NeedyBase {
  kind: 'venting-gas';
  question: 'vent' | 'detonate';
  /** A typed reply: its letters run from `at`, it counts at `doneAt`, input is locked until `lockUntil`. */
  reply: { yes: boolean; at: number; doneAt: number; lockUntil: number; counted?: boolean } | null;
  /** "Venting prevents explosions" shows from then (after a No to venting). */
  warnedAt: number | null;
}

export interface CapacitorModule extends NeedyBase {
  kind: 'capacitor';
  /** The lever is held from then (server time), or null. */
  heldAt: number | null;
  exploded: boolean;
}

export interface KnobModule extends NeedyBase {
  kind: 'knob';
  /** Where the UP label sits. */
  label: Dir;
  /** Index in `KNOB`, or null while it isn't running. */
  pattern: number | null;
  /** The knob's position, relative to the UP label. */
  pos: Dir;
}

export type SolvableModule =
  | WiresModule
  | ButtonModule
  | KeypadModule
  | SimonModule
  | WhosOnFirstModule
  | MemoryModule
  | MorseModule
  | VennModule
  | SequenceModule
  | MazeModule
  | PasswordModule;
export type NeedyModule = VentModule | CapacitorModule | KnobModule;
export type Module = SolvableModule | NeedyModule;

export interface LogEntry {
  at: number;
  module: string;
  kind: Kind;
  what: 'strike' | 'solve' | 'needy';
}

export interface Bomb {
  no: number;
  /** Hidden: the bomb's own random stream (mulberry32 state). */
  r: number;
  startedAt: number;
  /** Modules switch on (the lights). */
  activeAt: number;
  /** The clock starts. */
  clockAt: number;
  total: number;
  /** Bomb time left (ms) at `anchorAt`, running at `rate`. */
  leftAtAnchor: number;
  anchorAt: number;
  rate: number;
  strikes: number;
  strikeLimit: number;
  /** The face (0 front, 1 rear) and anchor of the timer. */
  timer: { face: 0 | 1; anchor: number };
  serial: string;
  widgets: Widget[];
  modules: Module[];
  /** The lights are on: modules have woken (`Bomb.ActivateComponents`). */
  activated: boolean;
  /** The latest time the bomb has been run to. */
  at: number;
  log: LogEntry[];
  end: { how: 'defused' | 'strikes' | 'time'; at: number; left: number; by?: string } | null;
  /**
   * The room's surprises (`PaceMaker`), hidden: their own random stream, the next idle check and
   * the idle actions not used yet. Null with the host's "Room surprises" off (and in bombs saved
   * before the room).
   */
  pace?: { r: number; next: number | null; left: Surprise[] } | null;
  /** The mission this bomb is (missing: Free Play). */
  mission?: string | null;
  /** Bomb time (ms) before needy modules wake by themselves (missing: 90 s). */
  needyAfter?: number;
  /**
   * Hidden: the different manual's seed the bomb follows (missing or 1: the printed manual). It
   * never reaches a player; experts get the rules it makes.
   */
  manual?: number;
  /** Lights out (`CeilingLight.CutTheLightsRoutine`): when it began. */
  lightsAt?: number | null;
  /** The alarm clock rings from `at` until `until` (cut short by a snooze). */
  alarm?: { at: number; until: number } | null;
}

/** The room's idle surprises, in the original's order (`FacilityRoom.PopulatePacingActions`). */
export type Surprise = 'lights' | 'alarm';

// ---- The room ----

export type DefuserMode = 'rotate' | 'random' | 'volunteer';

export interface Settings {
  /** Seconds, 30–600 in 30 s steps. */
  time: number;
  /** 3–11, a needy module counted among them. */
  modules: number;
  hardcore: boolean;
  needy: boolean;
  /** Up to 3 module kinds left out. */
  vetoes: SolvableKind[];
  defuserMode: DefuserMode;
  expertsSeeClock: boolean;
  table: 'manual' | 'bomb';
  /** Lights out and the alarm clock while the bomb is going well (missing in rooms saved before: on). */
  surprises?: boolean;
  /** A bomb binder mission instead of Free Play (missing or null: Free Play). */
  mission?: string | null;
  /**
   * The different manual: the printed one (missing), a new manual each bomb, or one kept all
   * night.
   */
  manual?: ManualMode;
  /** The experts' interactive helpers (maze tracer, wire lookups); missing: off. */
  helpers?: boolean;
}

export type ManualMode = 'printed' | 'each' | 'night';

/** A manual page: a module kind, or the appendix. */
export type PageId = Kind | 'appendix';

export interface BombResult {
  no: number;
  /** The mission played (missing: Free Play). */
  mission?: string | null;
  defuser: PlayerId;
  how: 'defused' | 'strikes' | 'time';
  left: number;
  strikes: number;
  modules: number;
  solved: number;
}

export interface Player {
  id: PlayerId;
  name: string;
}

/**
 * How the defuser is looking at the bomb, for a table screen showing it: their own choice of
 * view (3D, the default, or the flat 2D one) and, in 3D, the pose (on the desk, held, zoomed to
 * a module) and the quarter turn they settled on.
 */
export interface Look {
  mode: '3d' | '2d';
  pose: 'desk' | 'held' | 'module';
  /** Degrees, a multiple of 90. */
  yaw: number;
  /** The settled tilt: 0 level, ±80/±90 to show the top or bottom edge. */
  settle: number;
  module: string | null;
}

export interface State {
  phase: 'lobby' | 'playing' | 'over';
  stage: 'lobby' | 'bomb' | 'result';
  settings: Settings;
  /** Seated players (at most 12), in seat order; the rest watch. */
  seats: Player[];
  watchers: Player[];
  /** This bomb's defuser, or the next bomb's in the lobby and on the results. */
  defuser: PlayerId | null;
  volunteers: PlayerId[];
  bombNo: number;
  bomb: Bomb | null;
  claims: Partial<Record<PageId, PlayerId[]>>;
  notes: Partial<Record<PageId, string>>;
  history: BombResult[];
  /** The defuser's view of the live bomb (missing in rooms saved before, and between bombs). */
  look?: Look | null;
  /** The table screen's volumes, from the host's sliders (missing in rooms saved before). */
  tableVolumes?: TableVolumes;
  /** Hidden: seeds the next bomb. */
  seed: number;
  /** Hidden: the seed of the manual kept all night ("Same manual all night"). */
  nightManual?: number | null;
}

// ---- Actions ----

export type ModuleOp =
  | { op: 'cut'; wire: number }
  | { op: 'down' }
  | { op: 'up' }
  | { op: 'tap' }
  | { op: 'press'; button: number }
  | { op: 'dial'; by: 1 | -1 }
  | { op: 'tx' }
  | { op: 'next' }
  | { op: 'back' }
  | { op: 'move'; dir: Dir }
  | { op: 'spin'; column: number; by: 1 | -1 }
  | { op: 'submit' }
  | { op: 'answer'; yes: boolean }
  | { op: 'turn' };

export type Action =
  | { type: 'settings'; settings: Partial<Settings> }
  | { type: 'set-defuser'; player: PlayerId }
  | { type: 'volunteer'; on: boolean }
  | { type: 'start' }
  | ({ type: 'act'; module: string; at?: number } & ModuleOp)
  | { type: 'claim'; page: PageId; on: boolean }
  | { type: 'note'; page: PageId; text: string }
  | { type: 'hand-over'; player: PlayerId }
  | ({ type: 'look' } & Look)
  | { type: 'table-volume'; volumes: TableVolumes }
  /** The defuser presses the alarm clock's snooze button (`AlarmClock.ButtonDown`). */
  | { type: 'alarm' }
  | { type: 'next' }
  | { type: 'lobby' }
  /** Playtest bots only: "still thinking", always refused so the bot looks again shortly. */
  | { type: 'ponder' };
