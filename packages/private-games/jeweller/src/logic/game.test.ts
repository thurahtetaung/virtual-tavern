import { describe, expect, it } from 'vitest';
import { CARDS } from './cards.ts';
import { jeweller, setTestDeck } from './game.ts';
import { bonusesOf, noPieces, totalOf } from './rules.ts';
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
import type { Gem } from './types.ts';

/** The first `n` level-1 cards of a colour (bought cards for a rig). */
const cardsOf = (bonus: Gem, n: number, level: 1 | 2 | 3 = 1) =>
  CARDS.filter((c) => c.level === level && c.bonus === bonus)
    .slice(0, n)
    .map((c) => c.id);

describe('setup', () => {
  it.each([
    [2, 4, 3],
    [3, 5, 4],
    [4, 7, 5],
  ])('%i players: %i gems a colour, 5 gold, %i nobles, 4 cards a level', (n, gems, nobles) => {
    const h = harness(n);
    h.act(HOST, { type: 'start' });
    const g = game(h);
    expect(g.bank).toEqual({
      white: gems,
      blue: gems,
      green: gems,
      red: gems,
      black: gems,
      gold: 5,
    });
    expect(g.nobles).toHaveLength(nobles);
    for (const l of [1, 2, 3] as const) expect(g.market[l]).toHaveLength(4);
    expect(g.decks[1]).toHaveLength(36);
    expect(g.decks[2]).toHaveLength(26);
    expect(g.decks[3]).toHaveLength(16);
    expect(g.order).toHaveLength(n);
    expect(g.current).toBe(g.order[0]);
  });

  it('the browser-test rig stacks decks and nobles and gives the first seat a head start', () => {
    setTestDeck({ decks: { 1: ['L1-35'] }, nobles: ['N09'], owned: ['L3-05'], firstSeat: true });
    try {
      const h = harness(2);
      h.act(HOST, { type: 'start' });
      const g = game(h);
      expect(g.current).toBe('p1');
      expect(g.market[1][0]).toBe('L1-35');
      expect(g.nobles[0]).toBe('N09');
      expect(player(h, 'p1').cards).toEqual(['L3-05']);
      expect([...g.decks[3], ...g.market[3]]).not.toContain('L3-05');
    } finally {
      setTestDeck(null);
    }
  });

  it('needs 2 to 4 players', () => {
    const h = harness(1);
    expect(h.refuse(HOST, { type: 'start' })).toBe('too-few');
    const five = harness(5);
    // The fifth watches.
    expect(Object.values(five.state.seats).filter((s) => s.playing)).toHaveLength(4);
  });

  it('only the host changes settings, and the target stays within 15–21', () => {
    const h = harness(2);
    h.act(HOST, { type: 'update-settings', target: 18, showReserved: true });
    expect(h.state.settings).toMatchObject({ target: 18, showReserved: true });
    expect(h.refuse('p2', { type: 'update-settings', target: 16 })).toBe('not-host');
    expect(jeweller.actionSchema.safeParse({ type: 'update-settings', target: 22 }).success).toBe(
      false,
    );
  });
});

