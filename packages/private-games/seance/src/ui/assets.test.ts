import { describe, expect, it } from 'vitest';
import { POOL_CARDS, POOL_R_CARDS } from '../logic/cards.ts';
import { contentFor, poolArt } from './assets.ts';

const manifest = {
  pools: {
    'pool-a': { name: 'Pool A' },
    'pool-r': { name: 'Pictures', art: 'reverie/cards/{nnn}.jpg' },
  },
};

describe('card art and names', () => {
  it('stories take the third pillar’s name, icon and art', () => {
    const c = contentFor(manifest, 'story');
    expect(c.kindOf('object')).toBe('story');
    expect(c.kindOf('place')).toBe('place');
    expect(c.pillarName('object')).toBe('Story');
    expect(c.pillarIcon('object')).toBe('📜');
    expect(c.pillarPlural('object')).toBe('Stories');
    expect(c.pillarPlural('suspect')).toBe('Suspects');
    expect(c.cardLabel('story', 4)).toBe('Story 4');
    expect(c.cardArt('story', 4, true)).toBe('/api/backroom/assets/seance/story/thumb/4.webp');
    const objects = contentFor(manifest);
    expect(objects.pillarName('object')).toBe('Object');
    expect(objects.kindOf('object')).toBe('object');
  });

  it('pool visions: cut pools from Séance’s storage, pool-r from Reverie’s', () => {
    const c = contentFor(manifest);
    expect(c.cardArt('vision', 200, true)).toBe(
      '/api/backroom/assets/seance/vision/thumb/200.webp',
    );
    const first = POOL_CARDS['pool-r'][0]!;
    const n = String(POOL_R_CARDS[0]).padStart(3, '0');
    expect(c.cardArt('vision', first, true)).toBe(`/api/backroom/assets/reverie/cards/${n}.jpg`);
    expect(c.cardArt('vision', first, false)).toBe(`/api/backroom/assets/reverie/cards/${n}.jpg`);
    expect(c.poolName('pool-a')).toBe('Pool A');
    expect(c.poolName('pool-b')).toBe('Extra visions B');
    // Without a pointer, a pool-r vision is a numbered placeholder.
    expect(contentFor({}).cardArt('vision', first, true)).toBeNull();
    expect(contentFor('unavailable').cardArt('story', 1)).toBeNull();
  });

  it('the extra suspects and places: art with the others, name from the manifest', () => {
    const c = contentFor({ extras: { name: 'More faces', description: 'From elsewhere.' } });
    expect(c.cardArt('suspect', 40, true)).toBe(
      '/api/backroom/assets/seance/suspect/thumb/40.webp',
    );
    expect(c.cardArt('place', 51, false)).toBe('/api/backroom/assets/seance/place/51.webp');
    expect(c.extrasName).toBe('More faces');
    expect(c.extrasDescription).toBe('From elsewhere.');
    expect(contentFor(null).extrasName).toBe('Extra suspects & places');
    expect(contentFor(null).extrasDescription).toBeNull();
  });

  it('a pool’s art template stays a plain path under the back-room assets', () => {
    expect(poolArt('reverie/cards/{n}.jpg', 7)).toBe('/api/backroom/assets/reverie/cards/7.jpg');
    expect(poolArt('../admin/{n}', 7)).toBeNull();
    expect(poolArt('reverie/../x/{n}.jpg', 7)).toBeNull();
    expect(poolArt('https://example.com/{n}.jpg', 7)).toBeNull();
    expect(poolArt('/reverie/{n}.jpg', 7)).toBeNull();
    expect(poolArt('reverie/{n}.jpg?x=1', 7)).toBeNull();
    expect(poolArt(undefined, 7)).toBeNull();
  });
});
