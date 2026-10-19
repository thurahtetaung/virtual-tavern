import { describe, expect, it } from 'vitest';
import { thorns } from './game.ts';
import {
  HOST,
  game,
  harness,
  placeAll,
  rigStacks,
  round,
  setDiscs,
  started,
} from './test-utils.ts';

describe('setup', () => {
  it('needs 3 to 6 players', () => {
    expect(harness(2).refuse(HOST, { type: 'start' })).toBe('too-few');
    const h = harness(7);
    expect(h.state.seats.p7!.waiting).toBe(true);
    h.act(HOST, { type: 'start' });
    expect(game(h).order).toHaveLength(6);
  });

  it('deals three roses and a thorn each and starts with everyone placing', () => {
    const h = started(4);
    for (const id of game(h).order)
      expect(game(h).players[id]!.hand.sort()).toEqual(['rose', 'rose', 'rose', 'thorn']);
    expect(round(h).stage).toBe('place');
    expect(game(h).order).toContain(round(h).starter);
  });

  it('only the host starts, and settings change between games', () => {
    const h = harness(3);
    expect(h.refuse('p2', { type: 'start' })).toBe('not-host');
    h.act(HOST, { type: 'update-settings', seconds: 30, timerMode: 'strict', lastChance: false });
    expect(h.state.settings).toEqual({ seconds: 30, timerMode: 'strict', lastChance: false });
    h.act(HOST, { type: 'start' });
    expect(h.refuse(HOST, { type: 'update-settings', seconds: null })).toBe('in-progress');
  });
});

describe('a round', () => {
  it('everyone puts a first disc down at once, then turns go from the first player', () => {
    const h = started(3, { first: 'p2' });
    expect(h.refuse('p2', { type: 'bid', amount: 1 })).toBe('wrong-stage');
    h.act('p3', { type: 'place', disc: 'rose' });
    expect(h.refuse('p3', { type: 'place', disc: 'rose' })).toBe('placed');
    h.act('p1', { type: 'place', disc: 'thorn' });
    expect(round(h).stage).toBe('place');
    h.act('p2', { type: 'place', disc: 'rose' });
    expect(round(h).stage).toBe('turns');
    expect(round(h).current).toBe('p2');
    expect(h.refuse('p1', { type: 'place', disc: 'rose' })).toBe('not-your-turn');
    expect(h.refuse('p2', { type: 'pass' })).toBe('no-bid');
    h.act('p2', { type: 'place', disc: 'rose' });
    expect(round(h).current).toBe('p3');
  });

  it('caps the bid at the discs in play and needs a raise', () => {
    const h = started(3, { first: 'p1' });
    placeAll(h, { p1: ['rose'], p2: ['rose'], p3: ['rose'] });
    expect(h.refuse('p1', { type: 'bid', amount: 4 })).toBe('too-high');
    h.act('p1', { type: 'bid', amount: 1 });
    expect(round(h).stage).toBe('bid');
    expect(h.refuse('p2', { type: 'place', disc: 'rose' })).toBe('wrong-stage');
    expect(h.refuse('p2', { type: 'bid', amount: 1 })).toBe('too-low');
    h.act('p2', { type: 'bid', amount: 2 });
    h.act('p3', { type: 'pass' });
    h.act('p1', { type: 'pass' });
    expect(round(h).stage).toBe('flip');
    expect(round(h).challenger).toBe('p2');
  });

  it('passes are for the rest of the round', () => {
    const h = started(4, { first: 'p1' });
    placeAll(h, { p1: ['rose'], p2: ['rose'], p3: ['rose'], p4: ['rose'] });
    h.act('p1', { type: 'bid', amount: 1 });
    h.act('p2', { type: 'pass' });
    h.act('p3', { type: 'bid', amount: 2 });
    h.act('p4', { type: 'pass' });
    // p2 is skipped: back to p1.
    expect(round(h).current).toBe('p1');
  });

  it('a bid of every disc in play makes the challenge at once', () => {
    const h = started(3, { first: 'p1' });
    placeAll(h, { p1: ['rose'], p2: ['rose'], p3: ['rose'] });
    h.act('p1', { type: 'bid', amount: 3 });
    expect(round(h).stage).toBe('flip');
    expect(round(h).challenger).toBe('p1');
  });

  it('a player with no discs in hand must bid', () => {
    const h = started(3, { first: 'p1' });
    setDiscs(h, { p1: ['rose'] });
    placeAll(h, { p1: ['rose'], p2: ['rose'], p3: ['rose'] });
    expect(round(h).current).toBe('p1');
    expect(h.refuse('p1', { type: 'place', disc: 'rose' })).toBe('not-in-hand');
    h.act('p1', { type: 'bid', amount: 1 });
  });
});

