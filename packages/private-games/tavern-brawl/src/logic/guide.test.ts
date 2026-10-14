import { describe, expect, it } from 'vitest';
import { CARDS, ENABLED_HEROES, cardsOf } from './cards.ts';
import { MIGHTY, cardText, makeGuide, powersOf } from './guide.ts';

describe('cardText', () => {
  it('spells out every symbol in printed order', () => {
    expect(cardText(CARDS['brute.06']!)).toBe(
      'Deal 1 damage to one opponent, then play another card.',
    );
    expect(cardText(CARDS['brute.01']!)).toBe('Put up a 1-point shield, then draw 1 card.');
    expect(cardText(CARDS['brute.09']!)).toMatch(/^Put up a 3-point shield: it stays in front/);
    expect(cardText(CARDS['knight.03']!)).toBe(
      'Take a card from your discard pile (from before this turn) into your hand, then heal 2.',
    );
  });

  it('reads as plain sentences for every card', () => {
    for (const def of Object.values(CARDS)) {
      const text = cardText(def);
      expect(text, def.id).toMatch(/^[A-Z].*\.$/);
      expect(text, def.id).not.toMatch(/then then|\bThen\b.*, then play another card|\.\./);
      expect(text, def.id).not.toBe('No effect.');
    }
  });

  it('names the Form bonus, and powers that change the card’s own attack', () => {
    expect(cardText(CARDS['druid.04']!)).toBe(
      'Deal 2 damage to one opponent. Form bonus: heal 1 as the bear, or deal 1 more damage as the wolf.',
    );
    expect(cardText(CARDS['owl.09']!)).toContain('deal 1 damage to each opponent');
    expect(cardText(CARDS['slime.05']!)).toContain('straight through shields');
    expect(cardText(CARDS['slime.01']!)).toMatch(/^Put up a 3-point shield\. It strikes back/);
  });
});

describe('the guide’s heroes, cards and mighty powers', () => {
  const guide = makeGuide({
    hero: (id) => `«${id}»`,
    card: (id) => `‹${id}›`,
    cardArt: (id) => ({ thumb: `/t/${id}`, face: `/f/${id}` }),
  });

  it('gives every hero a Mighty powers block and a link to their cards', () => {
    for (const h of ENABLED_HEROES) {
      const tile = guide.tiles!.items.find((t) => t.id === h)!;
      expect(tile.highlights?.title).toBe('Mighty powers');
      expect(tile.highlights!.items.map((i) => i.name)).toEqual(
        powersOf(h).map((c) => `‹${c.id}› ×${c.count}`),
      );
      expect(tile.highlights!.items.every((i) => i.art?.startsWith('/t/'))).toBe(true);
      expect(tile.catalog).toBe(h);
    }
  });

  it('lists every card under its hero, mighty powers first and marked', () => {
    const groups = guide.catalog!.groups;
    expect(groups.map((g) => g.id)).toEqual([...ENABLED_HEROES]);
    for (const g of groups) {
      const hero = g.id as (typeof ENABLED_HEROES)[number];
      expect(g.items.map((c) => c.id).sort()).toEqual(
        cardsOf(hero)
          .map((c) => c.id)
          .sort(),
      );
      const powers = powersOf(hero).length;
      expect(g.items.slice(0, powers).every((c) => c.mark?.label === `✦ ${MIGHTY}`)).toBe(true);
      expect(g.items.slice(powers).some((c) => c.mark)).toBe(false);
      expect(g.items.reduce((n, c) => n + (c.count ?? 0), 0)).toBe(28);
      for (const c of g.items) {
        expect(c.text).toBe(cardText(CARDS[c.id]!));
        expect(c.card).toBe(`/f/${c.id}`);
      }
    }
  });

  it('keeps a per-hero mighty powers table on the cheat sheet', () => {
    const table = guide.reference!.find((t) => t.title === 'Mighty powers')!;
    const total = ENABLED_HEROES.reduce((n, h) => n + powersOf(h).length, 0);
    expect(table.rows).toHaveLength(total);
    expect(table.rows.filter((r) => r[0]).map((r) => r[0])).toEqual(
      ENABLED_HEROES.map((h) => `«${h}»`),
    );
  });

  it('filters the cards to the heroes at the table', () => {
    const ctx = guide.room!(
      {
        seats: [
          { id: 'a', hero: 'mage', playing: true },
          { id: 'b', hero: 'slime', playing: true },
        ],
        settings: {},
      },
      'a',
    )!;
    expect(Object.keys(ctx.inGame!)).toEqual(['mage', 'slime']);
    expect(ctx.you?.tile).toBe('mage');
  });
});
