import { describe, expect, it } from 'vitest';
import { artFor } from './assets.tsx';

describe('campaign names', () => {
  const deep = { key: 'voyage-2', name: 'Campaign' };
  const nine = { key: 'voyage-1', name: 'Campaign (one-card)' };

  it('uses each campaign’s manifest title, the pack’s name only without one', () => {
    const art = artFor({ title: 'Deep', voyages: { 'voyage-1': { title: 'Nine' } } });
    expect(art.campaignName(deep)).toBe('Deep');
    expect(art.campaignName(nine)).toBe('Nine');
    // A campaign with its own block but no title never borrows the top-level one.
    expect(artFor({ title: 'Deep', voyages: { 'voyage-1': {} } }).campaignName(nine)).toBe(
      'Campaign (one-card)',
    );
    expect(artFor(null).campaignName(deep)).toBe('Campaign');
  });
});
