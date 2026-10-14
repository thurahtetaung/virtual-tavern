import { describe, expect, it } from 'vitest';
import { tavernBrawl } from './game.ts';
import { arrange, cardsIn, checkConservation, started } from './test-utils.ts';
import type { TavernBrawlState } from './types.ts';

const g = (h: { state: TavernBrawlState }) => h.state.game!;
const hp = (h: { state: TavernBrawlState }, p: string) => g(h).players[p]!.hp;
const hand = (h: { state: TavernBrawlState }, p: string) => g(h).players[p]!.hand;
const choice = (h: { state: TavernBrawlState }) => g(h).choice;

describe('the dragon', () => {
  it('everyone chooses, going right, and you repeat each choice', () => {
    const h = started(['dragon', 'mage', 'brute']);
    arrange(h, 'p1', { hand: ['dragon.03', 'dragon.14'], hp: 5 });
    const before = hand(h, 'p2').length;
    h.play('p1', 'dragon.03');
    expect(choice(h)).toMatchObject({ kind: 'mna', chooser: 'p1' });
    h.choose('p1', 'heal');
    expect(hp(h, 'p1')).toBe(6);
    // Going right means the previous seat: p3 next, with the fixed out-of-turn clock.
    expect(choice(h)).toMatchObject({ kind: 'mna', chooser: 'p3' });
    expect(choice(h)!.deadline).toBe(h.now + 20_000);
    h.choose('p3', 'attack');
    expect(choice(h)).toMatchObject({ kind: 'target', chooser: 'p3' });
    h.choose('p3', 'p2');
    // The dragon repeats the attack at a target of its own choosing.
    expect(choice(h)).toMatchObject({ kind: 'target', chooser: 'p1' });
    h.choose('p1', 'p3');
    expect(choice(h)).toMatchObject({ kind: 'mna', chooser: 'p2' });
    h.choose('p2', 'draw');
    expect([hp(h, 'p1'), hp(h, 'p2'), hp(h, 'p3')]).toEqual([6, 9, 9]);
    // Drew 1 for the choice, then 1 more as their turn began.
    expect(hand(h, 'p2')).toHaveLength(before + 2);
    expect(hand(h, 'p1')).toHaveLength(2);
    checkConservation(h.state);
  });

  it('keeps all of its repeated attacks on one opponent', () => {
    const h = started(['dragon', 'mage', 'brute']);
    arrange(h, 'p1', { hand: ['dragon.03', 'dragon.14'] });
    h.play('p1', 'dragon.03');
    h.choose('p1', 'attack');
    h.choose('p1', 'p2');
    h.choose('p3', 'attack');
    h.choose('p3', 'p2');
    // No second question for the dragon: it hits p2 again.
    expect(choice(h)).toMatchObject({ kind: 'mna', chooser: 'p2' });
    h.choose('p2', 'heal');
    // Three hits on p2 (the dragon's own and its repeat of p3's, plus p3's), then p2 healed 1.
    expect([hp(h, 'p1'), hp(h, 'p2')]).toEqual([10, 8]);
  });

  it('draws for anyone who lets the 20 seconds run out', () => {
    const h = started(['dragon', 'mage'], 7, { seconds: null });
    arrange(h, 'p1', { hand: ['dragon.03', 'dragon.14'] });
    const before = hand(h, 'p2').length;
    h.play('p1', 'dragon.03');
    h.choose('p1', 'heal');
    expect(choice(h)!.chooser).toBe('p2');
    h.tick(20_000);
    expect(hand(h, 'p2')).toHaveLength(before + 2);
    expect(choice(h)).toBeNull();
  });

  it('cashes in the rest of its hand for up to 5 damage, then draws 2', () => {
    const h = started(['dragon', 'mage']);
    arrange(h, 'p1', { hand: ['dragon.04', 'dragon.01', 'dragon.07', 'dragon.09'] });
    h.play('p1', 'dragon.04');
    expect(hp(h, 'p2')).toBe(7);
    expect(cardsIn(h, g(h).players.p1!.discard)).toEqual(
      expect.arrayContaining(['dragon.01', 'dragon.07', 'dragon.09', 'dragon.04']),
    );
    expect(hand(h, 'p1')).toHaveLength(2);
  });

  it('caps the cash-in at 5', () => {
    const h = started(['dragon', 'mage']);
    arrange(h, 'p1', {
      hand: [
        'dragon.04',
        'dragon.01',
        'dragon.01',
        'dragon.02',
        'dragon.02',
        'dragon.07',
        'dragon.09',
      ],
    });
    h.play('p1', 'dragon.04');
    expect(hp(h, 'p2')).toBe(5);
  });

  it('hits all, then 2 at one, then 1 at a different one', () => {
    const h = started(['dragon', 'mage', 'brute']);
    arrange(h, 'p1', { hand: ['dragon.05', 'dragon.14'] });
    h.play('p1', 'dragon.05');
    expect(choice(h)!.kind).toBe('opponent');
    h.choose('p1', 'p2');
    // The second target can't be the first: only p3 is left, so no question.
    expect([hp(h, 'p2'), hp(h, 'p3')]).toEqual([7, 8]);
  });
});

