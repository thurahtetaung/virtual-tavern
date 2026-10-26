import { describe, expect, it } from 'vitest';
import { goingOnce } from './definition.ts';
import { sendHints } from './hints.ts';
import { dealContacts, saidAs } from './lines.ts';
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
    const own = { buyer1: 'One speaks.', buyer2: 'Two speaks.', buyer3: 'Three speaks.' };
    let fillers = 0;
    for (const seed of [6, 7, 8, 9]) {
      const h = auctioning(3, seed, packContent(undefined, lines));
      while (h.state.phase !== 'over') {
        hammer(h);
        nextLot(h);
      }
      const g = game(h);
      for (const id of g.order)
        for (const m of g.players[id]!.messages.filter((x) => x.kind === 'filler')) {
          fillers++;
          expect(m.text).toBe(own[g.contacts![id]!]);
        }
    }
    expect(fillers).toBeGreaterThan(0);
  });

  it('never repeats a line from a player’s last few messages while there is another', () => {
    const chatter = (b: string) => Array.from({ length: 5 }, (_, i) => `${b} line ${i}.`);
    const lines = {
      filler: ['Shared chatter.'],
      buyer1: chatter('One'),
      buyer2: chatter('Two'),
      buyer3: [...chatter('Three').slice(1), 'Code {random} from {player}.'],
    };
    const all = Object.values(lines).flat();
    const lineOf = (text: string) => all.find((l) => saidAs(text, l, {}));
    let fillers = 0;
    for (let seed = 1; seed <= 6; seed++) {
      const h = auctioning(3, seed, packContent(undefined, lines));
      // The same lot's hints over and over: once the one-off tips are out, it is all chatter.
      const rng = createRng(seed);
      for (let i = 0; i < 30; i++) sendHints(h.state, rng);
      for (const p of Object.values(game(h).players))
        p.messages.forEach((m, i) => {
          if (m.kind !== 'filler') return;
          fillers++;
          const before = p.messages.slice(Math.max(0, i - 4), i).map((x) => lineOf(x.text));
          expect(lineOf(m.text)).toBeDefined();
          expect(before).not.toContain(lineOf(m.text));
        });
    }
    expect(fillers).toBeGreaterThan(200);
  });

  it('still sends a line it said lately when it is the only one', () => {
    const h = auctioning(3, 6, packContent(undefined, { filler: ['Only one.'] }));
    const rng = createRng(6);
    for (let i = 0; i < 10; i++) sendHints(h.state, rng);
    // The lot's artist hears about their own art instead; the others get the one line each time.
    const said = Object.values(game(h).players).map(
      (p) => p.messages.filter((m) => m.text === 'Only one.').length,
    );
    expect(said.filter((n) => n >= 8)).toHaveLength(2);
  });

  it('knows a filled line when it sees one', () => {
    expect(saidAs('Code ab!?cd from Ana.', 'Code {random} from {player}.', { player: 'Ana' })).toBe(
      true,
    );
    expect(saidAs('Code ab!?cd from Ana.', 'Code {random} from {player}.', {})).toBe(false);
    expect(saidAs('Worth $4,500.', 'Worth {value}.', { value: 4500 })).toBe(true);
    expect(saidAs('Worth $4,500 now.', 'Worth {value}.', { value: 4500 })).toBe(false);
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

describe('hints the original’s way (the owner’s rulings, 2026-10-26)', () => {
  it('offers revenge after a forced buy that made no profit at all', () => {
    const h = auctioning(3, 3);
    bid(h, 'p2', 400);
    const s = structuredClone(h.state);
    s.game!.auction!.screwed = { target: 'p2', by: 'p1' };
    s.game!.items[s.game!.lots[0]!]!.value = 400;
    h.state = s;
    hammer(h);
    nextLot(h);
    expect(game(h).players.p2!.messages.at(-1)).toMatchObject({ kind: 'revenge', about: 'p1' });
  });

  it('sends no wants-art message to an artist who is the one being asked for', () => {
    /** Lot 4, after p3 bought one of `artists`' cheaper drawings for $1,500 each. */
    const setUp = (artists: string[]) => {
      const h = auctioning(3, 3);
      const s = structuredClone(h.state);
      const g = s.game!;
      for (const id of g.order) {
        g.players[id]!.sent = ['intro'];
        g.players[id]!.wish = [];
      }
      for (const id of artists) {
        const [lo] = g.prompts[id]!.map((i) => g.items[i]!).sort((x, y) => x.value - y.value);
        lo!.sale = { buyer: 'p3', price: 1500, commission: 750, screwedBy: null };
      }
      g.auction!.lot = 3;
      h.state = s;
      sendHints(h.state, createRng(1));
      return game(h);
    };
    // p1 and p2 would both be asked for: neither is told about the other.
    let g = setUp(['p1', 'p2']);
    expect(g.players.p1!.messages.at(-1)?.kind).not.toBe('wantArt');
    expect(g.players.p2!.messages.at(-1)?.kind).not.toBe('wantArt');
    // Only p2 would be: p1 hears about p2.
    g = setUp(['p2']);
    expect(g.players.p1!.messages.at(-1)).toMatchObject({ kind: 'wantArt', about: 'p2' });
  });
});
