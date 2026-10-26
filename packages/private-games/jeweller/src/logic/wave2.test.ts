import { describe, expect, it } from 'vitest';
import { CARDS, cardOf } from './cards.ts';
import { CITIES, cityOf, meetsCity } from './cities.ts';
import { jeweller, setTestDeck } from './game.ts';
import { noGems, pointsOf } from './rules.ts';
import { supplyOf } from './strongholds.ts';
import {
  HOST,
  game,
  harness,
  pieces,
  player,
  setMarket,
  setPlayer,
  started,
} from './test-utils.ts';
import type { Gem, JewellerAction, Pieces } from './types.ts';

/** The first `n` cards of a colour at a level (bought cards for a rig). */
const cardsOf = (bonus: Gem, n: number, level: 1 | 2 | 3 = 1) =>
  CARDS.filter((c) => c.level === level && c.bonus === bonus)
    .slice(0, n)
    .map((c) => c.id);

const gems = (g: Partial<Record<Gem, number>>) => ({ ...noGems(), ...g });
/** Exactly what a card costs, as pieces. */
const costOf = (id: string): Pieces => pieces({ ...cardOf(id).cost });
const TAKE: JewellerAction = { type: 'take', gems: ['white', 'blue', 'green'] };

describe('Cities: the tiles', () => {
  it('has the 14 sides as printed', () => {
    const table = CITIES.map((c) => [c.id, c.points, Object.values(c.requires).join(''), c.any]);
    expect(table).toEqual([
      ['C1a', 16, '11111', 0],
      ['C1b', 17, '00000', 0],
      ['C2a', 11, '30333', 0],
      ['C2b', 11, '33033', 0],
      ['C3a', 13, '34000', 0],
      ['C3b', 13, '40030', 0],
      ['C4a', 15, '00000', 5],
      ['C4b', 12, '00000', 6],
      ['C5a', 13, '03400', 0],
      ['C5b', 14, '00400', 4],
      ['C6a', 13, '22222', 0],
      ['C6b', 14, '21122', 0],
      ['C7a', 13, '00043', 0],
      ['C7b', 13, '00304', 0],
    ]);
  });

  it('needs the points and the cards; “any colour” can’t be one the side already asks for', () => {
    const c5b = cityOf('C5b');
    expect(meetsCity(c5b, gems({ green: 8 }), 20)).toBe(false);
    expect(meetsCity(c5b, gems({ green: 4, red: 4 }), 14)).toBe(true);
    expect(meetsCity(c5b, gems({ green: 4, red: 4 }), 13)).toBe(false);
    expect(meetsCity(cityOf('C4a'), gems({ blue: 5 }), 15)).toBe(true);
    expect(meetsCity(cityOf('C4a'), gems({ blue: 4, red: 4 }), 15)).toBe(false);
    expect(meetsCity(cityOf('C1b'), gems({}), 17)).toBe(true);
    expect(
      meetsCity(cityOf('C6b'), gems({ white: 2, blue: 1, green: 1, red: 2, black: 1 }), 14),
    ).toBe(false);
  });
});

describe('Cities: setup', () => {
  it('no nobles; 3 City tiles, one side of each, a random side up', () => {
    const sides = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const h = started(3, { seed, settings: { cities: true } });
      const g = game(h);
      expect(g.nobles).toEqual([]);
      expect(g.cities).toHaveLength(3);
      expect(new Set(g.cities!.map((c) => c[1])).size).toBe(3);
      for (const c of g.cities!) sides.add(c);
    }
    expect(sides.size).toBeGreaterThan(10);
  });

  it('the browser-test rig deals the listed sides', () => {
    setTestDeck({ cities: ['C1b', 'C2a', 'C1a'] });
    try {
      const h = started(2, { settings: { cities: true } });
      // Never both sides of a tile.
      expect(game(h).cities!.slice(0, 2)).toEqual(['C1b', 'C2a']);
      expect(game(h).cities!.filter((c) => c[1] === '1')).toEqual(['C1b']);
    } finally {
      setTestDeck(null);
    }
  });

  it('off by default, and only the host switches it, between games', () => {
    const h = harness(2);
    expect(h.state.settings.cities).toBe(false);
    expect(h.refuse('p2', { type: 'update-settings', cities: true })).toBe('not-host');
    h.act(HOST, { type: 'update-settings', cities: true, strongholds: true });
    h.act(HOST, { type: 'start' });
    expect(h.refuse(HOST, { type: 'update-settings', cities: false })).toBe('in-progress');
  });
});

