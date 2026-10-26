import { describe, expect, it } from 'vitest';
import { HAND_SIZE, PRESETS, menuProblem, randomMenu } from './cards.ts';
import { conveyor, waitingOn, winnersOf } from './game.ts';
import { dessertRows, roundRows } from './score.ts';
import { HOST, game, harness, ks, pickAll, player, playing, tray } from './test-utils.ts';
import type { Played } from './types.ts';

const rows = (
  trays: Record<string, Played[]>,
  extra: { ura?: Record<string, number>; claimed?: number } = {},
) =>
  Object.fromEntries(
    roundRows({
      order: Object.keys(trays),
      trays,
      ura: extra.ura ?? {},
      claimed: extra.claimed ?? 0,
    }).map((r) => [r.id, r.points]),
  );

describe('setup', () => {
  it.each([2, 3, 4, 5, 6, 7, 8])('deals the right hands to %i players', (n) => {
    const h = harness(n, 3, { menu: n === 2 ? 'two' : n >= 7 ? 'banquet' : 'first' });
    h.act(HOST, { type: 'start' });
    const g = game(h);
    for (const id of g.order) expect(player(h, id).hand).toHaveLength(HAND_SIZE[n]!);
    // 54 main cards plus the round's desserts, less the hands.
    const desserts = n >= 6 ? 7 : 5;
    expect(g.deck.length).toBe(54 + desserts - n * HAND_SIZE[n]!);
    expect(g.dessertPile).toHaveLength(15 - desserts);
  });

  it('refuses a menu the table size can’t use', () => {
    expect(
      menuProblem(['maki', 'tempura', 'sashimi', 'dumpling', 'spoon', 'tea', 'pudding'], 2),
    ).toMatch(/Spoon/);
    expect(
      menuProblem(['maki', 'tempura', 'sashimi', 'dumpling', 'menu', 'tea', 'pudding'], 7),
    ).toMatch(/Menu/);
    expect(
      menuProblem(['maki', 'temaki', 'sashimi', 'dumpling', 'menu', 'tea', 'pudding'], 4),
    ).toMatch(/1 roll/);
    const h = harness(2, 1, { menu: 'master' });
    expect(h.refuse(HOST, { type: 'start' })).toBe('bad-menu');
  });

  it('every suggested menu has the right shape, and random menus are legal', () => {
    for (const p of PRESETS) expect(menuProblem(p.types, null)).toBeNull();
    let x = 0;
    for (const n of [2, 3, 6, 7, 8])
      for (let i = 0; i < 50; i++)
        expect(
          menuProblem(
            randomMenu(n, (k) => (x = (x * 7 + 3) % 97) % k),
            n,
          ),
        ).toBeNull();
  });

  it('2-player draw piles: 5 in hand, 5 in your pile, one drawn on turns 2 to 6', () => {
    const h = harness(2, 4, { menu: 'two', drawPile: true });
    h.act(HOST, { type: 'start' });
    expect(player(h, 'p1').hand).toHaveLength(5);
    expect(player(h, 'p1').pile).toHaveLength(5);
    expect(conveyor.view(h.state, 'p2').game!.players[0]!.pile).toBe(5);
    let turns = 0;
    while (game(h).round === 1 && game(h).stage !== 'scores') {
      const before = game(h).turn;
      for (const id of game(h).order) {
        const p = player(h, id);
        const card = p.hand.find((c) => c.k !== 'order') ?? p.hand[0]!;
        const target = card.k === 'order' ? p.tray.find((c) => c.k !== 'menu-7')?.id : undefined;
        h.act(id, { type: 'pick', card: card.id, ...(target && { target }) });
      }
      while (game(h).stage === 'resolve')
        h.act(HOST, { type: 'act-for', player: waitingOn(game(h))[0]! });
      if (game(h).turn !== before) {
        turns++;
        if (game(h).turn <= 6) expect(player(h, 'p1').hand).toHaveLength(5);
        else expect(player(h, 'p1').hand).toHaveLength(11 - game(h).turn);
      }
    }
    expect(turns).toBe(9);
  });
});