describe('taking gems', () => {
  it('3 different colours, then the turn passes', () => {
    const h = started(2);
    h.act('p1', { type: 'take', gems: ['white', 'blue', 'green'] });
    expect(player(h, 'p1').tokens).toEqual(pieces({ white: 1, blue: 1, green: 1 }));
    expect(game(h).bank.white).toBe(3);
    expect(game(h).current).toBe('p2');
  });

  it('2 of one colour only from a pile of 4 or more', () => {
    const h = started(2);
    // With 2 players a full pile is exactly 4: allowed.
    h.act('p1', { type: 'take', gems: ['red', 'red'] });
    expect(game(h).bank.red).toBe(2);
    expect(h.refuse('p2', { type: 'take', gems: ['red', 'red'] })).toBe('bad-take');
  });

  it('never gold, never 2 different (or 1) while 3 colours are there', () => {
    const h = started(2);
    expect(h.refuse('p1', { type: 'take', gems: ['white', 'blue'] })).toBe('bad-take');
    expect(h.refuse('p1', { type: 'take', gems: ['white'] })).toBe('bad-take');
    expect(h.refuse('p1', { type: 'take', gems: ['white', 'white', 'blue'] })).toBe('bad-take');
    expect(jeweller.actionSchema.safeParse({ type: 'take', gems: ['gold'] }).success).toBe(false);
  });

  it('fewer than 3 colours left: one of each that is left', () => {
    const h = started(2);
    h.rig((s) => {
      s.game!.bank = pieces({ white: 2, blue: 1, gold: 5 });
    });
    expect(h.refuse('p1', { type: 'take', gems: ['white'] })).toBe('bad-take');
    h.act('p1', { type: 'take', gems: ['white', 'blue'] });
    h.rig((s) => {
      s.game!.bank = pieces({ white: 1 });
    });
    h.act('p2', { type: 'take', gems: ['white'] });
    expect(player(h, 'p2').tokens.white).toBe(1);
  });

  it('only on your turn', () => {
    const h = started(2);
    expect(h.refuse('p2', { type: 'take', gems: ['white', 'blue', 'green'] })).toBe(
      'not-your-turn',
    );
  });
});

describe('the 10-piece limit', () => {
  it('over 10 at the end of the turn: hand back exactly the excess, any pieces you choose', () => {
    const h = started(2);
    setPlayer(h, 'p1', { tokens: pieces({ white: 3, blue: 3, green: 3, gold: 0 }) });
    h.act('p1', { type: 'take', gems: ['red', 'black', 'white'] });
    expect(game(h).stage).toBe('return');
    expect(game(h).current).toBe('p1');
    expect(h.refuse('p1', { type: 'take', gems: ['red', 'black', 'white'] })).toBe('return-first');
    expect(h.refuse('p1', { type: 'return', tokens: { white: 1 } })).toBe('return-count');
    expect(h.refuse('p1', { type: 'return', tokens: { gold: 2 } })).toBe('return-missing');
    // The ones just taken may go back.
    h.act('p1', { type: 'return', tokens: { red: 1, white: 1 } });
    expect(totalOf(player(h, 'p1').tokens)).toBe(10);
    expect(game(h).current).toBe('p2');
  });

  it('gold counts toward the limit, and a reserve can push you over', () => {
    const h = started(2);
    setPlayer(h, 'p1', { tokens: pieces({ white: 4, blue: 4, green: 2 }) });
    h.act('p1', { type: 'reserve', level: 1 });
    expect(game(h).stage).toBe('return');
    h.act('p1', { type: 'return', tokens: { gold: 1 } });
    expect(player(h, 'p1').tokens.gold).toBe(0);
    expect(game(h).bank.gold).toBe(5);
  });
});

