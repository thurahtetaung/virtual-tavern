import { afterEach, describe, expect, it } from 'vitest';
import { CARDS, HAND_SIZE, START_CARD, deckFor } from './cards.ts';
import { encore, parseTestDeck, setTestDeck } from './game.ts';
import {
  beatReason,
  beats,
  flipHand,
  kindOf,
  legalShows,
  segments,
  shapeLine,
  showProblem,
  strengthOf,
} from './rules.ts';
import { HOST, NOW, cards, game, harness, keepAll, player, playing, ups } from './test-utils.ts';
import { DEFAULT_SECONDS, LEFT_BEAT_MS, TWO_PLAYER_CHIPS } from './types.ts';

const S = (text: string) => strengthOf(cards(text))!;

afterEach(() => {
  setTestDeck(null);
});

describe('the cards', () => {
  it('has 45 different pairs, and the right deck for each table', () => {
    expect(CARDS).toHaveLength(45);
    expect(new Set(CARDS.map((c) => c.id)).size).toBe(45);
    expect(deckFor(2)).toHaveLength(44);
    expect(deckFor(3)).toHaveLength(36);
    expect(deckFor(3).some((id) => id.endsWith('-10'))).toBe(false);
    expect(deckFor(4)).toHaveLength(44);
    expect(deckFor(4)).not.toContain('9-10');
    expect(deckFor(5)).toHaveLength(45);
  });
});

describe('groups and strength', () => {
  it('reads singles, sets and runs, either way', () => {
    expect(kindOf([7])).toBe('single');
    expect(kindOf([4, 4, 4])).toBe('set');
    expect(kindOf([4, 5, 6])).toBe('run');
    expect(kindOf([6, 5, 4])).toBe('run');
    expect(kindOf([3, 1, 2])).toBeNull();
    expect(kindOf([4, 6])).toBeNull();
    expect(kindOf([4, 4, 5])).toBeNull();
  });

  it('more cards beat fewer, a set beats a run, then the higher lowest number', () => {
    expect(beats(S('2/9 3/9'), S('9/1'))).toBe(true);
    expect(beats(S('9/1'), S('2/9 3/9'))).toBe(false);
    expect(beats(S('4/1 4/2'), S('7/1 8/1'))).toBe(true);
    expect(beats(S('7/1 8/1'), S('4/1 4/2'))).toBe(false);
    expect(beats(S('5/1 6/1 7/1'), S('4/1 5/2 6/2'))).toBe(true);
    expect(beats(S('8/1'), S('7/1'))).toBe(true);
    expect(beats(S('7/2'), S('7/1'))).toBe(false);
    expect(beats(S('9/1'), null)).toBe(true);
  });

  it('equal never beats: 3-2-1 can’t beat 1-2-3', () => {
    expect(beats(S('3/4 2/4 1/4'), S('1/5 2/5 3/5'))).toBe(false);
    expect(showProblem(cards('3/4 2/4 1/4'), S('1/5 2/5 3/5'))).toMatch(/Equal/);
  });

  it('says why a show wins', () => {
    expect(beatReason(S('2/9 3/9 4/9 5/9'), S('6/1 7/1 8/1'))).toBe('4 cards beat 3');
    expect(beatReason(S('4/1 4/2'), S('7/1 8/1'))).toBe('a set beats a run');
    expect(beatReason(S('5/1 6/1 7/1'), S('4/1 5/2 6/2'))).toBe('lowest 5 beats 4');
  });

  it('lists the shows that beat the table, longest first', () => {
    const hand = cards('4/8 4/1 4/9 7/3 2/6 3/8 4/1 5/1');
    expect(legalShows(hand, S('6/1 7/1 8/1'))).toEqual([
      [4, 7],
      [0, 2],
    ]);
    expect(legalShows(hand, null)[0]).toEqual([4, 7]);
  });

  it('flipping reverses the hand and turns every card', () => {
    const hand = cards('1/2 3/8 10/4');
    expect(ups(flipHand(hand))).toBe('4 8 2');
  });

  it('finds the sets and runs a hand holds', () => {
    const hand = cards('4/8 4/1 4/9 7/3 2/6 3/8 4/1 5/1');
    expect(segments(hand)).toEqual([
      { from: 0, to: 2, kind: 'set' },
      { from: 4, to: 7, kind: 'run' },
    ]);
    expect(shapeLine(hand)).toBe('1 set, 1 run, longest 4');
  });
});