describe('Cities: the end', () => {
  /** A 3-player game on C3a (13 + 4 blue + 3 white), C1b (17) and C2a (11 + 3 W G R K). */
  function cityGame(n = 3) {
    const h = started(n, { settings: { cities: true } });
    h.rig((s) => {
      s.game!.cities = ['C3a', 'C1b', 'C2a'];
    });
    return h;
  }
  /** 4 blue + 3 white cards and level-3 cards to reach `points`. */
  const c3a = (extra: string[]) => [...cardsOf('blue', 4), ...cardsOf('white', 3), ...extra];

  it('the target doesn’t end the game: meeting a City does, and the round is finished', () => {
    const h = cityGame();
    // 16 points but no City met (C1b needs 17, C3a and C2a their cards).
    setPlayer(h, 'p1', { cards: ['L3-04', 'L3-08', 'L3-12', 'L1-08'] });
    expect(pointsOf(player(h, 'p1').cards, [])).toBe(16);
    h.act('p1', TAKE);
    expect(game(h).finalBy).toBeNull();
    setPlayer(h, 'p2', { cards: c3a(['L3-04', 'L3-08', 'L3-12']) });
    h.act('p2', TAKE);
    expect(game(h).finalBy).toBe('p2');
    expect(h.state.log.at(-1)).toMatchObject({ kind: 'final', by: 'p2', city: 'C3a' });
    expect(h.state.phase).toBe('playing');
    h.act('p3', TAKE);
    expect(h.state.phase).toBe('over');
    expect(game(h).winners).toEqual(['p2']);
  });

  it('only players meeting a City can win, however many points the others have', () => {
    const h = cityGame();
    setPlayer(h, 'p1', { cards: c3a(['L3-04', 'L3-08', 'L3-12']) });
    h.act('p1', TAKE);
    // p3 has more points but meets no City.
    setPlayer(h, 'p3', { cards: ['L3-04', 'L3-08', 'L3-12', 'L3-16'] });
    h.rig((s) => {
      s.game!.cities = ['C3a', 'C3b', 'C2a'];
    });
    h.act('p2', TAKE);
    h.act('p3', TAKE);
    expect(h.state.phase).toBe('over');
    expect(game(h).winners).toEqual(['p1']);
  });

  it('among those meeting one: most points, then fewest cards, then shared', () => {
    const h = cityGame(2);
    setPlayer(h, 'p1', { cards: c3a(['L3-04', 'L3-08', 'L3-12']) });
    setPlayer(h, 'p2', { cards: c3a(['L3-04', 'L3-08', 'L3-16', 'L3-17']) });
    h.act('p1', TAKE);
    h.act('p2', TAKE);
    expect(game(h).winners).toEqual(['p2']);

    const t = cityGame(2);
    setPlayer(t, 'p1', { cards: c3a(['L3-04', 'L3-08', 'L3-12']) });
    setPlayer(t, 'p2', { cards: c3a(['L3-04', 'L3-08', 'L3-12']) });
    t.act('p1', TAKE);
    t.act('p2', TAKE);
    expect(game(t).winners.sort()).toEqual(['p1', 'p2']);
  });

  it('owner’s ruling: a stalled game with nobody meeting a City scores as the base game', () => {
    const h = cityGame();
    h.rig((s) => {
      const g = s.game!;
      g.bank = pieces({});
      for (const [i, id] of ['p1', 'p2', 'p3'].entries())
        g.players[id]!.reserved = g.decks[3]
          .slice(i * 3, i * 3 + 3)
          .map((card) => ({ card, blind: true }));
    });
    setPlayer(h, 'p2', { cards: ['L1-08'] });
    h.act('p1', { type: 'pass' });
    h.act('p2', { type: 'pass' });
    h.act('p3', { type: 'pass' });
    expect(h.state.phase).toBe('over');
    expect(game(h).winners).toEqual(['p2']);
  });

  it('owner’s ruling: the last player left after removals wins, City or not', () => {
    const h = cityGame(2);
    setPlayer(h, 'p1', { cards: ['L1-08'] });
    h.state = jeweller.playerLeft(h.state, 'p2', h.now);
    h.act(HOST, { type: 'remove', player: 'p2' });
    expect(h.state.phase).toBe('over');
    expect(game(h).winners).toEqual(['p1']);
  });

  it('the view says which Cities each player meets', () => {
    const h = cityGame(2);
    setPlayer(h, 'p2', { cards: c3a(['L3-04', 'L3-08', 'L3-12']) });
    const v = jeweller.view(h.state, 'p1');
    expect(v.game!.cities).toEqual(['C3a', 'C1b', 'C2a']);
    expect(v.game!.players[1]!.cities).toEqual(['C3a']);
    expect(v.game!.players[0]!.cities).toEqual([]);
  });
});