describe('a turn', () => {
  it('keeps picks secret until everyone has picked, then reveals and passes left', () => {
    const h = playing(3, {
      hands: {
        p1: ['tempura', 'sashimi'],
        p2: ['maki-2', 'miso'],
        p3: ['nigiri-egg', 'tea'],
      },
    });
    h.act('p1', { type: 'pick', card: 'p1-0' });
    const seen = conveyor.view(h.state, 'p2').game!;
    expect(seen.players[0]!.done).toBe(true);
    expect(JSON.stringify(seen)).not.toContain('p1-0');
    expect(conveyor.view(h.state, 'p1').game!.myPick).toEqual({ card: 'p1-0' });
    // Changeable until all are in.
    h.act('p1', { type: 'pick', card: 'p1-1' });
    h.act('p2', { type: 'pick', card: 'p2-0' });
    h.act('p3', { type: 'pick', card: 'p3-0' });
    expect(ks(player(h, 'p1').tray)).toEqual(['sashimi']);
    expect(ks(player(h, 'p3').tray)).toEqual(['nigiri-egg']);
    // p1's last card (tempura) went left to p2.
    expect(ks(player(h, 'p2').hand)).toEqual(['tempura']);
    expect(player(h, 'p2').from).toBe('p1');
    expect(game(h).turn).toBe(2);
  });

  it('passes right in round 2 with pass both ways', () => {
    const h = playing(3, {
      settings: { passBoth: true },
      hands: { p1: ['tempura', 'sashimi'], p2: ['maki-2', 'miso'], p3: ['nigiri-egg', 'tea'] },
    });
    h.rig((s) => {
      s.game!.round = 2;
    });
    pickAll(h);
    expect(ks(player(h, 'p3').hand)).toEqual(['sashimi']);
  });

  it('puts a nigiri on a waiting wasabi, one each, and triples it', () => {
    const h = playing(3, {
      turn: 3,
      hands: { p1: ['nigiri-squid', 'nigiri-egg'] },
      trays: { p1: [tray('wasabi', 1, { id: 'w1' }), tray('wasabi', 2, { id: 'w2' })] },
    });
    pickAll(h);
    const t = player(h, 'p1').tray;
    expect(t.find((c) => c.k === 'nigiri-squid')!.on).toBe('w1');
    expect(rows({ a: t }).a).toBe(9);
  });
});

describe('chopsticks', () => {
  it('play a second card after the reveal and go back in the hand passed on', () => {
    const h = playing(3, {
      turn: 2,
      hands: {
        p1: ['tempura', 'tempura', 'miso'],
        p2: ['maki-1', 'maki-2', 'maki-3'],
        p3: ['tea', 'tea', 'tea'],
      },
      trays: { p1: [tray('chopsticks-2', 1, { id: 'ch' })] },
    });
    pickAll(h, { p1: { card: 'p1-0', bonus: 'ch' } });
    expect(game(h).step?.kind).toBe('chop');
    expect(conveyor.view(h.state, 'p2').game!.step).toEqual({
      kind: 'chop',
      players: ['p1'],
      done: [],
    });
    h.refuse('p1', { type: 'chop', card: 'p2-0' });
    h.act('p1', { type: 'chop', card: 'p1-1' });
    expect(ks(player(h, 'p1').tray).sort()).toEqual(['tempura', 'tempura']);
    // Miso + chopsticks went left to p2.
    expect(ks(player(h, 'p2').hand).sort()).toEqual(['chopsticks-2', 'miso']);
    expect(game(h).order.map((id) => player(h, id).hand.length)).toEqual([2, 2, 2]);
  });

  it('need a second card in hand, and one bonus a turn', () => {
    const h = playing(3, {
      turn: 5,
      hands: { p1: ['tempura'] },
      trays: { p1: [tray('chopsticks-1', 1, { id: 'ch' })] },
    });
    expect(h.refuse('p1', { type: 'pick', card: 'p1-0', bonus: 'ch' })).toBe('no-second');
  });
});