describe('the flip', () => {
  it('own stack first, from the top, only up to the bid, then a point', () => {
    const h = started(3, { first: 'p1' });
    rigStacks(h, { p1: ['thorn', 'rose', 'rose'], p2: ['rose'], p3: ['rose'] }, 'p1');
    h.act('p1', { type: 'bid', amount: 2 });
    h.act('p2', { type: 'pass' });
    h.act('p3', { type: 'pass' });
    expect(h.refuse('p1', { type: 'flip', owner: 'p2' })).toBe('own-first');
    expect(h.refuse('p2', { type: 'flip', owner: 'p2' })).toBe('not-challenger');
    h.act('p1', { type: 'flip', owner: 'p1' });
    h.act('p1', { type: 'flip', owner: 'p1' });
    // The thorn at the bottom is never turned over: the bid was 2.
    expect(game(h).players.p1!.points).toBe(1);
    expect(round(h).stage).toBe('result');
    expect(round(h).result).toMatchObject({ outcome: 'won', next: 'p1' });
    h.tick();
    expect(round(h)).toMatchObject({ number: 2, stage: 'place', starter: 'p1' });
    expect(game(h).players.p1!.hand).toHaveLength(4);
  });

  it('then other players’ tops, switching freely; a second point wins', () => {
    const h = started(3, { first: 'p1' });
    const s = structuredClone(h.state);
    s.game!.players.p1!.points = 1;
    h.state = s;
    rigStacks(h, { p1: ['rose'], p2: ['rose', 'rose'], p3: ['thorn', 'rose'] }, 'p1');
    h.act('p1', { type: 'bid', amount: 3 });
    h.act('p2', { type: 'pass' });
    h.act('p3', { type: 'pass' });
    h.act('p1', { type: 'flip', owner: 'p1' });
    expect(h.refuse('p1', { type: 'flip', owner: 'p1' })).toBe('own-done');
    h.act('p1', { type: 'flip', owner: 'p3' });
    h.act('p1', { type: 'flip', owner: 'p2' });
    expect(h.state.phase).toBe('over');
    expect(game(h)).toMatchObject({ winners: ['p1'], how: 'points' });
  });

  it('another’s thorn: a random disc is lost, secretly, and the Challenger starts next', () => {
    const h = started(3, { first: 'p1' });
    rigStacks(h, { p1: ['rose'], p2: ['thorn'], p3: ['rose'] }, 'p1');
    h.act('p1', { type: 'bid', amount: 2 });
    h.act('p2', { type: 'pass' });
    h.act('p3', { type: 'pass' });
    h.act('p1', { type: 'flip', owner: 'p1' });
    h.act('p1', { type: 'flip', owner: 'p2' });
    const p1 = game(h).players.p1!;
    expect(p1.discs).toHaveLength(3);
    expect(p1.lost).toHaveLength(1);
    expect(round(h).result).toMatchObject({ outcome: 'failed', thornBy: 'p2', next: 'p1' });
    const v2 = thorns.view(h.state, 'p2');
    expect(JSON.stringify(v2)).not.toContain('"lost":["');
    expect(thorns.view(h.state, 'p1').mine!.lost).toEqual(p1.lost);
    expect(v2.game!.players.find((p) => p.id === 'p1')!.discs).toBe(3);
  });

  it('own thorn: the Challenger chooses the disc to lose', () => {
    const h = started(3, { first: 'p1' });
    rigStacks(h, { p1: ['thorn'], p2: ['rose'], p3: ['rose'] }, 'p1');
    h.act('p1', { type: 'bid', amount: 2 });
    h.act('p2', { type: 'pass' });
    h.act('p3', { type: 'pass' });
    h.act('p1', { type: 'flip', owner: 'p1' });
    expect(round(h).stage).toBe('lose');
    expect(h.refuse('p2', { type: 'lose', disc: 'rose' })).toBe('not-challenger');
    expect(h.refuse('p1', { type: 'lose', disc: 'chance' })).toBe('not-yours');
    h.act('p1', { type: 'lose', disc: 'thorn' });
    expect(game(h).players.p1!.discs).toEqual(['rose', 'rose', 'rose']);
    expect(round(h).stage).toBe('result');
  });

  it('out on another’s thorn: that thorn’s owner starts', () => {
    const h = started(3, { first: 'p1', settings: { lastChance: false } });
    setDiscs(h, { p1: ['rose'] });
    rigStacks(h, { p1: ['rose'], p2: ['rose'], p3: ['thorn'] }, 'p1');
    h.act('p1', { type: 'bid', amount: 2 });
    h.act('p2', { type: 'pass' });
    h.act('p3', { type: 'pass' });
    h.act('p1', { type: 'flip', owner: 'p1' });
    h.act('p1', { type: 'flip', owner: 'p3' });
    expect(game(h).players.p1!.out).toBe(true);
    expect(round(h).result).toMatchObject({ eliminated: true, next: 'p3' });
    h.tick();
    expect(round(h).starter).toBe('p3');
    expect(game(h).players.p1!.hand).toEqual([]);
  });

  it('out on their own thorn: they name who starts, or the next player after 30 s', () => {
    const h = started(4, { first: 'p1', settings: { lastChance: false } });
    setDiscs(h, { p1: ['thorn'] });
    rigStacks(h, { p1: ['thorn'], p2: ['rose'], p3: ['rose'], p4: ['rose'] }, 'p1');
    h.act('p1', { type: 'bid', amount: 1 });
    h.act('p2', { type: 'pass' });
    h.act('p3', { type: 'pass' });
    h.act('p4', { type: 'pass' });
    h.act('p1', { type: 'flip', owner: 'p1' });
    h.act('p1', { type: 'lose', disc: 'thorn' });
    expect(game(h).players.p1!.out).toBe(true);
    expect(round(h).stage).toBe('starter');
    expect(h.refuse('p1', { type: 'starter', player: 'p1' })).toBe('bad-player');
    const named = structuredClone(h.state);
    h.act('p1', { type: 'starter', player: 'p4' });
    h.tick();
    expect(round(h).starter).toBe('p4');
    h.state = named;
    h.tick();
    expect(round(h).stage).toBe('result');
    expect(round(h).result!.next).toBe('p2');
  });

  it('a revealed thorn that was its owner’s last disc knocks its owner out', () => {
    const h = started(4, { first: 'p1', settings: { lastChance: false } });
    setDiscs(h, { p3: ['thorn'] });
    rigStacks(h, { p1: ['rose'], p2: ['rose'], p3: ['thorn'], p4: ['rose'] }, 'p1');
    h.act('p1', { type: 'bid', amount: 2 });
    for (const p of ['p2', 'p3', 'p4']) h.act(p, { type: 'pass' });
    h.act('p1', { type: 'flip', owner: 'p1' });
    h.act('p1', { type: 'flip', owner: 'p3' });
    expect(game(h).players.p3!.out).toBe(true);
    expect(game(h).players.p1!.discs).toHaveLength(3);
    expect(round(h).result!.next).toBe('p1');
  });

  it('when the Challenger and the thorn’s owner both go out, the next after the owner starts', () => {
    const h = started(4, { first: 'p1', settings: { lastChance: false } });
    setDiscs(h, { p1: ['rose'], p2: ['thorn'] });
    rigStacks(h, { p1: ['rose'], p2: ['thorn'], p3: ['rose'], p4: ['rose'] }, 'p1');
    h.act('p1', { type: 'bid', amount: 2 });
    for (const p of ['p2', 'p3', 'p4']) h.act(p, { type: 'pass' });
    h.act('p1', { type: 'flip', owner: 'p1' });
    h.act('p1', { type: 'flip', owner: 'p2' });
    expect(round(h).result!.next).toBe('p3');
  });

  it('when that leaves nobody, the thorn’s owner wins; one left wins', () => {
    const h = started(3, { first: 'p1', settings: { lastChance: false } });
    const s = structuredClone(h.state);
    s.game!.players.p3!.out = true;
    s.game!.players.p3!.discs = [];
    s.game!.players.p3!.hand = [];
    h.state = s;
    setDiscs(h, { p1: ['rose'], p2: ['thorn'] });
    rigStacks(h, { p1: ['rose'], p2: ['thorn'] }, 'p1');
    h.act('p1', { type: 'bid', amount: 2 });
    h.act('p1', { type: 'flip', owner: 'p1' });
    h.act('p1', { type: 'flip', owner: 'p2' });
    expect(h.state.phase).toBe('over');
    expect(game(h)).toMatchObject({ winners: ['p2'], how: 'last' });
  });

  it('after a failed challenge anyone may show their stack', () => {
    const h = started(3, { first: 'p1' });
    rigStacks(h, { p1: ['rose'], p2: ['thorn'], p3: ['rose', 'thorn'] }, 'p1');
    h.act('p1', { type: 'bid', amount: 2 });
    h.act('p2', { type: 'pass' });
    expect(h.refuse('p3', { type: 'show' })).toBe('wrong-stage');
    h.act('p3', { type: 'pass' });
    h.act('p1', { type: 'flip', owner: 'p1' });
    h.act('p1', { type: 'flip', owner: 'p2' });
    h.act('p3', { type: 'show' });
    const seen = thorns.view(h.state, 'p2').game!.players.find((p) => p.id === 'p3')!;
    expect(seen.shown).toEqual(['thorn', 'rose']);
    expect(h.refuse('p3', { type: 'show' })).toBe('shown');
  });
});

