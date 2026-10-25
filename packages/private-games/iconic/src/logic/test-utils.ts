import { type ContentProvider, GameError, createRng } from '@vt/game-sdk';
import { iconic } from './game.ts';
import type { IconicAction, IconicState, Settings } from './types.ts';

export const NOW = 1_000_000;
export const HOST = 'p1';
export const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

const listWords = (prefix: string, n: number) =>
  Array.from({ length: n }, (_, i) => `${prefix} ${String.fromCharCode(97 + (i % 26))}${i}`);

/** Three made-up lists, one per level, with names that say their level. */
export const LISTS: Record<string, string[]> = {
  e: listWords('easy', 30),
  h: listWords('hard', 30),
  c: listWords('tough', 30),
};

export const content: ContentProvider = {
  wordLists: () => [
    { id: 'e', name: 'Test: Easy', wordCount: 30, games: ['iconic'] },
    { id: 'h', name: 'Test: Hard', wordCount: 30, games: ['iconic'] },
    { id: 'c', name: 'Test: Challenging', wordCount: 30, games: ['iconic'] },
  ],
  words: (listIds) => listIds.flatMap((id) => LISTS[id] ?? []),
};

export interface Harness {
  state: IconicState;
  now: number;
  act(by: string, action: IconicAction): IconicState;
  refuse(by: string, action: IconicAction): string;
  /** Runs the deadline due next (moving the clock to it). */
  tick(): IconicState;
  /** Moves the clock on by `ms` without running anything. */
  wait(ms: number): void;
}

export function harness(n = 4, seed = 7, settings: Partial<Settings> = {}): Harness {
  const rng = createRng(seed);
  const run = (state: IconicState, action: IconicAction, by: string) =>
    iconic.reduce(state, action, { by, isHost: by === HOST, now: h.now, rng, content });
  const h: Harness = {
    now: NOW,
    state: iconic.create(
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
      return r.code;
    },
    tick() {
      const at = iconic.nextDeadline!(h.state);
      if (at === null) throw new Error('no deadline');
      h.now = Math.max(h.now, at);
      h.state = iconic.onDeadline!(h.state, h.now);
      return h.state;
    },
    wait(ms) {
      h.now += ms;
    },
  };
  const { lists, ...rest } = settings;
  if (Object.keys(rest).length) h.act(HOST, { type: 'update-settings', ...rest });
  if (lists)
    for (const [level, ids] of Object.entries(lists))
      h.act(HOST, { type: 'update-settings', lists: { level: level as 'easy', ids } });
  return h;
}

/** A started game whose first clue giver is `first` (the round re-dealt for them). */
export function started(
  n = 4,
  opts: { first?: string; seed?: number; settings?: Partial<Settings> } = {},
) {
  const h = harness(n, opts.seed ?? 7, opts.settings);
  h.act(HOST, { type: 'start' });
  if (opts.first) {
    const s = structuredClone(h.state);
    const g = s.game!;
    const size = g.round.givers.length;
    const at = g.order.indexOf(opts.first);
    g.round.givers = Array.from({ length: size }, (_, i) => g.order[(at + i) % g.order.length]!);
    h.state = s;
  }
  return h;
}

export const round = (h: Harness) => h.state.game!.round;
export const giver = (h: Harness) => round(h).givers[0]!;
export const guessersOf = (h: Harness) =>
  h.state.game!.order.filter((id) => !round(h).givers.includes(id) && round(h).helper !== id);

/** Chooses the card's word at `index` (a pair proposes and agrees). */
export function chooseWord(h: Harness, index = 0) {
  const [a, b] = round(h).givers;
  h.act(a!, { type: 'pick', index });
  if (b) h.act(b, { type: 'agree' });
  return round(h).answer!.word;
}

/** Plays a word to a right guess by `by` (or the first guesser), through the undo window. */
export function guessRight(h: Harness, by?: string) {
  const word = chooseWord(h);
  const g = giver(h);
  h.act(g, { type: 'place', set: 'main', icon: 1 });
  const who = by ?? guessersOf(h)[0]!;
  h.act(who, { type: 'guess', text: word });
  const id = round(h).guesses.at(-1)!.id;
  h.act(g, { type: 'award', guess: id });
  h.tick();
}
