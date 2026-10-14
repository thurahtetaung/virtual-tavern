import { levelOf, stepsOf } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { buildGames } from './registry.ts';

const games = [...buildGames().values()].map((g) => [g.id, g] as const);
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

describe('game guides', () => {
  it.each(games)('%s has a quick start of 5 or 6 short bullets', (_id, game) => {
    const quick = game.guide.quickStart ?? [];
    expect(quick.length).toBeGreaterThanOrEqual(5);
    expect(quick.length).toBeLessThanOrEqual(6);
    for (const line of quick) expect(line.length).toBeLessThanOrEqual(160);
  });

  it.each(games)('%s has a 4 to 7 step stepper of short steps', (_id, game) => {
    expect(game.guide.steps?.length).toBeGreaterThanOrEqual(4);
    const steps = stepsOf(game.guide);
    expect(steps.length).toBeLessThanOrEqual(7);
    for (const step of steps) {
      expect(step.title.length).toBeGreaterThan(0);
      expect(words(step.title)).toBeLessThanOrEqual(8);
      expect(words(step.text), step.title).toBeLessThanOrEqual(40);
    }
  });

  it.each(games)('%s gives every rules section a level, basics first', (_id, game) => {
    const { sections } = game.guide;
    for (const s of sections)
      expect(s.level ?? levelOf(s), s.title).toMatch(/^(basics|details|edge)$/);
    const basics = sections.filter((s) => levelOf(s) === 'basics');
    expect(basics.length).toBeGreaterThan(0);
    // The section a newcomer opens first stays short.
    const first = basics[0]!;
    expect(words([...(first.paragraphs ?? []), ...(first.bullets ?? [])].join(' '))).toBeLessThan(
      150,
    );
  });

  it.each(games)('%s names every section and tile once', (_id, game) => {
    const titles = game.guide.sections.map((s) => s.title);
    expect(new Set(titles).size).toBe(titles.length);
    const tiles = game.guide.tiles?.items.map((t) => t.id) ?? [];
    expect(new Set(tiles).size).toBe(tiles.length);
    for (const preset of game.guide.presets ?? [])
      for (const id of Object.keys(preset.context.inGame ?? {})) expect(tiles, id).toContain(id);
  });

  it.each(games)('%s links its tiles to catalog groups that exist', (_id, game) => {
    const groups = game.guide.catalog?.groups.map((g) => g.id) ?? [];
    expect(new Set(groups).size).toBe(groups.length);
    for (const g of game.guide.catalog?.groups ?? []) {
      expect(g.items.length, g.id).toBeGreaterThan(0);
      const cards = g.items.map((c) => c.id);
      expect(new Set(cards).size, g.id).toBe(cards.length);
      for (const c of g.items) expect(c.text, c.id).toMatch(/\.$/);
    }
    for (const t of game.guide.tiles?.items ?? [])
      if (t.catalog) expect(groups, t.id).toContain(t.catalog);
  });
});
