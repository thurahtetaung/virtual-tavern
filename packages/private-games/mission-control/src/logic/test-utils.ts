import { type ContentProvider, GameError, createRng } from '@vt/game-sdk';
import type { CardId } from './cards.ts';
import type { Check } from './checks.ts';
import { missionControl } from './definition.ts';
import { controller, legalFor, setTestDeal } from './game.ts';
import type { Attempt, MissionControlAction, MissionControlState } from './types.ts';

export const NOW = 1_000_000;
export const HOST = 'p1';
export const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

const d = (n: number) => ({ 3: n, 4: n, 5: n });

/** Made-up task cards (the real ones are private and never committed). */
export const TASKS: {
  id: number;
  check: Check;
  difficulty: Record<3 | 4 | 5, number>;
  text: string;
  reDeal?: CardId[][];
}[] = [
  { id: 1, check: { kind: 'win-cards', cards: ['p3'] }, difficulty: d(1), text: 'Take the pink 3' },
  {
    id: 2,
    check: { kind: 'win-cards', cards: ['y1'] },
    difficulty: d(1),
    text: 'Take the yellow 1',
  },
  { id: 3, check: { kind: 'tricks', win: [1] }, difficulty: d(1), text: 'Take trick one' },
  { id: 4, check: { kind: 'trick-count', n: 0 }, difficulty: d(3), text: 'Take nothing' },
  { id: 5, check: { kind: 'win-cards', cards: ['b4'] }, difficulty: d(1), text: 'Take the blue 4' },
  {
    id: 6,
    check: { kind: 'win-count', match: { values: [7] }, op: 'atLeast', n: 2 },
    difficulty: d(2),
    text: 'Two sevens',
  },
  {
    id: 7,
    check: { kind: 'win-count', match: { values: [9] }, op: 'exactly', n: 0 },
    difficulty: d(2),
    text: 'No nines',
  },
  {
    id: 8,
    check: { kind: 'tricks', win: ['last'] },
    difficulty: d(2),
    text: 'Take the final trick',
  },
  {
    id: 9,
    check: { kind: 'predict', secret: true },
    difficulty: d(3),
    text: 'Name your tricks (hidden)',
  },
  { id: 10, check: { kind: 'predict', secret: false }, difficulty: d(3), text: 'Name your tricks' },
  {
    id: 11,
    check: { kind: 'compare', with: 'captain', op: 'more' },
    difficulty: d(2),
    text: 'Beat the boss',
  },
  { id: 12, check: { kind: 'win-cards', cards: ['t3'] }, difficulty: d(1), text: 'Take trump 3' },
  {
    id: 13,
    check: { kind: 'win-count', match: { suits: ['t'] }, op: 'exactly', n: 1 },
    difficulty: d(3),
    text: 'Exactly one trump',
    reDeal: [['t1', 't2', 't3', 't4']],
  },
  {
    id: 14,
    check: { kind: 'tricks', win: [1, 2] },
    difficulty: d(1),
    text: 'Take tricks one and two',
  },
];

export const VOYAGE = {
  key: 'test-voyage',
  name: 'Test voyage',
  missions: [
    { n: 1, title: 'First dip', difficulty: 2, rule: 'Just tasks.', story: 'A calm day.' },
    { n: 2, difficulty: 3, comms: 'currents' },
    {
      n: 3,
      difficulty: null,
      conditions: [{ check: { kind: 'balance', value: 9, gap: 2 }, text: 'Share the nines' }],
    },
    { n: 4, difficulty: 4, selection: 'free', comms: 'rapture' },
    {
      n: 5,
      difficulty: 3,
      selection: 'crew-wanted',
      wanted: 1,
      timer: { seconds: 60, untimed: { comms: 'currents' } },
    },
    { n: 6, difficulty: 3, selection: 'captain-offers' },
    { n: 7, difficulty: 3, comms: 'terrain' },
    {
      n: 8,
      difficulty: null,
      fixedTasks: [
        { check: { kind: 'win-cards', cards: ['p3'] }, text: 'Take the pink 3' },
        { check: { kind: 'tricks', win: [1] }, text: 'Take trick one' },
      ],
    },
    { n: 9, difficulty: 4, selection: 'hardest-first' },
    { n: 10, difficulty: 3, selection: 'captain-skips' },
    { n: 11, difficulty: 3, selection: 'all-to-one', commsFrom: 3 },
    { n: 12, difficulty: 4, selection: 'crew-wanted', wanted: 2 },
  ],
  epilogue: { difficulty: 5, title: 'Endless' },
};