describe('the owl', () => {
  it('smashes a shield into that much damage', () => {
    const h = started(['owl', 'mage']);
    arrange(h, 'p1', { hand: ['owl.14', 'owl.06'] });
    arrange(h, 'p2', { shields: [['mage.08', 1]] });
    h.play('p1', 'owl.14');
    expect(g(h).players.p2!.shields).toHaveLength(0);
    expect(hp(h, 'p2')).toBe(7);
  });

  it('gets everyone dancing: dancers draw 1, the owl 1 more per dancer', () => {
    const h = started(['owl', 'mage', 'brute'], 7, { seconds: null });
    arrange(h, 'p1', { hand: ['owl.05', 'owl.06'] });
    const p2 = hand(h, 'p2').length;
    const p3 = hand(h, 'p3').length;
    h.play('p1', 'owl.05');
    expect(choice(h)).toMatchObject({ kind: 'social', chooser: 'p1', flavour: 'dance' });
    h.choose('p1', 'done');
    expect(choice(h)!.chooser).toBe('p2');
    h.choose('p2', 'skip');
    expect(choice(h)!.chooser).toBe('p3');
    h.tick(20_000);
    expect(hand(h, 'p3')).toHaveLength(p3 + 1);
    // p2 didn't dance, and drew only as their turn began.
    expect(hand(h, 'p2')).toHaveLength(p2 + 1);
    // Owl: 1 for dancing, then 2 for the two dancers, plus the other card still held.
    expect(hand(h, 'p1')).toHaveLength(4);
  });

  it('hits every opponent until its next turn, with its own attack too', () => {
    const h = started(['owl', 'mage', 'brute']);
    arrange(h, 'p1', { hand: ['owl.09', 'owl.06'] });
    h.play('p1', 'owl.09');
    expect([hp(h, 'p2'), hp(h, 'p3')]).toEqual([9, 9]);
    h.play('p1', 'owl.06');
    expect([hp(h, 'p2'), hp(h, 'p3')]).toEqual([7, 7]);
    expect(g(h).lasting.some((l) => l.kind === 'allOpps')).toBe(true);
  });
});

describe('the psychic', () => {
  it('swaps hands; an emptied hand draws 2 once the card has resolved', () => {
    const h = started(['psychic', 'mage']);
    arrange(h, 'p1', { hand: ['psychic.14'] });
    arrange(h, 'p2', { hand: ['mage.01', 'mage.06', 'mage.03'] });
    h.play('p1', 'psychic.14');
    expect(cardsIn(h, hand(h, 'p1'))).toEqual(['mage.01', 'mage.06', 'mage.03']);
    // p2 got the psychic's empty hand, so drew 2 (and 1 more at the start of their turn).
    expect(hand(h, 'p2')).toHaveLength(3);
    checkConservation(h.state);
  });

  it('takes the top of each opponent’s discard pile', () => {
    const h = started(['psychic', 'mage', 'brute']);
    arrange(h, 'p1', { hand: ['psychic.05', 'psychic.04'] });
    arrange(h, 'p2', { discard: ['mage.01', 'mage.06'] });
    h.play('p1', 'psychic.05');
    expect(cardsIn(h, hand(h, 'p1')).sort()).toEqual(['mage.06', 'psychic.04']);
    expect(g(h).cards[hand(h, 'p1').find((i) => g(h).cards[i]!.card === 'mage.06')!]!.owner).toBe(
      'p2',
    );
  });

  it('blasts one damage per card in the target’s hand, up to 5', () => {
    const h = started(['psychic', 'mage']);
    arrange(h, 'p1', { hand: ['psychic.07'] });
    arrange(h, 'p2', {
      hand: ['mage.01', 'mage.01', 'mage.01', 'mage.06', 'mage.06', 'mage.06', 'mage.03'],
    });
    h.play('p1', 'psychic.07');
    expect(hp(h, 'p2')).toBe(5);
  });
});

