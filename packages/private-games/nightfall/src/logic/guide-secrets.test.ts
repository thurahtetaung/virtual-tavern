import { withoutSecrets } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { guide, makeGuide } from './guide.ts';
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

  it('names your exact team only behind the peek', () => {
    const h = table({ players: ['werewolf', 'seer', 'robber', 'troublemaker', 'villager'] });
    const wolf = h.ids.find((id) => h.role(id) === 'werewolf')!;
    const ctx = guide.room!(h.view(wolf), wolf)!;
    expect(ctx.you?.subtitle).toBe('Werewolves');
    expect(withoutSecrets(ctx).you).toBeUndefined();
  });
});

describe('the role tiles', () => {
  const tiles = (g = guide) => new Map(g.tiles!.items.map((t) => [t.id, t]));

  it('name each role’s exact team, grouped by side for the filter', () => {
    const t = tiles();
    expect(t.get('seer')?.subtitle).toBe('Village');
    expect(t.get('minion')?.subtitle).toBe('Werewolves');
    expect(t.get('renfield')?.subtitle).toBe('Vampires');
    expect(t.get('groob')?.subtitle).toBe('Aliens');
    expect(t.get('apprentice-tanner')?.subtitle).toBe('Tanner');
    expect(t.get('synthetic-alien')?.subtitle).toBe('Synthetic Alien');
    expect(t.get('renfield')?.group).toBe(t.get('minion')?.group);
    expect(t.get('tanner')?.group).toBe(t.get('blob')?.group);
  });

  it('take the manifest’s names for teams named after a role', () => {
    const t = tiles(makeGuide({ role: (r) => ({ name: `«${r}»` }) }));
    expect(t.get('apprentice-tanner')?.subtitle).toBe('«tanner»');
    expect(t.get('synthetic-alien')?.subtitle).toBe('«synthetic-alien»');
    expect(t.get('mortician')?.subtitle).toBe('«mortician»');
    expect(t.get('minion')?.subtitle).toBe('Werewolves');
  });
});
