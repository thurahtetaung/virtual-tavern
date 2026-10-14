import { withoutSecrets } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { inquest } from './game.ts';
import { guide } from './guide.ts';
import { startedGame } from './test-utils.ts';

describe('the rules drawer in a room', () => {
  it('keeps every seat’s role secret until they peek', () => {
    const h = startedGame(6);
    const ids = h.game().players.map((p) => p.id);
    const roles = new Set<string>();
    const hidden = ids.map((id) => {
      const ctx = guide.room!(inquest.view(h.state, id), id)!;
      expect(ctx.secret).toBe(true);
      roles.add(ctx.you!.tile!);
      return JSON.stringify(withoutSecrets(ctx));
    });
    expect(roles.size).toBeGreaterThanOrEqual(3);
    for (const json of hidden) expect(json).toBe(hidden[0]);
    expect(hidden[0]).not.toContain('"you"');
    expect(guide.room!(inquest.view(h.state, null), 'watcher')?.you).toBeUndefined();
  });
});