describe('the deal', () => {
  it.each([2, 3, 4, 5])('deals %i players their hands', (n) => {
    const h = harness(n);
    h.act(HOST, { type: 'start' });
    const g = game(h);
    for (const id of g.order) expect(player(h, id).hand).toHaveLength(HAND_SIZE[n]!);
    expect(g.reserve).toHaveLength(n === 2 ? 22 : 0);
    expect(g.rounds).toBe(n);
    expect(g.stage).toBe('flip');
    const all = [...g.order.flatMap((id) => player(h, id).hand.map((c) => c.id)), ...g.reserve];
    expect(new Set(all).size).toBe(all.length);
    for (const id of g.order) {
      expect(player(h, id).chips).toBe(n === 2 ? TWO_PLAYER_CHIPS : 0);
      expect(player(h, id).marker).toBe(n > 2);
    }
  });

  it('the holder of the 1/2 card starts the first round', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const h = harness(4, seed);
      h.act(HOST, { type: 'start' });
      const holder = game(h).order.find((id) =>
        player(h, id).hand.some((c) => c.id === START_CARD),
      );
      expect(game(h).starter).toBe(holder);
    }
  });

  it('with 2 players and the 1/2 card set aside, a random player starts', () => {
    const starters = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const h = harness(2, seed);
      h.act(HOST, { type: 'start' });
      const g = game(h);
      if (g.reserve.includes(START_CARD)) starters.add(g.starter);
      else expect(player(h, g.starter).hand.some((c) => c.id === START_CARD)).toBe(true);
    }
    expect(starters).toEqual(new Set(['p1', 'p2']));
  });

  it('every card lies a random way up', () => {
    const h = harness(5);
    h.act(HOST, { type: 'start' });
    const all = game(h).order.flatMap((id) => player(h, id).hand);
    const low = all.filter((c) => c.up === Number(c.id.split('-')[0])).length;
    expect(low).toBeGreaterThan(5);
    expect(low).toBeLessThan(40);
  });

  it('the test rig deals the deck in order', () => {
    setTestDeck({ 3: cards('5/1 5/2 5/3') });
    const h = harness(3);
    h.act(HOST, { type: 'start' });
    expect(ups(player(h, 'p1').hand).startsWith('5 5 5 1 1')).toBe(true);
    expect(game(h).starter).toBe('p1');
  });
});

describe('the flip', () => {
  it('is a secret choice, applied once everyone has made it', () => {
    const h = harness(3);
    h.act(HOST, { type: 'start' });
    const before = player(h, 'p2').hand;
    h.act('p2', { type: 'flip', flip: true });
    expect(game(h).stage).toBe('flip');
    // Others only see that p2 has chosen.
    const v = encore.view(h.state, 'p1').game!;
    expect(v.players.find((p) => p.id === 'p2')!.done).toBe(true);
    expect(v.myFlip).toBeNull();
    const other = structuredClone(h.state);
    other.game!.players.p2!.flip = false;
    expect(encore.view(other, 'p1')).toEqual(encore.view(h.state, 'p1'));
    expect(encore.view(h.state, 'p2').game!.myFlip).toBe(true);
    // A choice can change until the last one is in.
    h.act('p2', { type: 'flip', flip: false });
    h.act('p2', { type: 'flip', flip: true });
    h.act('p1', { type: 'flip', flip: false });
    h.act('p3', { type: 'flip', flip: false });
    expect(game(h).stage).toBe('play');
    expect(player(h, 'p2').hand).toEqual(flipHand(before));
    expect(h.refuse('p2', { type: 'flip', flip: false })).toBe('not-now');
  });

  it('nobody can play before the hands are set', () => {
    const h = harness(3);
    h.act(HOST, { type: 'start' });
    expect(h.refuse(game(h).current, { type: 'show', from: 0, to: 0 })).toBe('flip-first');
  });
});

