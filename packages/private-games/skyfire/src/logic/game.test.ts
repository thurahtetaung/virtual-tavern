import { describe, expect, it } from 'vitest';
import { deckFor, ratingOf, scoreOf } from './cards.ts';
import { possibilities, possibleSuits } from './clues.ts';
import { skyfire } from './game.ts';
import { HOST, game, handOf, harness, playing } from './test-utils.ts';

const view = (s: Parameters<typeof skyfire.view>[0], v: string | null) => skyfire.view(s, v);

describe('setup', () => {
  it.each([
    [2, 5],
    [3, 5],
    [4, 4],
    [5, 4],
  ])('%i players get %i cards each', (n, size) => {
    const h = harness(n);
    h.act(HOST, { type: 'start' });
    const g = game(h);
    for (const id of g.order) expect(g.hands[id]).toHaveLength(size);
    expect(g.deck).toHaveLength(50 - n * size);
    expect(g.clues).toBe(8);
    expect(g.fuses).toBe(0);
  });

  it('deck sizes for every variant', () => {
    expect(deckFor({ multi: 'off', black: false })).toHaveLength(50);
    expect(deckFor({ multi: '6th', black: false })).toHaveLength(60);
    expect(deckFor({ multi: 'wild', black: false })).toHaveLength(60);
    expect(deckFor({ multi: 'one-each', black: false })).toHaveLength(55);
    expect(deckFor({ multi: 'off', black: true })).toHaveLength(60);
    expect(deckFor({ multi: 'wild', black: true })).toHaveLength(70);
    const black = deckFor({ multi: 'off', black: true }).filter((c) => c.suit === 'black');
    expect(black.map((c) => c.rank).sort()).toEqual([1, 2, 2, 3, 3, 4, 4, 5, 5, 5]);
  });

  it('a random first player, then the next seat each game', () => {
    const h = harness(3, 11);
    h.act(HOST, { type: 'start' });
    const first = game(h).current;
    h.act(HOST, { type: 'end-game' });
    h.act(HOST, { type: 'play-again' });
    const order = game(h).order;
    expect(game(h).current).toBe(order[(order.indexOf(first) + 1) % 3]);
  });

  it('only 2 to 5 play; a sixth watches', () => {
    const h = harness(6);
    expect(h.state.seats.p6!.playing).toBe(false);
    h.act(HOST, { type: 'start' });
    expect(game(h).order).toHaveLength(5);
    expect(view(h.state, 'p6').game!.hands.p1!.every((s) => s.card)).toBe(true);
  });
});