describe('the slime', () => {
  it('eats a shield for its printed points in health', () => {
    const h = started(['slime', 'mage']);
    arrange(h, 'p1', { hand: ['slime.02'], hp: 4 });
    arrange(h, 'p2', { shields: [['mage.08', 2]] });
    h.play('p1', 'slime.02');
    expect(hp(h, 'p1')).toBe(7);
    expect(g(h).players.p2!.shields).toHaveLength(0);
  });

  it('ignores shields this turn, its own swords included', () => {
    const h = started(['slime', 'mage']);
    arrange(h, 'p1', { hand: ['slime.05', 'slime.07'] });
    arrange(h, 'p2', { shields: ['mage.08'] });
    h.play('p1', 'slime.05');
    expect(hp(h, 'p2')).toBe(7);
    expect(g(h).players.p2!.shields[0]!.damage).toBe(0);
  });

  describe('the strike-back shield', () => {
    it('strikes twice for its holder after the card that broke it', () => {
      const h = started(['brute', 'slime', 'mage'], 7, { seconds: null });
      arrange(h, 'p1', { hand: ['brute.10'] });
      arrange(h, 'p2', { shields: ['slime.01'] });
      h.play('p1', 'brute.10');
      if (choice(h)?.kind === 'target') h.choose('p1', 'p2');
      expect(hp(h, 'p2')).toBe(9);
      // Two separate 1-damage attacks, asked of the slime on someone else's turn.
      expect(choice(h)).toMatchObject({ kind: 'target', chooser: 'p2' });
      expect(choice(h)!.deadline).toBeDefined();
      h.choose('p2', 'p1');
      h.choose('p2', 'p3');
      expect([hp(h, 'p1'), hp(h, 'p3')]).toEqual([9, 9]);
      expect(g(h).turn.player).toBe('p2');
    });

    it('also strikes when a power destroys it', () => {
      const h = started(['brute', 'slime']);
      arrange(h, 'p1', { hand: ['brute.07', 'brute.01'] });
      arrange(h, 'p2', { shields: ['slime.01'] });
      h.play('p1', 'brute.07');
      expect(hp(h, 'p1')).toBe(8);
    });

    it('doesn’t strike when its holder is knocked out', () => {
      const h = started(['brute', 'slime', 'mage']);
      arrange(h, 'p1', { hand: ['brute.10'] });
      arrange(h, 'p2', { shields: [['slime.01', 2]], hp: 1 });
      h.play('p1', 'brute.10');
      if (choice(h)?.kind === 'target') h.choose('p1', 'p2');
      expect(g(h).players.p2!.out).toBe(true);
      expect(hp(h, 'p1')).toBe(10);
      expect(g(h).turn.player).toBe('p3');
    });
  });
});

describe('the eye', () => {
  it('asks each opponent for praise and hits those who refuse', () => {
    const h = started(['eye', 'mage', 'brute']);
    arrange(h, 'p1', { hand: ['eye.06'] });
    h.play('p1', 'eye.06');
    expect(hand(h, 'p1')).toHaveLength(3);
    expect(choice(h)).toMatchObject({ kind: 'social', chooser: 'p2', flavour: 'praise' });
    h.choose('p2', 'done');
    h.choose('p3', 'skip');
    expect([hp(h, 'p2'), hp(h, 'p3')]).toEqual([10, 8]);
  });

  it('steers other players’ attack cards, but never back at the attacker', () => {
    const h = started(['eye', 'mage', 'brute']);
    arrange(h, 'p1', { hand: ['eye.09'] });
    h.play('p1', 'eye.09');
    expect(g(h).turn.player).toBe('p2');
    arrange(h, 'p2', { hand: ['mage.06', 'mage.01'] });
    h.play('p2', 'mage.06');
    h.choose('p2', 'p1');
    expect(choice(h)).toMatchObject({ kind: 'redirect', chooser: 'p1', attacker: 'p2' });
    expect(choice(h)!.options.sort()).toEqual(['p1', 'p3']);
    h.choose('p1', 'p3');
    expect([hp(h, 'p1'), hp(h, 'p3')]).toEqual([10, 7]);
  });

  it('leaves a steered attack where it was aimed when time runs out', () => {
    const h = started(['eye', 'mage', 'brute'], 7, { seconds: null });
    arrange(h, 'p1', { hand: ['eye.09'] });
    h.play('p1', 'eye.09');
    arrange(h, 'p2', { hand: ['mage.06', 'mage.01'] });
    h.play('p2', 'mage.06');
    h.choose('p2', 'p1');
    h.tick(20_000);
    expect(hp(h, 'p1')).toBe(7);
  });

  it('hits the unshielded, then wipes every shield', () => {
    const h = started(['eye', 'mage', 'brute']);
    arrange(h, 'p1', { hand: ['eye.05'], shields: ['eye.14'] });
    arrange(h, 'p3', { shields: ['brute.13'] });
    h.play('p1', 'eye.05');
    expect([hp(h, 'p2'), hp(h, 'p3')]).toEqual([8, 10]);
    for (const p of ['p1', 'p2', 'p3']) expect(g(h).players[p]!.shields).toHaveLength(0);
  });
});