describe('show', () => {
  it('beats the table, captures it and passes the turn', () => {
    const h = playing(3, { p1: '4/1 5/1 6/1 9/2' }, { table: '2/1 3/1', owner: 'p3' });
    h.act('p1', { type: 'show', from: 0, to: 2 });
    const g = game(h);
    expect(g.table).toEqual({ cards: cards('4/1 5/1 6/1'), owner: 'p1' });
    expect(player(h, 'p1').captured).toBe(2);
    expect(ups(player(h, 'p1').hand)).toBe('9');
    expect(g.current).toBe('p2');
  });

  it('refuses a weaker show, cards that aren’t a group and another player’s turn', () => {
    const h = playing(3, { p1: '4/1 6/1 7/1 9/2' }, { table: '2/1 3/1', owner: 'p3' });
    expect(h.refuse('p1', { type: 'show', from: 3, to: 3 })).toBe('too-weak');
    expect(h.refuse('p1', { type: 'show', from: 0, to: 1 })).toBe('too-weak');
    expect(h.refuse('p1', { type: 'show', from: 2, to: 5 })).toBe('bad-range');
    expect(h.refuse('p2', { type: 'show', from: 0, to: 0 })).toBe('not-your-turn');
  });

  it('anything goes on an empty table', () => {
    const h = playing(3, { p1: '1/3 9/2' });
    h.act('p1', { type: 'show', from: 0, to: 0 });
    expect(game(h).table!.cards).toEqual(cards('1/3'));
  });

  it('emptying a hand ends the round at once (the table scores for nobody)', () => {
    const h = playing(
      3,
      { p1: '4/1 5/1', p2: '9/1 8/1 7/1', p3: '2/1' },
      { table: '3/2', owner: 'p3' },
    );
    h.rig((s) => {
      s.game!.players.p2!.captured = 2;
      s.game!.players.p3!.chips = 1;
    });
    h.act('p1', { type: 'show', from: 0, to: 1 });
    const r = game(h).results[0]!;
    expect(r).toMatchObject({ round: 1, ender: 'p1', how: 'out' });
    expect(r.rows.map((x) => x.points)).toEqual([1, 2 - 3, 1 - 1]);
    expect(game(h).stage).toBe('scores');
  });
});

describe('recruit', () => {
  it('takes an end card into any gap, either way up, and pays its owner', () => {
    const h = playing(3, { p1: '1/2 9/2' }, { table: '6/1 7/2 8/3', owner: 'p3' });
    h.act('p1', { type: 'recruit', end: 'right', flip: true, at: 1 });
    expect(ups(player(h, 'p1').hand)).toBe('1 3 9');
    expect(game(h).table!.cards).toEqual(cards('6/1 7/2'));
    expect(game(h).table!.owner).toBe('p3');
    expect(player(h, 'p3').chips).toBe(1);
    expect(game(h).current).toBe('p2');
  });

  it('can’t recruit an empty table, or put a card past the end', () => {
    const h = playing(3, { p1: '1/2 9/2' }, { table: '6/1', owner: 'p3' });
    expect(h.refuse('p1', { type: 'recruit', end: 'left', flip: false, at: 3 })).toBe('bad-gap');
    h.act('p1', { type: 'recruit', end: 'left', flip: false, at: 2 });
    // The set is gone: the next player must show something.
    expect(h.refuse('p2', { type: 'recruit', end: 'left', flip: false, at: 0 })).toBe(
      'nothing-to-recruit',
    );
    h.act('p2', { type: 'show', from: 0, to: 0 });
    expect(game(h).table!.owner).toBe('p2');
  });

  it('logs which end was taken, never where it went or which way up', () => {
    const h = playing(3, { p1: '1/2 9/2' }, { table: '6/1 7/2 8/3', owner: 'p3' });
    h.act('p1', { type: 'recruit', end: 'left', flip: true, at: 2 });
    const e = h.state.log.at(-1)!;
    expect(e).toMatchObject({ kind: 'recruit', by: 'p1', end: 'left', owner: 'p3' });
    expect(e).toMatchObject({ card: { id: '1-6', up: 6 } });
    expect(JSON.stringify(e)).not.toMatch(/"at"|"flip"/);
  });
});

