import { describe, expect, it } from 'vitest';
import { royalPost } from './game.ts';
import { insights } from './insights.ts';
import { HOST, THREE, type Harness, harness, leave, rig, startedGame } from './test-utils.ts';
import type { RoyalPostAction } from './types.ts';

function table(edition: 'classic' | '2019' = 'classic') {
  const h = startedGame(THREE, edition);
  h.state = { ...h.state, round: { ...h.state.round!, order: [...THREE], current: HOST } };
  return h;
}

/** Runs an action and returns what it reported. */
function step(h: Harness, action: RoyalPostAction, by = HOST) {
  const before = h.state;
  h.act(action, by);
  return insights(before, h.state, action, by);
}

describe('insights', () => {
  it('reports nothing for lobby moves and a game start', () => {
    const h = harness();
    const before = h.state;
    h.act({ type: 'update-settings', edition: '2019' });
    expect(insights(before, h.state, null, HOST)).toEqual([]);
    const lobby = h.state;
    h.act({ type: 'start' });
    expect(insights(lobby, h.state, { type: 'start' }, HOST)).toEqual([]);
  });

  it('reports each card played, Guard guesses and knock-outs by card', () => {
    const h = rig(table(), {
      hands: { host: ['guard', 'priest'], ana: ['princess'], ben: ['baron'] },
    });
    expect(step(h, { type: 'play', card: 'guard', target: 'ana', guess: 'princess' })).toEqual([
      {
        type: 'play',
        playerId: HOST,
        props: {
          card: 'guard',
          edition: 'classic',
          noEffect: false,
          target: 'ana',
          tie: false,
          auto: false,
        },
      },
      {
        type: 'guard',
        playerId: HOST,
        props: { hit: true, guess: 'princess', edition: 'classic' },
      },
      {
        type: 'elimination',
        playerId: 'ana',
        props: {
          cause: 'guard',
          by: HOST,
          lostPrincess: true,
          edition: 'classic',
          cards: ['princess'],
        },
      },
    ]);
    // A miss is a Guard guess too; a Priest is just a card played, and its result stays private.
    const g = rig(table(), { hands: { host: ['guard', 'priest'], ana: ['king'], ben: ['baron'] } });
    expect(
      step(g, { type: 'play', card: 'guard', target: 'ana', guess: 'baron' })[1],
    ).toMatchObject({
      type: 'guard',
      props: { hit: false },
    });
    const p = rig(table(), { hands: { host: ['priest', 'guard'], ana: ['king'], ben: ['baron'] } });
    const peek = step(p, { type: 'play', card: 'priest', target: 'ana' });
    expect(peek).toEqual([
      {
        type: 'play',
        playerId: HOST,
        props: {
          card: 'priest',
          edition: 'classic',
          noEffect: false,
          target: 'ana',
          tie: false,
          auto: false,
        },
      },
    ]);
    expect(JSON.stringify(peek)).not.toContain('king');
  });

  it('marks a Princess played away as a fumble', () => {
    const h = rig(table(), {
      hands: { host: ['princess', 'guard'], ana: ['king'], ben: ['baron'] },
    });
    const events = step(h, { type: 'play', card: 'princess' });
    expect(events.find((e) => e.type === 'elimination')).toMatchObject({
      playerId: HOST,
      props: { cause: 'princess', lostPrincess: true },
    });
  });

  it('reports round winners, the Spy bonus and the game result', () => {
    const h = rig(table('2019'), {
      hands: { host: ['handmaid', 'priest'], ana: ['king'], ben: ['baron'] },
      discards: { ben: ['spy'] },
      deck: [],
    });
    h.state = {
      ...h.state,
      seats: { ...h.state.seats, ana: { ...h.state.seats.ana!, tokens: 4 } },
    };
    const events = step(h, { type: 'play', card: 'handmaid' });
    expect(events.filter((e) => e.type !== 'play')).toEqual([
      {
        type: 'round',
        props: {
          edition: '2019',
          round: 1,
          reason: 'deck-empty',
          roundWinners: ['ana'],
          spy: 'ben',
          survivors: ['host', 'ana', 'ben'],
          finalCards: ['priest', 'king', 'baron'],
          tokensTo: ['ana', 'ben'],
        },
      },
      { type: 'spy', playerId: 'ben', props: { edition: '2019' } },
      {
        type: 'outcome',
        winners: ['ana'],
        props: {
          edition: '2019',
          rounds: 1,
          target: 5,
          endReason: 'target',
          ranking: ['ana', 'ben', 'host'],
          tokens: [5, 1, 0],
        },
      },
    ]);
    // Round winners are props, never `winners`: only the game's outcome credits a win.
    expect(events.filter((e) => e.winners)).toHaveLength(1);
  });

  it('does not count a player leaving as a knock-out', () => {
    const h = rig(table(), {
      hands: { host: ['handmaid', 'priest'], ana: ['king'], ben: ['baron'] },
    });
    const before = h.state;
    leave(h, 'ben');
    expect(insights(before, h.state, null, null)).toEqual([]);
    expect(royalPost.view(h.state, HOST).log.at(-1)).toMatchObject({ kind: 'out', cause: 'left' });
  });
});
