// The bomb binder's missions (the original's `Mission` assets, in its table of contents' order):
// each one's time, strikes and module pools as its `GeneratorSetting` has them. Names come from
// the manifest; here a mission is only its section and place.
import type { Kind, NeedyKind, SolvableKind } from './types.ts';

/** `MissionUtil.GetSpecialComponentList`: every solvable kind, in the original's order. */
export const ANY: SolvableKind[] = [
  'button',
  'keypad',
  'maze',
  'memory',
  'morse',
  'password',
  'simon',
  'complicated-wires',
  'whos-on-first',
  'wires',
  'wire-sequence',
];
/** Every needy kind, in the original's order. */
export const ANY_NEEDY: NeedyKind[] = ['capacitor', 'knob', 'venting-gas'];

export interface Pool {
  count: number;
  kinds: Kind[];
}

export interface Mission {
  /** `s<section>-<place>`. */
  id: string;
  section: number;
  /** Seconds. */
  time: number;
  strikes: number;
  /** Modules on the front face only (`FrontFaceOnly`). */
  front?: boolean;
  /** Seconds of bomb time before needy modules wake (`TimeBeforeNeedyActivation`; 90 if missing). */
  needyAfter?: number;
  /** The room's surprises (`PacingEventsEnabled`). */
  pacing?: boolean;
  pools: Pool[];
}