describe('reserving', () => {
  it('a face-up card: into the hand, a gold, and the space refills', () => {
    const h = started(2);
    const card = game(h).market[2][1]!;
    const next = game(h).decks[2][0]!;
    h.act('p1', { type: 'reserve', card });
    expect(player(h, 'p1').reserved).toEqual([{ card, blind: false }]);
    expect(player(h, 'p1').tokens.gold).toBe(1);
    expect(game(h).market[2][1]).toBe(next);
    expect(game(h).bank.gold).toBe(4);
  });

  it('the top of a deck, face down', () => {
    const h = started(2);
    const top = game(h).decks[3][0]!;
    h.act('p1', { type: 'reserve', level: 3 });
    expect(player(h, 'p1').reserved).toEqual([{ card: top, blind: true }]);
    expect(game(h).decks[3]).toHaveLength(15);
  });

  it('with no gold left you still reserve; never more than 3', () => {
    const h = started(2);
    h.rig((s) => {
      s.game!.bank.gold = 0;
    });
    h.act('p1', { type: 'reserve', level: 1 });
    expect(player(h, 'p1').tokens.gold).toBe(0);
    setPlayer(h, 'p2', {
      reserved: [game(h).decks[1][0]!, game(h).decks[1][1]!, game(h).decks[1][2]!].map((card) => ({
        card,
        blind: true,
      })),
    });
    expect(h.refuse('p2', { type: 'reserve', level: 2 })).toBe('reserve-full');
  });

  it('an empty deck can’t be reserved from, and an empty deck leaves the space empty', () => {
    const h = started(2);
    h.rig((s) => {
      s.game!.decks[3] = [];
    });
    expect(h.refuse('p1', { type: 'reserve', level: 3 })).toBe('deck-empty');
    const card = game(h).market[3][0]!;
    h.act('p1', { type: 'reserve', card });
    expect(game(h).market[3][0]).toBeNull();
  });
});

describe('buying', () => {
  it('pays the cost less bonuses; pieces go back to the piles; the space refills', () => {
    const h = started(2);
    setMarket(h, 1, ['L1-01', 'L1-02', 'L1-09', 'L1-17']);
    // L1-01: 2 red + 1 black. One red card already owned.
    setPlayer(h, 'p1', { cards: ['L1-25'], tokens: pieces({ red: 1, black: 1, white: 2 }) });
    h.act('p1', { type: 'buy', card: 'L1-01' });
    expect(player(h, 'p1').cards).toEqual(['L1-25', 'L1-01']);
    expect(player(h, 'p1').tokens).toEqual(pieces({ white: 2 }));
    expect(game(h).bank.red).toBe(5);
    expect(game(h).market[1][0]).not.toBe('L1-01');
    expect(game(h).market[1][0]).not.toBeNull();
  });

  it('bonuses can cover a colour completely: nothing is paid in it', () => {
    const h = started(2);
    setMarket(h, 1, ['L1-02', 'L1-01', 'L1-09', 'L1-17']);
    // L1-02 costs 3 blue; three blue cards make it free.
    setPlayer(h, 'p1', { cards: cardsOf('blue', 3), tokens: noPieces() });
    h.act('p1', { type: 'buy', card: 'L1-02' });
    expect(player(h, 'p1').cards).toContain('L1-02');
  });

  it('gold pays the shortfall automatically, and can stand in for gems you hold', () => {
    const h = started(2);
    setMarket(h, 1, ['L1-01', 'L1-02', 'L1-09', 'L1-17']);
    setPlayer(h, 'p1', { tokens: pieces({ red: 1, black: 1, gold: 2 }) });
    h.act('p1', { type: 'buy', card: 'L1-01' });
    // 1 red + 1 black + 1 gold for the missing red.
    expect(player(h, 'p1').tokens).toEqual(pieces({ gold: 1 }));

    const h2 = started(2);
    setMarket(h2, 1, ['L1-01', 'L1-02', 'L1-09', 'L1-17']);
    setPlayer(h2, 'p1', { tokens: pieces({ red: 2, black: 1, gold: 2 }) });
    h2.act('p1', { type: 'buy', card: 'L1-01', gold: { red: 2 } });
    expect(player(h2, 'p1').tokens).toEqual(pieces({ red: 2 }));
    expect(game(h2).bank.gold).toBe(7);
  });

  it('refuses what you can’t afford, too much gold, and cards not on offer', () => {
    const h = started(2);
    setMarket(h, 1, ['L1-01', 'L1-02', 'L1-09', 'L1-17']);
    setPlayer(h, 'p1', { tokens: pieces({ red: 1, gold: 1 }) });
    expect(h.refuse('p1', { type: 'buy', card: 'L1-01' })).toBe('cant-afford');
    setPlayer(h, 'p1', { tokens: pieces({ red: 2, black: 1, gold: 1 }) });
    expect(h.refuse('p1', { type: 'buy', card: 'L1-01', gold: { white: 1 } })).toBe('cant-afford');
    expect(h.refuse('p1', { type: 'buy', card: game(h).decks[1][0]! })).toBe('not-buyable');
  });

  it('a reserved card, which leaves the hand', () => {
    const h = started(2);
    const card = game(h).decks[1][0]!;
    setPlayer(h, 'p1', {
      reserved: [{ card, blind: true }],
      tokens: pieces({ gold: 5, white: 2, blue: 2, green: 2, red: 2, black: 2 }),
    });
    h.act('p1', { type: 'buy', card });
    expect(player(h, 'p1').reserved).toEqual([]);
    expect(player(h, 'p1').cards).toEqual([card]);
  });
});