describe('spoon', () => {
  const setup = () =>
    playing(4, {
      menu: ['temaki', 'eel', 'tofu', 'miso', 'spoon', 'soy', 'pudding'],
      turn: 2,
      hands: {
        p1: ['tofu', 'eel', 'eel'],
        p2: ['eel', 'miso', 'miso'],
        p3: ['tofu', 'nigiri-squid', 'nigiri-egg'],
        p4: ['tofu', 'nigiri-salmon', 'eel'],
      },
      trays: { p1: [tray('spoon-5', 1, { id: 'sp' })] },
    });

  it('takes the asked card from the first player to the left who has it', () => {
    const h = setup();
    pickAll(h, { p1: { card: 'p1-0', bonus: 'sp' } });
    expect(game(h).step?.kind).toBe('spoon');
    h.act('p1', { type: 'spoon', want: 'nigiri', variant: 'nigiri-salmon' });
    // p2 and p3 have none: p4 gives it, and gets the spoon.
    expect(ks(player(h, 'p1').tray).sort()).toEqual(['nigiri-salmon', 'tofu']);
    expect(ks(player(h, 'p1').tray)).not.toContain('spoon-5');
    expect(game(h).order.map((id) => player(h, id).hand.length)).toEqual([2, 2, 2, 2]);
    const all = game(h).order.flatMap((id) => ks(player(h, id).hand));
    expect(all).toContain('spoon-5');
  });

  it('lets the giver choose for a whole dish, privately, then gives a random one after 15 s', () => {
    const h = setup();
    pickAll(h, { p1: { card: 'p1-0', bonus: 'sp' } });
    h.act('p1', { type: 'spoon', want: 'nigiri' });
    const step = game(h).step!;
    expect(step).toMatchObject({ kind: 'give', from: 'p3' });
    expect(
      (conveyor.view(h.state, 'p3').game!.step as { options: unknown[] }).options,
    ).toHaveLength(2);
    expect(conveyor.view(h.state, 'p2').game!.step).toMatchObject({ request: null, options: null });
    expect(conveyor.view(h.state, 'p1').game!.step).toMatchObject({
      request: { type: 'nigiri' },
      options: null,
    });
    const at = conveyor.nextDeadline!(h.state)!;
    expect(at - h.now).toBe(15_000);
    h.tick();
    expect(ks(player(h, 'p1').tray).some((k) => k.startsWith('nigiri'))).toBe(true);
    expect(h.state.log.find((e) => e.kind === 'spoon')).toMatchObject({
      from: 'p3',
      auto: 'timer',
    });
  });

  it('is discarded when nobody has the card', () => {
    const h = setup();
    pickAll(h, { p1: { card: 'p1-0', bonus: 'sp' } });
    h.act('p1', { type: 'spoon', want: 'pudding' });
    expect(game(h).order.flatMap((id) => ks(player(h, id).hand))).not.toContain('spoon-5');
    expect(h.state.log.find((e) => e.kind === 'spoon')).toMatchObject({ from: null, k: null });
  });
});

describe('menu', () => {
  it('draws four, plays one (not a menu), and the drawn cards stay private', () => {
    const h = playing(3, {
      menu: ['temaki', 'tempura', 'dumpling', 'tofu', 'wasabi', 'menu', 'icecream'],
      hands: { p1: ['menu-8', 'tofu'] },
    });
    pickAll(h);
    const step = game(h).step!;
    expect(step.kind).toBe('menu');
    const drawn = (step as { drawn: { id: string; k: string }[] }).drawn;
    expect(drawn).toHaveLength(4);
    expect(conveyor.view(h.state, 'p2').game!.step).toMatchObject({ drawn: null, count: 4 });
    const deck = game(h).deck.length;
    const card = drawn.find((c) => !c.k.startsWith('menu'))!;
    h.act('p1', { type: 'menu', card: card.id });
    expect(ks(player(h, 'p1').tray)).toEqual([card.k]);
    // Three back, the menu discarded into the deck too.
    expect(game(h).deck.length).toBe(deck + 3 + 1);
  });
});