describe('Strongholds', () => {
  /** A 3-player game with strongholds, p1 holding plenty to buy level-1 cards. */
  function holdGame(n = 3, cities = false) {
    const h = started(n, { settings: { strongholds: true, cities } });
    setMarket(h, 1, ['L1-01', 'L1-02', 'L1-03', 'L1-04']);
    return h;
  }
  const rich = pieces({ white: 4, blue: 4, green: 4, red: 4, black: 4 });

  it('every purchase owes a stronghold, placed before the space is refilled', () => {
    const h = holdGame();
    setPlayer(h, 'p1', { tokens: costOf('L1-01') });
    h.act('p1', { type: 'buy', card: 'L1-01' });
    expect(game(h).stage).toBe('hold');
    expect(game(h).market[1][0]).toBeNull();
    expect(h.refuse('p1', { type: 'stronghold', card: 'L1-01' })).toBe('bad-stronghold');
    expect(h.refuse('p1', TAKE)).toBe('hold-first');
    h.act('p1', { type: 'stronghold', card: 'L1-02' });
    expect(game(h).holds).toEqual({ 'L1-02': { by: 'p1', n: 1 } });
    expect(game(h).market[1][0]).not.toBeNull();
    expect(game(h).current).toBe('p2');
    expect(supplyOf(game(h).holds, 'p1')).toBe(2);
  });

  it('a reserve or a take owes nothing; a reserved card bought from the hand does', () => {
    const h = holdGame();
    h.act('p1', { type: 'reserve', card: 'L1-01' });
    expect(game(h).current).toBe('p2');
    setPlayer(h, 'p1', { tokens: costOf('L1-01') });
    h.act('p2', TAKE);
    h.act('p3', TAKE);
    h.act('p1', { type: 'buy', card: 'L1-01' });
    expect(game(h).stage).toBe('hold');
  });

  it('stacks up to 3 of yours, never on another player’s; moves one of yours', () => {
    const h = holdGame();
    h.rig((s) => {
      s.game!.holds = { 'L1-02': { by: 'p1', n: 2 }, 'L1-03': { by: 'p2', n: 2 } };
    });
    setPlayer(h, 'p1', { tokens: costOf('L1-01') });
    h.act('p1', { type: 'buy', card: 'L1-01' });
    expect(h.refuse('p1', { type: 'stronghold', card: 'L1-03' })).toBe('bad-stronghold');
    expect(h.refuse('p1', { type: 'evict', card: 'L1-03' })).toBe('bad-stronghold');
    h.act('p1', { type: 'stronghold', card: 'L1-04', from: 'L1-02' });
    expect(game(h).holds).toEqual({
      'L1-02': { by: 'p1', n: 1 },
      'L1-03': { by: 'p2', n: 2 },
      'L1-04': { by: 'p1', n: 1 },
    });
    expect(supplyOf(game(h).holds, 'p1')).toBe(1);
  });

  it('a lone opponent stronghold can be sent back to its owner instead', () => {
    const h = holdGame();
    h.rig((s) => {
      s.game!.holds = { 'L1-03': { by: 'p2', n: 1 } };
    });
    setPlayer(h, 'p1', { tokens: costOf('L1-01') });
    h.act('p1', { type: 'buy', card: 'L1-01' });
    h.act('p1', { type: 'evict', card: 'L1-03' });
    expect(game(h).holds).toEqual({});
    expect(supplyOf(game(h).holds, 'p2')).toBe(3);
    expect(h.state.log.at(-1)).toMatchObject({ kind: 'evict', by: 'p1', owner: 'p2' });
  });

  it('an occupied card is only for its owner, who takes the strongholds back', () => {
    const h = holdGame();
    h.rig((s) => {
      s.game!.holds = { 'L1-02': { by: 'p2', n: 1 }, 'L1-03': { by: 'p2', n: 2 } };
    });
    setPlayer(h, 'p1', { tokens: rich });
    expect(h.refuse('p1', { type: 'buy', card: 'L1-02' })).toBe('occupied');
    expect(h.refuse('p1', { type: 'reserve', card: 'L1-02' })).toBe('occupied');
    setPlayer(h, 'p1', { tokens: pieces({}) });
    h.act('p1', TAKE);
    setPlayer(h, 'p2', { tokens: costOf('L1-03') });
    h.act('p2', { type: 'reserve', card: 'L1-02' });
    expect(game(h).holds).toEqual({ 'L1-03': { by: 'p2', n: 2 } });
    h.act('p3', TAKE);
    h.act('p1', TAKE);
    h.act('p2', { type: 'buy', card: 'L1-03' });
    expect(game(h).holds).toEqual({});
    expect(game(h).stage).toBe('hold');
  });

  it('Conquest, as in the rulebook’s example: buy A, the third on B, buy B, one on C', () => {
    const h = holdGame();
    h.rig((s) => {
      s.game!.holds = { 'L1-02': { by: 'p1', n: 2 } };
    });
    setPlayer(h, 'p1', { tokens: pieces({ blue: 3, red: 2, black: 1 }) });
    h.act('p1', { type: 'buy', card: 'L1-01' });
    h.act('p1', { type: 'stronghold', card: 'L1-02' });
    expect(game(h).stage).toBe('conquer');
    // Only the conquered card.
    expect(h.refuse('p1', { type: 'buy', card: 'L1-03' })).toBe('not-conquest');
    h.act('p1', { type: 'buy', card: 'L1-02' });
    expect(game(h).holds).toEqual({});
    expect(game(h).stage).toBe('hold');
    // Both spaces stay empty until the strongholds are done.
    expect(game(h).market[1].slice(0, 2)).toEqual([null, null]);
    h.act('p1', { type: 'stronghold', card: 'L1-03' });
    expect(game(h).market[1].every((c) => c !== null)).toBe(true);
    expect(player(h, 'p1').cards).toEqual(['L1-01', 'L1-02']);
    expect(h.state.log.find((e) => e.kind === 'buy' && e.card === 'L1-02')).toMatchObject({
      conquest: true,
    });
    expect(game(h).current).toBe('p2');
  });

  it('Conquest after any action, before the 10-piece check; it may be skipped', () => {
    // L1-02 costs 3 blue: 10 pieces, 13 after the take.
    const ten = pieces({ white: 2, blue: 5, green: 2, red: 1 });
    const h = holdGame();
    h.rig((s) => {
      s.game!.holds = { 'L1-02': { by: 'p1', n: 3 } };
    });
    setPlayer(h, 'p1', { tokens: ten });
    h.act('p1', TAKE);
    expect(game(h).stage).toBe('conquer');
    h.act('p1', { type: 'buy', card: 'L1-02' });
    h.act('p1', { type: 'stronghold', card: 'L1-03' });
    // Down to 10 by the purchase: nothing to hand back.
    expect(game(h).current).toBe('p2');

    const k = holdGame();
    k.rig((s) => {
      s.game!.holds = { 'L1-02': { by: 'p1', n: 3 } };
    });
    setPlayer(k, 'p1', { tokens: ten });
    k.act('p1', TAKE);
    k.act('p1', { type: 'no-conquest' });
    expect(game(k).holds).toEqual({ 'L1-02': { by: 'p1', n: 3 } });
    expect(game(k).stage).toBe('return');
  });

  it('no Conquest offered for a card the player can’t afford', () => {
    const h = holdGame();
    h.rig((s) => {
      s.game!.holds = { 'L1-02': { by: 'p1', n: 3 } };
    });
    h.act('p1', TAKE);
    expect(game(h).current).toBe('p2');
  });

  it('owner’s ruling: a removed player’s strongholds leave the table', () => {
    const h = holdGame();
    h.rig((s) => {
      s.game!.holds = { 'L1-02': { by: 'p2', n: 2 }, 'L1-03': { by: 'p3', n: 1 } };
    });
    h.state = jeweller.playerLeft(h.state, 'p2', h.now);
    h.act(HOST, { type: 'remove', player: 'p2' });
    expect(game(h).holds).toEqual({ 'L1-03': { by: 'p3', n: 1 } });
    expect(jeweller.view(h.state, 'p1').game!.players[1]!.strongholds).toBe(0);
  });

  it('strict timer: a stronghold from the supply on the cheapest card; Conquest skipped', () => {
    const h = started(2, { settings: { strongholds: true, seconds: 30, timerMode: 'strict' } });
    setMarket(h, 1, ['L1-01', 'L1-02', 'L1-03', 'L1-04']);
    setPlayer(h, 'p1', { tokens: costOf('L1-01') });
    h.act('p1', { type: 'buy', card: 'L1-01' });
    h.tick();
    expect(Object.values(game(h).holds!)).toEqual([{ by: 'p1', n: 1 }]);
    expect(h.state.log.at(-1)).toMatchObject({ kind: 'hold', auto: 'timer' });

    const c = started(2, { settings: { strongholds: true, seconds: 30, timerMode: 'strict' } });
    setMarket(c, 1, ['L1-01', 'L1-02', 'L1-03', 'L1-04']);
    c.rig((s) => {
      s.game!.holds = { 'L1-02': { by: 'p1', n: 3 } };
    });
    setPlayer(c, 'p1', { tokens: costOf('L1-02') });
    c.act('p1', { type: 'take', gems: ['white', 'blue', 'green'] });
    expect(game(c).stage).toBe('conquer');
    c.tick();
    expect(c.state.log.some((e) => e.kind === 'conquest-pass')).toBe(true);
  });

  it('the browser-test rig puts the first seat’s strongholds on face-up cards', () => {
    setTestDeck({
      decks: { 1: ['L1-05', 'L1-06'] },
      holds: ['L1-05', 'L1-05', 'L1-06'],
      firstSeat: true,
    });
    try {
      const h = started(2, { settings: { strongholds: true } });
      expect(game(h).holds).toEqual({
        'L1-05': { by: 'p1', n: 2 },
        'L1-06': { by: 'p1', n: 1 },
      });
    } finally {
      setTestDeck(null);
    }
  });

  it('with Cities: a Conquest counts before the City check', () => {
    const h = holdGame(2, true);
    setMarket(h, 3, ['L3-20', 'L3-01', 'L3-02', 'L3-03']);
    h.rig((s) => {
      // 15 points before; the conquered card makes 20, enough for C1b (17).
      s.game!.cities = ['C1b', 'C2a', 'C3a'];
      s.game!.holds = { 'L3-20': { by: 'p1', n: 3 } };
    });
    setPlayer(h, 'p1', {
      cards: ['L3-04', 'L3-08', 'L3-12'],
      tokens: pieces({ ...cardOf('L3-20').cost }),
    });
    h.act('p1', TAKE);
    h.act('p1', { type: 'buy', card: 'L3-20' });
    h.act('p1', { type: 'stronghold', card: 'L1-01' });
    expect(game(h).finalBy).toBe('p1');
  });
});