describe('nobles', () => {
  const four = [...cardsOf('red', 4), ...cardsOf('black', 3)];

  it('visit at the end of the turn when the cards meet their needs, whatever the action', () => {
    const h = started(2);
    h.rig((s) => {
      s.game!.nobles = ['N01', 'N02', 'N10'];
    });
    setMarket(h, 1, ['L1-37', 'L1-02', 'L1-09', 'L1-17']);
    setPlayer(h, 'p1', { cards: four, tokens: pieces({ white: 2, blue: 2, green: 2, red: 2 }) });
    // L1-37 is black: the fourth black meets N01 (4 red, 4 black).
    const card = CARDS.find((c) => c.id === 'L1-37')!;
    expect(card.bonus).toBe('black');
    h.act('p1', { type: 'buy', card: 'L1-37' });
    expect(player(h, 'p1').nobles).toEqual(['N01']);
    expect(game(h).nobles).toEqual(['N02', 'N10']);
    expect(jeweller.view(h.state, 'p2').game!.players[0]!.points).toBe(3);
  });

  it('pieces don’t count; a noble you still qualify for comes on a later turn', () => {
    const h = started(2);
    h.rig((s) => {
      s.game!.nobles = ['N01', 'N02', 'N10'];
    });
    setPlayer(h, 'p1', { cards: four, tokens: pieces({ black: 9 }) });
    h.act('p1', { type: 'take', gems: ['white', 'blue', 'green'] });
    expect(game(h).stage).toBe('return');
    h.act('p1', { type: 'return', tokens: { black: 2 } });
    expect(player(h, 'p1').nobles).toEqual([]);
    // Give p1 the fourth black between turns: next turn the noble comes, even for taking gems.
    setPlayer(h, 'p1', { cards: [...four, 'L1-37'], tokens: noPieces() });
    h.act('p2', { type: 'take', gems: ['white', 'blue', 'green'] });
    h.act('p1', { type: 'take', gems: ['white', 'blue', 'green'] });
    expect(player(h, 'p1').nobles).toEqual(['N01']);
  });

  it('several qualify: the player picks one, and only one per turn', () => {
    const h = started(2);
    h.rig((s) => {
      s.game!.nobles = ['N01', 'N06', 'N10'];
    });
    // 4 red, 4 black and 3 white: N01 (4 red 4 black) and N06 (3 white 3 red 3 black).
    setPlayer(h, 'p1', {
      cards: [...cardsOf('red', 4), ...cardsOf('black', 4), ...cardsOf('white', 3)],
    });
    h.act('p1', { type: 'take', gems: ['white', 'blue', 'green'] });
    expect(game(h).stage).toBe('noble');
    expect(game(h).nobleChoice).toEqual(['N01', 'N06']);
    expect(h.refuse('p1', { type: 'noble', noble: 'N10' })).toBe('bad-noble');
    h.act('p1', { type: 'noble', noble: 'N06' });
    expect(player(h, 'p1').nobles).toEqual(['N06']);
    expect(game(h).current).toBe('p2');
    // Next turn the other one comes.
    h.act('p2', { type: 'take', gems: ['white', 'blue', 'green'] });
    h.act('p1', { type: 'take', gems: ['white', 'blue', 'red'] });
    expect(player(h, 'p1').nobles).toEqual(['N06', 'N01']);
  });
});

