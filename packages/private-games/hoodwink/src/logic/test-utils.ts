import {
  type ContentProvider,
  GameError,
  type Question,
  type QuestionDeckSummary,
  createRng,
} from '@vt/game-sdk';
import { hoodwink } from './game.ts';
import type { HoodwinkAction, HoodwinkState, Round } from './types.ts';

export const NOW = 1_000_000;
export const HOST = 'host';

/** Made-up questions about made-up things, so tests never carry real content. */
export function makeQuestions(deckId: string, count: number): Question[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${deckId}:${i}`,
    deckId,
    prompt: `The fictional town of Zorbly ${i} is famous for its annual ___ festival.`,
    answer: `Pickle ${deckId} ${i}`,
    alternates: [`Pickled ${deckId} ${i}`],
  }));
}

export interface FakeDeck extends QuestionDeckSummary {
  questions: Question[];
}

export const deck = (id: string, count: number, adult = false): FakeDeck => ({
  id,
  name: id.toUpperCase(),
  description: `Made-up deck ${id}`,
  questionCount: count,
  adult,
  questions: makeQuestions(id, count),
});

/** A made-up deck whose questions all share one answer and carry the given built-in fakes. */
export function lureDeck(decoys: string[] | undefined, id = 'lure'): FakeDeck {
  return {
    ...deck(id, 0),
    questionCount: 5,
    questions: Array.from({ length: 5 }, (_, i) => ({
      id: `${id}:${i}`,
      deckId: id,
      prompt: `In the made-up land of Quux ${i}, people greet each other by waving a ___.`,
      answer: 'Wooden spoon',
      alternates: ['Ladle'],
      ...(decoys ? { decoys } : {}),
    })),
  };
}

export const DECKS = [deck('odd', 12), deck('wild', 6), deck('late', 4, true)];

/** A fake ContentProvider over small made-up decks. */
export function content(decks: FakeDeck[] = DECKS): ContentProvider {
  return {
    wordLists: () => [],
    words: () => [],
    questionDecks: () => decks.map(({ questions: _q, ...summary }) => summary),
    questions: (ids) => decks.filter((d) => ids.includes(d.id)).flatMap((d) => d.questions),
  };
}

export interface Harness {
  state: HoodwinkState;
  provider: ContentProvider;
  act(action: HoodwinkAction, by?: string, now?: number): HoodwinkState;
  reject(action: HoodwinkAction, by?: string): GameError;
}

export function harness(players: string[], provider = content(), seed = 7): Harness {
  const rng = createRng(seed);
  const run = (state: HoodwinkState, action: HoodwinkAction, by: string, now: number) =>
    hoodwink.reduce(state, action, { by, isHost: by === HOST, now, rng, content: provider });
  const h: Harness = {
    provider,
    state: hoodwink.create(
      { now: NOW, rng, content: provider },
      players.map((id) => ({ id, name: id.toUpperCase() })),
    ),
    act(action, by = HOST, now = NOW) {
      const result = run(h.state, action, by, now);
      if (result instanceof GameError)
        throw new Error(`${action.type} by ${by}: ${result.code}: ${result.message}`);
      h.state = result;
      return result;
    },
    reject(action, by = HOST) {
      const result = run(h.state, action, by, NOW);
      if (!(result instanceof GameError))
        throw new Error(`expected ${action.type} by ${by} to be rejected`);
      return result;
    },
  };
  return h;
}

export const FOUR = [HOST, 'p2', 'p3', 'p4'];
export const THREE = [HOST, 'p2', 'p3'];

export function startedGame(
  players = FOUR,
  opts: {
    rounds?: 5 | 7 | 10;
    clueSeconds?: number;
    guessSeconds?: number;
    timerMode?: 'soft' | 'strict';
    provider?: ContentProvider;
  } = {},
) {
  const h = harness(players, opts.provider);
  h.act({
    type: 'update-settings',
    rounds: opts.rounds ?? 5,
    clueSeconds: opts.clueSeconds ?? null,
    guessSeconds: opts.guessSeconds ?? null,
    timerMode: opts.timerMode ?? 'soft',
  });
  h.act({ type: 'start' });
  return h;
}

export const round = (h: Harness): Round => h.state.round!;
export const answer = (h: Harness) => round(h).question.answer;
export const truthIndex = (h: Harness) => round(h).options.findIndex((o) => o.truth);
/** The board index of the lie written (or co-written) by `author`. */
export const lieOf = (h: Harness, author: string) =>
  round(h).options.findIndex((o) => o.authors.includes(author));

/** Every round player writes a distinct lie ("lie host", "lie p2"…). */
export function writeAll(h: Harness, now = NOW) {
  for (const id of round(h).players) h.act({ type: 'lie', text: `lie ${id}` }, id, now);
  return h.state;
}

/** Every voter picks the truth. */
export function voteTruth(h: Harness, now = NOW) {
  for (const id of round(h).voters) h.act({ type: 'vote', option: truthIndex(h) }, id, now);
  return h.state;
}

/** Plays a whole round where everyone finds the truth, then the host moves on. */
export function playRound(h: Harness) {
  writeAll(h);
  voteTruth(h);
  h.act({ type: 'next-round' });
}