describe('clues', () => {
  it('spend a token and touch every matching card', () => {
    const h = playing(3, { p2: 'r1 b1 r3 g2 r5' });
    h.act('p1', { type: 'clue', to: 'p2', colour: 'red' });
    const g = game(h);
    expect(g.clues).toBe(7);
    const touched = h.state.log.at(-1)!;
    expect(touched.kind === 'clue' && touched.touched).toEqual(['hp2-0', 'hp2-2', 'hp2-4']);
    expect(g.know['hp2-0']!.colours).toEqual(['red']);
    expect(g.know['hp2-1']!.notColours).toEqual(['red']);
    expect(g.current).toBe('p2');
  });

  it('are refused to yourself, out of turn and without tokens', () => {
    const h = playing(3, { p2: 'r1' }, { clues: 0 });
    expect(h.refuse('p1', { type: 'clue', to: 'p1', rank: 1 })).toBe('no-clues');
    h.rig((s) => {
      s.game!.clues = 3;
    });
    expect(h.refuse('p1', { type: 'clue', to: 'p1', rank: 1 })).toBe('self');
    expect(h.refuse('p2', { type: 'clue', to: 'p3', rank: 1 })).toBe('not-your-turn');
    expect(h.refuse('p1', { type: 'clue', to: 'p2' })).toBe('bad-clue');
    expect(h.refuse('p1', { type: 'clue', to: 'p2', rank: 1, colour: 'red' })).toBe('bad-clue');
  });

  it('may touch nothing, unless the host forbids it', () => {
    const h = playing(3, { p2: 'r1 r2' });
    h.act('p1', { type: 'clue', to: 'p2', colour: 'blue' });
    expect(game(h).know['hp2-0']!.notColours).toEqual(['blue']);
    const strict = playing(3, { p2: 'r1 r2' }, { settings: { zeroClues: false } });
    expect(strict.refuse('p1', { type: 'clue', to: 'p2', colour: 'blue' })).toBe('zero-clue');
  });

  it('multicolour as a sixth colour is named on its own', () => {
    const h = playing(3, { p2: 'm1 r1 m2' }, { settings: { multi: '6th' } });
    h.act('p1', { type: 'clue', to: 'p2', colour: 'red' });
    const e = h.state.log.at(-1)!;
    expect(e.kind === 'clue' && e.touched).toEqual(['hp2-1']);
    h.act('p2', { type: 'clue', to: 'p3', rank: 1 });
    h.act('p3', { type: 'clue', to: 'p2', colour: 'multi' });
    const m = h.state.log.at(-1)!;
    expect(m.kind === 'clue' && m.touched).toEqual(['hp2-0', 'hp2-2']);
  });

  it('wild multicolour is touched by every colour and never named', () => {
    const h = playing(3, { p2: 'm1 r1 b2' }, { settings: { multi: 'wild' } });
    expect(h.refuse('p1', { type: 'clue', to: 'p2', colour: 'multi' })).toBe('bad-colour');
    h.act('p1', { type: 'clue', to: 'p2', colour: 'red' });
    const e = h.state.log.at(-1)!;
    expect(e.kind === 'clue' && e.touched).toEqual(['hp2-0', 'hp2-1']);
    // Touched by two colours: it can only be multicolour.
    h.act('p2', { type: 'clue', to: 'p3', rank: 1 });
    h.act('p3', { type: 'clue', to: 'p2', colour: 'blue' });
    const o = { multi: 'wild' as const, black: false };
    expect(possibleSuits(game(h).know['hp2-0']!, o)).toEqual(['multi']);
    // "No red" rules out multicolour too.
    expect(possibleSuits(game(h).know['hp2-2']!, o)).toEqual(['blue']);
  });

  it('black powder: no colour touches it, numbers do, and black is never a clue', () => {
    const h = playing(3, { p2: 'k5 r5 k3' }, { settings: { black: true } });
    h.act('p1', { type: 'clue', to: 'p2', colour: 'red' });
    const e = h.state.log.at(-1)!;
    expect(e.kind === 'clue' && e.touched).toEqual(['hp2-1']);
    h.act('p2', { type: 'clue', to: 'p3', rank: 1 });
    h.act('p3', { type: 'clue', to: 'p2', rank: 5 });
    const f = h.state.log.at(-1)!;
    expect(f.kind === 'clue' && f.touched).toEqual(['hp2-0', 'hp2-1']);
    expect(
      skyfire.actionSchema.safeParse({ type: 'clue', to: 'p2', colour: 'black' }).success,
    ).toBe(false);
  });
});

describe('plays and discards', () => {
  it('a fitting card goes on its firework; the new card arrives on the left', () => {
    const h = playing(3, { p1: 'r2 r1 b3' }, { deck: 'y4' });
    h.act('p1', { type: 'play', card: 'hp1-1' });
    expect(game(h).fireworks.red).toBe(1);
    expect(handOf(h, 'p1')).toBe('y4 r2 b3');
    expect(game(h).fuses).toBe(0);
  });

  it('a card that doesn’t fit burns a fuse and goes to the discards', () => {
    const h = playing(3, { p1: 'r2' }, { deck: 'y4' });
    h.act('p1', { type: 'play', card: 'hp1-0' });
    expect(game(h).fuses).toBe(1);
    expect(game(h).discards).toEqual(['hp1-0']);
    expect(game(h).fireworks.red).toBe(0);
  });

  it('a 5 finishes a firework and wins a clue back, unless all 8 are back', () => {
    const h = playing(
      3,
      { p1: 'r5', p2: 'b5' },
      { deck: 'y1 y2', fireworks: { red: 4, blue: 4 }, clues: 5 },
    );
    h.act('p1', { type: 'play', card: 'hp1-0' });
    expect(game(h).clues).toBe(6);
    h.rig((s) => {
      s.game!.clues = 8;
    });
    h.act('p2', { type: 'play', card: 'hp2-0' });
    expect(game(h).clues).toBe(8);
  });

  it('discarding wins a clue back, and is refused with all 8', () => {
    const h = playing(3, { p1: 'r2 g3' }, { deck: 'y4' });
    expect(h.refuse('p1', { type: 'discard', card: 'hp1-0' })).toBe('full-clues');
    h.rig((s) => {
      s.game!.clues = 6;
    });
    h.act('p1', { type: 'discard', card: 'hp1-1' });
    expect(game(h).clues).toBe(7);
    expect(handOf(h, 'p1')).toBe('y4 r2');
  });

  it('the third fuse loses the show at 0, saying what the fireworks reached', () => {
    const h = playing(3, { p1: 'b3' }, { deck: 'y4', fireworks: { red: 3, green: 2 }, fuses: 2 });
    h.act('p1', { type: 'play', card: 'hp1-0' });
    expect(h.state.phase).toBe('over');
    expect(game(h).result).toMatchObject({ how: 'fuses', score: 0, reached: 5, win: false });
  });

  it('finishing every firework ends a perfect show', () => {
    const h = playing(
      2,
      { p1: 'w5' },
      { deck: 'y4', fireworks: { red: 5, yellow: 5, green: 5, blue: 5, white: 4 } },
    );
    h.act('p1', { type: 'play', card: 'hp1-0' });
    expect(game(h).result).toMatchObject({ how: 'perfect', score: 25, win: true });
  });
});