describe('the end', () => {
  const fifteen = () => [
    ...CARDS.filter((c) => c.level === 3 && c.points === 5)
      .slice(0, 3)
      .map((c) => c.id),
  ];

  it('reaching the target finishes the round; the last seat plays, then the game ends', () => {
    const h = started(3);
    setPlayer(h, 'p2', { cards: fifteen() });
    h.act('p1', { type: 'take', gems: ['white', 'blue', 'green'] });
    h.act('p2', { type: 'take', gems: ['white', 'blue', 'green'] });
    expect(game(h).finalBy).toBe('p2');
    expect(h.state.phase).toBe('playing');
    h.act('p3', { type: 'take', gems: ['white', 'blue', 'green'] });
    expect(h.state.phase).toBe('over');
    expect(game(h).winners).toEqual(['p2']);
  });

  it('the last seat reaching it ends the game at once', () => {
    const h = started(2);
    setPlayer(h, 'p2', { cards: fifteen() });
    h.act('p1', { type: 'take', gems: ['white', 'blue', 'green'] });
    h.act('p2', { type: 'take', gems: ['white', 'blue', 'green'] });
    expect(h.state.phase).toBe('over');
  });

  it('a tie on points goes to fewest bought cards; still tied, they share', () => {
    const h = started(2);
    const fives = fifteen();
    setPlayer(h, 'p1', { cards: fives });
    // 15 points from more cards.
    const p2 = CARDS.filter((c) => c.level === 3 && c.points === 3)
      .slice(0, 5)
      .map((c) => c.id);
    setPlayer(h, 'p2', { cards: p2 });
    h.act('p1', { type: 'take', gems: ['white', 'blue', 'green'] });
    h.act('p2', { type: 'take', gems: ['white', 'blue', 'green'] });
    expect(game(h).winners).toEqual(['p1']);

    const t = started(2);
    // 15 points from 4 cards each.
    const zero = CARDS.find((c) => c.level === 1 && c.points === 0)!.id;
    const one = CARDS.find((c) => c.level === 1 && c.points === 1)!.id;
    const four = CARDS.find((c) => c.level === 3 && c.points === 4)!.id;
    const allFives = CARDS.filter((c) => c.level === 3 && c.points === 5).map((c) => c.id);
    setPlayer(t, 'p1', { cards: [...fives, zero] });
    setPlayer(t, 'p2', { cards: [...allFives.slice(3, 5), four, one] });
    t.act('p1', { type: 'take', gems: ['white', 'blue', 'green'] });
    t.act('p2', { type: 'take', gems: ['white', 'blue', 'green'] });
    expect(game(t).winners.sort()).toEqual(['p1', 'p2']);
  });

  it('a higher target', () => {
    const h = started(2, { settings: { target: 18 } });
    setPlayer(h, 'p1', { cards: fifteen() });
    h.act('p1', { type: 'take', gems: ['white', 'blue', 'green'] });
    expect(game(h).finalBy).toBeNull();
  });

  it('play again deals afresh; back to the lobby keeps the seats', () => {
    const h = started(2);
    setPlayer(h, 'p2', { cards: fifteen() });
    h.act('p1', { type: 'take', gems: ['white', 'blue', 'green'] });
    h.act('p2', { type: 'take', gems: ['white', 'blue', 'green'] });
    h.act(HOST, { type: 'play-again' });
    expect(h.state.phase).toBe('playing');
    expect(bonusesOf(player(h, 'p2').cards).white).toBe(0);
    h.act(HOST, { type: 'back-to-lobby' });
    expect(h.state.phase).toBe('lobby');
  });
});

