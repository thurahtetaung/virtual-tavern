import type { InsightEvent } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { echo } from './game.ts';
import { insights } from './insights.ts';
import {
  FOUR,
  HOST,
  type Harness,
  NOW,
  THREE,
  secret,
  startedGame,
  toGuess,
  turn,
} from './test-utils.ts';
import type { EchoState } from './types.ts';

/** Reports every action the harness applies from now on, and keeps every state it passes. */
function record(h: Harness) {
  const events: InsightEvent[] = [];
  const states: EchoState[] = [h.state];
  const act = h.act.bind(h);
  h.act = (action, by = HOST, now = NOW) => {
    const before = h.state;
    const after = act(action, by, now);
    events.push(...insights(before, after, action, by));
    states.push(after);
    return after;
  };
  const fire = (now: number) => {
    const before = h.state;
    h.state = echo.onDeadline!(before, now);
    events.push(...insights(before, h.state, null, null));
    states.push(h.state);
  };
  /** Events since the last call. */
  const take = () => events.splice(0);
  return { take, states, fire };
}

describe('insights', () => {
  it('reports nothing until the card is resolved', () => {
    const h = startedGame();
    const { take } = record(h);
    toGuess(h);
    expect(take()).toEqual([]);
  });

  it('reports a right guess with every clue', () => {
    const h = startedGame();
    const { take } = record(h);
    h.act({ type: 'pick', index: 2 });
    h.act({ type: 'give-clues', clues: ['apple'] }, 'p2');
    h.act({ type: 'give-clues', clues: ['pear'] }, 'p3');
    h.act({ type: 'give-clues', clues: ['plum'] }, 'p4');
    const word = secret(h);
    h.act({ type: 'guess', word });
    expect(take()).toEqual([
      {
        type: 'card',
        playerId: HOST,
        words: [
          { kind: 'clue', word: 'apple' },
          { kind: 'clue', word: 'pear' },
          { kind: 'clue', word: 'plum' },
          { kind: 'guess', word },
        ],
        props: {
          word,
          outcome: 'right',
          countedBy: null,
          clueCount: 3,
          cancelledCount: 0,
          survivors: ['p2', 'p3', 'p4'],
          survivorWords: ['apple', 'pear', 'plum'],
          givers: ['p2', 'p3', 'p4'],
          auto: false,
        },
      },
    ]);
  });

  it('reports cancelled clues and who echoed whom', () => {
    const h = startedGame();
    const { take } = record(h);
    h.act({ type: 'pick', index: 0 });
    h.act({ type: 'give-clues', clues: ['Moon'] }, 'p2');
    h.act({ type: 'give-clues', clues: ['tide'] }, 'p3');
    h.act({ type: 'give-clues', clues: ['moons'] }, 'p4');
    const word = secret(h);
    h.act({ type: 'pass' });
    expect(take()).toEqual([
      {
        type: 'card',
        playerId: HOST,
        words: [
          { kind: 'clue', word: 'Moon' },
          { kind: 'clue', word: 'tide' },
          { kind: 'clue', word: 'moons' },
          { kind: 'cancelled', word: 'Moon' },
          { kind: 'cancelled', word: 'moons' },
        ],
        props: {
          word,
          outcome: 'pass',
          countedBy: null,
          clueCount: 3,
          cancelledCount: 2,
          survivors: ['p3'],
          survivorWords: ['tide'],
          givers: ['p2', 'p3', 'p4'],
          auto: false,
        },
      },
      { type: 'match', props: { a: 'p2', b: 'p4', word: 'Moon' } },
    ]);
  });

  it('reports one match per pair, and none for a player cancelling only themselves', () => {
    const h = startedGame(THREE);
    const { take } = record(h);
    h.act({ type: 'pick', index: 0 });
    h.act({ type: 'give-clues', clues: ['Moon', 'star'] }, 'p2');
    h.act({ type: 'give-clues', clues: ['moons', 'STARS'] }, 'p3');
    h.act({ type: 'pass' });
    expect(take().filter((e) => e.type === 'match')).toEqual([
      { type: 'match', props: { a: 'p2', b: 'p3', word: 'Moon' } },
      { type: 'match', props: { a: 'p2', b: 'p3', word: 'star' } },
    ]);
  });

  it('reports a timed-out pass from the deadline', () => {
    const h = startedGame(FOUR, { guessSeconds: 30, clueSeconds: 30, timerMode: 'strict' });
    const { take, fire } = record(h);
    toGuess(h);
    fire(turn(h).deadline!);
    expect(take()[0]).toMatchObject({ type: 'card', props: { outcome: 'pass', auto: true } });
  });

  it('reports a finished game, crediting everyone playing', () => {
    const h = startedGame();
    const { take, states } = record(h);
    while (h.state.phase === 'playing') {
      toGuess(h);
      h.act({ type: 'guess', word: secret(h) }, turn(h).guesser);
      h.act({ type: 'next-card' });
    }
    const events = take();
    expect(events.filter((e) => e.type === 'card')).toHaveLength(8);
    expect(events.filter((e) => e.type === 'outcome')).toEqual([
      {
        type: 'outcome',
        winners: FOUR,
        props: { score: 8, deckSize: 8, endReason: 'finished' },
      },
    ]);
    h.act({ type: 'start' });
    h.act({ type: 'back-to-lobby' });
    expect(take()).toEqual([]);
    // Never throws, whatever two states of a game it is handed.
    for (const a of states) {
      for (const b of states) expect(() => insights(a, b, null, null)).not.toThrow();
    }
  });

  it('credits nobody when the game ends for lack of players', () => {
    const h = startedGame(THREE);
    const before = h.state;
    const after = echo.playerLeft(before, 'p3', NOW);
    expect(insights(before, after, null, null)).toEqual([
      {
        type: 'outcome',
        winners: [],
        props: { score: 0, deckSize: 8, endReason: 'too-few' },
      },
    ]);
  });
});