export const MISSIONS: Mission[] = [
  {
    id: 's1-1',
    section: 1,
    time: 300,
    strikes: 3,
    front: true,
    pools: [
      { count: 1, kinds: ['wires'] },
      { count: 1, kinds: ['button'] },
      { count: 1, kinds: ['keypad'] },
    ],
  },
  {
    id: 's2-1',
    section: 2,
    time: 300,
    strikes: 3,
    front: true,
    pools: [
      { count: 2, kinds: ['wires', 'button', 'keypad'] },
      { count: 1, kinds: ['memory', 'maze', 'simon'] },
    ],
  },
  {
    id: 's2-2',
    section: 2,
    time: 300,
    strikes: 3,
    pools: [
      { count: 2, kinds: ['wires'] },
      { count: 2, kinds: ['button'] },
      { count: 2, kinds: ['keypad'] },
    ],
  },
  {
    id: 's2-3',
    section: 2,
    time: 300,
    strikes: 3,
    front: true,
    pools: [
      { count: 2, kinds: ['wires', 'button', 'keypad'] },
      { count: 1, kinds: ['whos-on-first', 'memory'] },
      { count: 1, kinds: ['simon', 'maze'] },
    ],
  },
  {
    id: 's2-4',
    section: 2,
    time: 180,
    strikes: 3,
    front: true,
    pools: [
      { count: 1, kinds: ['wires', 'button', 'keypad'] },
      { count: 2, kinds: ['simon', 'whos-on-first', 'maze', 'memory'] },
    ],
  },
  {
    id: 's3-1',
    section: 3,
    time: 300,
    strikes: 3,
    pacing: true,
    pools: [
      { count: 1, kinds: ['simon', 'whos-on-first', 'memory'] },
      { count: 1, kinds: ['wires', 'button'] },
      { count: 1, kinds: ['password', 'morse'] },
    ],
  },
  {
    id: 's3-2',
    section: 3,
    time: 300,
    strikes: 3,
    pacing: true,
    pools: [
      { count: 1, kinds: ['wires'] },
      { count: 1, kinds: ['complicated-wires', 'wire-sequence'] },
      { count: 1, kinds: ['memory', 'simon'] },
    ],
  },
  {
    id: 's3-3',
    section: 3,
    time: 300,
    strikes: 3,
    pacing: true,
    pools: [
      { count: 1, kinds: ['maze', 'simon', 'whos-on-first', 'memory'] },
      { count: 2, kinds: ['wire-sequence', 'complicated-wires', 'password', 'morse'] },
      { count: 1, kinds: ['button', 'keypad'] },
    ],
  },
  {
    id: 's3-4',
    section: 3,
    time: 300,
    strikes: 3,
    pacing: true,
    pools: [
      { count: 2, kinds: ['button', 'simon', 'memory', 'maze', 'wires', 'keypad'] },
      { count: 1, kinds: ['complicated-wires', 'wire-sequence'] },
      { count: 1, kinds: ['morse', 'password'] },
      { count: 1, kinds: ['whos-on-first', 'memory'] },
    ],
  },
  {
    id: 's3-5',
    section: 3,
    time: 150,
    strikes: 3,
    pacing: true,
    pools: [
      { count: 4, kinds: ['wires', 'button', 'keypad'] },
      { count: 1, kinds: ['whos-on-first', 'maze'] },
    ],
  },
  {
    id: 's3-6',
    section: 3,
    time: 300,
    strikes: 1,
    pacing: true,
    pools: [
      { count: 2, kinds: ['wires'] },
      { count: 1, kinds: ['keypad', 'button'] },
      { count: 1, kinds: ['memory'] },
      { count: 1, kinds: ['whos-on-first'] },
    ],
  },
  {
    id: 's3-7',
    section: 3,
    time: 480,
    strikes: 3,
    pacing: true,
    pools: [
      { count: 1, kinds: ['wires'] },
      { count: 1, kinds: ['button'] },
      { count: 1, kinds: ['keypad'] },
      { count: 1, kinds: ['simon', 'whos-on-first'] },
      { count: 1, kinds: ['morse', 'complicated-wires'] },
      { count: 1, kinds: ['memory', 'maze'] },
      { count: 1, kinds: ['wire-sequence', 'password'] },
      { count: 1, kinds: ['morse', 'maze', 'wire-sequence', 'complicated-wires', 'password'] },
    ],
  },
  {
    id: 's4-1',
    section: 4,
    time: 300,
    strikes: 1,
    pools: [
      { count: 4, kinds: ['wires', 'button', 'keypad'] },
      { count: 1, kinds: ['capacitor'] },
      { count: 1, kinds: ['complicated-wires', 'whos-on-first'] },
    ],
  },
  {
    id: 's4-2',
    section: 4,
    time: 300,
    strikes: 1,
    pools: [
      { count: 2, kinds: ['wires', 'keypad', 'button'] },
      { count: 1, kinds: ['whos-on-first', 'memory'] },
      { count: 1, kinds: ['maze', 'password', 'simon'] },
      { count: 1, kinds: ['venting-gas', 'capacitor'] },
    ],
  },
  {
    id: 's4-3',
    section: 4,
    time: 300,
    strikes: 1,
    pacing: true,
    pools: [
      { count: 1, kinds: ['wires'] },
      { count: 1, kinds: ['complicated-wires', 'wire-sequence'] },
      { count: 1, kinds: ['memory', 'whos-on-first'] },
      { count: 2, kinds: ['keypad'] },
      { count: 1, kinds: ['knob'] },
    ],
  },
  {
    id: 's4-4',
    section: 4,
    time: 300,
    strikes: 1,
    needyAfter: 0,
    pacing: true,
    pools: [
      { count: 1, kinds: ['venting-gas'] },
      { count: 1, kinds: ['keypad'] },
      { count: 1, kinds: ['password'] },
      { count: 1, kinds: ['maze', 'wire-sequence'] },
      { count: 2, kinds: ['capacitor'] },
    ],
  },
  {
    id: 's5-1',
    section: 5,
    time: 300,
    strikes: 3,
    pacing: true,
    pools: [
      { count: 2, kinds: ['wires'] },
      { count: 2, kinds: ['wire-sequence'] },
      { count: 2, kinds: ['complicated-wires'] },
    ],
  },
  {
    id: 's5-2',
    section: 5,
    time: 300,
    strikes: 1,
    needyAfter: 0,
    pools: [
      { count: 5, kinds: ['venting-gas'] },
      { count: 1, kinds: ['simon'] },
      { count: 1, kinds: ['password'] },
      { count: 1, kinds: ['maze'] },
    ],
  },
  {
    id: 's5-3',
    section: 5,
    time: 210,
    strikes: 1,
    pools: [{ count: 4, kinds: ['whos-on-first'] }],
  },
  {
    id: 's5-4',
    section: 5,
    time: 300,
    strikes: 3,
    pacing: true,
    pools: [
      { count: 1, kinds: ['whos-on-first', 'maze', 'memory', 'simon'] },
      { count: 1, kinds: ['wire-sequence', 'complicated-wires'] },
      { count: 1, kinds: ['password', 'morse'] },
      { count: 2, kinds: ['wires', 'button', 'keypad'] },
      { count: 1, kinds: ANY_NEEDY },
    ],
  },
  {
    id: 's5-5',
    section: 5,
    time: 90,
    strikes: 1,
    pacing: true,
    pools: [
      { count: 3, kinds: ['wires', 'button', 'keypad'] },
      { count: 1, kinds: ['simon', 'password', 'morse', 'whos-on-first', 'memory', 'maze'] },
    ],
  },
  {
    id: 's5-6',
    section: 5,
    time: 360,
    strikes: 3,
    pools: [
      { count: 1, kinds: ['wires'] },
      { count: 1, kinds: ['button'] },
      { count: 1, kinds: ['keypad'] },
      { count: 1, kinds: ['simon'] },
      { count: 1, kinds: ['whos-on-first'] },
      { count: 1, kinds: ['memory'] },
      { count: 1, kinds: ['morse'] },
      { count: 1, kinds: ['complicated-wires'] },
      { count: 1, kinds: ['wire-sequence'] },
      { count: 1, kinds: ['maze'] },
      { count: 1, kinds: ['password'] },
    ],
  },
  {
    id: 's6-1',
    section: 6,
    time: 80,
    strikes: 1,
    pools: [
      { count: 1, kinds: ['complicated-wires'] },
      { count: 1, kinds: ['wires', 'button'] },
      { count: 1, kinds: ['keypad'] },
      { count: 1, kinds: ['wire-sequence'] },
    ],
  },
  {
    id: 's6-2',
    section: 6,
    time: 300,
    strikes: 1,
    pools: [
      { count: 1, kinds: ['knob'] },
      { count: 1, kinds: ['venting-gas', 'capacitor'] },
      { count: 1, kinds: ['simon'] },
      { count: 1, kinds: ['morse'] },
      { count: 1, kinds: ['wires', 'button', 'keypad'] },
      { count: 2, kinds: ['whos-on-first', 'memory', 'maze', 'password'] },
      { count: 1, kinds: ['complicated-wires', 'wire-sequence'] },
    ],
  },
  {
    id: 's6-3',
    section: 6,
    time: 300,
    strikes: 1,
    pools: [
      { count: 2, kinds: ['knob'] },
      { count: 6, kinds: ANY },
    ],
  },
  {
    id: 's6-4',
    section: 6,
    time: 300,
    strikes: 1,
    pacing: true,
    pools: [
      { count: 10, kinds: ANY },
      { count: 1, kinds: ANY_NEEDY },
    ],
  },
  {
    id: 's7-1',
    section: 7,
    time: 90,
    strikes: 1,
    front: true,
    pools: [{ count: 5, kinds: ['simon'] }],
  },
  {
    id: 's7-2',
    section: 7,
    time: 180,
    strikes: 1,
    pools: [{ count: 11, kinds: ['complicated-wires'] }],
  },
  {
    id: 's7-3',
    section: 7,
    time: 180,
    strikes: 1,
    pools: [{ count: 8, kinds: ['maze'] }],
  },
  {
    id: 's7-4',
    section: 7,
    time: 180,
    strikes: 1,
    pools: [{ count: 6, kinds: ['wire-sequence'] }],
  },
  {
    id: 's7-5',
    section: 7,
    time: 240,
    strikes: 1,
    pools: [{ count: 9, kinds: ['password'] }],
  },
  {
    id: 's7-6',
    section: 7,
    time: 180,
    strikes: 1,
    pools: [
      { count: 3, kinds: ['simon'] },
      { count: 3, kinds: ['morse'] },
    ],
  },
];

export const SECTIONS = [...new Set(MISSIONS.map((m) => m.section))];

export const missionById = (id: string | null | undefined): Mission | null =>
  MISSIONS.find((m) => m.id === id) ?? null;

/** Its place in the binder ("3.2"). */
export const missionNumber = (m: Pick<Mission, 'id'>) => m.id.slice(1).replace('-', '.');

export const moduleCount = (m: Mission) => m.pools.reduce((n, p) => n + p.count, 0);
