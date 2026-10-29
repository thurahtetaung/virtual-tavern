import { type ContentProvider, GameError, createRng } from '@vt/game-sdk';
import { cliffhanger } from './definition.ts';
import { BASE_GENRES, FILM_GENRE_IDS, TV_GENRE_IDS } from './genres.ts';
import type { CliffhangerAction, CliffhangerState, Settings } from './types.ts';

// Made-up titles and categories only: the real packs are private and never committed.
export const NOW = 1_000_000;
export const HOST = 'p1';
export const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

/** `n` made-up films per genre, genre by genre round the list (so the deck mixes them). */
export function films(perGenre = 12, genres: readonly string[] = FILM_GENRE_IDS) {
  const out: { title: string; genre: string; tier?: 'easy' | 'medium' }[] = [];
  for (let i = 0; i < perGenre; i++) {
    for (const g of genres) {
      out.push({
        title: `Pretend ${g} ${i}`,
        genre: g,
        ...(i % 2 === 0 ? { tier: 'easy' as const } : {}),
      });
    }
  }
  return out;
}

export const CATEGORIES = Array.from({ length: 30 }, (_, i) => `Made-up category ${i}`);

export interface Packs {
  films?: unknown;
  categories?: unknown;
  shows?: unknown;
  tvCategories?: unknown;
}

export function content(packs: Packs = {}): ContentProvider {
  const data: Record<string, { id: string; name: string; data: unknown }[]> = {
    films: [{ id: 'f1', name: 'Test films', data: { films: packs.films ?? films() } }],
    categories: [
      { id: 'c1', name: 'Test categories', data: { categories: packs.categories ?? CATEGORIES } },
    ],
    shows: [
      { id: 's1', name: 'Test shows', data: { shows: packs.shows ?? films(12, TV_GENRE_IDS) } },
    ],
    'tv-categories': [
      {
        id: 't1',
        name: 'Test TV categories',
        data: { categories: packs.tvCategories ?? CATEGORIES },
      },
    ],
  };
  return { wordLists: () => [], words: () => [], contentPacks: (kind) => data[kind] ?? [] };
}

export interface Harness {
  state: CliffhangerState;
  now: number;
  act(by: string, action: CliffhangerAction): CliffhangerState;
  refuse(by: string, action: CliffhangerAction): string;
  /** Runs the deadline due next (moving the clock to it). */
  tick(): CliffhangerState;
  /** Moves the clock on without running any deadline. */
  wait(ms: number): void;
  host: string;
}

export function harness(
  n = 4,
  opts: { seed?: number; packs?: Packs; settings?: Partial<Settings> } = {},
): Harness {
  const rng = createRng(opts.seed ?? 7);
  const provider = content(opts.packs);
  const run = (state: CliffhangerState, action: CliffhangerAction, by: string) =>
    cliffhanger.reduce(state, action, {
      by,
      isHost: by === h.host,
      now: h.now,
      rng,
      content: provider,
    });
  const h: Harness = {
    now: NOW,
    host: HOST,
    state: cliffhanger.create({ now: NOW, rng, content: provider }, []),
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
      const at = cliffhanger.nextDeadline!(h.state);
      if (at === null) throw new Error('no deadline');
      h.now = Math.max(h.now, at);
      h.state = cliffhanger.onDeadline!(h.state, h.now);
      return h.state;
    },
    wait(ms) {
      h.now += ms;
    },
  };
  for (const id of ids(n))
    h.state = cliffhanger.playerJoined(h.state, { id, name: id.toUpperCase() });
  if (opts.settings && Object.keys(opts.settings).length) {
    h.act(HOST, { type: 'update-settings', ...opts.settings });
  }
  return h;
}

/** A started game, at its first face-off (the countdown run). */
export function started(n = 4, opts: Parameters<typeof harness>[1] = {}): Harness {
  const h = harness(n, opts);
  h.act(HOST, { type: 'start' });
  if (h.state.round?.stage === 'countdown') h.tick();
  return h;
}

/** The face-off's two players: `[first, second]` (a's, then b's). */
export const pair = (h: Harness) => [h.state.round!.pair.a, h.state.round!.pair.b] as const;

/** Plays the face-off: `winner` answers first, then the other runs out of time. */
export function winFaceOff(h: Harness, winner: string): void {
  h.act(winner, { type: 'said' });
  h.tick();
}

/** The winner keeps their first three as they are, the loser too; then the countdown runs. */
export function keepAndPlace(h: Harness): void {
  const r = h.state.round!;
  const winner = r.faceoffResult!.winner;
  h.act(winner, { type: 'lock' });
  if (h.state.round!.stage === 'countdown') h.tick();
}

/** Every card the describer can get now, own first. */
export function gettable(h: Harness): string[] {
  const r = h.state.round!;
  const turn = r.turn!;
  const own = r.board[turn.team]!.filter((s) => !s.got).map((s) => s.card.id);
  if (own.length) return own;
  const theirs = r.board[turn.team === 'a' ? 'b' : 'a'] ?? [];
  return turn.stealOpen ? theirs.filter((s) => !s.got).map((s) => s.card.id) : [];
}

export { BASE_GENRES };