describe('the Last Chance disc', () => {
  /** p1 fails as Challenger with two discs left, on p2's thorn. */
  function failDownToOne(settings = {}) {
    const h = started(3, { first: 'p1', settings });
    setDiscs(h, { p1: ['rose', 'rose'] });
    rigStacks(h, { p1: ['rose'], p2: ['thorn'], p3: ['rose'] }, 'p1');
    h.act('p1', { type: 'bid', amount: 2 });
    h.act('p2', { type: 'pass' });
    h.act('p3', { type: 'pass' });
    h.act('p1', { type: 'flip', owner: 'p1' });
    h.act('p1', { type: 'flip', owner: 'p2' });
    return h;
  }

  it('is lent for the next round to a failed Challenger left with one disc', () => {
    const h = failDownToOne();
    expect(game(h).chance).toEqual({ holder: 'p1', round: 2 });
    h.tick();
    expect(game(h).players.p1!.hand.sort()).toEqual(['chance', 'rose']);
    h.act('p1', { type: 'place', disc: 'chance' });
    // Everyone sees where it is.
    expect(thorns.view(h.state, 'p2').game!.players[0]!.chanceAt).toBe(0);
    // It counts as a disc in play and turns over as a rose.
    placeAll(h, { p2: ['rose'], p3: ['rose'] });
    expect(round(h).current).toBe('p1');
    h.act('p1', { type: 'bid', amount: 3 });
    h.act('p1', { type: 'flip', owner: 'p1' });
    h.act('p1', { type: 'flip', owner: 'p2' });
    h.act('p1', { type: 'flip', owner: 'p3' });
    expect(game(h).players.p1!.points).toBe(1);
    h.tick();
    // Back to the supply after its round.
    expect(game(h).chance).toBeNull();
    expect(game(h).players.p1!.hand).toEqual(['rose']);
  });

  it('a holder who fails as Challenger loses both and is out', () => {
    const h = failDownToOne();
    h.tick();
    rigStacks(h, { p1: ['chance', 'rose'], p2: ['rose'], p3: ['thorn'] }, 'p1');
    h.act('p1', { type: 'bid', amount: 4 });
    for (const id of ['p1', 'p1', 'p3']) h.act('p1', { type: 'flip', owner: id });
    expect(game(h).players.p1!.out).toBe(true);
    expect(game(h).chance).toBeNull();
    expect(round(h).result).toMatchObject({ eliminated: true, next: 'p3' });
  });

  it('returns before it is lent again (one disc for the table)', () => {
    const h = failDownToOne();
    h.tick();
    // Round 2: p2 fails down to one disc while p1 holds it.
    setDiscs(h, { p2: ['rose', 'rose'] });
    rigStacks(h, { p1: ['rose'], p2: ['rose'], p3: ['thorn'] }, 'p2');
    h.act('p2', { type: 'bid', amount: 3 });
    for (const id of ['p2', 'p1', 'p3']) h.act('p2', { type: 'flip', owner: id });
    expect(game(h).chance).toEqual({ holder: 'p2', round: 3 });
    h.tick();
    expect(game(h).players.p1!.hand).toEqual(['rose']);
    expect(game(h).players.p2!.hand.sort()).toEqual(['chance', 'rose']);
  });

  it('its holder is safe when their own last thorn is turned over that round', () => {
    const h = failDownToOne();
    h.tick();
    setDiscs(h, { p1: ['thorn'] });
    rigStacks(h, { p1: ['chance', 'thorn'], p2: ['rose'], p3: ['rose'] }, 'p2');
    h.act('p2', { type: 'bid', amount: 2 });
    h.act('p3', { type: 'pass' });
    h.act('p1', { type: 'pass' });
    h.act('p2', { type: 'flip', owner: 'p2' });
    h.act('p2', { type: 'flip', owner: 'p1' });
    expect(game(h).players.p1!.out).toBe(false);
    expect(round(h).result).toMatchObject({ outcome: 'failed', thornBy: 'p1', next: 'p2' });
    // Back to one disc next round: a revealed last thorn knocks them out.
    h.tick();
    expect(game(h).chance).toBeNull();
    rigStacks(h, { p1: ['thorn'], p2: ['rose'], p3: ['rose'] }, 'p2');
    h.act('p2', { type: 'bid', amount: 2 });
    h.act('p3', { type: 'pass' });
    h.act('p1', { type: 'pass' });
    h.act('p2', { type: 'flip', owner: 'p2' });
    h.act('p2', { type: 'flip', owner: 'p1' });
    expect(game(h).players.p1!.out).toBe(true);
  });

  it('is not lent when switched off, and only once per player', () => {
    expect(game(failDownToOne({ lastChance: false })).chance).toBeNull();
  });
});