describe('the last round', () => {
  it('everyone, the drawer included, takes one more turn', () => {
    const h = playing(3, { p1: 'r1 b4', p2: 'g4 y4', p3: 'w4 w3' }, { deck: 'y1', clues: 5 });
    h.act('p1', { type: 'play', card: 'hp1-0' });
    expect(view(h.state, 'p2').game!.lastTurns).toEqual(['p2', 'p3', 'p1']);
    expect(h.state.log.some((e) => e.kind === 'last-round')).toBe(true);
    h.act('p2', { type: 'discard', card: 'hp2-0' });
    expect(handOf(h, 'p2')).toBe('y4');
    h.act('p3', { type: 'clue', to: 'p1', rank: 4 });
    expect(h.state.phase).toBe('playing');
    h.act('p1', { type: 'discard', card: 'hp1-1' });
    expect(game(h).result).toMatchObject({ how: 'deck', score: 1, reached: 1 });
  });
});

describe('the expert ending', () => {
  const expert = { expert: true };

  it('has no last round: play goes on with fewer cards', () => {
    const h = playing(2, { p1: 'r1 b4', p2: 'g4 y4' }, { deck: 'y1', clues: 5, settings: expert });
    h.act('p1', { type: 'play', card: 'hp1-0' });
    expect(game(h).finalTurns).toBeNull();
    h.act('p2', { type: 'discard', card: 'hp2-0' });
    expect(handOf(h, 'p2')).toBe('y4');
    expect(h.state.phase).toBe('playing');
  });

  it('losing the last copy of a needed card loses the show, discarded or misplayed', () => {
    const h = playing(2, { p1: 'b5', p2: 'g2' }, { deck: 'y1 y2', clues: 5, settings: expert });
    h.act('p1', { type: 'discard', card: 'hp1-0' });
    expect(game(h).result).toMatchObject({
      how: 'lost-card',
      score: 0,
      card: { suit: 'blue', rank: 5 },
    });
    const m = playing(2, { p1: 'g2' }, { deck: 'y1', discards: 'g2', settings: expert });
    m.act('p1', { type: 'play', card: 'hp1-0' });
    expect(game(m).result).toMatchObject({ how: 'lost-card', score: 0 });
    // A copy of a card already on its firework is no loss.
    const ok = playing(
      2,
      { p1: 'r1', p2: 'g1' },
      { deck: 'y1', fireworks: { red: 1 }, clues: 5, settings: expert },
    );
    ok.act('p1', { type: 'discard', card: 'hp1-0' });
    expect(ok.state.phase).toBe('playing');
  });

  it('a player starting a turn with no cards loses the show (scored 0)', () => {
    const h = playing(2, { p1: 'r1', p2: '' }, { settings: expert, clues: 5 });
    h.act('p1', { type: 'play', card: 'hp1-0' });
    expect(game(h).result).toMatchObject({ how: 'no-cards', player: 'p2', score: 0, reached: 1 });
  });
});

describe('black powder', () => {
  it('is built 5 down to 1 and finishing it wins a clue', () => {
    const h = playing(
      2,
      { p1: 'k4 k5', p2: 'k1' },
      { settings: { black: true }, deck: 'r1 r2 r3', clues: 5, fireworks: { black: 4 } },
    );
    h.rig((s) => {
      s.game!.fireworks.black = 0;
    });
    h.act('p1', { type: 'play', card: 'hp1-0' });
    expect(game(h).fuses).toBe(1);
    h.rig((s) => {
      s.game!.fireworks.black = 4;
      s.game!.current = 'p2';
    });
    h.act('p2', { type: 'play', card: 'hp2-0' });
    expect(game(h).fireworks.black).toBe(5);
    expect(game(h).clues).toBe(6);
  });

  it('takes 1 off per missing black card, so a score can go below zero', () => {
    expect(scoreOf({ red: 3, black: 0 })).toBe(-2);
    expect(scoreOf({ red: 5, yellow: 5, green: 5, blue: 5, white: 5, black: 5 })).toBe(25);
    expect(ratingOf(-2, 25)).toBe('Booed');
    const h = playing(
      2,
      { p1: 'r1', p2: 'g4' },
      { settings: { black: true }, deck: 'y1', clues: 5 },
    );
    h.act('p1', { type: 'play', card: 'hp1-0' });
    h.act('p2', { type: 'discard', card: 'hp2-0' });
    h.act('p1', { type: 'discard', card: 'd0' });
    expect(game(h).result).toMatchObject({ how: 'deck', score: -4 });
  });
});

