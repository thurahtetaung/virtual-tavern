import { withoutSecrets } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { guide } from './guide.ts';
import { ROLES } from './roles.ts';
import { rigged } from './test-utils.ts';

describe('the rules drawer in a room', () => {
  it('keeps every seat’s role secret until they peek', () => {
    const h = rigged(['merlin', 'servant', 'servant', 'assassin', 'minion']);
    const hidden = h.state.game!.players.map((id) => {
      const ctx = guide.room!(h.view(id), id)!;
      expect(ctx.secret).toBe(true);
      expect(ctx.you?.name).toBe(ROLES[h.view(id).role!.role].name);
      return JSON.stringify(withoutSecrets(ctx));
    });
    for (const json of hidden) expect(json).toBe(hidden[0]);
    expect(hidden[0]).not.toContain('"you"');
    // A watcher has nothing secret at all.
    expect(guide.room!(h.view(null), 'watcher')?.you).toBeUndefined();
  });
});
