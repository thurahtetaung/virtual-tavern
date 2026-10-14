import { createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { CARD_TYPES, CORE_POOL, type CardType } from './cards.ts';
import { deal, extraDefuses, bombsFor, poolFor, readout } from './deck.ts';
import { DEFAULT_SETTINGS } from './game.ts';
import { everyCard, harness, ids } from './test-utils.ts';
import type { Settings } from './types.ts';

const S = (p: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...p });
const sum = (c: Partial<Record<CardType, number>>) => Object.values(c).reduce((a, b) => a + b, 0);

describe('setup', () => {
  const classic = { 2: 35, 3: 29, 4: 23, 5: 16, 6: 25, 7: 29, 8: 33, 9: 37, 10: 41 };
  const party = { 2: 29, 3: 22, 4: 38, 5: 31, 6: 24, 7: 17, 8: 54, 9: 47, 10: 40 };

  it.each(Object.entries(classic))('classic deck at %s players: pile of %i', (n, pile) => {
    expect(readout(S(), Number(n)).pile).toBe(pile);
    const d = deal(S(), Number(n), createRng(Number(n)));
    expect(d.pile.length).toBe(pile);
  });

  it.each(Object.entries(party))('party deck at %s players: pile of %i', (n, pile) => {
    expect(readout(S({ core: 'party' }), Number(n)).pile).toBe(pile);
    expect(deal(S({ core: 'party' }), Number(n), createRng(3)).pile.length).toBe(pile);
  });

  it('matches the printed extra Defuses and Bombs', () => {
    expect([2, 3, 4, 5].map((n) => extraDefuses(S(), n))).toEqual([2, 2, 2, 1]);
    expect([2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => extraDefuses(S({ core: 'party' }), n))).toEqual([
      1, 0, 3, 2, 1, 0, 2, 1, 0,
    ]);
    expect(extraDefuses(S({ x1: true }), 5)).toBe(2);
    expect(bombsFor(S(), 4)).toEqual({ bombs: 3, void: false });
    expect(bombsFor(S({ x1: true }), 4)).toEqual({ bombs: 2, void: true });
    expect(bombsFor(S({ x1: true }), 2)).toEqual({ bombs: 1, void: true });
  });

  it('tops the classic deck up to ten cards a player from 6 players, in proportion', () => {
    expect(sum(poolFor(S(), 5))).toBe(46);
    expect(sum(poolFor(S(), 6))).toBe(60);
    expect(sum(poolFor(S(), 10))).toBe(100);
    const nine = poolFor(S(), 9, createRng(1));
    for (const [t, n] of Object.entries(CORE_POOL)) {
      expect(nine[t as CardType]).toBeGreaterThanOrEqual(n * 2 - 1);
      expect(nine[t as CardType]).toBeLessThanOrEqual(n * 2);
    }
    // The party deck is never topped up; expansions count toward the ten.
    expect(sum(poolFor(S({ core: 'party' }), 10))).toBe(101);
    expect(sum(poolFor(S({ x1: true }), 6))).toBe(65);
  });

  it('deals a Defuse and 7 cards to each player, with no Bombs in hands', () => {
    for (const n of [2, 5, 10]) {
      const d = deal(S({ x1: true }), n, createRng(n));
      for (const hand of d.hands) {
        expect(hand.length).toBe(8);
        expect(hand.filter((id) => d.cards[id]!.t === 'defuse').length).toBeGreaterThanOrEqual(1);
        expect(hand.some((id) => ['bomb', 'void'].includes(d.cards[id]!.t))).toBe(false);
      }
      const inPile = (t: CardType) => d.pile.filter((id) => d.cards[id]!.t === t).length;
      expect(inPile('void')).toBe(1);
      expect(inPile('bomb')).toBe(n === 2 ? 1 : n - 2);
    }
  });

  it('expansion 2 adds a Bomb; expansion 3 deals a Stash and keeps every spare Defuse alone', () => {
    expect(bombsFor(S({ x2: true }), 4)).toEqual({ bombs: 4, void: false });
    expect(bombsFor(S({ x1: true, x2: true }), 4)).toEqual({ bombs: 3, void: true });
    expect(bombsFor(S({ x1: true, x2: true }), 2)).toEqual({ bombs: 1, void: true });
    expect([2, 3, 4, 5, 6].map((n) => extraDefuses(S({ x3: true }), n))).toEqual([4, 3, 2, 1, 2]);
    expect(extraDefuses(S({ x2: true, x3: true }), 3)).toBe(2);
    // Classic + expansion 3 at 2: 65 cards, 6 to the Stash, the Vault in, 14 dealt, 4 Defuses, 1 Bomb.
    expect(readout(S({ x3: true }), 2).pile).toBe(51);
    const d = deal(S({ x3: true }), 2, createRng(4));
    expect(d.stash).toHaveLength(6);
    expect(d.pile.length).toBe(51);
    expect(d.pile.some((id) => d.cards[id]!.t === 'vault')).toBe(true);
    expect(d.stash.some((id) => ['bomb', 'vault', 'defuse'].includes(d.cards[id]!.t))).toBe(false);
    // Expansion 2 adds 14 cards and a Bomb: 46 + 14 - 14 + 2 + 2 at two players.
    expect(readout(S({ x2: true }), 2).pile).toBe(50);
  });

  it('faster games leave a third of the pile out, before the Bombs go in', () => {
    const d = deal(S({ faster: true }), 2, createRng(5));
    expect(d.out.length).toBe(11);
    expect(d.pile.length).toBe(24);
    expect(d.out.some((id) => d.cards[id]!.t === 'bomb')).toBe(false);
    expect(readout(S({ faster: true }), 2).pile).toBe(24);
  });

  it('gives every card a distinct random id that says nothing about it', () => {
    const d = deal(S({ x1: true }), 6, createRng(9));
    const all = [...d.pile, ...d.hands.flat(), ...d.out];
    expect(new Set(all).size).toBe(all.length);
    expect(Object.keys(d.cards).sort()).toEqual([...all].sort());
    for (const id of all) expect(id).toMatch(/^[a-z2-9]{8}$/);
  });

  it('starts a game for every preset and table size with all cards accounted for', () => {
    for (const preset of ['classic', 'adult', 'party'] as const)
      for (const x1 of [false, true])
        for (let n = 2; n <= 10; n++) {
          const h = harness(ids(n), n);
          h.act({ type: 'update-settings', preset, x1 });
          h.act({ type: 'start' });
          const g = h.game();
          const all = everyCard(g);
          expect(new Set(all).size).toBe(all.length);
          expect(all.length).toBe(Object.keys(g.cards).length);
          expect(g.players.length).toBe(n);
          expect(g.bombsOut).toBe(bombsFor(h.state.settings, n).bombs);
          expect(CARD_TYPES).toEqual(
            expect.arrayContaining(Object.values(g.cards).map((c) => c.t)),
          );
        }
  });
});
