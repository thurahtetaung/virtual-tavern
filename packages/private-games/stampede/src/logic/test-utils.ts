import {
  type ContentProvider,
  GameError,
  type OpenQuestion,
  type QuestionDeckSummary,
  createRng,
} from '@vt/game-sdk';
import { stampede } from './game.ts';
import type { StampedeAction, StampedeState } from './types.ts';

// Made-up questions only: real decks are private and never committed.
export const NOW = 1_000_000;
export const HOST = 'p1';
export const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

export interface TestDeck {
  summary: QuestionDeckSummary;
  questions: OpenQuestion[];
}

export function deck(id: string, count: number, adult = false): TestDeck {
  return {
    summary: { id, name: `Deck ${id}`, questionCount: count, ...(adult ? { adult } : {}) },
    questions: Array.from({ length: count }, (_, i) => ({
      id: `${id}:${i}`,
      deckId: id,
      prompt: `Pretend question ${i} from ${id}?`,
    })),
  };
}

export function content(decks: TestDeck[] = [deck('d1', 20)]): ContentProvider {
  return {
    wordLists: () => [],
    words: () => [],
    questionDecks: () => decks.map((d) => d.summary),
    openQuestions: (deckIds) =>
      decks.filter((d) => deckIds.includes(d.summary.id)).flatMap((d) => d.questions),
  };
}

export interface Harness {
  state: StampedeState;
  now: number;
  act(by: string, action: StampedeAction): StampedeState;
  refuse(by: string, action: StampedeAction): string;
  /** Runs the deadline due next (moving the clock to it). */
  tick(): StampedeState;
  /** The host for this harness (the room host as the shell would report it). */
  host: string;
}

export function harness(
  n = 4,
  opts: { seed?: number; decks?: TestDeck[]; settings?: Partial<StampedeState['settings']> } = {},
): Harness {
  const rng = createRng(opts.seed ?? 7);
  const provider = content(opts.decks);
  const run = (state: StampedeState, action: StampedeAction, by: string) =>
    stampede.reduce(state, action, {
      by,
      isHost: by === h.host,
      now: h.now,
      rng,
      content: provider,
    });
  const h: Harness = {
    now: NOW,
    host: HOST,
    state: stampede.create(
      { now: NOW, rng, content: provider },
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
      const at = stampede.nextDeadline!(h.state);
      if (at === null) throw new Error('no deadline');
      h.now = Math.max(h.now, at);
      h.state = stampede.onDeadline!(h.state, h.now);
      return h.state;
    },
  };
  // Join everyone, as the room does, so seats are filled before any action.
  for (const id of ids(n)) h.state = stampede.playerJoined(h.state, { id, name: id.toUpperCase() });
  if (opts.settings && Object.keys(opts.settings).length)
    h.act(HOST, { type: 'update-settings', ...opts.settings });
  return h;
}

/** A started game. */
export function started(n = 4, opts: Parameters<typeof harness>[1] = {}): Harness {
  const h = harness(n, opts);
  h.act(HOST, { type: 'start' });
  return h;
}

/** Everyone answers (by seat order, `answers[i]` for `p{i+1}`; undefined skips that player). */
export function answerAll(h: Harness, answers: (string | undefined)[]): void {
  answers.forEach((text, i) => {
    if (text !== undefined) h.act(`p${i + 1}`, { type: 'answer', text });
  });
}

/** One whole round: answers (the host continues without anyone left out), then the reveal. */
export function playRound(h: Harness, answers: (string | undefined)[]): StampedeState {
  answerAll(h, answers);
  if (h.state.round?.stage === 'answer') h.act(h.host, { type: 'continue-without' });
  return h.state;
}

/** Next question (host). */
export const next = (h: Harness) => h.act(h.host, { type: 'next-round' });

export const cows = (h: Harness) =>
  Object.fromEntries(Object.entries(h.state.scores).map(([id, s]) => [id, s.cows]));