describe('scale', () => {
  it('names each band, up to divine with multicolour', () => {
    expect(ratingOf(5, 25)).toBe('Booed');
    expect(ratingOf(16, 25)).toBe('Excellent');
    expect(ratingOf(25, 25)).toBe('Legendary');
    expect(ratingOf(27, 30)).toBe('Legendary');
    expect(ratingOf(30, 30)).toBe('Divine');
  });
});

describe('your hand', () => {
  it('can be put in any order, as everyone sees', () => {
    const h = playing(3, { p2: 'r1 b2 g3' });
    h.act('p2', { type: 'reorder', order: ['hp2-2', 'hp2-0', 'hp2-1'] });
    expect(handOf(h, 'p2')).toBe('g3 r1 b2');
    expect(view(h.state, 'p1').game!.hands.p2!.map((s) => s.id)).toEqual([
      'hp2-2',
      'hp2-0',
      'hp2-1',
    ]);
    expect(h.refuse('p2', { type: 'reorder', order: ['hp2-2', 'hp2-0'] })).toBe('bad-order');
    expect(h.refuse('p2', { type: 'reorder', order: ['hp2-2', 'hp2-0', 'hp1-0'] })).toBe(
      'bad-order',
    );
  });
});

describe('full help', () => {
  it('counts the copies the viewer can see, teammates’ hands included', () => {
    const h = playing(
      3,
      { p1: 'r5 b2', p2: 'r1 r1', p3: 'r1 g1' },
      { settings: { memory: 'full' } },
    );
    h.act('p1', { type: 'clue', to: 'p2', rank: 1 });
    h.act('p2', { type: 'clue', to: 'p1', colour: 'red' });
    // p1's red card: the three red 1s are all in sight, so it can't be a red 1.
    const v = view(h.state, 'p1');
    const seen = [...v.game!.hands.p2!, ...v.game!.hands.p3!].map((s) => s.card!);
    const poss = possibilities(v.game!.hands.p1![0]!.know!, { multi: 'off', black: false }, seen);
    expect(poss.map((p) => p.rank)).toEqual([2, 3, 4, 5]);
  });
});

describe('memory', () => {
  it('sends no marks, and a clue stays in your log until your next turn is over', () => {
    const h = playing(
      3,
      { p1: 'r1 b2', p2: 'g4', p3: 'w1' },
      { settings: { memory: 'memory' }, deck: 'y1 y2 y3' },
    );
    h.act('p1', { type: 'clue', to: 'p2', rank: 4 });
    h.act('p2', { type: 'clue', to: 'p1', colour: 'red' });
    const clueToP1 = () =>
      view(h.state, 'p1').log.filter((e) => e.kind === 'clue' && e.to === 'p1');
    expect(view(h.state, 'p1').game!.hands.p1![0]!.know).toBeNull();
    expect(clueToP1()).toHaveLength(1);
    h.act('p3', { type: 'clue', to: 'p2', rank: 4 });
    // p1's own turn: still there while they decide…
    expect(clueToP1()).toHaveLength(1);
    h.act('p1', { type: 'clue', to: 'p3', rank: 1 });
    // …and gone once it is over.
    expect(clueToP1()).toHaveLength(0);
    // Watchers and the end replay keep everything.
    h.act(HOST, { type: 'end-game' });
    expect(view(h.state, 'p1').log.filter((e) => e.kind === 'clue')).toHaveLength(4);
  });
});