describe('the mimic', () => {
  it('copies a shield: its symbols happen and it stays as that shield', () => {
    const h = started(['mimic', 'dragon']);
    arrange(h, 'p1', { hand: ['mimic.13'] });
    arrange(h, 'p2', { shields: ['dragon.11'] });
    h.play('p1', 'mimic.13');
    // The copied card's own attack broke p2's 1-point shield.
    expect(hp(h, 'p2')).toBe(10);
    expect(g(h).players.p2!.shields).toHaveLength(0);
    expect(g(h).players.p1!.shields).toEqual([
      expect.objectContaining({ copyOf: 'dragon.11', damage: 0 }),
    ]);
    checkConservation(h.state);
  });

  it('a copy of a copy copies the original; with no shield in play it’s just discarded', () => {
    const h = started(['mimic', 'dragon']);
    arrange(h, 'p1', { hand: ['mimic.13', 'mimic.02', 'mimic.13'] });
    arrange(h, 'p2', { shields: ['dragon.06'] });
    h.play('p1', 'mimic.02');
    h.play('p1', 'mimic.13');
    h.play('p1', 'mimic.13');
    if (choice(h)?.kind === 'mirror') h.choose('p1', g(h).players.p1!.shields[0]!.id);
    expect(g(h).players.p1!.shields.map((s) => s.copyOf)).toEqual(['dragon.06', 'dragon.06']);
    const h2 = started(['mimic', 'dragon']);
    arrange(h2, 'p1', { hand: ['mimic.13'] });
    h2.play('p1', 'mimic.13');
    expect(h2.state.game!.players.p1!.shields).toHaveLength(0);
    expect(cardsIn(h2, h2.state.game!.players.p1!.discard)).toContain('mimic.13');
  });

  it('borrows the first power of the nearest neighbour still in on either side', () => {
    const h = started(['mimic', 'brute', 'mage', 'knight']);
    g(h).players.p4!.out = true;
    arrange(h, 'p1', { hand: ['mimic.11'] });
    h.play('p1', 'mimic.11');
    // Left is p2 (the brute); right skips the knocked-out p4 to p3 (the mage).
    expect(choice(h)!.options.sort()).toEqual(['p2', 'p3']);
    h.choose('p1', 'p3');
    expect([hp(h, 'p1'), hp(h, 'p2'), hp(h, 'p3')]).toEqual([7, 7, 7]);
  });

  it('makes one player’s hit points equal another’s', () => {
    const h = started(['mimic', 'mage', 'brute']);
    arrange(h, 'p1', { hand: ['mimic.12'], hp: 3 });
    h.play('p1', 'mimic.12');
    h.choose('p1', 'p2');
    h.choose('p1', 'p1');
    expect(hp(h, 'p2')).toBe(3);
  });
});