describe('takeout box', () => {
  it('turns earlier cards face down for 2 each; a face-down wasabi frees its nigiri', () => {
    const w = tray('wasabi', 1, { id: 'w', filled: true });
    const n = tray('nigiri-squid', 2, { id: 'n', on: 'w' });
    const eel = tray('eel', 2, { id: 'e' });
    const h = playing(3, {
      menu: ['temaki', 'onigiri', 'tofu', 'eel', 'wasabi', 'takeout', 'fruit'],
      turn: 3,
      hands: { p1: ['takeout-11', 'tofu'] },
      trays: { p1: [w, n, eel] },
    });
    pickAll(h);
    expect(game(h).step?.kind).toBe('takeout');
    h.refuse('p1', {
      type: 'takeout',
      cards: [player(h, 'p1').tray.find((c) => c.k === 'takeout-11')!.id],
    });
    h.act('p1', { type: 'takeout', cards: ['w', 'e'] });
    const t = player(h, 'p1').tray;
    expect(t.find((c) => c.id === 'n')!.on).toBeUndefined();
    // Squid 3, two face-down cards 4.
    expect(rows({ a: t }).a).toBe(7);
    expect(t.some((c) => c.k.startsWith('takeout'))).toBe(false);
  });

  it('a face-down nigiri leaves its wasabi used; zero cards is fine', () => {
    const h = playing(3, {
      menu: ['temaki', 'onigiri', 'tofu', 'eel', 'wasabi', 'takeout', 'fruit'],
      turn: 3,
      hands: { p1: ['takeout-10', 'nigiri-squid'] },
      trays: {
        p1: [
          tray('wasabi', 1, { id: 'w', filled: true }),
          tray('nigiri-egg', 2, { id: 'n', on: 'w' }),
        ],
      },
    });
    pickAll(h);
    h.act('p1', { type: 'takeout', cards: ['n'] });
    // The next nigiri can't use that wasabi.
    const later = playing(3, {
      menu: ['temaki', 'onigiri', 'tofu', 'eel', 'wasabi', 'takeout', 'fruit'],
      turn: 4,
      hands: { p1: ['nigiri-squid'] },
      trays: { p1: player(h, 'p1').tray },
    });
    pickAll(later);
    expect(rows({ a: player(later, 'p1').tray }).a).toBe(2 + 3);
    const zero = playing(3, {
      menu: ['temaki', 'onigiri', 'tofu', 'eel', 'wasabi', 'takeout', 'fruit'],
      turn: 2,
      hands: { p1: ['takeout-10', 'tofu'] },
      trays: { p1: [tray('tofu', 1)] },
    });
    pickAll(zero);
    zero.act('p1', { type: 'takeout', cards: [] });
    expect(game(zero).stage).toBe('pick');
  });
});

describe('special order', () => {
  const menu = ['uramaki', 'onigiri', 'dumpling', 'miso', 'wasabi', 'order', 'pudding'] as const;

  it('copies a card you played earlier, chosen with the pick', () => {
    const h = playing(3, {
      menu: [...menu],
      turn: 3,
      hands: { p1: ['order', 'miso'] },
      trays: { p1: [tray('dumpling', 1, { id: 'd' }), tray('onigiri-circle', 2, { id: 'o' })] },
    });
    expect(h.refuse('p1', { type: 'pick', card: 'p1-0' })).toBe('pick-target');
    pickAll(h, { p1: { card: 'p1-0', target: 'o' } });
    const copy = player(h, 'p1').tray.find((c) => c.copy)!;
    expect(copy).toMatchObject({ k: 'onigiri-circle', copy: 'o' });
    // Two circles: two sets of one.
    expect(rows({ a: player(h, 'p1').tray }).a).toBe(1 + 1 + 1);
  });

  it('a copied nigiri goes on an empty wasabi; a copied wasabi is empty', () => {
    const w = tray('wasabi', 1, { id: 'w', filled: true });
    const h = playing(3, {
      menu: [...menu],
      turn: 3,
      hands: { p1: ['order', 'miso'] },
      trays: {
        p1: [w, tray('nigiri-squid', 2, { id: 'n', on: 'w' }), tray('wasabi', 2, { id: 'w2' })],
      },
    });
    pickAll(h, { p1: { card: 'p1-0', target: 'n' } });
    expect(player(h, 'p1').tray.find((c) => c.copy)).toMatchObject({ k: 'nigiri-squid', on: 'w2' });
    expect(rows({ a: player(h, 'p1').tray }).a).toBe(18);
  });

  it('a copied dessert is kept and counts for the tiebreak', () => {
    const h = playing(3, {
      menu: [...menu],
      turn: 2,
      hands: { p1: ['order'], p2: ['miso'], p3: ['dumpling'] },
      trays: { p1: [tray('pudding', 1, { id: 'pd' })] },
    });
    h.rig((s) => {
      s.game!.turns = 2;
    });
    pickAll(h, { p1: { card: 'p1-0', target: 'pd' } });
    expect(game(h).stage).toBe('scores');
    expect(ks(player(h, 'p1').desserts)).toEqual(['pudding', 'pudding']);
    // The copy stays out of the deck.
    expect(game(h).deck.some((c) => c.id === 'p1-0')).toBe(false);
  });

  it('with nothing to copy it is discarded; brought by chopsticks it may copy this turn’s card', () => {
    const h = playing(3, { menu: [...menu], hands: { p1: ['order', 'miso'] } });
    pickAll(h);
    expect(player(h, 'p1').tray).toEqual([]);
    const c = playing(3, {
      menu: ['uramaki', 'onigiri', 'dumpling', 'miso', 'chopsticks', 'order', 'pudding'],
      turn: 2,
      hands: { p1: ['dumpling', 'order', 'miso'] },
      trays: { p1: [tray('chopsticks-1', 1, { id: 'ch' })] },
    });
    pickAll(c, { p1: { card: 'p1-0', bonus: 'ch' } });
    const dumpling = player(c, 'p1').tray.find((x) => x.k === 'dumpling')!;
    c.act('p1', { type: 'chop', card: 'p1-1', target: dumpling.id });
    expect(ks(player(c, 'p1').tray)).toEqual(['dumpling', 'dumpling']);
  });
});

