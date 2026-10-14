import { withoutSecrets } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { guide } from './guide.ts';
import { ids, rigged } from './test-utils.ts';

describe('the rules drawer in a room', () => {
  it('keeps every seat’s role secret until they peek', () => {
    const players = ids(7);
    const h = rigged(['blue', 'red', 'leader', 'blue', 'red', 'blue', 'blue']);
    const hidden = players.map((id) => {
      const ctx = guide.room!(h.view(id), id)!;
      expect(ctx.secret).toBe(true);
      expect(ctx.you?.tile).toBe(h.view(id).role!.role);
      return JSON.stringify(withoutSecrets(ctx));
    });
    for (const json of hidden) expect(json).toBe(hidden[0]);
    expect(hidden[0]).not.toContain('"you"');
    expect(guide.room!(h.view(null), 'watcher')?.you).toBeUndefined();
  });
});
