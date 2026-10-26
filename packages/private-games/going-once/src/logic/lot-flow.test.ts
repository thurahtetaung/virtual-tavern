import { describe, expect, it } from 'vitest';
import { goingOnce } from './definition.ts';
import { dealContacts } from './lines.ts';
import { createRng } from '@vt/game-sdk';
import {
  HOST,
  SQUIGGLE,
  auctioning,
  bid,
  game,
  hammer,
  nextLot,
  packContent,
  started,
} from './test-utils.ts';
import { BUYERS, HOUSE_BIDDER, PRACTICE_MS, PRACTICE_VALUE } from './types.ts';

describe('the lot intro', () => {
  it('shows the lot number and the hints before the picture, then opens the bidding', () => {
    const h = started(3, 4);
    const g = game(h);
    for (const id of g.order)
      for (const item of g.prompts[id]!) h.act(id, { type: 'draw', item, drawing: SQUIGGLE });
    const a = game(h).auction!;
    expect(a.close).toBe('intro');
    expect(a.closeAt - h.now).toBe(2000);
    // Hints are already in, the picture isn't up and nobody may bid or screw yet.
    expect(game(h).players.p1!.messages.at(-1)!.lot).toBe(0);
    for (const viewer of ['p1', 'p2', null]) {
      const pic = goingOnce.view(h.state, viewer).game!.auction!.picture;
      expect(pic.drawing).toBeNull();
      expect(pic.house).toBeNull();
    }
    h.wait(500);
    expect(h.refuse('p2', { type: 'bid', amount: 400, seq: a.seq }).code).toBe('not-yet');
    h.tick();
    const open = game(h).auction!;
    expect(open.close).toBe('open');
    expect(open.since).toBe(h.now);
    expect(open.closeAt - h.now).toBe(8000);
    expect(goingOnce.view(h.state, 'p2').game!.auction!.picture.drawing).not.toBeNull();
    bid(h, 'p2', 400);
  });

  it('notes when each close stage began, for the sound', () => {
    const h = auctioning(3, 4);
    bid(h, 'p1', 400);
    expect(game(h).auction!.since).toBe(h.now);
    h.tick();
    expect(game(h).auction!.close).toBe('once');
    expect(game(h).auction!.since).toBe(h.now);
    hammer(h);
    expect(game(h).stage).toBe('sold');
    expect(game(h).since).toBe(h.now);
  });
});

describe('each player’s art buyer', () => {
  it('deals the buyers round the table as evenly as it can', () => {
    for (let n = 3; n <= 6; n++)
      for (let seed = 1; seed <= 20; seed++) {
        const order = Array.from({ length: n }, (_, i) => `p${i}`);
        const contacts = dealContacts(order, createRng(seed));
        const counts = BUYERS.map((b) => order.filter((id) => contacts[id] === b).length);
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
        expect(Object.keys(contacts)).toEqual(order);
      }
    expect(dealContacts(['a', 'b', 'c', 'd'], createRng(1), true)).toEqual({
      a: 'buyer1',
      b: 'buyer2',
      c: 'buyer3',
      d: 'buyer1',
    });
  });

  it('sends every tip and bit of chatter from the same buyer all game; the bank sends its own', () => {
    const h = auctioning(4, 5);
    while (h.state.phase !== 'over') {
      const a = game(h).auction;
      if (a && game(h).stage === 'auction' && a.lot % 2 === 0 && !a.bid)
        bid(h, game(h).order[a.lot % 4]!, 400);
      hammer(h);
      nextLot(h);
    }
    const g = game(h);
    for (const id of g.order) {
      const contact = g.contacts![id]!;
      expect(goingOnce.view(h.state, id).mine!.contact).toBe(contact);
      for (const m of g.players[id]!.messages) {
        if (['firstLoan', 'thirdLoan', 'prankCall', 'bankReminder'].includes(m.kind))
          expect(m.from).toBe('bank');
        else if (m.kind === 'dog') expect(m.from).toBe('dog');
        else if (m.kind === 'cameoA' || m.kind === 'cameoB') expect(m.from).toBe('caller');
        else expect(m.from).toBe(contact);
      }
    }
  });

  it('gives each buyer their own chatter when the pack has some', () => {
    const lines = {
      filler: ['Shared chatter.'],
      buyer1: ['One speaks.'],
      buyer2: ['Two speaks.'],
      buyer3: ['Three speaks.'],
    };
    const h = auctioning(3, 6, packContent(undefined, lines));
    while (h.state.phase !== 'over') {
      hammer(h);
      nextLot(h);
    }
    const g = game(h);
    const own = { buyer1: 'One speaks.', buyer2: 'Two speaks.', buyer3: 'Three speaks.' };
    let fillers = 0;
    for (const id of g.order)
      for (const m of g.players[id]!.messages.filter((x) => x.kind === 'filler')) {
        fillers++;
        expect(m.text).toBe(own[g.contacts![id]!]);
      }
    expect(fillers).toBeGreaterThan(0);
  });

  it('keeps other players’ buyers out of each view', () => {
    const h = auctioning(3, 7);
    const v = goingOnce.view(h.state, 'p1');
    expect(JSON.stringify(v)).not.toContain('contacts');
    expect(v.mine!.contact).toBe(game(h).contacts!.p1);
  });
});

