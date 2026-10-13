import { createRng } from '@vt/game-sdk';
import { shortFuse } from '@vt/private-short-fuse/logic';
import { describe, expect, it } from 'vitest';
import { buildGames } from './registry.ts';

describe('Short Fuse test rig', () => {
  it('is off unless a test server asks for it', () => {
    expect(process.env.SHORT_FUSE_TEST_RIG).toBeUndefined();
    expect(buildGames().get('short-fuse')).toBe(shortFuse);
    const content = { wordLists: () => [], words: () => [] };
    const state = shortFuse.create({ now: 0, rng: createRng(1), content }, [
      { id: 'a', name: 'A' },
    ]);
    expect(shortFuse.view(state, 'a').rigAllowed).toBe(false);
    const rig = shortFuse.reduce(
      state,
      { type: 'rig', hands: [], top: [], first: 0 },
      {
        now: 0,
        rng: createRng(1),
        content,
        by: 'a',
        isHost: true,
      },
    );
    expect(rig).toMatchObject({ code: 'no-rig' });
  });
});
