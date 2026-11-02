import { type BotCtx, playWithBots } from '@vt/game-sdk';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { redHerring } from './game.ts';
import type { RedHerringAction, RedHerringView } from './types.ts';

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));

const host = (v: RedHerringView, _me?: string): RedHerringAction | null => {
  if (v.phase === 'lobby') return { type: 'start' };
  const stage = v.game?.round.stage;
  if (v.phase !== 'playing') return null;
  if (stage === 'discuss') return { type: 'end-discussion' };
  if (stage === 'reveal') return { type: 'next-round' };
  return null;
};

describe('Red Herring bots', () => {
  it('see only their own seat’s view', () => {
    expectTypeOf<Parameters<NonNullable<typeof redHerring.bot>>>().toEqualTypeOf<
      [RedHerringView, BotCtx]
    >();
  });

  it('play whole games at every table size with no refused move', () => {
    for (let n = 4; n <= 10; n++) {
      for (const seed of [1, 2, 3]) {
        const r = playWithBots(redHerring, seats(n), { seed, host, maxSteps: 5000 });
        expect(r.refused).toEqual([]);
        expect(r.over).toBe(true);
        expect(r.state.game?.history).toHaveLength(n < 5 ? 2 * n : n);
      }
    }
  }, 60_000);

  it('play the open vote in turn and No Discussion too', () => {
    const r = playWithBots(redHerring, seats(5), {
      seed: 9,
      maxSteps: 5000,
      host: (v, me) =>
        v.phase === 'lobby' && !v.settings.openVote
          ? { type: 'update-settings', openVote: true, noDiscussion: true }
          : host(v, me),
    });
    expect(r.refused).toEqual([]);
    expect(r.over).toBe(true);
  });
});