describe('uramaki', () => {
  const menu = ['uramaki', 'onigiri', 'tofu', 'miso', 'menu', 'order', 'fruit'] as const;

  it('the first to 10 icons scores 8 at once and discards them; same-turn ties skip a place', () => {
    const h = playing(4, {
      menu: [...menu],
      turn: 3,
      hands: {
        p1: ['uramaki-5', 'tofu'],
        p2: ['uramaki-5', 'tofu'],
        p3: ['uramaki-4', 'tofu'],
        p4: ['tofu', 'tofu'],
      },
      trays: {
        p1: [tray('uramaki-5', 1), tray('uramaki-3', 2)],
        p2: [tray('uramaki-5', 1), tray('uramaki-3', 2)],
        p3: [tray('uramaki-3', 1), tray('uramaki-3', 2)],
      },
    });
    pickAll(h);
    expect(player(h, 'p1').ura).toBe(8);
    expect(player(h, 'p2').ura).toBe(8);
    // p3 reached exactly 10 with fewer icons: the place after the tie (5) is skipped.
    expect(player(h, 'p3').ura).toBe(2);
    expect(game(h).claimed).toBe(3);
    expect(player(h, 'p1').tray.some((c) => c.k.startsWith('uramaki'))).toBe(false);
  });

  it('at the round’s end, the most icons left takes the next free place (one place only)', () => {
    const r = rows(
      { a: [tray('uramaki-5', 1)], b: [tray('uramaki-4', 1)], c: [] },
      { ura: { a: 8 }, claimed: 1 },
    );
    expect(r).toEqual({ a: 8 + 5, b: 0, c: 0 });
  });
});

describe('miso', () => {
  it('two in one turn are both discarded; one alone scores 3', () => {
    const h = playing(3, {
      menu: ['temaki', 'eel', 'tofu', 'miso', 'spoon', 'soy', 'pudding'],
      hands: { p1: ['miso', 'eel'], p2: ['miso', 'eel'], p3: ['tofu', 'eel'] },
    });
    pickAll(h);
    expect(player(h, 'p1').tray).toEqual([]);
    expect(player(h, 'p2').tray).toEqual([]);
    expect(h.state.log.find((e) => e.kind === 'miso')).toMatchObject({ by: ['p1', 'p2'] });
  });
});

