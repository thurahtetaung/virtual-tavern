import { describe, expect, it } from 'vitest';
import { codenames } from './game.ts';
import { insights } from './insights.ts';
import { HOST, NOW, OP, SPY, type Harness, cardsOf, startedGame } from './test-utils.ts';
import type { CodenamesAction, CodenamesState, Team } from './types.ts';

/** Applies an action through the harness and returns what it reported. */
function step(h: Harness, action: CodenamesAction, by: string = HOST) {
  const before = h.state;
  h.act(action, by);
  return insights(before, h.state, action, by);
}

describe('insights', () => {
  it('reports a clue with its giver', () => {
    const h = startedGame();
    expect(step(h, { type: 'give-clue', word: 'ocean', count: 2 }, SPY.red)).toEqual([
      {
        type: 'clue',
        playerId: SPY.red,
        words: [{ kind: 'clue', word: 'ocean' }],
        props: { word: 'ocean', count: 2, team: 'red' },
      },
    ]);
  });

  it('reports a right guess', () => {
    const h = startedGame();
    step(h, { type: 'give-clue', word: 'ocean', count: 2 }, SPY.red);
    const card = cardsOf(h.state, 'red')[0]!;
    const word = h.state.board[card]!.word;
    expect(step(h, { type: 'guess', card }, OP.red)).toEqual([
      {
        type: 'guess',
        playerId: OP.red,
        words: [{ kind: 'guess', word }],
        props: {
          word,
          kind: 'red',
          correct: true,
          team: 'red',
          clueWord: 'ocean',
          clueCount: 2,
          guessNo: 1,
        },
      },
    ]);
  });

  it('reports a wrong guess and the turn it ended', () => {
    const h = startedGame();
    step(h, { type: 'give-clue', word: 'ocean', count: 2 }, SPY.red);
    const card = cardsOf(h.state, 'bystander')[0]!;
    const word = h.state.board[card]!.word;
    expect(step(h, { type: 'guess', card }, OP.red)).toEqual([
      {
        type: 'guess',
        playerId: OP.red,
        words: [{ kind: 'guess', word }],
        props: {
          word,
          kind: 'bystander',
          correct: false,
          team: 'red',
          clueWord: 'ocean',
          clueCount: 2,
          guessNo: 1,
        },
      },
      { type: 'end-turn', props: { reason: 'wrong-guess', team: 'red', stage: 'guess' } },
    ]);
  });

  it('reports an assassin hit and the other team winning', () => {
    const h = startedGame();
    step(h, { type: 'give-clue', word: 'ocean', count: 1 }, SPY.red);
    const card = cardsOf(h.state, 'assassin')[0]!;
    const word = h.state.board[card]!.word;
    expect(step(h, { type: 'guess', card }, OP.red)).toEqual([
      {
        type: 'guess',
        playerId: OP.red,
        words: [
          { kind: 'guess', word },
          { kind: 'assassin', word },
        ],
        props: {
          word,
          kind: 'assassin',
          correct: false,
          team: 'red',
          clueWord: 'ocean',
          clueCount: 1,
          guessNo: 1,
        },
      },
      {
        type: 'outcome',
        winners: [SPY.blue, OP.blue],
        props: {
          winner: 'blue',
          winReason: 'assassin',
          startingTeam: 'red',
          redLeft: 9,
          blueLeft: 8,
          spymasters: [SPY.red, SPY.blue],
        },
      },
    ]);
  });

  it('reports a pass', () => {
    const h = startedGame();
    step(h, { type: 'give-clue', word: 'ocean', count: 2 }, SPY.red);
    step(h, { type: 'guess', card: cardsOf(h.state, 'red')[0]! }, OP.red);
    expect(step(h, { type: 'end-turn' }, OP.red)).toEqual([
      {
        type: 'end-turn',
        playerId: OP.red,
        props: { reason: 'passed', team: 'red', stage: 'guess' },
      },
    ]);
  });

  it('reports a strict timeout from the deadline, with nobody acting', () => {
    const h = startedGame({ clueSeconds: 30, timerMode: 'strict' });
    const before = h.state;
    const after = codenames.onDeadline!(before, NOW + 30_000);
    expect(insights(before, after, null, null)).toEqual([
      { type: 'end-turn', props: { reason: 'timeout', team: 'red', stage: 'clue' } },
    ]);
  });

  it('reports nothing for lobby moves, marks, starting or leaving a game', () => {
    const h = startedGame();
    step(h, { type: 'give-clue', word: 'ocean', count: 2 }, SPY.red);
    expect(step(h, { type: 'toggle-suggestion', card: 0 }, OP.red)).toEqual([]);
    expect(step(h, { type: 'back-to-lobby' })).toEqual([]);
    expect(step(h, { type: 'join-team', team: 'blue', role: 'operative' }, 'p4')).toEqual([]);
    expect(step(h, { type: 'start' })).toEqual([]);
  });

  it('reports an all-agents win once, crediting the whole winning team', () => {
    const events = playWholeGame().events;
    expect(events.filter((e) => e.type === 'outcome')).toEqual([
      {
        type: 'outcome',
        winners: [SPY.red, OP.red],
        props: {
          winner: 'red',
          winReason: 'all-agents',
          startingTeam: 'red',
          redLeft: 0,
          blueLeft: expect.any(Number) as number,
          spymasters: [SPY.red, SPY.blue],
        },
      },
    ]);
    // Every guess knows the clue it followed and its place in the turn.
    for (const g of events.filter((e) => e.type === 'guess')) {
      expect(typeof g.props?.clueWord).toBe('string');
      expect(typeof g.props?.guessNo).toBe('number');
    }
    expect(events.filter((e) => e.type === 'end-turn' && e.playerId)).not.toHaveLength(0);
    expect(events.filter((e) => e.type === 'clue')).toHaveLength(5);
    expect(events.filter((e) => e.type === 'guess')).toHaveLength(13);
    expect(events.filter((e) => e.type === 'end-turn')).toHaveLength(4);
  });

  it('never throws, whatever two states of a game it is handed', () => {
    const { states } = playWholeGame();
    for (const a of states) {
      for (const b of states) {
        expect(() => insights(a, b, null, null)).not.toThrow();
      }
    }
  });
});

/** A scripted game (as in game.test.ts), then a rematch start, recording every state. */
function playWholeGame() {
  const h = startedGame();
  const states: CodenamesState[] = [h.state];
  const events: ReturnType<typeof insights> = [];
  const run = (action: CodenamesAction, by: string) => {
    events.push(...step(h, action, by));
    states.push(h.state);
  };
  const per: Record<Team, number> = { red: 3, blue: 2 };
  while (h.state.phase === 'playing') {
    const team = h.state.turn!.team;
    const count = Math.min(per[team], cardsOf(h.state, team).length);
    run({ type: 'give-clue', word: `hint${states.length}`, count }, SPY[team]);
    for (const card of cardsOf(h.state, team).slice(0, count)) {
      run({ type: 'guess', card }, OP[team]);
    }
    if (h.state.phase === 'playing' && h.state.turn!.team === team) {
      run({ type: 'end-turn' }, OP[team]);
    }
  }
  run({ type: 'start' }, HOST);
  run({ type: 'back-to-lobby' }, HOST);
  return { states, events };
}