describe('the round ends when a Show comes back unbeaten', () => {
  it('3 players: two recruits in a row, and the owner loses nothing for their hand', () => {
    const h = playing(
      3,
      { p1: '9/1 9/2 1/3 2/4', p2: '1/5 2/6', p3: '1/7 3/8 5/9' },
      { current: 'p1' },
    );
    h.act('p1', { type: 'show', from: 0, to: 1 });
    h.act('p2', { type: 'recruit', end: 'left', flip: false, at: 0 });
    expect(game(h).stage).toBe('play');
    h.act('p3', { type: 'recruit', end: 'left', flip: false, at: 0 });
    const r = game(h).results[0]!;
    expect(r).toMatchObject({ ender: 'p1', how: 'unbeaten', last: cards('9/1 9/2') });
    // p1: 2 chips, 2 cards kept free; p2: 3 cards; p3: 4 cards.
    expect(r.rows).toEqual([
      { id: 'p1', captured: 0, chips: 2, hand: 2, penalty: false, points: 2 },
      { id: 'p2', captured: 0, chips: 0, hand: 3, penalty: true, points: -3 },
      { id: 'p3', captured: 0, chips: 0, hand: 4, penalty: true, points: -4 },
    ]);
  });

  it('the last player before the owner can keep it going with Recruit & Show', () => {
    const h = playing(
      4,
      { p1: '9/1 9/2 9/3 1/3', p2: '1/5 2/6', p3: '1/7 3/8', p4: '1/9 2/3 8/1' },
      { current: 'p1' },
    );
    h.act('p1', { type: 'show', from: 0, to: 2 });
    h.act('p2', { type: 'recruit', end: 'left', flip: false, at: 0 });
    h.act('p3', { type: 'recruit', end: 'left', flip: false, at: 0 });
    // One 9 left: p4 takes it, which empties the table, and shows 1-2.
    h.act('p4', { type: 'recruit-show', end: 'left', flip: false, at: 0, from: 1, to: 2 });
    expect(game(h).stage).toBe('play');
    expect(game(h).table).toEqual({ cards: cards('1/9 2/3'), owner: 'p4' });
    expect(player(h, 'p1').chips).toBe(3);
    expect(game(h).current).toBe('p1');
  });

  it('still ends if the recruits took every card on the way round', () => {
    const h = playing(3, { p1: '9/1 9/2 1/3', p2: '1/5', p3: '1/7' }, { current: 'p1' });
    h.act('p1', { type: 'show', from: 0, to: 1 });
    h.act('p2', { type: 'recruit', end: 'left', flip: false, at: 0 });
    h.act('p3', { type: 'recruit', end: 'left', flip: false, at: 0 });
    expect(game(h).results[0]).toMatchObject({ ender: 'p1', how: 'unbeaten' });
  });

  it('a Show in between starts the count again', () => {
    const h = playing(
      3,
      { p1: '5/1 5/2 1/3', p2: '6/1 6/2 1/4', p3: '1/7 3/8' },
      { current: 'p1' },
    );
    h.act('p1', { type: 'show', from: 0, to: 1 });
    h.act('p2', { type: 'show', from: 0, to: 1 });
    h.act('p3', { type: 'recruit', end: 'left', flip: false, at: 0 });
    expect(game(h).current).toBe('p1');
    h.act('p1', { type: 'recruit', end: 'left', flip: false, at: 0 });
    expect(game(h).results[0]).toMatchObject({ ender: 'p2', how: 'unbeaten' });
  });
});

describe('Recruit & Show', () => {
  it('is all or nothing: refused whole when the Show doesn’t beat what is left', () => {
    const h = playing(3, { p1: '1/2 2/3' }, { table: '7/1 7/2 7/3', owner: 'p3' });
    const before = structuredClone(h.state);
    expect(
      h.refuse('p1', { type: 'recruit-show', end: 'left', flip: false, at: 0, from: 1, to: 2 }),
    ).toBe('too-weak');
    expect(h.state).toEqual(before);
  });

  it('works once a round, and the owner still gets the chip', () => {
    const h = playing(3, { p1: '6/1 8/1 9/1 2/3', p2: '1/3' }, { table: '7/1 7/2', owner: 'p3' });
    h.act('p1', { type: 'recruit-show', end: 'left', flip: false, at: 1, from: 0, to: 3 });
    expect(game(h).table).toEqual({ cards: cards('6/1 7/1 8/1 9/1'), owner: 'p1' });
    expect(player(h, 'p1').captured).toBe(1);
    expect(player(h, 'p1').marker).toBe(false);
    expect(player(h, 'p3').chips).toBe(1);
    h.rig((s) => {
      s.game!.current = 'p1';
      s.game!.table = { cards: cards('2/1 3/1'), owner: 'p2' };
    });
    expect(
      h.refuse('p1', { type: 'recruit-show', end: 'left', flip: false, at: 0, from: 0, to: 0 }),
    ).toBe('marker-used');
  });

  it('taking the last card lets any Show through', () => {
    const h = playing(3, { p1: '1/2 9/2' }, { table: '10/1', owner: 'p3' });
    h.act('p1', { type: 'recruit-show', end: 'left', flip: false, at: 0, from: 1, to: 1 });
    expect(game(h).table!.cards).toEqual(cards('1/2'));
    expect(player(h, 'p1').captured).toBe(0);
  });

  it('can end the round by emptying the hand', () => {
    const h = playing(3, { p1: '6/1 8/1' }, { table: '7/1', owner: 'p3' });
    h.act('p1', { type: 'recruit-show', end: 'left', flip: false, at: 1, from: 0, to: 2 });
    expect(game(h).results[0]).toMatchObject({ ender: 'p1', how: 'out' });
  });
});

