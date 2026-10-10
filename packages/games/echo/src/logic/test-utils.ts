import { type ContentProvider, GameError, createRng } from '@vt/game-sdk';
import { echo } from './game.ts';
import type { EchoAction, EchoState, Turn } from './types.ts';

export const NOW = 1_000_000;
export const HOST = 'host';

/** Distinct, unrelated made-up words, so no two share a comparison key by accident. */
export function words(count: number): string[] {
  const letters = 'bcdfghjklmnpqrstvwz';
  return Array.from({ length: count }, (_, i) => {
    const a = letters[i % letters.length]!;
    const b = letters[Math.floor(i / letters.length) % letters.length]!;
    return `${a}o${b}ak`;
  });
}

export function content(list = words(120)): ContentProvider {
  return {
    wordLists: () => [{ id: 'default', name: 'Default', wordCount: list.length }],
    words: (ids) => (ids.includes('default') ? list : []),
  };
}

export interface Harness {
  state: EchoState;
  act(action: EchoAction, by?: string, now?: number): EchoState;
  reject(action: EchoAction, by?: string): string;
}

export function harness(players: string[], provider = content(), seed = 7): Harness {
  const rng = createRng(seed);
  const run = (state: EchoState, action: EchoAction, by: string, now: number) =>
    echo.reduce(state, action, { by, isHost: by === HOST, now, rng, content: provider });
  const h: Harness = {
    state: echo.create(
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
      return result.code;
    },
  };
  return h;
}

export const FOUR = [HOST, 'p2', 'p3', 'p4'];
export const THREE = [HOST, 'p2', 'p3'];

/** A started game; the host guesses first (it's the first game in the room). */
export function startedGame(
  players = FOUR,
  opts: {
    deckSize?: 8 | 13 | 20;
    clueSeconds?: number;
    guessSeconds?: number;
    timerMode?: 'soft' | 'strict';
  } = {},
) {
  const h = harness(players);
  h.act({
    type: 'update-settings',
    deckSize: opts.deckSize ?? 8,
    clueSeconds: opts.clueSeconds ?? null,
    guessSeconds: opts.guessSeconds ?? null,
    timerMode: opts.timerMode ?? 'soft',
  });
  h.act({ type: 'start' });
  return h;
}

export const turn = (h: Harness): Turn => h.state.turn!;
export const secret = (h: Harness) => turn(h).card[turn(h).pick!]!;
export const givers = (h: Harness) => turn(h).givers;

/** The guesser picks the first word and every giver writes a distinct, harmless clue. */
export function toGuess(h: Harness, now = NOW) {
  h.act({ type: 'pick', index: 0 }, turn(h).guesser, now);
  const per = turn(h).perGiver;
  givers(h).forEach((g, i) => {
    const clues =
      per === 2 ? [`alpha${'x'.repeat(i)}`, `omega${'x'.repeat(i)}`] : [`clue${'x'.repeat(i)}`];
    h.act({ type: 'give-clues', clues }, g, now);
  });
  return h.state;
}
