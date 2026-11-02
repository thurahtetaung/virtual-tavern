import { describe, expect, it } from 'vitest';
import { redHerring } from '../logic/game.ts';
import { FOUR, HOST, harness } from '../logic/test-utils.ts';
import { cuesOf } from './Sound.tsx';

describe('the lobby', () => {
  it('is silent: no cue plays before a game starts', () => {
    const h = harness(FOUR);
    for (const id of [...FOUR, null]) {
      const v = redHerring.view(h.state, id);
      expect(v.phase).toBe('lobby');
      expect(cuesOf(v)).toEqual([]);
    }
    expect(redHerring.view(h.state, HOST).settings.sound).toBe('all');
  });
});