describe('scoring', () => {
  it('maki: ties take full points and the next count is still second', () => {
    const r = rows({
      a: [tray('maki-3', 1)],
      b: [tray('maki-3', 1)],
      c: [tray('maki-2', 1)],
      d: [],
    });
    expect(r).toEqual({ a: 6, b: 6, c: 3, d: 0 });
    const six = rows(
      Object.fromEntries(
        ['a', 'b', 'c', 'd', 'e', 'f'].map((id, i) => [
          id,
          i < 3 ? [tray(`maki-${3 - i}`, 1)] : [],
        ]),
      ),
    );
    expect([six.a, six.b, six.c, six.d]).toEqual([6, 4, 2, 0]);
  });

  it('temaki: most +4, fewest −4 (not with 2), everyone equal nothing', () => {
    expect(
      rows({ a: [tray('temaki', 1), tray('temaki', 2)], b: [tray('temaki', 1)], c: [] }),
    ).toEqual({ a: 4, b: 0, c: -4 });
    expect(rows({ a: [tray('temaki', 1)], b: [] })).toEqual({ a: 4, b: 0 });
    expect(
      rows({ a: [tray('temaki', 1)], b: [tray('temaki', 1)], c: [tray('temaki', 1)] }),
    ).toEqual({ a: 0, b: 0, c: 0 });
  });

  it('the sets: tempura, sashimi, dumpling, eel, tofu, onigiri', () => {
    const t = (k: string, n: number) => Array.from({ length: n }, () => tray(k, 1));
    expect(rows({ a: t('tempura', 3) }).a).toBe(5);
    expect(rows({ a: t('sashimi', 5) }).a).toBe(10);
    expect(rows({ a: t('dumpling', 6) }).a).toBe(15);
    expect(rows({ a: t('eel', 1) }).a).toBe(-3);
    expect(rows({ a: t('eel', 4) }).a).toBe(7);
    expect(rows({ a: t('tofu', 2) }).a).toBe(6);
    expect(rows({ a: t('tofu', 3) }).a).toBe(0);
    expect(
      rows({
        a: [...t('onigiri-circle', 2), ...t('onigiri-square', 2), ...t('onigiri-triangle', 1)],
      }).a,
    ).toBe(9 + 4);
  });

  it('edamame, tea and soy sauce', () => {
    expect(
      rows({ a: [tray('edamame', 1), tray('edamame', 1)], b: [tray('edamame', 1)], c: [] }),
    ).toEqual({ a: 2, b: 1, c: 0 });
    // Tea: biggest colour is nigiri + wasabi (3 cards); a face-down card is its own colour.
    expect(
      rows({
        a: [
          tray('tea', 1),
          tray('nigiri-egg', 1),
          tray('wasabi', 1),
          tray('nigiri-egg', 1),
          tray('eel', 1, { flipped: true }),
        ],
      }).a,
    ).toBe(3 + 2 + 2);
    // Soy: a has 3 colours (soy, maki, dessert this round), b 2: a scores 4.
    expect(
      rows({
        a: [tray('soy', 1), tray('maki-1', 1), tray('pudding', 1)],
        b: [tray('soy', 1), tray('tofu', 1)],
      }),
    ).toMatchObject({ b: 2 });
  });

  it('desserts: pudding, ice cream and fruit at the end', () => {
    const t = (k: string, n: number) => Array.from({ length: n }, () => tray(k, 0));
    const pud = Object.fromEntries(
      dessertRows(
        ['a', 'b', 'c'],
        { a: t('pudding', 3), b: t('pudding', 1), c: [] },
        'pudding',
      ).map((r) => [r.id, r.points]),
    );
    expect(pud).toEqual({ a: 6, b: 0, c: -6 });
    const two = dessertRows(['a', 'b'], { a: t('pudding', 1), b: [] }, 'pudding');
    expect(two.map((r) => r.points)).toEqual([6, 0]);
    expect(dessertRows(['a'], { a: t('icecream', 9) }, 'icecream')[0]!.points).toBe(24);
    // Watermelon 4 (6), pineapple 1 (0), orange 1 (0); no fruit at all −6.
    const fruit = dessertRows(
      ['a', 'b'],
      { a: [...t('fruit-ww', 2), ...t('fruit-wp', 0), tray('fruit-po', 0)], b: [] },
      'fruit',
    );
    expect(fruit.map((r) => r.points)).toEqual([6 + 0 + 0, -6]);
  });

  it('a tie goes to most desserts (fewest with golf), then is shared', () => {
    const h = playing(3);
    h.rig((s) => {
      const g = s.game!;
      g.players.p1!.score = 30;
      g.players.p2!.score = 30;
      g.players.p3!.score = 10;
      g.players.p2!.desserts = [tray('icecream', 0)];
    });
    expect(winnersOf(game(h), false)).toEqual(['p2']);
    expect(winnersOf(game(h), true)).toEqual(['p3']);
    h.rig((s) => {
      s.game!.players.p3!.score = 30;
    });
    expect(winnersOf(game(h), true)).toEqual(['p1', 'p3']);
  });
});

