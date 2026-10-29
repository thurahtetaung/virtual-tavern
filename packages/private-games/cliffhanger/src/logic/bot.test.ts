import { playWithBots } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { hostMove } from './bot.ts';
import { cliffhanger } from './definition.ts';
import { progress } from './genres.ts';
import { content, films, ids } from './test-utils.ts';

describe('bots', () => {
  it.each([4, 6, 9, 16])('%i bots play a game to the end', (n) => {
    const result = playWithBots(
      cliffhanger,
      ids(n).map((id) => ({ id, name: id.toUpperCase() })),
      { seed: n, content: content(), maxSteps: 4000, host: hostMove },
    );
    expect(result.over).toBe(true);
    expect(result.state.endReason).toBe('won');
    // Bots only ever act on their own view: a refusal is a stale move after someone else's.
    const codes = new Set(result.refused.map((r) => r.code));
    for (const code of codes) expect(['wrong-stage', 'not-your-steal', 'no-hand']).toContain(code);
  });

  it('bots play TV shows too', () => {
    const result = playWithBots(
      cliffhanger,
      ids(4).map((id) => ({ id, name: id.toUpperCase() })),
      {
        seed: 3,
        content: content(),
        maxSteps: 4000,
        host: (view) =>
          view.phase === 'lobby' && view.settings.deck !== 'tv'
            ? { type: 'update-settings', deck: 'tv' }
            : hostMove(view),
      },
    );
    expect(result.over).toBe(true);
    expect(result.state.goal).toBe('tv');
  });

  it('bots play the host’s own goal: five genres, two of each', () => {
    const picked = ['action', 'horror', 'heart', 'remakes', 'adult'];
    const result = playWithBots(
      cliffhanger,
      ids(6).map((id) => ({ id, name: id.toUpperCase() })),
      {
        seed: 5,
        content: content({ films: films(20) }),
        maxSteps: 6000,
        host: (view) =>
          view.phase === 'lobby' && view.target.genres.length !== picked.length
            ? { type: 'update-settings', genres: picked, each: 2 }
            : hostMove(view),
      },
    );
    expect(result.over).toBe(true);
    expect(result.state.target).toEqual({ genres: picked, each: 2 });
    expect(result.state.deck.every((c) => picked.includes(c.genre))).toBe(true);
    const w = result.state.winner!;
    const p = progress(
      result.state.collections[w].map((c) => c.genre),
      result.state.target!,
    );
    expect(p).toEqual({ have: 10, need: 10 });
  });
});
