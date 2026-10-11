import { describe, expect, it } from 'vitest';
import { buildGames } from './registry.ts';

describe('game guides', () => {
  it.each([...buildGames().values()].map((g) => [g.id, g] as const))(
    '%s has a quick start of 5 or 6 short bullets',
    (_id, game) => {
      const quick = game.guide.quickStart ?? [];
      expect(quick.length).toBeGreaterThanOrEqual(5);
      expect(quick.length).toBeLessThanOrEqual(6);
      for (const line of quick) expect(line.length).toBeLessThanOrEqual(160);
    },
  );
});