describe('two players', () => {
  it('recruiting costs your own chip and you go again', () => {
    const h = playing(2, { p1: '1/2 2/3', p2: '9/1' }, { table: '8/1 8/2', owner: 'p2' });
    h.act('p1', { type: 'recruit', end: 'left', flip: false, at: 0 });
    expect(player(h, 'p1').chips).toBe(TWO_PLAYER_CHIPS - 1);
    expect(player(h, 'p2').chips).toBe(TWO_PLAYER_CHIPS);
    expect(game(h).current).toBe('p1');
    expect(h.state.log.at(-1)).toMatchObject({ kind: 'recruit', paid: true });
    expect(
      h.refuse('p1', { type: 'recruit-show', end: 'left', flip: false, at: 0, from: 0, to: 0 }),
    ).toBe('no-double');
  });

  it('a player with no chip and no Show ends the round; the owner loses nothing', () => {
    const h = playing(2, { p1: '1/2 4/5 7/8', p2: '9/1 9/2 9/3 2/7 2/8 5/9' }, { current: 'p2' });
    h.act('p2', { type: 'show', from: 0, to: 2 });
    expect(game(h).current).toBe('p1');
    // p1 can't beat 9-9-9 and recruits, turning each 9 over, so nothing joins up.
    h.act('p1', { type: 'recruit', end: 'left', flip: true, at: 2 });
    expect(game(h).current).toBe('p1');
    h.act('p1', { type: 'recruit', end: 'left', flip: true, at: 4 });
    expect(game(h).stage).toBe('play');
    // The last chip takes the last 9; the table is empty: p1 must show.
    h.act('p1', { type: 'recruit', end: 'left', flip: true, at: 0 });
    expect(ups(player(h, 'p1').hand)).toBe('3 1 4 1 7 2');
    h.act('p1', { type: 'show', from: 0, to: 0 });
    // p2 beats it with a pair of 2s, and p1, out of chips, can't answer.
    h.act('p2', { type: 'show', from: 0, to: 1 });
    const r = game(h).results[0]!;
    expect(r).toMatchObject({ ender: 'p2', how: 'stuck' });
    const row = (id: string) => r.rows.find((x) => x.id === id)!;
    expect(row('p2')).toMatchObject({ penalty: false, chips: 3, captured: 1, hand: 1, points: 4 });
    expect(row('p1')).toMatchObject({ penalty: true, chips: 0, hand: 5, points: -5 });
  });

  it('deals the set-aside cards in round 2, and the other player starts', () => {
    const h = harness(2, 3);
    h.act(HOST, { type: 'start' });
    const reserve = [...game(h).reserve];
    const first = game(h).starter;
    keepAll(h);
    h.rig((s) => {
      s.game!.players[first]!.hand = cards('5/1');
      s.game!.table = null;
      s.game!.current = first;
    });
    h.act(first, { type: 'show', from: 0, to: 0 });
    expect(game(h).stage).toBe('scores');
    h.act('p1', { type: 'ready' });
    h.act('p2', { type: 'ready' });
    expect(game(h).round).toBe(2);
    expect(game(h).starter).not.toBe(first);
    const dealt = game(h).order.flatMap((id) => player(h, id).hand.map((c) => c.id));
    expect(dealt.sort()).toEqual(reserve.sort());
    expect(game(h).reserve).toEqual([]);
    expect(player(h, 'p1').chips).toBe(TWO_PLAYER_CHIPS);
  });
});

