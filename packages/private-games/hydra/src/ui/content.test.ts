import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_NAMES } from '../logic/names.ts';
import {
  DEFAULT_GEOMETRY,
  assetUrl,
  colorVars,
  contentFor,
  geometryOf,
  portraitIndex,
} from './assets.ts';
import { cardsText } from './Cards.tsx';

describe('portraits', () => {
  it('never repeat within a team while the pool is big enough, and are stable per game', () => {
    for (const seed of [0, 1, 42, 123_456_789]) {
      const picks = [0, 1, 2, 3, 4, 5].map((i) => portraitIndex('blue', i, seed, 10));
      expect(new Set(picks).size).toBe(6);
      for (const p of picks) expect(p).toBeGreaterThanOrEqual(0);
      expect([0, 1, 2, 3, 4, 5].map((i) => portraitIndex('blue', i, seed, 10))).toEqual(picks);
    }
    // A pool as small as the team still gives everyone their own portrait.
    expect(new Set([0, 1, 2].map((i) => portraitIndex('red', i, 9, 3))).size).toBe(3);
    expect(portraitIndex('leader', 0, 9, 1)).toBe(0);
    expect(portraitIndex('blue', 3, 9, 0)).toBe(0);
  });

  it('draw from the whole pool across games', () => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) seen.add(portraitIndex('blue', 0, seed, 10));
    expect(seen.size).toBe(10);
  });

  it('come from the edition’s pools, with Hydra’s fixed slots still working', () => {
    const c = contentFor(
      { art: { roles: { blue: ['b0', 'b1', 'b2'], leader: ['l0'] } } },
      'edition',
    );
    const urls = [0, 1, 2].map((i) => c.roleArt('blue', i, 5));
    expect(new Set(urls).size).toBe(3);
    for (const u of urls) expect(u).toMatch(/^\/api\/backroom\/assets\/edition\/b[012]$/);
    expect(c.roleArt('leader', 0, 5)).toBe('/api/backroom/assets/edition/l0');
    expect(c.roleArt('red', 0, 5)).toBeNull();
    expect(assetUrl('hydra', '/x.webp')).toBe('/api/backroom/assets/hydra/x.webp');
  });
});

describe('board geometry', () => {
  it('is Hydra’s without a manifest', () => {
    expect(geometryOf(null)).toEqual(DEFAULT_GEOMETRY);
    expect(contentFor(null).geometry).toEqual(DEFAULT_GEOMETRY);
  });

  it('takes the manifest’s measurements field by field, ignoring nonsense', () => {
    const g = geometryOf({
      art: {
        geometry: {
          red: { x0: 0.05, pitch: 0.15, top: 0.16, bottom: 0.85, ratio: 3.45 },
          blue: {
            x0: 0.127,
            pitch: 2,
            lamps: { xs: [0.34, 0.44, 0.54, 0.65], y: 0.91, size: 0.0225 },
          },
        },
      },
    });
    expect(g.red).toEqual({
      ...DEFAULT_GEOMETRY.red,
      x0: 0.05,
      pitch: 0.15,
      top: 0.16,
      bottom: 0.85,
      ratio: 3.45,
    });
    expect(g.blue.x0).toBe(0.127);
    expect(g.blue.pitch).toBe(DEFAULT_GEOMETRY.blue.pitch);
    expect(g.blue.lamps).toEqual({ xs: [0.34, 0.44, 0.54, 0.65], y: 0.91, size: 0.0225 });
    expect(g.blue.slots).toBe(5);
    expect(g.red.slots).toBe(6);
  });
});

describe('team colours', () => {
  it('leave Hydra’s alone, and recolour a whole scale from one colour', () => {
    expect(colorVars(undefined)).toBeUndefined();
    expect(contentFor(null).colors).toBeUndefined();
    const vars = colorVars({ blue: '#7a1f2e', red: 'rebeccapurple' }) as Record<string, string>;
    expect(vars['--color-sky-600']).toBe('#7a1f2e');
    expect(vars['--color-red-600']).toBe('rebeccapurple');
    expect(vars['--color-sky-50']).toMatch(/^color-mix\(in oklab, #7a1f2e, white/);
    expect(vars['--color-red-950']).toMatch(/black/);
    expect(Object.keys(vars)).toHaveLength(22);
    // Anything that isn't a plain colour is ignored.
    expect(colorVars({ blue: 'red; background: url(x)' })).toBeUndefined();
  });
});

describe('content', () => {
  it('names, power names and fonts come from the edition, with Hydra’s as the fallback', () => {
    const plain = contentFor('unavailable');
    expect(plain.names).toEqual(PLACEHOLDER_NAMES);
    expect(plain.powerName('peek')).toBe('Policy peek');
    expect(plain.policyName('blue')).toBe('Loyalist');
    expect(plain.font).toBeNull();
    expect(plain.copy('moment.cleared.stamp')).toBe('Not Usurper ✓');
    const c = contentFor(
      {
        names: { policy: 'edict', redPolicy: 'Shadowed', leader: 'the Archon' },
        copy: { 'moment.enact.red': 'The {redPolicy} {policy} falls, {player}' },
        fonts: { heading: 'fonts/display.woff2', headingFamily: 'Display' },
      },
      'edition',
    );
    expect(c.powerName('peek')).toBe('Edict peek');
    expect(c.copy('moment.enact.red', { player: 'Ana' })).toBe('The Shadowed edict falls, Ana');
    expect(c.copy('moment.cleared.stamp')).toBe('Not Archon ✓');
    expect(c.font).toEqual({
      url: '/api/backroom/assets/edition/fonts/display.woff2',
      family: 'Display',
    });
  });
});

describe('cards in words', () => {
  it('count each colour in the edition’s words, or list a peek in order', () => {
    const hydra = contentFor(null);
    expect(cardsText(hydra, ['red', 'blue', 'red'])).toBe('2 Conspirator · 1 Loyalist');
    expect(cardsText(hydra, ['red', 'red'])).toBe('2 Conspirator');
    expect(cardsText(hydra, ['blue'])).toBe('Loyalist');
    expect(cardsText(hydra, ['blue', 'red', 'red'], true)).toBe(
      'Loyalist, Conspirator, Conspirator',
    );
    const edition = contentFor({ names: { bluePolicy: 'Sunlit', redPolicy: 'Shadowed' } }, 'x');
    expect(cardsText(edition, ['blue', 'red', 'blue'])).toBe('1 Shadowed · 2 Sunlit');
  });
});