export function packContent(tasks: unknown = TASKS, voyage: unknown = VOYAGE): ContentProvider {
  return {
    wordLists: () => [],
    words: () => [],
    contentPacks: (kind) =>
      kind === 'tasks'
        ? [{ id: 'tp', name: 'Test tasks', data: tasks }]
        : kind === 'voyage'
          ? [{ id: 'vp', name: 'Test voyage', data: voyage }]
          : [],
  };
}

export interface Harness {
  state: MissionControlState;
  now: number;
  act(by: string, action: MissionControlAction): MissionControlState;
  refuse(by: string, action: MissionControlAction): { code: string; message: string };
  tick(): MissionControlState;
}

export function harness(n = 3, seed = 7, content: ContentProvider = packContent()): Harness {
  const rng = createRng(seed);
  const run = (state: MissionControlState, action: MissionControlAction, by: string) =>
    missionControl.reduce(state, action, { by, isHost: by === HOST, now: h.now, rng, content });
  const h: Harness = {
    now: NOW,
    state: missionControl.create(
      { now: NOW, rng, content },
      ids(n).map((id) => ({ id, name: id.toUpperCase() })),
    ),
    act(by, action) {
      const r = run(h.state, action, by);
      if (r instanceof GameError)
        throw new Error(`${action.type} by ${by}: ${r.code}: ${r.message}`);
      h.state = r;
      return r;
    },
    refuse(by, action) {
      const r = run(h.state, action, by);
      if (!(r instanceof GameError))
        throw new Error(`expected ${action.type} by ${by} to be refused`);
      return { code: r.code, message: r.message };
    },
    tick() {
      const at = missionControl.nextDeadline!(h.state);
      if (at === null) throw new Error('no deadline');
      h.now = Math.max(h.now, at);
      h.state = missionControl.onDeadline!(h.state, h.now);
      return h.state;
    },
  };
  return h;
}

export const att = (h: Harness): Attempt => h.state.attempt!;

/** Everyone presses Ready on the briefing. */
export function readyAll(h: Harness) {
  for (const id of att(h).crew) if (id !== 'dummy') h.act(id, { type: 'ready' });
}

/** Starts mission `n` (or the next) and gets through the briefing into the draft. */
export function toDraft(h: Harness, n: number | null = null) {
  if (n !== null) h.act(HOST, { type: 'choose', mission: n });
  h.act(HOST, { type: 'start' });
  readyAll(h);
}

/** Normal draft: everyone takes the first task they may, in turn. */
export function draftAll(h: Harness) {
  while (att(h).stage === 'draft') {
    const a = att(h);
    const seat = a.draft.order[a.draft.at % a.draft.order.length]!;
    const by = controller(a, seat);
    const i = a.tasks.findIndex(
      (t, j) =>
        !t.crew &&
        t.owner === null &&
        !(seat === a.captain && t.check.kind === 'compare' && t.check.with === 'captain') &&
        j >= 0,
    );
    h.act(by, i < 0 ? { type: 'pass' } : { type: 'take', task: i });
  }
}

/** Everyone presses Dive (no distress), and predicts 0 if asked. */
export function dive(h: Harness) {
  for (const id of att(h).crew)
    if (id !== 'dummy' && att(h).stage === 'distress') h.act(id, { type: 'dive' });
  while (att(h).stage === 'predict') {
    const a = att(h);
    const i = a.tasks.findIndex((t) => t.check.kind === 'predict' && t.prediction === null);
    h.act(controller(a, a.tasks[i]!.owner!), { type: 'predict', task: i, n: 0 });
  }
}

/** Plays the first legal card for whoever is on turn until the attempt ends. */
export function playOut(h: Harness, pick: (legal: CardId[]) => CardId = (l) => l[0]!) {
  for (let guard = 0; guard < 80 && att(h).stage === 'play'; guard++) {
    const a = att(h);
    h.act(controller(a, a.turn), { type: 'play', card: pick(legalFor(a, a.turn)) });
  }
}

/** Fixes the next deals (and tasks) for a test; call `rig(null)` after. */
export const rig = setTestDeal;
