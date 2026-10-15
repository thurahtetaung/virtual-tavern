import { fitSummary, summaryFits, summaryText } from '@vt/ui';
import { describe, expect, it } from 'vitest';
import { type RoleId, roleLabel } from '../logic/roles.ts';
import { cardsSummary } from './summary.ts';

const fitted = (parts: string[], width: number) =>
  summaryText(
    parts,
    fitSummary(parts, (t) => summaryFits(t, 'The cards', width)),
  );

describe('the guests’ cards summary', () => {
  it('counts the cards and names the roles, plain Villagers last', () => {
    const roles: RoleId[] = ['werewolf', 'villager', 'werewolf', 'seer', 'robber', 'villager'];
    expect(cardsSummary(roles, roleLabel)).toEqual([
      '6 cards',
      'Werewolf ×2',
      'Seer',
      'Robber',
      'Villager ×2',
    ]);
  });

  it('fits two lines at 360 and 390 px with many roles across sets, counting the rest', () => {
    const roles: RoleId[] = [
      'werewolf',
      'werewolf',
      'alpha-wolf',
      'mystic-wolf',
      'minion',
      'doppelganger',
      'seer',
      'apprentice-seer',
      'paranormal-investigator',
      'robber',
      'witch',
      'troublemaker',
      'village-idiot',
      'vampire',
      'the-count',
      'renfield',
      'villager',
    ];
    const parts = cardsSummary(roles, roleLabel);
    const at360 = fitted(parts, 360);
    const at390 = fitted(parts, 390);
    for (const [text, width] of [
      [at360, 360],
      [at390, 390],
    ] as const) {
      expect(summaryFits(text, 'The cards', width)).toBe(true);
      expect(text).toMatch(/^17 cards · Werewolf ×2 · .* · \+\d+ more$/);
      expect(text).not.toContain('…');
    }
    expect(at360.length).toBeLessThanOrEqual(at390.length);
  });

  it('cuts the live check’s six cards at a whole role, never mid-word', () => {
    const roles: RoleId[] = ['werewolf', 'werewolf', 'seer', 'robber', 'troublemaker', 'villager'];
    const parts = cardsSummary(roles, roleLabel);
    expect(fitted(parts, 360)).toBe('6 cards · Werewolf ×2 · Seer · Robber · +2 more');
    expect(fitted(parts, 390)).toBe('6 cards · Werewolf ×2 · Seer · Robber · +2 more');
    expect(fitted(parts, 430)).toBe(summaryText(parts));
  });
});
