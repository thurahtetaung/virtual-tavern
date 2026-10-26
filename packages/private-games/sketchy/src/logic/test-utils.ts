import {
  type ContentProvider,
  type Drawing,
  GameError,
  createRng,
  encodeDrawing,
} from '@vt/game-sdk';
import { sketchy } from './definition.ts';
import type { Game, SketchyAction, SketchyState, Turn } from './types.ts';

export const NOW = 1_000_000;
export const HOST = 'p1';
export const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

/** Made-up prompts and house titles (the real ones are private and never committed). */
export const PROMPTS = [
  { prompt: 'A Cat In A Hat', alternates: ['cat hat'] },
  { prompt: 'robot birthday party', alternates: ['robo birthday'] },
  { prompt: 'sad lighthouse' },
  { prompt: 'a very tall sandwich' },
  { prompt: 'dancing broccoli' },
  { prompt: '{player} at the beach' },
  { prompt: 'angry teapot' },
  { prompt: 'moon picnic' },
  { prompt: 'haunted bicycle' },
  { prompt: 'tiny volcano' },
  { prompt: 'polite shark' },
  { prompt: 'the last cookie' },
  { prompt: 'sleepy dragon' },
  { prompt: 'jazz penguin' },
  { prompt: 'upside down house' },
  { prompt: 'a wizard’s laundry' },
  { prompt: 'cloud with a job' },
  { prompt: 'banana phone' },
  { prompt: 'nervous snowman' },
  { prompt: 'spaghetti tornado' },
  { prompt: 'secret garden gnome' },
  { prompt: 'mild salsa' },
  { prompt: 'grumpy sunrise' },
  { prompt: 'knight on a scooter' },
];
export const ADULT = [{ prompt: 'spicy grown-up thing', adult: true }];
export const DECOYS = [
  'Casual Monday',
  'my uncle',
  'happiness',
  'whatever',
  'a cloud',
  'regret',
  'paprika',
  'swag',
  'doodles',
  'the future',
  'mistakes',
  'chaos',
].map((text) => ({ text }));

export function packContent(
  prompts: unknown = [...PROMPTS, ...ADULT],
  decoys: unknown = DECOYS,
): ContentProvider {
  return {
    wordLists: () => [],
    words: () => [],
    contentPacks: (kind) =>
      kind === 'prompts'
        ? [{ id: 'pack1', name: 'Test prompts', data: prompts }]
        : kind === 'decoys'
          ? [{ id: 'pack2', name: 'Test decoys', data: decoys }]
          : [],
  };
}

export const SQUIGGLE: Drawing = encodeDrawing([
  { c: 0, w: 1, points: [100, 100, 300, 400, 500, 200] },
]);

export interface Harness {
  state: SketchyState;
  now: number;
  act(by: string, action: SketchyAction): SketchyState;
  refuse(by: string, action: SketchyAction): { code: string; message: string };
  /** Runs the deadline due next (moving the clock to it). */
  tick(): SketchyState;
  wait(ms: number): void;
}

export function harness(n = 4, seed = 7, content: ContentProvider = packContent()): Harness {
  const rng = createRng(seed);
  const run = (state: SketchyState, action: SketchyAction, by: string) =>
    sketchy.reduce(state, action, { by, isHost: by === HOST, now: h.now, rng, content });
  const h: Harness = {
    now: NOW,
    state: sketchy.create(
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
      const at = sketchy.nextDeadline!(h.state);
      if (at === null) throw new Error('no deadline');
      h.now = Math.max(h.now, at);
      h.state = sketchy.onDeadline!(h.state, h.now);
      return h.state;
    },
    wait(ms) {
      h.now += ms;
    },
  };
  // Tests run on strict clocks, so a tick moves the game on; the reminder default has its own test.
  h.act(HOST, { type: 'update-settings', timerMode: 'strict' });
  return h;
}

export const game = (h: Harness): Game => h.state.game!;
export const turn = (h: Harness): Turn => h.state.game!.turn!;

/** A started game in its drawing stage. */
export function started(n = 4, seed = 7, content?: ContentProvider) {
  const h = harness(n, seed, content);
  h.act(HOST, { type: 'start' });
  return h;
}

/** Everyone in the round sends a drawing (but `skip`): the first drawing comes up. */
export function drawAll(h: Harness, skip: string[] = []) {
  for (const id of game(h).players) {
    if (!skip.includes(id)) h.act(id, { type: 'draw', drawing: SQUIGGLE });
  }
}

/** Every writer sends a lie of their own (distinct, never the truth). */
export function lieAll(h: Harness, skip: string[] = []) {
  for (const id of turn(h).writers) {
    if (!skip.includes(id)) h.act(id, { type: 'lie', text: `lie of ${id} ${game(h).at}` });
  }
}

/** The board index of the real title. */
export const truthIndex = (h: Harness) => turn(h).options.findIndex((o) => o.truth);
/** The board index of `id`'s lie. */
export const lieIndex = (h: Harness, id: string) =>
  turn(h).options.findIndex((o) => o.authors.includes(id));

/** A game at its first drawing's writing stage. */
export function writing(n = 4, seed = 7, content?: ContentProvider) {
  const h = started(n, seed, content);
  drawAll(h);
  return h;
}