describe('rounds and the end', () => {
  /** Ends the round at once: the current player shows their last card. */
  function finishRound(h: ReturnType<typeof harness>) {
    keepAll(h);
    const by = game(h).current;
    h.rig((s) => {
      s.game!.players[by]!.hand = cards('5/1');
      s.game!.table = null;
    });
    h.act(by, { type: 'show', from: 0, to: 0 });
  }

  it('plays a round per player, each starting one seat on, then ends', () => {
    const h = harness(3);
    h.act(HOST, { type: 'start' });
    const starters: string[] = [];
    for (let r = 1; r <= 3; r++) {
      starters.push(game(h).starter);
      finishRound(h);
      if (r < 3) {
        expect(game(h).stage).toBe('scores');
        for (const id of game(h).order) h.act(id, { type: 'ready' });
      }
    }
    expect(h.state.phase).toBe('over');
    const order = game(h).order;
    const at = order.indexOf(starters[0]!);
    expect(starters).toEqual([0, 1, 2].map((i) => order[(at + i) % 3]));
    expect(game(h).results).toHaveLength(3);
    expect(encore.view(h.state, 'p1').game!.finalHands).not.toBeNull();
  });

  it('two each doubles the rounds', () => {
    const h = harness(3, 7, { twoEach: true });
    h.act(HOST, { type: 'start' });
    expect(game(h).rounds).toBe(6);
  });

  it('the host can deal the next round without waiting', () => {
    const h = harness(3);
    h.act(HOST, { type: 'start' });
    finishRound(h);
    expect(h.refuse('p2', { type: 'next-round' })).toBe('not-host');
    h.act(HOST, { type: 'next-round' });
    expect(game(h)).toMatchObject({ round: 2, stage: 'flip' });
  });

  it('ties share the win', () => {
    const h = harness(3);
    h.act(HOST, { type: 'start' });
    h.rig((s) => {
      s.game!.round = 3;
      s.game!.results = [
        {
          round: 1,
          ender: 'p1',
          how: 'out',
          last: [],
          rows: [
            { id: 'p1', captured: 4, chips: 0, hand: 0, penalty: false, points: 4 },
            { id: 'p2', captured: 4, chips: 0, hand: 0, penalty: false, points: 4 },
            { id: 'p3', captured: 0, chips: 0, hand: 2, penalty: true, points: -2 },
          ],
        },
      ];
    });
    keepAll(h);
    h.rig((s) => {
      for (const id of ['p1', 'p2', 'p3']) s.game!.players[id]!.hand = cards('5/1 6/2');
      s.game!.current = 'p3';
      s.game!.table = null;
      s.game!.players.p3!.hand = cards('5/1');
    });
    h.act('p3', { type: 'show', from: 0, to: 0 });
    // p1 and p2 each lose 2: 2 and 2; p3 ends out: −2 + 0.
    expect(h.state.phase).toBe('over');
    expect(game(h).winners).toEqual(['p1', 'p2']);
  });
});

describe('timers and leaving', () => {
  it('the soft clock only reminds', () => {
    const h = harness(3);
    h.act(HOST, { type: 'start' });
    keepAll(h);
    const before = structuredClone(game(h).players);
    h.tick();
    expect(h.now).toBe(NOW + DEFAULT_SECONDS * 1000);
    expect(game(h).clock!.reminded).toBe(true);
    expect(game(h).players).toEqual(before);
    expect(encore.nextDeadline!(h.state)).toBeNull();
  });

  it('a strict clock plays the bot’s move, flips included', () => {
    const h = harness(3, 7, { timerMode: 'strict', seconds: 30 });
    h.act(HOST, { type: 'start' });
    h.act('p1', { type: 'flip', flip: false });
    h.tick();
    expect(game(h).stage).toBe('play');
    const who = game(h).current;
    h.tick();
    expect(game(h).current).not.toBe(who);
    expect(h.state.log.at(-1)).toMatchObject({ auto: 'timer' });
  });

  it('the table plays for a player who left, after a beat, and they can come back', () => {
    const h = harness(3);
    h.act(HOST, { type: 'start' });
    keepAll(h);
    const who = game(h).current;
    h.state = encore.playerLeft(h.state, who, h.now);
    expect(encore.nextDeadline!(h.state)).toBe(h.now + LEFT_BEAT_MS);
    h.tick();
    expect(h.state.log.some((e) => e.auto === 'left')).toBe(true);
    h.state = encore.playerJoined(h.state, { id: who, name: who });
    expect(game(h).left[who]).toBeUndefined();
  });

  it('the host’s Act for plays the waiting turn', () => {
    const h = harness(3);
    h.act(HOST, { type: 'start' });
    keepAll(h);
    const who = game(h).current;
    h.act(HOST, { type: 'act-for', player: who });
    expect(h.state.log.at(-1)).toMatchObject({ auto: 'host' });
    expect(h.refuse(HOST, { type: 'act-for', player: who })).toBe('not-waiting');
  });
});