describe('players who leave', () => {
  const join = (h: ReturnType<typeof started>, id: string) => {
    h.state = thorns.playerJoined(h.state, { id, name: id.toUpperCase() });
  };
  const leave = (h: ReturnType<typeof started>, id: string) => {
    h.state = thorns.playerLeft(h.state, id, h.now);
  };

  it('are skipped while placing and bidding (a skipped bidder passes), discs kept', () => {
    const h = started(4, { first: 'p1' });
    rigStacks(h, { p1: ['rose'], p2: ['rose'], p3: ['thorn'], p4: ['rose'] }, 'p1');
    leave(h, 'p2');
    expect(game(h).players.p2!.out).toBe(false);
    expect(h.state.seats.p2).toBeDefined();
    h.act('p1', { type: 'place', disc: 'rose' });
    // p2 is skipped.
    expect(round(h).current).toBe('p3');
    h.act('p3', { type: 'bid', amount: 1 });
    h.act('p4', { type: 'pass' });
    // p1 is next; then p2 would be, and passes by being away.
    h.act('p1', { type: 'bid', amount: 3 });
    expect(round(h).passed).toContain('p2');
    expect(round(h).current).toBe('p3');
    // Their disc is still on the mat and can be turned over.
    h.act('p3', { type: 'pass' });
    h.act('p1', { type: 'flip', owner: 'p1' });
    h.act('p1', { type: 'flip', owner: 'p1' });
    h.act('p1', { type: 'flip', owner: 'p2' });
    expect(round(h).flips.at(-1)).toEqual({ owner: 'p2', disc: 'rose' });
    expect(thorns.view(h.state, 'p1').game!.players[1]).toMatchObject({ away: true, out: false });
  });

  it('are not waited for with their first disc, and carry on when they come back', () => {
    const h = started(3, { first: 'p2' });
    leave(h, 'p2');
    h.act('p1', { type: 'place', disc: 'rose' });
    h.act('p3', { type: 'place', disc: 'rose' });
    expect(round(h).stage).toBe('turns');
    // The starter is away: the next player here starts.
    expect(round(h).current).toBe('p3');
    join(h, 'p2');
    expect(game(h).away).toEqual([]);
    h.act('p3', { type: 'place', disc: 'rose' });
    h.act('p1', { type: 'place', disc: 'rose' });
    expect(round(h).current).toBe('p2');
  });

  it('an away Challenger is waited for; the host can remove them and the round restarts', () => {
    const h = started(3, { first: 'p1' });
    rigStacks(h, { p1: ['rose'], p2: ['rose'], p3: ['rose'] }, 'p1');
    h.act('p1', { type: 'bid', amount: 3 });
    leave(h, 'p1');
    expect(round(h).stage).toBe('flip');
    expect(thorns.nextDeadline!(h.state)).toBeNull();
    expect(h.refuse('p2', { type: 'remove', player: 'p1' })).toBe('not-host');
    expect(h.refuse(HOST, { type: 'remove', player: 'p2' })).toBe('not-away');
  });

  it('removing a player whose discs are in play restarts the round; with 2 left play goes on', () => {
    const h = started(3, { first: 'p2' });
    rigStacks(h, { p1: ['rose'], p2: ['rose', 'rose'], p3: ['thorn'] }, 'p2');
    leave(h, 'p3');
    h.act(HOST, { type: 'remove', player: 'p3' });
    expect(game(h).players.p3).toMatchObject({ out: true, discs: [] });
    expect(h.state.seats.p3).toBeUndefined();
    expect(round(h)).toMatchObject({ number: 2, stage: 'place', starter: 'p2' });
    expect(game(h).players.p2!.hand).toHaveLength(4);
    expect(h.state.phase).toBe('playing');
  });

  it('once a thorn was hit, the round finishes first; one player left wins', () => {
    const h = started(3, { first: 'p2', settings: { lastChance: false } });
    rigStacks(h, { p1: ['rose'], p2: ['thorn'], p3: ['rose'] }, 'p2');
    h.act('p2', { type: 'bid', amount: 1 });
    h.act('p3', { type: 'pass' });
    h.act('p1', { type: 'pass' });
    h.act('p2', { type: 'flip', owner: 'p2' });
    expect(round(h).stage).toBe('lose');
    leave(h, 'p2');
    h.act(HOST, { type: 'remove', player: 'p2' });
    // Their disc to lose was picked for them, then they left: no restart.
    expect(round(h).number).toBe(1);
    leave(h, 'p3');
    h.act(HOST, { type: 'remove', player: 'p3' });
    expect(h.state.phase).toBe('over');
    expect(game(h)).toMatchObject({ winners: ['p1'], how: 'last' });
  });
});