describe('safe moves (strict timer, leavers, Act for)', () => {
  const strict = { seconds: 30, timerMode: 'strict' as const };

  it('discard the oldest unclued card', () => {
    const h = playing(3, { p1: 'r1 b2 g3' }, { settings: strict, clues: 4, deck: 'y1' });
    h.rig((s) => {
      s.game!.know['hp1-2']!.ranks.push(3);
    });
    h.tick();
    expect(game(h).discards).toEqual(['hp1-1']);
    expect(h.state.log.find((e) => e.kind === 'discard')).toMatchObject({ auto: 'timer' });
  });

  it('give a random clue that touches a card when every card is clued', () => {
    const h = playing(3, { p1: 'r1', p2: 'b2' }, { settings: strict, clues: 4 });
    h.rig((s) => {
      s.game!.know['hp1-0']!.ranks.push(1);
    });
    h.tick();
    const e = h.state.log.at(-1)!;
    expect(e).toMatchObject({ kind: 'clue', auto: 'timer' });
    expect(e.kind === 'clue' && e.touched.length).toBeGreaterThan(0);
  });

  it('with no clue token and every card clued, discard the oldest card', () => {
    const h = playing(3, { p1: 'r1 b2' }, { settings: strict, clues: 0, deck: 'y1' });
    h.rig((s) => {
      s.game!.know['hp1-0']!.ranks.push(1);
      s.game!.know['hp1-1']!.ranks.push(2);
    });
    h.tick();
    expect(game(h).discards).toEqual(['hp1-1']);
  });

  it('with 8 tokens and no clue possible, do nothing and leave it to the host', () => {
    const h = playing(
      2,
      { p1: 'r1', p2: '' },
      { settings: { ...strict, expert: true, zeroClues: false } },
    );
    h.tick();
    expect(game(h).turn).toBe(0);
    expect(game(h).clock!.reminded).toBe(true);
    expect(skyfire.nextDeadline!(h.state)).toBeGreaterThan(h.now);
  });

  it('never play a card', () => {
    const h = playing(3, { p1: 'r1', p2: 'b2', p3: 'g2' }, { settings: strict });
    for (let i = 0; i < 30 && h.state.phase === 'playing'; i++) h.tick();
    expect(h.state.log.some((e) => e.kind === 'play')).toBe(false);
  });

  it('a soft timer only reminds; the host may act for the player', () => {
    const h = playing(3, { p1: 'r1 b2' }, { settings: { seconds: 30 }, clues: 4, deck: 'y1' });
    h.tick();
    expect(game(h).clock!.reminded).toBe(true);
    expect(game(h).turn).toBe(0);
    expect(h.refuse('p2', { type: 'act-for', player: 'p1' })).toBe('not-host');
    h.act(HOST, { type: 'act-for', player: 'p1' });
    expect(h.state.log.find((e) => e.kind === 'discard')).toMatchObject({ auto: 'host' });
  });

  it('a player who left gets the safe move after a short beat, and carries on when back', () => {
    const h = playing(3, { p1: 'r1 b2', p2: 'g1 g2' }, { clues: 4, deck: 'y1 y2' });
    h.state = skyfire.playerLeft(h.state, 'p1', h.now);
    h.tick();
    expect(h.state.log.at(-1)).toMatchObject({ kind: 'discard', auto: 'left', by: 'p1' });
    h.state = skyfire.playerJoined(h.state, { id: 'p1', name: 'P1' });
    expect(game(h).left).toEqual({});
  });
});

describe('the host', () => {
  it('can end the show as it stands: scored as reached, no win', () => {
    const h = playing(3, { p1: 'r1' }, { fireworks: { red: 3, blue: 2 } });
    expect(h.refuse('p2', { type: 'end-game' })).toBe('not-host');
    h.act(HOST, { type: 'end-game' });
    expect(game(h).result).toMatchObject({ how: 'ended', score: 5, reached: 5, win: false });
  });

  it('settings change between games only', () => {
    const h = harness(3);
    h.act(HOST, { type: 'update-settings', multi: 'wild', black: true, expert: true });
    expect(h.state.settings).toMatchObject({ multi: 'wild', black: true, expert: true });
    h.act(HOST, { type: 'start' });
    expect(Object.keys(game(h).fireworks)).toEqual([
      'red',
      'yellow',
      'green',
      'blue',
      'white',
      'multi',
      'black',
    ]);
    expect(h.refuse(HOST, { type: 'update-settings', black: false })).toBe('in-progress');
  });
});

describe('reactions', () => {
  it('answer the latest turn, one per player', () => {
    const h = playing(3, { p2: 'r1' });
    expect(h.refuse('p2', { type: 'react', emoji: '👏' })).toBe('nothing-yet');
    h.act('p1', { type: 'clue', to: 'p2', rank: 1 });
    h.act('p2', { type: 'react', emoji: '👏' });
    h.act('p2', { type: 'react', emoji: '🎆' });
    expect(h.state.reactions).toHaveLength(1);
    expect(h.state.reactions[0]).toMatchObject({ by: 'p2', emoji: '🎆' });
    expect(skyfire.actionSchema.safeParse({ type: 'react', emoji: 'hi' }).success).toBe(false);
  });
});