describe('the browser tests’ script', () => {
  // The same decks as ENCORE_TEST_DECK in playwright.config.ts.
  const RIG =
    '3:1/2 4/1 7/1 2/3 5/1 8/1 3/1 6/1 9/1 4/2 7/2 5/2 8/2 8/3 6/2 3/4 9/2 5/3 7/3 4/5 6/3 9/3 4/6 7/4 5/8 7/8 4/8 6/5 8/6 5/7 7/6 4/9 9/5 9/6 9/7 9/8;' +
    '2:1/2 6/1 8/1 5/1 7/1 3/1 1/10 4/1 6/2 8/2 5/2 9/2 9/3 9/4 9/5 3/4 5/6 7/6 3/5 7/4 5/8 8/6';

  it('3 players: three short rounds, with a Recruit & Show', () => {
    setTestDeck(parseTestDeck(RIG));
    const h = harness(3);
    h.act(HOST, { type: 'start' });
    expect(new Set(game(h).order.flatMap((id) => player(h, id).hand.map((c) => c.id))).size).toBe(
      36,
    );
    const recruitLeft = (by: string) =>
      h.act(by, { type: 'recruit', end: 'left', flip: false, at: 0 });
    const readyAll = () => {
      for (const id of ['p1', 'p2', 'p3']) h.act(id, { type: 'ready' });
    };
    // Round 1: p1 holds the 1/2 card.
    keepAll(h);
    expect(game(h).starter).toBe('p1');
    h.act('p1', { type: 'show', from: 0, to: 0 });
    h.act('p2', { type: 'show', from: 0, to: 1 });
    recruitLeft('p3');
    recruitLeft('p1');
    expect(game(h).results[0]).toMatchObject({ ender: 'p2', how: 'unbeaten' });
    readyAll();
    // Round 2: p2 shows a 6; p3 recruits it into 5-_-7 and shows 5-6-7.
    keepAll(h);
    h.act('p2', { type: 'show', from: 2, to: 2 });
    h.act('p3', { type: 'recruit-show', end: 'left', flip: false, at: 1, from: 0, to: 2 });
    expect(game(h).table!.cards.map((c) => c.up)).toEqual([5, 6, 7]);
    recruitLeft('p1');
    recruitLeft('p2');
    expect(game(h).results[1]).toMatchObject({ ender: 'p3', how: 'unbeaten' });
    readyAll();
    // Round 3: p3 starts with four 9s.
    keepAll(h);
    h.act('p3', { type: 'show', from: 8, to: 11 });
    recruitLeft('p1');
    recruitLeft('p2');
    expect(h.state.phase).toBe('over');
  });

  it('2 players: recruiting with chips until stuck, then the other player starts', () => {
    setTestDeck(parseTestDeck(RIG));
    const h = harness(2);
    h.act(HOST, { type: 'start' });
    keepAll(h);
    expect(game(h).starter).toBe('p1');
    h.act('p1', { type: 'show', from: 0, to: 0 });
    h.act('p2', { type: 'show', from: 0, to: 3 });
    h.act('p1', { type: 'recruit', end: 'left', flip: true, at: 0 });
    h.act('p1', { type: 'recruit', end: 'left', flip: true, at: 11 });
    h.act('p1', { type: 'recruit', end: 'left', flip: true, at: 0 });
    expect(ups(player(h, 'p1').hand)).toBe('4 2 6 8 5 7 3 1 4 6 8 5 3');
    expect(game(h).results[0]).toMatchObject({ ender: 'p2', how: 'stuck' });
    expect(game(h).results[0]!.rows.map((r) => r.points)).toEqual([-13, 4]);
    h.act('p1', { type: 'ready' });
    h.act('p2', { type: 'ready' });
    expect(game(h)).toMatchObject({ round: 2, starter: 'p2', stage: 'flip' });
  });
});
