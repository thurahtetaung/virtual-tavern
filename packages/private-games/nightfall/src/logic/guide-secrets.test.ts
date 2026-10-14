import { withoutSecrets } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { guide } from './guide.ts';
import { table } from './test-utils.ts';

describe('the rules drawer in a room', () => {
  it('keeps every seat’s card, wake step and notes secret until they peek', () => {
    const h = table({ players: ['werewolf', 'seer', 'robber', 'troublemaker', 'villager'] });
    for (const step of [null, 'seer']) {
      if (step) h.toStep(step);
      const hidden = h.ids.map((id) => {
        const ctx = guide.room!(h.view(id), id)!;
        expect(ctx.secret).toBe(true);
        expect(ctx.you?.tile).toBe(h.role(id));
        expect(ctx.stepNotes).toBeDefined();
        return JSON.stringify(withoutSecrets(ctx));
      });
      for (const json of hidden) expect(json).toBe(hidden[0]);
      expect(hidden[0]).not.toMatch(/"you"|stepNotes|You were dealt|you wake/i);
    }
    expect(guide.room!(h.view(null), 'watcher')?.you).toBeUndefined();
  });
});
