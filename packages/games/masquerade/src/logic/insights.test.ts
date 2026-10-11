import { describe, expect, it } from 'vitest';
import { locationById } from '../content/locations.ts';
import { insightsFor } from './insights.ts';
import { FOUR, HOST, type Harness, allReady, harness, rig, startedGame } from './test-utils.ts';
import type { MasqueradeAction } from './types.ts';

const insights = insightsFor((id) => locationById(id)?.name ?? id);

function step(h: Harness, action: MasqueradeAction, by = HOST) {
  const before = h.state;
  h.act(action, by);
  return insights(before, h.state, action, by);
}

function table(rounds: number | null = null) {
  const h = startedGame(FOUR, { rounds });
  return rig(h, { spies: ['cy'], location: 'bakery' });
}

describe('insights', () => {
  it('reports nothing in the lobby, at the start, or while the round is secret', () => {
    const h = harness();
    const before = h.state;
    h.act({ type: 'update-settings', roundSeconds: 240 });
    expect(insights(before, h.state, null, HOST)).toEqual([]);
    expect(step(h, { type: 'start' })).toEqual([]);
    rig(h, { spies: ['cy'], location: 'bakery' });
    allReady(h);
    expect(step(h, { type: 'vote', target: 'cy' }, 'ana')).toEqual([]);
  });

  it('reports the round, the spy and every vote once it is revealed', () => {
    const h = allReady(table());
    step(h, { type: 'vote', target: 'cy' }, HOST);
    step(h, { type: 'vote', target: 'cy' }, 'ana');
    step(h, { type: 'vote', target: 'ana' }, 'ben');
    expect(step(h, { type: 'vote', target: 'ben' }, 'cy')).toEqual([]);
    expect(step(h, { type: 'spy-guess', location: 'gym' }, 'cy')).toEqual([
      {
        type: 'round',
        words: [{ kind: 'clue', word: 'Bakery' }],
        props: {
          location: 'Bakery',
          spyWon: false,
          spies: 1,
          players: 4,
          round: 1,
          named: ['cy'],
          starter: 'cy',
          pointsTo: [HOST, 'ana', 'ben', 'cy'],
          points: [2, 2, 1, 0],
        },
      },
      {
        type: 'spy',
        playerId: 'cy',
        words: [{ kind: 'guess', word: 'Gym' }],
        props: { outcome: 'caught', votes: 2, location: 'Bakery', round: 1 },
      },
      { type: 'vote', playerId: HOST, props: { hit: true, target: 'cy', round: 1 } },
      { type: 'vote', playerId: 'ana', props: { hit: true, target: 'cy', round: 1 } },
      { type: 'vote', playerId: 'ben', props: { hit: false, target: 'ana', round: 1 } },
      { type: 'vote', playerId: 'cy', props: { hit: false, target: 'ben', round: 1 } },
    ]);
  });

  it('reports an escape and the end of the game', () => {
    const h = allReady(table(1));
    step(h, { type: 'vote', target: 'ana' }, HOST);
    step(h, { type: 'vote', target: 'ben' }, 'ana');
    step(h, { type: 'vote', target: 'ana' }, 'ben');
    const events = step(h, { type: 'vote', target: 'ana' }, 'cy');
    expect(events[0]).toMatchObject({ type: 'round', props: { spyWon: true } });
    expect(events[1]).toEqual({
      type: 'spy',
      playerId: 'cy',
      props: { outcome: 'escaped', votes: 0, location: 'Bakery', round: 1 },
    });
    expect(events.at(-1)).toEqual({
      type: 'outcome',
      winners: ['cy'],
      props: { rounds: 1, ranking: ['cy', HOST, 'ana', 'ben'], scores: [2, 0, 0, 0] },
    });
  });
});
