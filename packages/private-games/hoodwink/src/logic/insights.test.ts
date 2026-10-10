import type { InsightEvent } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { hoodwink } from './game.ts';
import { insights } from './insights.ts';
import {
  FOUR,
  HOST,
  type Harness,
  NOW,
  THREE,
  lieOf,
  playRound,
  round,
  startedGame,
  truthIndex,
  writeAll,
} from './test-utils.ts';
import type { HoodwinkState } from './types.ts';

/** Reports every action the harness applies from now on, and keeps every state it passes. */
function record(h: Harness) {
  const events: InsightEvent[] = [];
  const states: HoodwinkState[] = [h.state];
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
    h.state = hoodwink.onDeadline!(before, now);
    events.push(...insights(before, h.state, null, null));
    states.push(h.state);
  };
  /** Events since the last call. */
  const take = () => events.splice(0);
  return { take, states, fire };
}

describe('insights', () => {
  it('reports nothing until the reveal', () => {
    const h = startedGame();
    const { take } = record(h);
    writeAll(h);
    h.act({ type: 'vote', option: truthIndex(h) }, HOST);
    expect(take()).toEqual([]);
  });

  it('reports every lie, every vote and the round at the reveal', () => {
    const h = startedGame();
    const { take } = record(h);
    h.act({ type: 'lie', text: 'Cheese' }, HOST);
    h.act({ type: 'lie', text: 'cheese' }, 'p2');
    h.act({ type: 'lie', text: 'Goat' }, 'p3');
    h.act({ type: 'lie', text: 'Kite' }, 'p4');
    const { question } = round(h);
    h.act({ type: 'vote', option: lieOf(h, 'p3') }, HOST);
    h.act({ type: 'vote', option: truthIndex(h) }, 'p2');
    h.act({ type: 'vote', option: lieOf(h, HOST) }, 'p3');
    h.act({ type: 'vote', option: lieOf(h, HOST) }, 'p4');
    const events = take();
    const lies = events.filter((e) => e.type === 'lie');
    expect(lies).toHaveLength(3);
    expect(lies).toEqual(
      expect.arrayContaining([
        {
          type: 'lie',
          playerId: HOST,
          words: [{ kind: 'guess', word: 'Cheese' }],
          props: { fooled: 2, authors: [HOST, 'p2'], auto: false },
        },
        {
          type: 'lie',
          playerId: 'p3',
          words: [{ kind: 'guess', word: 'Goat' }],
          props: { fooled: 1, authors: ['p3'], auto: false },
        },
        {
          type: 'lie',
          playerId: 'p4',
          words: [{ kind: 'guess', word: 'Kite' }],
          props: { fooled: 0, authors: ['p4'], auto: false },
        },
      ]),
    );
    expect(events.filter((e) => e.type === 'vote')).toEqual([
      { type: 'vote', playerId: HOST, props: { foundTruth: false } },
      { type: 'vote', playerId: 'p2', props: { foundTruth: true } },
      { type: 'vote', playerId: 'p3', props: { foundTruth: false } },
      { type: 'vote', playerId: 'p4', props: { foundTruth: false } },
    ]);
    expect(events.at(-1)).toEqual({
      type: 'round',
      props: {
        questionId: question.id,
        deckId: question.deckId,
        truthFound: 1,
        liesCount: 3,
        house: 0,
      },
    });
    h.act({ type: 'next-round' });
    expect(take()).toEqual([]);
  });

  it('reports a round with no lies after a strict timeout', () => {
    const h = startedGame(FOUR, { clueSeconds: 30, timerMode: 'strict' });
    const { take, fire } = record(h);
    fire(round(h).deadline!);
    expect(take()).toEqual([
      {
        type: 'round',
        props: {
          questionId: round(h).question.id,
          deckId: round(h).question.deckId,
          truthFound: 0,
          liesCount: 0,
          house: 0,
        },
      },
    ]);
  });

  it('reports a finished game, crediting the top scorers', () => {
    const h = startedGame(FOUR, { rounds: 5 });
    const { take, states } = record(h);
    for (let i = 0; i < 4; i++) playRound(h);
    writeAll(h);
    h.act({ type: 'vote', option: lieOf(h, 'p3') }, HOST);
    for (const id of ['p2', 'p3', 'p4']) h.act({ type: 'vote', option: truthIndex(h) }, id);
    h.act({ type: 'next-round' });
    const events = take();
    expect(events.filter((e) => e.type === 'round')).toHaveLength(5);
    expect(events.filter((e) => e.type === 'outcome')).toEqual([
      {
        type: 'outcome',
        winners: ['p3'],
        props: { rounds: 5, endReason: 'finished' },
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
    playRound(h);
    const before = h.state;
    const after = hoodwink.playerLeft(before, 'p3', NOW);
    expect(insights(before, after, null, null)).toEqual([
      { type: 'outcome', winners: [], props: { rounds: 1, endReason: 'too-few' } },
    ]);
  });
});