describe('five or six players', () => {
  const five = () => started(['mage', 'brute', 'knight', 'thief', 'ranger']);

  it('lets regular attacks reach only the living neighbours', () => {
    const h = five();
    expect(g(h).zone).toBe(true);
    arrange(h, 'p1', { hand: ['mage.06', 'mage.01'] });
    h.play('p1', 'mage.06');
    expect(choice(h)!.options.sort()).toEqual(['p2', 'p5']);
  });

  it('skips knocked-out seats for neighbours', () => {
    const h = five();
    g(h).players.p2!.out = true;
    g(h).players.p2!.ghost = true;
    arrange(h, 'p1', { hand: ['mage.06', 'mage.01'] });
    h.play('p1', 'mage.06');
    expect(choice(h)!.options.sort()).toEqual(['p3', 'p5']);
  });

  it('lets powers reach anyone, their swords included', () => {
    const h = started(['slime', 'brute', 'knight', 'thief', 'ranger']);
    arrange(h, 'p1', { hand: ['slime.05'] });
    h.play('p1', 'slime.05');
    expect(
      choice(h)!
        .options.filter((o) => o.startsWith('p'))
        .sort(),
    ).toEqual(['p2', 'p3', 'p4', 'p5']);
  });

  it('a ghost’s attack stops at 1 hit point and skips 1-hit-point players', () => {
    const h = five();
    for (const p of ['p3', 'p4', 'p5']) g(h).players[p]!.hp = 1;
    arrange(h, 'p1', { hand: ['mage.06', 'mage.01'] });
    arrange(h, 'p2', { hp: 3 });
    h.play('p1', 'mage.06');
    h.choose('p1', 'p2');
    // The ghost's only legal target is p1 (10 hit points): no question.
    expect(hp(h, 'p1')).toBe(9);
    expect(g(h).turn.player).toBe('p3');
    const ghostHits = h.state.log.filter((e) => e.kind === 'damage' && e.ghost);
    expect(ghostHits).toHaveLength(1);
  });

  it('a ghost with nobody above 1 hit point skips its attack', () => {
    const h = five();
    for (const p of ['p3', 'p4', 'p5']) g(h).players[p]!.hp = 1;
    arrange(h, 'p1', { hand: ['mage.06', 'mage.01'], hp: 1 });
    arrange(h, 'p2', { hp: 3 });
    h.play('p1', 'mage.06');
    h.choose('p1', 'p2');
    expect(h.state.log.some((e) => e.kind === 'haunt')).toBe(true);
    expect(g(h).turn.player).toBe('p3');
  });

  it('never lets a ghost win', () => {
    const h = five();
    for (const p of ['p3', 'p4', 'p5']) {
      g(h).players[p]!.out = true;
      g(h).players[p]!.ghost = true;
    }
    arrange(h, 'p1', { hand: ['mage.06'] });
    arrange(h, 'p2', { hp: 3 });
    h.play('p1', 'mage.06');
    expect(h.state.phase).toBe('over');
    expect(g(h).winners).toEqual(['p1']);
  });

  it('is shown in the view', () => {
    const h = five();
    expect(tavernBrawl.view(h.state, 'p1').game!.zone).toBe(true);
  });
});

describe('the zone and the ghosts, more rulings', () => {
  it('lets every attack during the dragon’s everyone-chooses reach anyone', () => {
    const h = started(['dragon', 'brute', 'knight', 'thief', 'ranger']);
    arrange(h, 'p1', { hand: ['dragon.03', 'dragon.14'] });
    h.play('p1', 'dragon.03');
    h.choose('p1', 'attack');
    // p3 and p4 are not neighbours of p1, yet both can be hit.
    expect(
      choice(h)!
        .options.filter((o) => o.startsWith('p'))
        .sort(),
    ).toEqual(['p2', 'p3', 'p4', 'p5']);
  });

  it('lets a shield absorb a ghost’s attack', () => {
    const h = started(['mage', 'brute', 'knight', 'thief', 'ranger']);
    for (const p of ['p3', 'p4', 'p5']) g(h).players[p]!.hp = 1;
    arrange(h, 'p1', { hand: ['mage.06', 'mage.01'], shields: ['mage.08'] });
    arrange(h, 'p2', { hp: 3 });
    const shield = h.shieldOf('p1', 'mage.08');
    h.play('p1', 'mage.06');
    h.choose('p1', 'p2');
    // The ghost's only target is p1, whose shield takes the hit.
    expect(hp(h, 'p1')).toBe(10);
    const sh = g(h).players.p1!.shields.find((x) => x.id === shield);
    expect(sh ? sh.damage : 'destroyed').not.toBe(0);
  });

  it('seats six and turns the zone on', () => {
    const h = started(['dragon', 'owl', 'psychic', 'slime', 'eye', 'mimic']);
    expect(g(h).order).toHaveLength(6);
    expect(g(h).zone).toBe(true);
    const h4 = started(['dragon', 'owl', 'psychic', 'slime']);
    expect(g(h4).zone).toBeFalsy();
  });
});
