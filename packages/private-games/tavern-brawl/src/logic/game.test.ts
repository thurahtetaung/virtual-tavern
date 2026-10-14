import { createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { CARDS, HEROES, cardsOf, deckList } from './cards.ts';
import { tavernBrawl } from './game.ts';
import {
  NOW,
  arrange,
  cardsIn,
  checkConservation,
  exhaust,
  harness,
  started,
} from './test-utils.ts';
import { HERO_IDS, type TavernBrawlState } from './types.ts';

const g = (h: { state: TavernBrawlState }) => h.state.game!;
const hp = (h: { state: TavernBrawlState }, p: string) => g(h).players[p]!.hp;
const logKinds = (h: { state: TavernBrawlState }) => h.state.log.map((e) => e.kind);

describe('cards', () => {
  it('every deck has 28 cards', () => {
    for (const hero of HERO_IDS) expect(deckList(hero)).toHaveLength(28);
  });

  it('matches the printed decks', () => {
    const shape = (hero: (typeof HERO_IDS)[number]) =>
      cardsOf(hero).map((c) => [
        c.count,
        c.shield,
        c.effect ?? '',
        c.steps.map((s) => s.k).join(' '),
      ]);
    expect(cardsOf('brute')).toHaveLength(15);
    expect(cardsOf('mage')).toHaveLength(12);
    expect(cardsOf('knight')).toHaveLength(13);
    expect(cardsOf('thief')).toHaveLength(12);
    expect(cardsOf('ranger')).toHaveLength(14);
    expect(cardsOf('druid')).toHaveLength(13);
    expect(shape('brute')[1]).toEqual([2, 0, 'allDiscardDraw3', 'power play']);
    expect(shape('brute')[6]).toEqual([2, 0, 'destroyOneShield', 'power draw']);
    expect(shape('knight')[2]).toEqual([2, 0, 'takeFromDiscard', 'power heal']);
    expect(shape('druid')[11]).toEqual([2, 0, 'freeFormPlay', 'draw power']);
    expect(shape('druid')[12]).toEqual([3, 0, 'formWolf', 'atk power']);
    expect(shape('druid')[1]).toEqual([2, 1, '', 'atk']);
    expect(CARDS['druid.04']!.attack).toBe(true);
    expect(CARDS['druid.07']!.attack).toBe(false);
    // Shield cards per hero (kinds, copies).
    const shields = (hero: (typeof HERO_IDS)[number]) => {
      const list = cardsOf(hero).filter((c) => c.shield > 0);
      return [list.length, list.reduce((n, c) => n + c.count, 0)];
    };
    expect(shields('brute')).toEqual([4, 4]);
    expect(shields('mage')).toEqual([3, 4]);
    expect(shields('knight')).toEqual([3, 5]);
    expect(shields('thief')).toEqual([3, 5]);
    expect(shields('ranger')).toEqual([3, 5]);
    expect(shields('druid')).toEqual([3, 5]);
    const powers = (hero: (typeof HERO_IDS)[number]) =>
      cardsOf(hero)
        .filter((c) => c.effect)
        .reduce((n, c) => n + c.count, 0);
    expect([HERO_IDS.map(powers)]).toEqual([[6, 6, 3, 6, 6, 9, 7, 6, 6, 6, 7, 7]]);
    for (const h of HERO_IDS) expect(HEROES[h].id).toBe(h);
  });
});

describe('lobby', () => {
  const lobby = (n: number) => {
    const rng = createRng(1);
    const ps = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
    let state = tavernBrawl.create(
      { now: NOW, rng, content: { wordLists: () => [], words: () => [] } },
      ps,
    );
    for (const p of ps) state = tavernBrawl.playerJoined(state, p);
    return harness(state);
  };

  it('seats six and lets the rest wait', () => {
    const h = lobby(7);
    expect(h.state.seats.p6!.playing).toBe(true);
    expect(h.state.seats.p7!.playing).toBe(false);
    expect(h.state.seats.p7!.waiting).toBe(true);
  });

  it('keeps heroes unique', () => {
    const h = lobby(2);
    h.act('p1', { type: 'pick-hero', hero: 'mage' });
    expect(h.refuse('p2', { type: 'pick-hero', hero: 'mage' })).toBe('taken');
    h.act('p2', { type: 'pick-hero', hero: 'random' });
    expect(h.state.seats.p2!.hero).not.toBe('mage');
    expect(h.state.seats.p2!.hero).not.toBeNull();
  });

  it('deals random heroes to everyone (host only)', () => {
    const h = lobby(4);
    expect(h.refuse('p2', { type: 'random-heroes' }, false)).toBe('not-host');
    h.act('p1', { type: 'random-heroes' });
    const heroes = Object.values(h.state.seats).map((s) => s.hero);
    expect(new Set(heroes).size).toBe(4);
    expect(heroes.every((x) => x !== null)).toBe(true);
  });

  it('needs a hero for everyone to start', () => {
    const h = lobby(2);
    h.act('p1', { type: 'pick-hero', hero: 'mage' });
    expect(h.refuse('p1', { type: 'start' })).toBe('no-hero');
    h.act('p2', { type: 'pick-hero', hero: 'brute' });
    h.act('p1', { type: 'start' });
    expect(h.state.phase).toBe('playing');
  });

  it('deals 10 hit points and 3 cards, and the first player draws one more', () => {
    const h = started(['mage', 'brute', 'knight']);
    for (const p of ['p1', 'p2', 'p3']) expect(hp(h, p)).toBe(10);
    expect(g(h).players.p1!.hand).toHaveLength(4);
    expect(g(h).players.p2!.hand).toHaveLength(3);
    expect(g(h).turn).toMatchObject({ player: 'p1', debt: 1, number: 1 });
    checkConservation(h.state);
  });

  it('picks a random first player', () => {
    const firsts = new Set<string>();
    for (let seed = 1; seed < 30; seed++) {
      const rng = createRng(seed);
      const ps = [1, 2, 3].map((i) => ({ id: `p${i}`, name: `P${i}` }));
      let s = tavernBrawl.create(
        { now: NOW, rng, content: { wordLists: () => [], words: () => [] } },
        ps,
      );
      for (const p of ps) s = tavernBrawl.playerJoined(s, p);
      const h = harness(s, seed);
      h.act('p1', { type: 'random-heroes' });
      h.act('p1', { type: 'start' });
      firsts.add(g(h).first);
    }
    expect(firsts.size).toBe(3);
  });
});

describe('the turn', () => {
  it('plays a card, attacks the only opponent and passes the turn', () => {
    const h = started(['mage', 'brute']);
    arrange(h, 'p1', { hand: ['mage.06', 'mage.01'] });
    h.play('p1', 'mage.06');
    expect(hp(h, 'p2')).toBe(7);
    expect(g(h).turn.player).toBe('p2');
    expect(g(h).players.p2!.hand).toHaveLength(4);
    expect(cardsIn(h, g(h).players.p1!.discard)).toEqual(['mage.06']);
    checkConservation(h.state);
  });

  it('owes one more card per ⚡', () => {
    const h = started(['mage', 'brute']);
    arrange(h, 'p1', { hand: ['mage.10', 'mage.01', 'mage.07', 'mage.01'] });
    h.play('p1', 'mage.10');
    expect(g(h).turn.debt).toBe(2);
    h.play('p1', 'mage.07');
    expect(g(h).turn.debt).toBe(2);
    h.play('p1', 'mage.01');
    expect(g(h).turn.debt).toBe(1);
    expect(g(h).turn.player).toBe('p1');
    h.play('p1', 'mage.01');
    expect(g(h).turn.player).toBe('p2');
    expect(hp(h, 'p2')).toBe(10 - 1 - 2 - 2);
  });

  it('refuses plays out of turn or from someone else’s hand', () => {
    const h = started(['mage', 'brute']);
    arrange(h, 'p2', { hand: ['brute.03'] });
    expect(h.refuse('p2', { type: 'play', card: h.inHand('p2', 'brute.03') })).toBe(
      'not-your-turn',
    );
    expect(h.refuse('p1', { type: 'play', card: h.inHand('p2', 'brute.03') })).toBe('not-in-hand');
  });

  it('draws 2 when the hand empties, between cards only', () => {
    const h = started(['mage', 'brute']);
    arrange(h, 'p1', { hand: ['mage.10', 'mage.06'], deck: ['mage.01', 'mage.01', 'mage.03'] });
    h.play('p1', 'mage.10');
    h.play('p1', 'mage.06');
    // Empty after the attack: drew 2 and still owes one.
    expect(cardsIn(h, g(h).players.p1!.hand)).toEqual(['mage.01', 'mage.01']);
    expect(g(h).turn.player).toBe('p1');
    expect(h.state.log.some((e) => e.kind === 'draw' && e.refill)).toBe(true);
  });

  it('does not refill after a last card that draws (A4)', () => {
    const h = started(['mage', 'brute']);
    arrange(h, 'p1', { hand: ['mage.05'] });
    h.play('p1', 'mage.05');
    expect(g(h).players.p1!.hand).toHaveLength(3);
    expect(h.state.log.some((e) => e.kind === 'draw' && e.refill)).toBe(false);
  });

  it('reshuffles the discard pile into an empty deck', () => {
    const h = started(['mage', 'brute']);
    const p2 = g(h).players.p2!;
    p2.discard = [...p2.deck];
    p2.deck = [];
    arrange(h, 'p1', { hand: ['mage.01'] });
    h.play('p1', 'mage.01');
    expect(logKinds(h)).toContain('reshuffle');
    expect(g(h).players.p2!.hand).toHaveLength(4);
    expect(g(h).players.p2!.discard).toHaveLength(0);
    checkConservation(h.state);
  });

  it('just doesn’t draw with deck and discard both empty (A6), and passes with nothing to play', () => {
    const h = started(['mage', 'brute', 'knight']);
    exhaust(h, 'p2');
    g(h).players.p2!.hand = [];
    arrange(h, 'p1', { hand: ['mage.01', 'mage.01'] });
    h.play('p1', 'mage.01');
    if (g(h).choice) h.choose('p1', 'p3');
    expect(g(h).turn.player).toBe('p3');
    expect(logKinds(h)).toContain('pass');
  });

  it('moves played cards to their owners’ discards at the end of the turn', () => {
    const h = started(['thief', 'mage']);
    arrange(h, 'p1', { hand: ['thief.07'] });
    arrange(h, 'p2', { deck: ['mage.01'] });
    h.play('p1', 'thief.07');
    expect(cardsIn(h, g(h).players.p2!.discard)).toEqual(['mage.01']);
    expect(cardsIn(h, g(h).players.p1!.discard)).toEqual(['thief.07']);
  });
});

describe('shields and damage', () => {
  const twoShields = () => {
    const h = started(['mage', 'brute']);
    arrange(h, 'p1', { hand: ['mage.06', 'mage.01'] });
    arrange(h, 'p2', { shields: ['brute.09', 'brute.13'] });
    return h;
  };

  it('asks which shield to hit when it matters, then overflows (A2)', () => {
    const h = twoShields();
    h.play('p1', 'mage.06');
    expect(g(h).choice?.kind).toBe('target');
    h.choose('p1', h.shieldOf('p2', 'brute.13'));
    const shields = g(h).players.p2!.shields;
    expect(shields).toHaveLength(1);
    expect(shields[0]!.damage).toBe(1);
    expect(hp(h, 'p2')).toBe(10);
    expect(cardsIn(h, g(h).players.p2!.discard)).toEqual(['brute.13']);
  });

  it('asks for the shield order after picking the player', () => {
    const h = twoShields();
    h.play('p1', 'mage.06');
    h.choose('p1', 'p2');
    expect(g(h).choice?.kind).toBe('shield');
    h.choose('p1', h.shieldOf('p2', 'brute.09'));
    expect(g(h).players.p2!.shields.map((s) => s.damage)).toEqual([0]);
    expect(
      cardsIn(
        h,
        g(h).players.p2!.shields.map((s) => s.id),
      ),
    ).toEqual(['brute.13']);
  });

  it('skips the question when every shield breaks anyway', () => {
    const h = started(['brute', 'mage']);
    arrange(h, 'p1', { hand: ['brute.10'] });
    arrange(h, 'p2', { shields: ['mage.09', 'mage.11'] });
    h.play('p1', 'brute.10');
    expect(g(h).choice).toBeNull();
    expect(g(h).players.p2!.shields).toHaveLength(0);
    expect(hp(h, 'p2')).toBe(9);
  });

  it('keeps damage marks between turns', () => {
    const h = started(['mage', 'brute']);
    arrange(h, 'p1', { hand: ['mage.01'] });
    arrange(h, 'p2', { shields: ['brute.09'] });
    h.play('p1', 'mage.01');
    expect(g(h).players.p2!.shields[0]!.damage).toBe(2);
  });

  it('lets shields block power damage too (A3)', () => {
    const h = started(['mage', 'brute']);
    arrange(h, 'p1', { hand: ['mage.04'], shields: ['mage.11'] });
    arrange(h, 'p2', { shields: ['brute.13'] });
    h.play('p1', 'mage.04');
    expect(hp(h, 'p1')).toBe(9);
    expect(hp(h, 'p2')).toBe(9);
  });

  it('caps healing at 10', () => {
    const h = started(['mage', 'brute']);
    arrange(h, 'p1', { hand: ['mage.03', 'mage.01'], hp: 10 });
    h.play('p1', 'mage.03');
    expect(hp(h, 'p1')).toBe(10);
  });

  it('adds the attack bonus to attack cards played after it, per target, stacking (B1)', () => {
    const h = started(['ranger', 'brute']);
    arrange(h, 'p1', { hand: ['ranger.11', 'ranger.02', 'ranger.02', 'ranger.13'] });
    h.play('p1', 'ranger.11');
    expect(hp(h, 'p2')).toBe(9);
    h.play('p1', 'ranger.02');
    h.play('p1', 'ranger.02');
    h.play('p1', 'ranger.13');
    expect(hp(h, 'p2')).toBe(9 - 4);
  });
});

describe('knockouts', () => {
  it('checks knockouts after the whole card: a double knockout is a tie (A7)', () => {
    const h = started(['mage', 'brute']);
    arrange(h, 'p1', { hand: ['mage.04'], hp: 2 });
    arrange(h, 'p2', { hp: 3 });
    h.play('p1', 'mage.04');
    expect(h.state.phase).toBe('over');
    expect(g(h).winners).toEqual([]);
    expect(g(h).endReason).toBe('tie');
  });

  it('ends the turn of a player who knocks themselves out, debt and all', () => {
    const h = started(['mage', 'brute', 'knight']);
    arrange(h, 'p1', { hand: ['mage.10', 'mage.04', 'mage.01'], hp: 2 });
    h.play('p1', 'mage.10');
    h.play('p1', 'mage.04');
    expect(g(h).players.p1!.out).toBe(true);
    expect(g(h).turn.player).toBe('p2');
    expect(g(h).knockouts[0]).toMatchObject({ player: 'p1', by: 'p1', card: 'mage.04' });
    checkConservation(h.state);
  });

  it('never targets a knocked-out player (A9)', () => {
    const h = started(['mage', 'brute', 'knight']);
    g(h).players.p3!.out = true;
    arrange(h, 'p1', { hand: ['mage.06', 'mage.01'] });
    h.play('p1', 'mage.06');
    expect(g(h).choice).toBeNull();
    expect(hp(h, 'p2')).toBe(7);
  });

  it('wins for the last one standing', () => {
    const h = started(['mage', 'brute']);
    arrange(h, 'p1', { hand: ['mage.06'] });
    arrange(h, 'p2', { hp: 2 });
    h.play('p1', 'mage.06');
    expect(h.state.phase).toBe('over');
    expect(g(h).winners).toEqual(['p1']);
  });
});

describe('core powers', () => {
  it('the spin: heal per opponent (disguised too), then 1 to each reachable opponent', () => {
    const h = started(['brute', 'thief', 'mage']);
    arrange(h, 'p1', { hand: ['brute.15'], hp: 5 });
    g(h).lasting.push({ kind: 'disguise', player: 'p2', card: 'x' });
    h.play('p1', 'brute.15');
    expect(hp(h, 'p1')).toBe(7);
    expect(hp(h, 'p2')).toBe(10);
    expect(hp(h, 'p3')).toBe(9);
  });

  it('fresh hands: everyone discards and draws 3; borrowed cards go home', () => {
    const h = started(['brute', 'ranger', 'mage']);
    arrange(h, 'p1', { hand: ['brute.02', 'ranger.03'] });
    arrange(h, 'p2', { hand: ['ranger.01'] });
    h.play('p1', 'brute.02');
    for (const p of ['p1', 'p2', 'p3']) expect(g(h).players[p]!.hand).toHaveLength(3);
    expect(cardsIn(h, g(h).players.p2!.discard)).toContain('ranger.03');
    expect(g(h).turn.debt).toBe(1);
    checkConservation(h.state);
  });

  it('breaking a shield destroys your own when it is the only one (#8), else asks', () => {
    const h = started(['brute', 'mage']);
    arrange(h, 'p1', { hand: ['brute.07', 'brute.07'], shields: ['brute.13'] });
    h.play('p1', 'brute.07');
    expect(g(h).players.p1!.shields).toHaveLength(0);
    expect(cardsIn(h, g(h).players.p1!.discard)).toContain('brute.13');
  });

  it('breaking a shield with none in play does nothing but the draw', () => {
    const h = started(['brute', 'mage']);
    arrange(h, 'p1', { hand: ['brute.07'] });
    h.play('p1', 'brute.07');
    expect(logKinds(h)).toContain('fizzle');
    expect(g(h).players.p1!.hand).toHaveLength(1);
  });

  it('the blast hits everyone in seat order, you too', () => {
    const h = started(['mage', 'brute', 'knight']);
    arrange(h, 'p1', { hand: ['mage.04'] });
    h.play('p1', 'mage.04');
    expect([hp(h, 'p1'), hp(h, 'p2'), hp(h, 'p3')]).toEqual([7, 7, 7]);
  });

  it('taking a shield keeps its damage; it goes to its owner’s discard when broken', () => {
    const h = started(['mage', 'brute']);
    arrange(h, 'p1', { hand: ['mage.02'] });
    arrange(h, 'p2', { shields: [['brute.09', 1]], hand: ['brute.04'] });
    h.play('p1', 'mage.02');
    expect(g(h).players.p1!.shields.map((sh) => sh.damage)).toEqual([1]);
    expect(g(h).players.p2!.shields).toHaveLength(0);
    h.play('p2', 'brute.04');
    expect(g(h).players.p1!.shields).toHaveLength(0);
    expect(hp(h, 'p1')).toBe(10);
    expect(cardsIn(h, g(h).players.p2!.discard)).toContain('brute.09');
  });

  it('a taken shield stays with its holder when its owner is knocked out', () => {
    const h = started(['mage', 'brute', 'knight']);
    arrange(h, 'p1', { hand: ['mage.02', 'mage.06'] });
    arrange(h, 'p2', { shields: ['brute.09'] });
    h.play('p1', 'mage.02');
    g(h).players.p2!.hp = 0;
    // Any card ends with the knockout check.
    arrange(h, 'p2', { hand: ['brute.03'] });
    h.play('p2', 'brute.03');
    if (g(h).choice) h.choose('p2', 'p3');
    expect(g(h).players.p2!.out).toBe(true);
    expect(
      cardsIn(
        h,
        g(h).players.p1!.shields.map((s) => s.id),
      ),
    ).toEqual(['brute.09']);
  });

  it('a knocked-out holder sends a taken shield home', () => {
    const h = started(['mage', 'brute', 'knight']);
    arrange(h, 'p1', { hand: ['mage.01'] });
    arrange(h, 'p2', { shields: ['brute.09'] });
    g(h).players.p1!.shields.push(g(h).players.p2!.shields.pop()!);
    g(h).players.p1!.hp = 0;
    h.play('p1', 'mage.01');
    if (g(h).choice) h.choose('p1', 'p3');
    expect(g(h).players.p1!.out).toBe(true);
    expect(g(h).players.p1!.shields).toHaveLength(0);
    expect(cardsIn(h, g(h).players.p2!.discard)).toContain('brute.09');
    checkConservation(h.state);
  });

  it('the swap power trades hit points with an opponent', () => {
    const h = started(['mage', 'brute', 'knight']);
    arrange(h, 'p1', { hand: ['mage.12'], hp: 3 });
    arrange(h, 'p3', { hp: 8 });
    h.play('p1', 'mage.12');
    expect(g(h).choice?.kind).toBe('swap');
    h.choose('p1', 'p3');
    expect([hp(h, 'p1'), hp(h, 'p3')]).toEqual([8, 3]);
  });

  it('taking a card back only reaches cards discarded before this turn (A13)', () => {
    const h = started(['knight', 'brute']);
    arrange(h, 'p1', {
      hand: ['knight.01', 'knight.03'],
      shields: ['knight.08'],
      discard: ['knight.11'],
      hp: 5,
    });
    h.play('p1', 'knight.01');
    expect(cardsIn(h, g(h).players.p1!.discard)).toEqual(['knight.11', 'knight.08']);
    h.play('p1', 'knight.03');
    // Only knight.11 was there before the turn, so no question was asked.
    expect(cardsIn(h, g(h).players.p1!.hand)).toEqual(['knight.11']);
    expect(cardsIn(h, g(h).players.p1!.discard)).toEqual(['knight.08', 'knight.01', 'knight.03']);
    expect(hp(h, 'p1')).toBe(7);
  });

  it('breaking all shields destroys every shield, yours too', () => {
    const h = started(['knight', 'brute']);
    arrange(h, 'p1', { hand: ['knight.01', 'knight.12'], shields: ['knight.04'] });
    arrange(h, 'p2', { shields: ['brute.09', 'brute.13'] });
    h.play('p1', 'knight.01');
    expect(g(h).players.p1!.shields).toHaveLength(0);
    expect(g(h).players.p2!.shields).toHaveLength(0);
    expect(g(h).turn.debt).toBe(1);
  });

  describe('disguise', () => {
    const disguised = () => {
      const h = started(['thief', 'mage', 'brute']);
      arrange(h, 'p1', { hand: ['thief.02'], shields: ['thief.10'] });
      h.play('p1', 'thief.02');
      expect(g(h).turn.player).toBe('p2');
      return h;
    };

    it('takes the thief out of opponents’ targets and everyone-effects', () => {
      const h = disguised();
      arrange(h, 'p2', { hand: ['mage.04'] });
      h.play('p2', 'mage.04');
      expect([hp(h, 'p1'), hp(h, 'p2'), hp(h, 'p3')]).toEqual([10, 7, 7]);
      arrange(h, 'p3', { hand: ['brute.03'] });
      h.play('p3', 'brute.03');
      expect(g(h).choice).toBeNull();
      expect(hp(h, 'p2')).toBe(4);
    });

    it('keeps the thief’s shields from smites and charms', () => {
      const h = disguised();
      arrange(h, 'p2', { hand: ['mage.02'] });
      h.play('p2', 'mage.02');
      expect(g(h).players.p1!.shields).toHaveLength(1);
      expect(logKinds(h)).toContain('fizzle');
    });

    it('makes an attack with only disguised targets fizzle', () => {
      const h = started(['thief', 'mage']);
      arrange(h, 'p1', { hand: ['thief.02'] });
      h.play('p1', 'thief.02');
      arrange(h, 'p2', { hand: ['mage.06'] });
      h.play('p2', 'mage.06');
      expect(hp(h, 'p1')).toBe(10);
      expect(logKinds(h)).toContain('fizzle');
    });

    it('ends at the start of the thief’s next turn', () => {
      const h = disguised();
      arrange(h, 'p2', { hand: ['mage.01'] });
      h.play('p2', 'mage.01');
      if (g(h).choice) h.choose('p2', 'p3');
      arrange(h, 'p3', { hand: ['brute.04'] });
      h.play('p3', 'brute.04');
      expect(g(h).turn.player).toBe('p1');
      expect(g(h).lasting).toHaveLength(0);
    });

    it('does not protect the thief from his own cards, stolen ones included (A15)', () => {
      const h = started(['thief', 'mage']);
      g(h).lasting.push({ kind: 'disguise', player: 'p1', card: 'x' });
      arrange(h, 'p1', { hand: ['thief.07'] });
      arrange(h, 'p2', { deck: ['mage.04'] });
      h.play('p1', 'thief.07');
      expect([hp(h, 'p1'), hp(h, 'p2')]).toEqual([7, 7]);
    });
  });

  describe('playing an opponent’s top card', () => {
    it('plays the top card of an opponent’s deck as yours (A14: opponents only)', () => {
      const h = started(['thief', 'mage', 'brute']);
      arrange(h, 'p1', { hand: ['thief.07', 'thief.01'] });
      arrange(h, 'p2', { deck: ['mage.10'] });
      h.play('p1', 'thief.07');
      expect(g(h).choice?.options.sort()).toEqual(['p2', 'p3']);
      h.choose('p1', 'p2');
      expect(g(h).turn.debt).toBe(2);
      expect(h.state.log.some((e) => e.kind === 'play' && e.stolen && e.card === 'mage.10')).toBe(
        true,
      );
    });

    it('keeps a stolen shield in front of the thief until it breaks, then sends it home', () => {
      const h = started(['thief', 'mage']);
      arrange(h, 'p1', { hand: ['thief.07'] });
      arrange(h, 'p2', { deck: ['mage.11'], hand: ['mage.06', 'mage.06'] });
      h.play('p1', 'thief.07');
      expect(
        cardsIn(
          h,
          g(h).players.p1!.shields.map((s) => s.id),
        ),
      ).toEqual(['mage.11']);
      h.play('p2', 'mage.06');
      expect(hp(h, 'p1')).toBe(9);
      expect(cardsIn(h, g(h).players.p2!.discard)).toContain('mage.11');
    });

    it('a stolen Form only gives its symbols and goes to the druid’s discard', () => {
      const h = started(['thief', 'druid']);
      arrange(h, 'p1', { hand: ['thief.07'], hp: 5 });
      arrange(h, 'p2', { deck: ['druid.06'] });
      h.play('p1', 'thief.07');
      expect(hp(h, 'p1')).toBe(7);
      expect(g(h).players.p1!.form).toBeNull();
      expect(cardsIn(h, g(h).players.p2!.discard)).toEqual(['druid.06']);
    });

    it('takes nothing from an empty deck and discard', () => {
      const h = started(['thief', 'mage']);
      arrange(h, 'p1', { hand: ['thief.07'] });
      exhaust(h, 'p2');
      h.play('p1', 'thief.07');
      expect(h.state.log.some((e) => e.kind === 'pickpocket' && e.card === null)).toBe(true);
    });
  });

  it('passing hit points rotates them to the right, skipping knocked-out players', () => {
    const h = started(['ranger', 'mage', 'brute', 'knight']);
    arrange(h, 'p1', { hand: ['ranger.10'], hp: 2 });
    arrange(h, 'p2', { hp: 5 });
    arrange(h, 'p3', { hp: 8 });
    g(h).players.p4!.out = true;
    h.play('p1', 'ranger.10');
    expect([hp(h, 'p1'), hp(h, 'p2'), hp(h, 'p3')]).toEqual([5, 8, 2]);
  });

  it('scouting takes each opponent’s top card; they go home when played', () => {
    const h = started(['ranger', 'mage', 'brute']);
    arrange(h, 'p1', { hand: ['ranger.09'] });
    arrange(h, 'p2', { deck: ['mage.10'] });
    arrange(h, 'p3', { deck: ['brute.03'] });
    h.play('p1', 'ranger.09');
    // Hand was emptied by the card itself and refilled with the two taken cards.
    expect(cardsIn(h, g(h).players.p1!.hand).sort()).toEqual(['brute.03', 'mage.10']);
    checkConservation(h.state);
  });

  describe('forms', () => {
    it('bear: heals 2, then 🐾 heals 1 more', () => {
      const h = started(['druid', 'mage']);
      arrange(h, 'p1', { hand: ['druid.06', 'druid.09', 'druid.04'], hp: 4 });
      h.play('p1', 'druid.09');
      h.play('p1', 'druid.06');
      expect(g(h).players.p1!.form?.kind).toBe('bear');
      expect(hp(h, 'p1')).toBe(6);
      h.play('p1', 'druid.04');
      expect(hp(h, 'p1')).toBe(7);
      expect(hp(h, 'p2')).toBe(8);
    });

    it('wolf: 🐾 adds 1 to an attack card, or attacks on its own', () => {
      const h = started(['druid', 'mage']);
      arrange(h, 'p1', { hand: ['druid.09', 'druid.04', 'druid.07'], form: 'wolf' });
      h.play('p1', 'druid.09');
      h.play('p1', 'druid.04');
      expect(hp(h, 'p2')).toBe(7);
      h.play('p1', 'druid.07');
      expect(hp(h, 'p2')).toBe(6);
    });

    it('🐾 does nothing without a Form', () => {
      const h = started(['druid', 'mage']);
      arrange(h, 'p1', { hand: ['druid.10'], hp: 5 });
      h.play('p1', 'druid.10');
      expect(hp(h, 'p1')).toBe(5);
      expect(g(h).players.p1!.shields).toHaveLength(1);
    });

    it('a new Form replaces the old one, which is discarded', () => {
      const h = started(['druid', 'mage']);
      arrange(h, 'p1', { hand: ['druid.13'], form: 'bear' });
      h.play('p1', 'druid.13');
      expect(g(h).players.p1!.form?.kind).toBe('wolf');
      expect(cardsIn(h, g(h).players.p1!.discard)).toEqual(['druid.06']);
      expect(hp(h, 'p2')).toBe(8);
      checkConservation(h.state);
    });

    it('commune: draws 2, then a free Form that costs no play', () => {
      const h = started(['druid', 'mage']);
      arrange(h, 'p1', { hand: ['druid.12', 'druid.13'], deck: ['druid.01', 'druid.01'] });
      h.play('p1', 'druid.12');
      expect(g(h).choice?.kind).toBe('form');
      h.choose('p1', h.inHand('p1', 'druid.13'));
      expect(g(h).players.p1!.form?.kind).toBe('wolf');
      expect(hp(h, 'p2')).toBe(8);
      expect(g(h).turn.player).toBe('p2');
    });

    it('commune can skip the free Form', () => {
      const h = started(['druid', 'mage']);
      arrange(h, 'p1', { hand: ['druid.12', 'druid.13'] });
      h.play('p1', 'druid.12');
      h.choose('p1', 'skip');
      expect(g(h).players.p1!.form).toBeNull();
      expect(g(h).players.p1!.hand).toHaveLength(3);
    });
  });

  describe('the howl', () => {
    it('done: 1 damage to each opponent, then play again', () => {
      const h = started(['druid', 'mage', 'brute']);
      arrange(h, 'p1', { hand: ['druid.08', 'druid.01'] });
      h.play('p1', 'druid.08');
      expect(g(h).choice?.kind).toBe('social');
      h.choose('p1', 'done');
      expect([hp(h, 'p2'), hp(h, 'p3')]).toEqual([9, 9]);
      expect(g(h).turn.debt).toBe(1);
    });

    it('skip: no damage, still play again', () => {
      const h = started(['druid', 'mage']);
      arrange(h, 'p1', { hand: ['druid.08', 'druid.01'] });
      h.play('p1', 'druid.08');
      h.choose('p1', 'skip');
      expect(hp(h, 'p2')).toBe(10);
      expect(g(h).turn.debt).toBe(1);
    });

    it('counts as done after 20 seconds, even with no timer', () => {
      const h = started(['druid', 'mage'], 7, { seconds: null });
      arrange(h, 'p1', { hand: ['druid.08', 'druid.01'] });
      h.play('p1', 'druid.08');
      h.tick(19_000);
      expect(g(h).choice?.kind).toBe('social');
      h.tick(1_000);
      expect(g(h).choice).toBeNull();
      expect(hp(h, 'p2')).toBe(9);
      expect(h.state.log.some((e) => e.kind === 'social' && e.auto)).toBe(true);
    });
  });
});

describe('timers and absent players', () => {
  it('a soft timer only reminds', () => {
    const h = started(['mage', 'brute'], 7, { seconds: 30, timerMode: 'soft' });
    h.tick(30_000);
    expect(g(h).clock?.reminded).toBe(true);
    expect(g(h).turn.plays).toBe(0);
    expect(tavernBrawl.nextDeadline!(h.state)).toBeNull();
  });

  it('a strict timer plays a random card', () => {
    const h = started(['mage', 'brute'], 7, { seconds: 30, timerMode: 'strict' });
    h.tick(30_000);
    expect(g(h).turn.plays + (g(h).turn.player === 'p2' ? 1 : 0)).toBeGreaterThan(0);
    expect(h.state.log.some((e) => e.kind === 'auto' && e.by === 'timer')).toBe(true);
    const due = tavernBrawl.nextDeadline!(h.state);
    expect(due === null || due > h.now).toBe(true);
  });

  it('the host can act for the player the table waits on', () => {
    const h = started(['mage', 'brute']);
    expect(h.refuse('p2', { type: 'act-for', player: 'p1' }, false)).toBe('not-host');
    expect(h.refuse('p1', { type: 'act-for', player: 'p2' })).toBe('not-waiting');
    h.act('p1', { type: 'act-for', player: 'p1' });
    expect(h.state.log.some((e) => e.kind === 'auto' && e.by === 'host')).toBe(true);
  });

  it('anyone can nudge, but not too often', () => {
    const h = started(['mage', 'brute']);
    h.act('p2', { type: 'nudge', player: 'p1' });
    expect(h.refuse('p2', { type: 'nudge', player: 'p1' })).toBe('too-soon');
  });

  it('plays for a player who left, after a short beat, and the host can remove them', () => {
    const h = started(['mage', 'brute', 'knight']);
    h.state = tavernBrawl.playerLeft(h.state, 'p1', h.now);
    expect(h.state.seats.p1).toBeDefined();
    h.tick(3_000);
    expect(h.state.log.some((e) => e.kind === 'auto' && e.by === 'left')).toBe(true);
    // Back on p1's turn later the table plays again; remove them instead.
    while (g(h).turn.player !== 'p1' && h.state.phase === 'playing') {
      const p = g(h).turn.player;
      h.act('p1', { type: 'act-for', player: p });
      while (g(h).choice) h.act('p1', { type: 'act-for', player: g(h).choice!.chooser });
    }
    if (h.state.phase !== 'playing') return;
    h.act('p1', { type: 'remove', player: 'p1' });
    expect(g(h).players.p1!.out).toBe(true);
    expect(g(h).knockouts.at(-1)).toMatchObject({ player: 'p1', removed: true });
  });

  it('a returning player gets their seat back', () => {
    const h = started(['mage', 'brute']);
    h.state = tavernBrawl.playerLeft(h.state, 'p2', h.now);
    expect(g(h).left.p2).toBeDefined();
    h.state = tavernBrawl.playerJoined(h.state, { id: 'p2', name: 'Player 2' });
    expect(g(h).left.p2).toBeUndefined();
  });
});

describe('play again', () => {
  it('deals a new game with the same seats and heroes', () => {
    const h = started(['mage', 'brute']);
    arrange(h, 'p1', { hand: ['mage.06'] });
    arrange(h, 'p2', { hp: 1 });
    h.play('p1', 'mage.06');
    expect(h.state.phase).toBe('over');
    h.act('p1', { type: 'play-again' });
    expect(h.state.phase).toBe('playing');
    expect(g(h).players.p1!.hero).toBe('mage');
    expect(hp(h, 'p2')).toBe(10);
  });
});