describe('timers and leavers', () => {
  it('soft: a reminder; strict: a random card for whoever hasn’t picked', () => {
    const h = playing(3, {
      hands: { p1: ['tempura', 'tea'], p2: ['tempura', 'tea'], p3: ['tempura', 'tea'] },
    });
    h.act('p1', { type: 'pick', card: 'p1-0' });
    h.tick();
    expect(game(h).clock!.reminded).toBe(true);
    expect(game(h).turn).toBe(1);
    const s = playing(3, {
      settings: { timerMode: 'strict' },
      hands: { p1: ['tempura', 'tea'], p2: ['tempura', 'tea'], p3: ['tempura', 'tea'] },
    });
    s.act('p1', { type: 'pick', card: 'p1-0' });
    s.tick();
    expect(game(s).turn).toBe(2);
    const reveal = s.state.log.find((e) => e.kind === 'reveal')!;
    expect(reveal.kind === 'reveal' && reveal.plays.map((p) => p.auto ?? null)).toEqual([
      null,
      'timer',
      'timer',
    ]);
  });

  it('the host can act for someone; a leaver is played for after a beat', () => {
    const h = playing(3, {
      hands: { p1: ['tempura', 'tea'], p2: ['tempura', 'tea'], p3: ['tempura', 'tea'] },
    });
    h.act(HOST, { type: 'act-for', player: 'p2' });
    expect(player(h, 'p2').pick?.auto).toBe('host');
    h.state = conveyor.playerLeft(h.state, 'p3', h.now);
    h.act('p1', { type: 'pick', card: 'p1-0' });
    h.tick();
    expect(game(h).turn).toBe(2);
  });

  it('a whole table of leavers still finishes the game', () => {
    const h = harness(4, 2, { menu: 'cutthroat' });
    h.act(HOST, { type: 'start' });
    for (const id of ['p1', 'p2', 'p3', 'p4']) h.state = conveyor.playerLeft(h.state, id, h.now);
    for (let i = 0; i < 3000 && h.state.phase === 'playing'; i++) h.tick();
    expect(h.state.phase).toBe('over');
    expect(game(h).dessertRows).toHaveLength(4);
  });
});

describe('order of a turn and strict timers', () => {
  it('a spoon acts before a takeout box, and a menu got by spoon acts at once', () => {
    const h = playing(4, {
      menu: ['temaki', 'tofu', 'eel', 'miso', 'spoon', 'menu', 'pudding'],
      turn: 2,
      hands: {
        p1: ['tofu', 'eel', 'eel'],
        p2: ['eel', 'menu-9', 'tofu'],
        p3: ['tofu', 'eel', 'eel'],
        p4: ['tofu', 'eel', 'eel'],
      },
      trays: { p1: [tray('spoon-6', 1, { id: 'sp' })] },
    });
    pickAll(h, { p1: { card: 'p1-0', bonus: 'sp' } });
    h.act('p1', { type: 'spoon', want: 'menu' });
    // The menu came from p2's hand and is p1's to order from now.
    expect(game(h).step).toMatchObject({ kind: 'menu', by: 'p1' });
    const drawn = (game(h).step as { drawn: { id: string; k: string }[] }).drawn;
    h.act('p1', { type: 'menu', card: drawn.find((c) => !c.k.startsWith('menu'))!.id });
    expect(game(h).turn).toBe(3);
    const kinds = h.state.log.map((e) => e.kind);
    expect(kinds.indexOf('spoon')).toBeLessThan(kinds.indexOf('menu'));
  });

  it('strict: chopsticks get a random second card, a spoon asks for a random dish', () => {
    const h = playing(4, {
      menu: ['temaki', 'tofu', 'eel', 'miso', 'spoon', 'chopsticks', 'pudding'],
      settings: { timerMode: 'strict' },
      turn: 2,
      hands: {
        p1: ['tofu', 'eel', 'eel'],
        p2: ['eel', 'miso', 'tofu'],
        p3: ['tofu', 'eel', 'eel'],
        p4: ['tofu', 'eel', 'eel'],
      },
      trays: {
        p1: [tray('chopsticks-1', 1, { id: 'ch' })],
        p2: [tray('spoon-4', 1, { id: 'sp' })],
      },
    });
    pickAll(h, { p1: { card: 'p1-0', bonus: 'ch' }, p2: { card: 'p2-0', bonus: 'sp' } });
    expect(game(h).step?.kind).toBe('chop');
    h.tick();
    expect(h.state.log.find((e) => e.kind === 'chop')).toMatchObject({ by: 'p1', auto: 'timer' });
    expect(game(h).step?.kind).toBe('spoon');
    h.tick();
    expect(h.state.log.find((e) => e.kind === 'spoon')).toMatchObject({ by: 'p2', auto: 'timer' });
  });
});
