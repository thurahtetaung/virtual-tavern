import type { InsightEvent } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { reverie } from './game.ts';
import { insights } from './insights.ts';
import {
  FOUR,
  HOST,
  type Harness,
  NOW,
  startedGame,
  storyIndex,
  tellAndGive,
  voteAll,
} from './test-utils.ts';
import type { ReverieState } from './types.ts';

const THREE = [HOST, 'ana', 'ben'];

/** Reports every action the harness applies from now on, and keeps every state it passes. */
function record(h: Harness) {
  const events: InsightEvent[] = [];
  const states: ReverieState[] = [h.state];
  const act = h.act.bind(h);
  h.act = (action, by = HOST, now = NOW) => {
    const before = h.state;
    const after = act(action, by, now);
    events.push(...insights(before, after, action, by));
    states.push(after);
    return after;
  };
  /** Events since the last call. */
  const take = () => events.splice(0);
  return { take, states };
}

describe('insights', () => {
  it('reports nothing while the clue, cards and votes are still secret', () => {
    const h = startedGame();
    const { take } = record(h);
    tellAndGive(h);
    h.act({ type: 'vote', index: storyIndex(h) }, 'ana');
    expect(take()).toEqual([]);
  });

  it('reports the story and every vote at the reveal', () => {
    const h = startedGame();
    const { take } = record(h);
    tellAndGive(h, 'a quiet harbour');
    take();
    const anaCard = h.state.turn!.table.findIndex((t) => t.owner === 'ana');
    h.act({ type: 'vote', index: storyIndex(h) }, 'ana');
    h.act({ type: 'vote', index: anaCard }, 'ben');
    h.act({ type: 'vote', index: anaCard }, 'cy');
    const events = take();
    expect(events.filter((e) => e.type !== 'score')).toEqual([
      {
        type: 'story',
        playerId: HOST,
        words: [{ kind: 'story', word: 'a quiet harbour' }],
        props: { clue: 'a quiet harbour', allOrNone: false, round: 1, found: 1, voters: 3 },
      },
      { type: 'vote', playerId: 'ana', props: { found: true, owner: HOST } },
      { type: 'vote', playerId: 'ben', props: { found: false, owner: 'ana' } },
      { type: 'vote', playerId: 'cy', props: { found: false, owner: 'ana' } },
    ]);
    // Storyteller and Ana's finder score 3; Ana's card drew two votes (+2).
    expect(events.filter((e) => e.type === 'score')).toEqual([
      {
        type: 'score',
        playerId: HOST,
        props: { round: 1, points: 3, votesReceived: 1, total: 3, storyteller: true },
      },
      {
        type: 'score',
        playerId: 'ana',
        props: { round: 1, points: 5, votesReceived: 2, total: 5, storyteller: false },
      },
      {
        type: 'score',
        playerId: 'ben',
        props: { round: 1, points: 0, votesReceived: 0, total: 0, storyteller: false },
      },
      {
        type: 'score',
        playerId: 'cy',
        props: { round: 1, points: 0, votesReceived: 0, total: 0, storyteller: false },
      },
    ]);
  });

  it('reports an all-or-none story', () => {
    const h = startedGame();
    const { take } = record(h);
    tellAndGive(h);
    voteAll(h, ['ana', 'ben', 'cy']);
    expect(take()[0]).toMatchObject({ type: 'story', props: { allOrNone: true, found: 3 } });
  });

  it('reports a reveal forced by the vote timer, with only those who voted', () => {
    const h = startedGame(FOUR, { guessSeconds: 60, timerMode: 'strict' });
    tellAndGive(h);
    h.act({ type: 'vote', index: storyIndex(h) }, 'ana');
    const before = h.state;
    const after = reverie.onDeadline!(before, reverie.nextDeadline!(before)!);
    expect(insights(before, after, null, null).filter((e) => e.type !== 'score')).toEqual([
      {
        type: 'story',
        playerId: HOST,
        words: [{ kind: 'story', word: 'moonlight' }],
        props: { clue: 'moonlight', allOrNone: false, round: 1, found: 1, voters: 1 },
      },
      { type: 'vote', playerId: 'ana', props: { found: true, owner: HOST } },
    ]);
    // Moving the timer on from the reveal reports it no second time.
    expect(insights(after, reverie.onDeadline!(after, NOW + 10 ** 9), null, null)).toEqual([]);
  });

  it('reports the result once, when someone reaches the target', () => {
    const h = startedGame(FOUR, { targetScore: 15 });
    const { take, states } = record(h);
    while (h.state.phase === 'playing') {
      tellAndGive(h);
      voteAll(h, ['ana', 'ben', 'cy']);
      h.act({ type: 'next-turn' });
    }
    const events = take();
    const turns = h.state.turn!.round;
    expect(events.filter((e) => e.type === 'story')).toHaveLength(turns);
    expect(events.filter((e) => e.type === 'vote')).toHaveLength(turns * 3);
    expect(events.filter((e) => e.type === 'score')).toHaveLength(turns * 4);
    const ranking = Object.entries(h.state.seats)
      .sort((a, b) => b[1].score - a[1].score)
      .map(([id]) => id);
    expect(events.filter((e) => e.type === 'outcome')).toEqual([
      {
        type: 'outcome',
        winners: h.state.winners,
        props: {
          target: 15,
          endReason: 'target',
          ranking,
          scores: ranking.map((id) => h.state.seats[id]!.score),
        },
      },
    ]);
    // The last score event of each player carries their final total.
    const last = new Map(
      events.filter((e) => e.type === 'score').map((e) => [e.playerId, e.props!.total]),
    );
    for (const id of ranking) expect(last.get(id)).toBe(h.state.seats[id]!.score);
    expect(h.state.winners.length).toBeGreaterThan(0);
    h.act({ type: 'start' });
    h.act({ type: 'back-to-lobby' });
    expect(take()).toEqual([]);
    // Never throws, whatever two states of a game it is handed.
    for (const a of states) {
      for (const b of states) expect(() => insights(a, b, null, null)).not.toThrow();
    }
  });

  it('reports a game that ends with too few players', () => {
    const h = startedGame(THREE);
    tellAndGive(h);
    voteAll(h, ['ana', 'ben']);
    h.act({ type: 'sit', playing: false }, 'ben');
    const { take } = record(h);
    h.act({ type: 'next-turn' });
    expect(take()).toEqual([
      {
        type: 'outcome',
        winners: ['ana'],
        props: { target: 30, endReason: 'too-few', ranking: ['ana', HOST], scores: [2, 0] },
      },
    ]);
  });
});