describe('passing', () => {
  it('only when no action at all is possible', () => {
    const h = started(2);
    expect(h.refuse('p1', { type: 'pass' })).toBe('can-act');
    h.rig((s) => {
      s.game!.bank = noPieces();
    });
    setPlayer(h, 'p1', {
      reserved: game(h)
        .decks[3].slice(0, 3)
        .map((card) => ({ card, blind: true })),
    });
    h.act('p1', { type: 'pass' });
    expect(game(h).current).toBe('p2');
  });
});

describe('timers and leavers', () => {
  it('soft: a reminder, then the host may act for the player', () => {
    const h = started(2, { settings: { seconds: 30 } });
    h.tick();
    expect(game(h).clock!.reminded).toBe(true);
    expect(game(h).current).toBe('p1');
    expect(jeweller.nextDeadline!(h.state)).toBeNull();
    h.act(HOST, { type: 'act-for', player: 'p1' });
    expect(game(h).current).toBe('p2');
    expect(h.state.log.at(-1)).toMatchObject({ kind: 'take', auto: 'host' });
    expect(h.refuse('p2', { type: 'act-for', player: 'p2' })).toBe('not-host');
  });

  it('strict: takes the fullest piles, hands back extras and takes the noble', () => {
    const h = started(2, { settings: { seconds: 30, timerMode: 'strict' } });
    h.rig((s) => {
      s.game!.bank = pieces({ white: 4, blue: 1, green: 3, red: 2, black: 0, gold: 5 });
    });
    setPlayer(h, 'p1', { tokens: pieces({ black: 9 }) });
    h.tick();
    // White, green, red; then 2 back from what p1 holds most of (black).
    expect(player(h, 'p1').tokens).toEqual(pieces({ white: 1, green: 1, red: 1, black: 7 }));
    expect(game(h).current).toBe('p2');
  });

  it('strict with no gems: reserves; with nothing at all: passes', () => {
    const h = started(2, { settings: { seconds: 30, timerMode: 'strict' } });
    h.rig((s) => {
      s.game!.bank = pieces({ gold: 5 });
    });
    h.tick();
    expect(player(h, 'p1').reserved).toHaveLength(1);
    setPlayer(h, 'p2', {
      reserved: game(h)
        .decks[3].slice(0, 3)
        .map((card) => ({ card, blind: true })),
    });
    h.tick();
    expect(h.state.log.at(-1)).toMatchObject({ kind: 'pass', auto: 'timer' });
  });

  it('a player who leaves has their turns played after a short pause, until they return', () => {
    const h = started(2);
    h.state = jeweller.playerLeft(h.state, 'p1', h.now);
    expect(jeweller.view(h.state, 'p2').game!.players[0]!.left).toBe(true);
    h.tick();
    expect(game(h).current).toBe('p2');
    expect(h.state.log.at(-1)).toMatchObject({ kind: 'take', auto: 'left' });
    h.state = jeweller.playerJoined(h.state, { id: 'p1', name: 'P1' });
    h.act('p2', { type: 'take', gems: ['white', 'blue', 'green'] });
    expect(jeweller.nextDeadline!(h.state)).toBeNull();
    // Their seat goes once the game is over.
    h.state = jeweller.playerLeft(h.state, 'p1', h.now);
    h.rig((s) => {
      s.phase = 'over';
    });
    h.act(HOST, { type: 'back-to-lobby' });
    expect(h.state.seats.p1).toBeUndefined();
  });

  it('a newcomer mid-game watches and sits at the next game', () => {
    const h = started(2);
    h.state = jeweller.playerJoined(h.state, { id: 'p3', name: 'P3' });
    expect(h.state.seats.p3).toMatchObject({ playing: false, waiting: true });
    h.rig((s) => {
      s.phase = 'over';
    });
    h.act(HOST, { type: 'play-again' });
    expect(game(h).order).toContain('p3');
  });
});