describe('strict timers', () => {
  const strict = { seconds: 20, timerMode: 'strict' as const };

  it('put down only the first disc (a random one), then open the bidding at 1', () => {
    const h = started(3, { first: 'p1', settings: strict });
    h.tick();
    expect(round(h).stage).toBe('turns');
    for (const id of ['p1', 'p2', 'p3']) expect(game(h).players[id]!.stack).toHaveLength(1);
    h.tick();
    expect(round(h).bids).toEqual([{ by: 'p1', amount: 1 }]);
    expect(game(h).players.p1!.stack).toHaveLength(1);
    // In the bidding: pass.
    h.tick();
    expect(round(h).passed).toEqual(['p2']);
  });

  it('turn over the Challenger’s own discs, then the next stack clockwise', () => {
    const h = started(4, { first: 'p2', settings: strict });
    rigStacks(h, { p1: ['rose'], p2: ['rose'], p3: ['rose', 'rose'], p4: ['rose'] }, 'p2');
    h.act('p2', { type: 'bid', amount: 5 });
    h.tick();
    expect(round(h).flips.map((f) => f.owner)).toEqual(['p2']);
    h.tick();
    h.tick();
    h.tick();
    expect(round(h).flips.map((f) => f.owner)).toEqual(['p2', 'p3', 'p3', 'p4']);
  });
});
