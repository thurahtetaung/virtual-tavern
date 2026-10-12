import { playWithBots } from '@vt/game-sdk';
import type { MasqueradeView } from '@vt/game-masquerade/logic';
import { describe, expect, it } from 'vitest';
import { masqueradeOriginals } from './index.ts';

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));

describe('Masquerade Originals bots', () => {
  it('inherit Masquerade’s bot and play whole games', () => {
    expect(typeof masqueradeOriginals.bot).toBe('function');
    for (const seed of [1, 2, 3]) {
      const r = playWithBots(masqueradeOriginals, seats(5), {
        seed,
        maxSteps: 4000,
        host: (v: MasqueradeView) =>
          v.phase === 'lobby'
            ? { type: 'start' }
            : v.round?.stage === 'reveal'
              ? { type: 'next-round' }
              : null,
      });
      expect(r.refused).toEqual([]);
      expect(r.over).toBe(true);
    }
  });
});