/** A room's first game with the practice lot on, all drawings in. */
function practising(seed = 8, lines?: Parameters<typeof packContent>[1]) {
  const h = started(3, seed, lines ? packContent(undefined, lines) : undefined, true);
  const g = game(h);
  for (const id of g.order)
    for (const item of g.prompts[id]!) h.act(id, { type: 'draw', item, drawing: SQUIGGLE });
  return h;
}

describe('the practice lot', () => {
  it('runs in a room’s first game: a tip, the bidding with a house bidder, Sold, two lessons', () => {
    const h = practising();
    let g = game(h);
    expect(g.stage).toBe('practice');
    const p = g.practice!;
    // The tip is true, and the picture comes from a spare group, never a lot.
    expect(p.step).toBe('hint');
    expect(p.hint).toContain('$2,000');
    expect(g.lots.map((id) => g.items[id]!.title)).not.toContain(p.title);
    expect(p.until - h.now).toBe(PRACTICE_MS.hint);
    expect(h.refuse('p1', { type: 'practice-bid', amount: 400, seq: 0 }).code).toBe('not-yet');
    h.tick();
    expect(game(h).practice!.step).toBe('bid');
    // A player opens; the house bidder raises once when the quiet ends.
    h.wait(400);
    h.act('p2', { type: 'practice-bid', amount: 600, seq: 0 });
    h.tick();
    g = game(h);
    expect(g.practice!.bid).toEqual({ by: HOUSE_BIDDER, amount: 700 });
    expect(g.practice!.houseBid).toBe(true);
    h.wait(400);
    h.act('p3', { type: 'practice-bid', amount: 900, seq: g.practice!.seq });
    // Then the close runs as usual: going once, going twice, Sold.
    h.tick();
    expect(game(h).practice!.close).toBe('once');
    h.tick();
    expect(game(h).practice!.close).toBe('twice');
    h.tick();
    g = game(h);
    expect(g.practice!.step).toBe('sold');
    expect(g.practice!.bid).toEqual({ by: 'p3', amount: 900 });
    const v = goingOnce.view(h.state, 'p1').game!.practice!;
    expect(v.title).toBe(g.practice!.title);
    expect(v.value).toBe(PRACTICE_VALUE);
    h.tick();
    expect(game(h).practice!.step).toBe('own');
    h.tick();
    expect(game(h).practice!.step).toBe('screw');
    h.tick();
    // Lot 1 opens; nothing from the practice counts.
    g = game(h);
    expect(g.stage).toBe('auction');
    expect(g.auction!.lot).toBe(0);
    expect(g.practice).toBeNull();
    for (const id of g.order) {
      expect(g.players[id]!.cash).toBe(3000);
      expect(g.players[id]!.bids).toBe(0);
    }
    expect(Object.values(g.items).every((i) => !i.sale)).toBe(true);
  });

  it('has the house bidder open a lot nobody bids on, and refuses bad practice bids', () => {
    const h = practising(9);
    h.tick();
    expect(h.refuse('p1', { type: 'practice-bid', amount: 700, seq: 0 }).code).toBe('bad-bid');
    h.tick();
    const p = game(h).practice!;
    expect(p.bid).toEqual({ by: HOUSE_BIDDER, amount: 400 });
    expect(h.refuse('p1', { type: 'practice-bid', amount: 400, seq: 0 }).code).toBe('too-late');
    h.wait(400);
    h.act('p1', { type: 'practice-bid', amount: 500, seq: p.seq });
    expect(
      h.refuse('p1', { type: 'practice-bid', amount: 600, seq: game(h).practice!.seq }).code,
    ).toBe('leading');
    // The house bidder bid once already: no more raises.
    h.tick();
    expect(game(h).practice!.close).toBe('once');
  });

  it('can be skipped by any player, for everyone', () => {
    const h = practising(10);
    expect(h.refuse('p2', { type: 'skip' }).code).toBe('not-host');
    h.act('p3', { type: 'skip-practice' });
    expect(game(h).stage).toBe('auction');
    expect(game(h).auction!.lot).toBe(0);
    expect(h.refuse('p3', { type: 'skip-practice' }).code).toBe('no-practice');
  });

  it('only runs in the room’s first game, and the host can turn it off', () => {
    const h = practising(11);
    h.act('p1', { type: 'skip-practice' });
    while (h.state.phase !== 'over') {
      hammer(h);
      nextLot(h);
    }
    h.act(HOST, { type: 'play-again' });
    const g = game(h);
    for (const id of g.order)
      for (const item of g.prompts[id]!) h.act(id, { type: 'draw', item, drawing: SQUIGGLE });
    expect(game(h).stage).toBe('auction');
    // Off in the lobby: the first game goes straight to lot 1.
    const off = started(3, 12);
    expect(off.state.settings.practice).toBe(false);
    for (const id of game(off).order)
      for (const item of game(off).prompts[id]!)
        off.act(id, { type: 'draw', item, drawing: SQUIGGLE });
    expect(game(off).stage).toBe('auction');
  });

  it('uses the pack’s practice tip when it has one', () => {
    const h = practising(13, { practice: ['This one is worth {value}, honest.'] });
    expect(game(h).practice!.hint).toBe('This one is worth $2,000, honest.');
  });
});
