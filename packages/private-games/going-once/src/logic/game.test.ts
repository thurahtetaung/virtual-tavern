import { describe, expect, it } from 'vitest';
import { goingOnce } from './definition.ts';
import { enableTestRig } from './game.ts';
import { halfAt } from './setup.ts';
import {
  GROUPS,
  HOST,
  NOW,
  SQUIGGLE,
  auctioning,
  bid,
  drawAll,
  game,
  hammer,
  harness,
  lot,
  nextLot,
  packContent,
  started,
} from './test-utils.ts';

describe('lobby', () => {
  it('counts the title groups on offer and refuses to start without two', () => {
    expect(harness(3).state.groupsAvailable).toBe(3);
    const empty = harness(3, 1, packContent([]));
    expect(empty.state.groupsAvailable).toBe(0);
    expect(empty.refuse(HOST, { type: 'start' }).code).toBe('no-content');
    const one = harness(3, 1, packContent([GROUPS[0]]));
    expect(one.refuse(HOST, { type: 'start' }).code).toBe('no-content');
  });

  it('needs three players and only the host starts', () => {
    expect(harness(2).refuse(HOST, { type: 'start' }).code).toBe('too-few');
    expect(harness(3).refuse('p2', { type: 'start' }).code).toBe('not-host');
  });

  it('lets the host set the drawing time and pace', () => {
    const h = harness(3);
    h.act(HOST, { type: 'update-settings', drawSeconds: 60, pace: 'fast' });
    expect(h.state.settings).toEqual({ drawSeconds: 60, pace: 'fast', paceChosen: true });
    expect(h.refuse('p2', { type: 'update-settings', pace: 'relaxed' }).code).toBe('not-host');
  });

  it('refuses the test rig unless the server allows it', () => {
    const h = harness(3);
    expect(h.refuse(HOST, { type: 'rig', scale: 0.5, fixed: true }).code).toBe('no-rig');
    enableTestRig();
    try {
      h.act(HOST, { type: 'rig', scale: 0.5, fixed: true, cash: 1400 });
      h.act(HOST, { type: 'start' });
      const g = game(h);
      // Fixed: groups in pack order, titles in seat order, first group high.
      expect(g.prompts.p1!.map((i) => g.items[i]!.title)).toEqual(['Apple', 'Top hat']);
      expect(g.prompts.p2!.map((i) => g.items[i]!.value)).toEqual([3500, 1000]);
      expect(g.players.p1!.cash).toBe(1400);
      expect(g.lots.map((i) => g.items[i]!.drawer)).toEqual([
        'p1',
        'p2',
        'p3',
        null,
        'p1',
        'p2',
        'p3',
        null,
      ]);
    } finally {
      enableTestRig(false);
    }
  });
});

describe('the deal', () => {
  for (const n of [3, 4, 5, 6]) {
    it(`deals ${n} players`, () => {
      for (const seed of [1, 2, 3, 4]) {
        const h = started(n, seed);
        const g = game(h);
        const items = Object.values(g.items);
        expect(g.lots).toHaveLength(n === 6 ? 12 : 2 * n + 2);
        // Two groups, each with every player's title and the house's at 3–5.
        for (const grp of [0, 1]) {
          const inGroup = items.filter((i) => i.group === grp);
          expect(inGroup).toHaveLength(n + (n === 6 ? 0 : 1));
          expect(new Set(inGroup.map((i) => i.title)).size).toBe(inGroup.length);
        }
        // The first group's lots come first.
        expect(g.lots.slice(0, g.lots.length / 2).every((i) => g.items[i]!.group === 0)).toBe(true);
        for (const id of g.order) {
          const [a, b] = g.prompts[id]!.map((i) => g.items[i]!);
          expect(a!.group).not.toBe(b!.group);
          expect(a!.value + b!.value).toBe(4500);
          const high = Math.max(a!.value, b!.value);
          expect(high).toBeGreaterThanOrEqual(3000);
          expect(high).toBeLessThanOrEqual(4000);
          expect(high % 100).toBe(0);
        }
        for (const house of items.filter((i) => !i.drawer)) {
          expect(house.value).toBeGreaterThanOrEqual(500);
          expect(house.value).toBeLessThanOrEqual(4500);
        }
        expect(g.players[g.order[0]!]).toMatchObject({ cash: 3000, debt: 0, screw: true });
      }
    });
  }

  it('deals fresh groups before reusing any', () => {
    const h = auctioning(3, 2);
    const first = [...h.state.usedGroups];
    expect(first).toHaveLength(2);
    h.act(HOST, { type: 'back-to-lobby' });
    h.act(HOST, { type: 'start' });
    // Only one group was left unused: the list starts over.
    expect(h.state.usedGroups).toHaveLength(2);
    // Group keys name the pack.
    expect(h.state.usedGroups.every((k) => k.startsWith('pack1:'))).toBe(true);
  });

  it('uses the pack’s house keys, or the title’s place in its group', () => {
    const g = game(started(3, 5));
    for (const item of Object.values(g.items))
      expect(item.house).toMatch(item.title === 'Top hat' ? /^h0$/ : /^(h\d|g-\w+_\d)$/);
  });
});

describe('wish lists', () => {
  for (const n of [3, 4, 5, 6]) {
    it(`give ${n} players three true, well-spread entries`, () => {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const g = game(auctioning(n, seed));
        const holders = new Map<string, number>();
        for (const id of g.order) {
          const wish = g.players[id]!.wish;
          expect(wish).toHaveLength(3);
          for (const w of wish) {
            const item = g.items[w.item]!;
            expect(w.value).toBe(item.value);
            expect(w.title).toBe(item.title);
            expect(item.drawer).not.toBe(id);
            expect(item.drawer).not.toBeNull();
            holders.set(w.item, (holders.get(w.item) ?? 0) + 1);
          }
          expect(wish[0]!.value).toBeGreaterThanOrEqual(3000);
          expect(wish[1]!.value).toBeLessThan(3000);
          expect(wish[2]!.value).toBeLessThan(3000);
          const groups = wish.map((w) => g.items[w.item]!.group);
          expect(groups.filter((x) => x === 0).length).toBeLessThanOrEqual(2);
          expect(groups.filter((x) => x === 1).length).toBeLessThanOrEqual(2);
        }
        // Every high drawing on a list is known by exactly one player, low ones by one or two.
        for (const [item, count] of holders) {
          if (g.items[item]!.value >= 3000) expect(count).toBe(1);
          else expect(count).toBeLessThanOrEqual(2);
        }
      }
    });
  }

  it('are hidden during the drawing and never name the lot', () => {
    const h = started(3);
    expect(goingOnce.view(h.state, 'p1').mine!.wish).toEqual([]);
    drawAll(h);
    const wish = goingOnce.view(h.state, 'p1').mine!.wish;
    expect(wish).toHaveLength(3);
    expect(Object.keys(wish[0]!).sort()).toEqual(['title', 'value']);
  });
});

describe('drawing', () => {
  it('takes each player’s own two titles once each', () => {
    const h = started(3);
    const g = game(h);
    const mine = g.prompts.p1![0]!;
    expect(h.refuse('p2', { type: 'draw', item: mine, drawing: SQUIGGLE }).code).toBe('not-yours');
    expect(h.refuse('p1', { type: 'draw', item: mine, drawing: [] }).code).toBe('drawing-empty');
    h.act('p1', { type: 'draw', item: mine, drawing: SQUIGGLE });
    expect(h.refuse('p1', { type: 'draw', item: mine, drawing: SQUIGGLE }).code).toBe('sent');
    expect(game(h).items[mine]!.artist).toBe('p1');
  });

  it('opens the first lot as soon as every drawing is in', () => {
    const h = started(3);
    drawAll(h);
    expect(game(h).stage).toBe('auction');
    expect(game(h).auction!.lot).toBe(0);
  });

  it('turns unsent drawings into house pictures with no artist when time runs out', () => {
    const h = started(3);
    drawAll(h, ['p3']);
    expect(game(h).stage).toBe('draw');
    // Nudges at half time and with ten seconds left, then 90 s plus a short grace.
    expect(goingOnce.nextDeadline!(h.state)).toBe(NOW + 45_000);
    h.tick();
    expect(goingOnce.nextDeadline!(h.state)).toBe(NOW + 80_000);
    h.tick();
    expect(goingOnce.nextDeadline!(h.state)).toBe(NOW + 90_000 + 2500);
    h.tick();
    const g = game(h);
    expect(g.stage).toBe('auction');
    for (const item of g.prompts.p3!) {
      expect(g.items[item]!.drawing).toBeNull();
      expect(g.items[item]!.artist).toBeNull();
    }
    expect(h.refuse('p3', { type: 'draw', item: g.prompts.p3![0]!, drawing: SQUIGGLE }).code).toBe(
      'not-drawing',
    );
  });

  it('doesn’t wait for a player who left', () => {
    const h = started(3);
    drawAll(h, ['p2']);
    h.state = goingOnce.playerLeft(h.state, 'p2', h.now);
    expect(game(h).stage).toBe('auction');
    expect(game(h).left).toEqual(['p2']);
  });
});

describe('bidding', () => {
  it('offers $400/$500/$600, then the next three steps', () => {
    const h = auctioning(3);
    expect(goingOnce.view(h.state, 'p1').game!.auction!.steps).toEqual([400, 500, 600]);
    bid(h, 'p1', 500);
    expect(goingOnce.view(h.state, 'p2').game!.auction!.steps).toEqual([600, 700, 800]);
    const seq = game(h).auction!.seq;
    h.wait(400);
    expect(h.refuse('p2', { type: 'bid', amount: 650, seq }).code).toBe('bad-bid');
    expect(h.refuse('p2', { type: 'bid', amount: 900, seq }).code).toBe('bad-bid');
    h.act('p2', { type: 'bid', amount: 800, seq });
    expect(game(h).auction!.bid).toEqual({ by: 'p2', amount: 800 });
  });

  it('refuses a bid for an old price, saying who bid what', () => {
    const h = auctioning(3);
    const seq = game(h).auction!.seq;
    bid(h, 'p1', 400);
    expect(h.refuse('p2', { type: 'bid', amount: 400, seq })).toEqual({
      code: 'too-late',
      message: 'Too late: P1 bid $400.',
    });
  });

  it('refuses raising your own bid, bidding past your cash, and bids too close together', () => {
    const h = auctioning(3);
    bid(h, 'p1', 600);
    const seq = game(h).auction!.seq;
    expect(h.refuse('p1', { type: 'bid', amount: 700, seq }).code).toBe('leading');
    const s = structuredClone(h.state);
    s.game!.players.p2!.cash = 650;
    h.state = s;
    expect(h.refuse('p2', { type: 'bid', amount: 700, seq }).code).toBe('cash');
    h.act('p3', { type: 'bid', amount: 700, seq });
    // p1 bid a moment ago: one bid at a time.
    expect(h.refuse('p1', { type: 'bid', amount: 800, seq: seq + 1 }).code).toBe('too-fast');
    h.wait(300);
    h.act('p1', { type: 'bid', amount: 800, seq: seq + 1 });
  });

  it('runs the soft close: open, going once, going twice, sold; a bid restarts the quiet', () => {
    const h = auctioning(3);
    const a = () => game(h).auction!;
    expect(a().close).toBe('open');
    expect(a().closeAt).toBe(h.now + 8000);
    h.tick();
    expect(a().close).toBe('once');
    bid(h, 'p2');
    expect(a().close).toBe('quiet');
    expect(a().closeAt).toBe(h.now + 4000);
    h.tick();
    expect(a().close).toBe('once');
    h.tick();
    expect(a().close).toBe('twice');
    bid(h, 'p3');
    expect(a().close).toBe('quiet');
    hammer(h);
    expect(game(h).stage).toBe('sold');
    expect(h.refuse('p1', { type: 'bid', amount: 600, seq: a().seq })).toEqual({
      code: 'too-late',
      message: 'Sold just before your bid.',
    });
  });

  it('runs at the host’s pace', () => {
    const h = harness(3);
    h.act(HOST, { type: 'update-settings', pace: 'relaxed' });
    h.act(HOST, { type: 'start' });
    drawAll(h);
    expect(game(h).auction!.closeAt).toBe(h.now + 12_000);
  });
});

describe('sold', () => {
  it('charges the buyer and pays the artist half', () => {
    const h = auctioning(3, 3);
    const item = lot(h);
    const artist = item.artist!;
    const buyer = ['p1', 'p2', 'p3'].find((p) => p !== artist)!;
    bid(h, buyer, 600);
    bid(h, artist, 900);
    bid(h, buyer, 1100);
    hammer(h);
    const g = game(h);
    expect(g.players[buyer]!.cash).toBe(3000 - 1100);
    expect(g.players[artist]!.cash).toBe(3000 + 550);
    expect(g.items[item.id]!.sale).toEqual({
      buyer,
      price: 1100,
      commission: 550,
      screwedBy: null,
    });
    const r = goingOnce.view(h.state, null).game!.results[0]!;
    expect(r).toMatchObject({ title: item.title, value: item.value, artist, buyer, price: 1100 });
  });

  it('pays no commission when the artist buys their own drawing', () => {
    const h = auctioning(3, 3);
    const artist = lot(h).artist!;
    bid(h, artist, 500);
    hammer(h);
    expect(game(h).players[artist]!.cash).toBe(2500);
    expect(lot(h).sale!.commission).toBe(0);
  });

  it('leaves an unsold lot’s artist secret until the end, but shows its value', () => {
    const h = auctioning(3, 3);
    const item = lot(h);
    hammer(h);
    const r = goingOnce.view(h.state, 'p1').game!.results[0]!;
    expect(r).toMatchObject({ buyer: null, value: item.value, artist: null, artistKnown: false });
  });
});

/** Plays lots with no bids up to the first lot of the second half. */
function toSecondHalf(seed = 3, n = 3) {
  const h = auctioning(n, seed);
  const half = halfAt(game(h).lots.length);
  while (game(h).auction!.lot < half) {
    hammer(h);
    nextLot(h);
  }
  return h;
}

describe('screws', () => {
  it('unlock at half-time, after a short break', () => {
    const h = auctioning(3, 3);
    expect(h.refuse('p1', { type: 'screw' }).code).toBe('locked');
    const half = halfAt(game(h).lots.length);
    while (game(h).auction!.lot < half - 1) {
      hammer(h);
      nextLot(h);
    }
    hammer(h);
    h.tick();
    expect(game(h).stage).toBe('halftime');
    h.tick();
    expect(game(h).stage).toBe('auction');
    expect(goingOnce.view(h.state, 'p1').game!.screwsOn).toBe(true);
  });

  it('force the target to bid $100 more, pausing the clock while aiming', () => {
    const h = toSecondHalf();
    bid(h, 'p1', 600);
    h.wait(1000);
    h.act('p2', { type: 'screw' });
    const a = game(h).auction!;
    expect(a.screw).toMatchObject({ by: 'p2', left: 3000 });
    expect(game(h).players.p2!.screw).toBe(false);
    expect(goingOnce.view(h.state, 'p2').mine!.targets).toEqual(['p3']);
    expect(goingOnce.view(h.state, 'p3').mine!.targets).toEqual([]);
    expect(h.refuse('p3', { type: 'bid', amount: 700, seq: a.seq }).code).toBe('screwing');
    expect(h.refuse('p2', { type: 'screw-pick', target: 'p1' }).code).toBe('bad-target');
    h.act('p2', { type: 'screw-pick', target: 'p3' });
    expect(game(h).auction!.bid).toEqual({ by: 'p3', amount: 700 });
    expect(game(h).auction!.screwed).toEqual({ target: 'p3', by: 'p2' });
    // Nobody can screw until a free bid.
    expect(h.refuse('p1', { type: 'screw' }).code).toBe('screwed');
    bid(h, 'p1');
    expect(game(h).auction!.screwed).toBeNull();
    h.act('p3', { type: 'screw' });
  });

  it('records a forced buy as screwed', () => {
    const h = toSecondHalf();
    h.act('p1', { type: 'screw' });
    h.act('p1', { type: 'screw-pick', target: 'p2' });
    expect(game(h).auction!.bid).toEqual({ by: 'p2', amount: 400 });
    hammer(h);
    expect(lot(h).sale).toMatchObject({ buyer: 'p2', price: 400, screwedBy: 'p1' });
  });

  it('are wasted when the target can’t afford it or nobody is picked', () => {
    const h = toSecondHalf();
    const s = structuredClone(h.state);
    s.game!.players.p3!.cash = 300;
    h.state = s;
    h.act('p1', { type: 'screw' });
    h.act('p1', { type: 'screw-pick', target: 'p3' });
    expect(game(h).auction!.bid).toBeNull();
    expect(h.state.log.at(-1)).toMatchObject({ kind: 'screw', outcome: 'failed', target: 'p3' });
    h.act('p2', { type: 'screw' });
    h.tick();
    expect(game(h).auction!.screw).toBeNull();
    expect(h.state.log.at(-1)).toMatchObject({ kind: 'screw', by: 'p2', outcome: 'wasted' });
    expect(game(h).players.p2!.screw).toBe(false);
    expect(h.refuse('p2', { type: 'screw' }).code).toBe('no-screw');
  });
});

describe('the bank', () => {
  it('opens by itself once someone has $1,000 or less, and lends $1,000 for $1,500', () => {
    const h = auctioning(3, 3);
    const s = structuredClone(h.state);
    s.game!.players.p1!.cash = 1400;
    h.state = s;
    bid(h, 'p1', 400);
    hammer(h);
    h.tick();
    expect(game(h).stage).toBe('bank');
    expect(goingOnce.view(h.state, 'p2').mine!.canLoan).toBe(true);
    h.act('p1', { type: 'loan', take: true });
    expect(game(h).players.p1).toMatchObject({ cash: 2000, debt: 1500, loans: 1 });
    expect(h.refuse('p1', { type: 'loan', take: true }).code).toBe('decided');
    h.act('p2', { type: 'loan', take: false });
    h.act('p3', { type: 'loan', take: false });
    // Everyone decided: the next lot opens, and p1 hears from the bank.
    expect(game(h).stage).toBe('auction');
    expect(game(h).players.p1!.messages.at(-1)!.kind).toBe('firstLoan');
  });

  it('can then be called during a lot (not the last), three times at most', () => {
    const h = auctioning(3, 3);
    expect(goingOnce.view(h.state, 'p2').mine!.bankRefusal).toBeNull();
    expect(h.refuse('p2', { type: 'call-bank' }).code).toBe('no-bank');
    const s = structuredClone(h.state);
    s.game!.bankOpened = true;
    h.state = s;
    h.act('p2', { type: 'call-bank' });
    expect(h.refuse('p3', { type: 'call-bank' }).code).toBe('bank-refused');
    hammer(h);
    h.tick();
    expect(game(h).stage).toBe('bank');
    for (const p of ['p1', 'p2', 'p3']) h.act(p, { type: 'loan', take: false });
    // Called without a loan: the bank says so next.
    expect(game(h).players.p2!.messages.at(-1)!.kind).toBe('prankCall');
    const t = structuredClone(h.state);
    t.game!.players.p2!.bankCalls = 3;
    h.state = t;
    expect(h.refuse('p2', { type: 'call-bank' }).message).toMatch(/Stop calling/);
  });

  it('gives at most three loans', () => {
    const h = auctioning(3, 3);
    const s = structuredClone(h.state);
    s.game!.players.p1!.loans = 3;
    s.game!.stage = 'bank';
    s.game!.bankDone = [];
    h.state = s;
    expect(h.refuse('p1', { type: 'loan', take: true }).code).toBe('bad-credit');
  });

  it('times out and moves on', () => {
    const h = auctioning(3, 3);
    const s = structuredClone(h.state);
    s.game!.players.p1!.cash = 900;
    h.state = s;
    hammer(h);
    h.tick();
    expect(game(h).stage).toBe('bank');
    h.tick();
    expect(game(h).stage).toBe('auction');
  });
});

describe('hints', () => {
  it('start with the wish-list intro, then the second-lot nudge', () => {
    const h = auctioning(3, 3);
    for (const p of ['p1', 'p2', 'p3']) expect(game(h).players[p]!.messages[0]!.kind).toBe('intro');
    hammer(h);
    nextLot(h);
    const kinds = ['p1', 'p2', 'p3'].map((p) => game(h).players[p]!.messages.at(-1)!.kind);
    expect(kinds).toContain('secondLot');
  });

  it('are always true: your own art, and who knows a lot', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const h = auctioning(4, seed);
      while (h.state.phase !== 'over') {
        const g = game(h);
        const a = g.auction!;
        const item = g.items[g.lots[a.lot]!]!;
        let knows = 0;
        for (const id of g.order) {
          const m = g.players[id]!.messages.at(-1)!;
          expect(m.lot).toBe(a.lot);
          if (m.kind === 'yourArt') expect(item.artist).toBe(id);
          if (m.kind === 'someoneKnows') {
            knows++;
            expect(g.players[m.about!]!.wish.some((w) => w.item === item.id)).toBe(true);
            expect(g.players[id]!.wish.some((w) => w.item === item.id)).toBe(false);
          }
        }
        expect(knows).toBeLessThanOrEqual(1);
        hammer(h);
        nextLot(h);
      }
    }
  });

  it('use the pack’s lines with their placeholders filled', () => {
    const h = auctioning(3, 3, packContent(undefined, { intro: ['Hello from the buyers!'] }));
    expect(game(h).players.p1!.messages[0]!.text).toBe('Hello from the buyers!');
  });
});

describe('the end', () => {
  it('scores cash plus art minus debt; ties share the win', () => {
    const h = auctioning(3, 3);
    const first = lot(h);
    bid(h, 'p1', 400);
    hammer(h);
    nextLot(h);
    while (h.state.phase !== 'over') {
      hammer(h);
      nextLot(h);
    }
    const v = goingOnce.view(h.state, 'p2').game!;
    const p1 = v.final!.find((f) => f.id === 'p1')!;
    expect(p1).toMatchObject({ cash: 2600, art: first.value, debt: 0 });
    expect(p1.score).toBe(2600 + first.value);
    const scores = v.final!.map((f) => f.score);
    expect(v.winners.length).toBeGreaterThanOrEqual(1);
    for (const w of v.winners)
      expect(v.final!.find((f) => f.id === w)!.score).toBe(Math.max(...scores));
    expect(game(h).stage).toBe('done');
    expect(goingOnce.nextDeadline!(h.state)).toBeNull();
  });
});

describe('moderation and leaving', () => {
  it('lets the host hide a drawing for everyone; it still sells', () => {
    const h = auctioning(3, 3);
    const item = lot(h);
    expect(h.refuse('p2', { type: 'hide', item: item.id, hidden: true }).code).toBe('not-host');
    h.act(HOST, { type: 'hide', item: item.id, hidden: true });
    const pic = goingOnce.view(h.state, 'p2').game!.auction!.picture;
    expect(pic).toEqual({ item: item.id, drawing: null, house: null, hidden: true });
    bid(h, 'p2', 400);
    hammer(h);
    expect(lot(h).sale!.buyer).toBe('p2');
  });

  it('keeps a leaver’s seat, cash and art, and welcomes them back', () => {
    const h = auctioning(3, 3);
    h.state = goingOnce.playerLeft(h.state, 'p3', h.now);
    expect(game(h).players.p3).toBeDefined();
    expect(game(h).left).toEqual(['p3']);
    h.state = goingOnce.playerJoined(h.state, { id: 'p3', name: 'P3' });
    expect(game(h).left).toEqual([]);
  });

  it('lets the host skip the Sold card', () => {
    const h = auctioning(3, 3);
    hammer(h);
    expect(game(h).stage).toBe('sold');
    h.act(HOST, { type: 'skip' });
    expect(game(h).stage).toBe('auction');
    expect(game(h).auction!.lot).toBe(1);
  });
});

describe('the original’s timings and redraw', () => {
  it('gives a screw 15 seconds to aim', () => {
    const h = toSecondHalf();
    h.act('p1', { type: 'screw' });
    expect(game(h).auction!.screw!.until).toBe(h.now + 15_000);
  });

  it('opens the bank for 30 seconds the first time and 10 after', () => {
    const h = auctioning(3, 3);
    const s = structuredClone(h.state);
    s.game!.players.p1!.cash = 900;
    h.state = s;
    hammer(h);
    h.tick();
    expect(game(h).stage).toBe('bank');
    expect(game(h).until).toBe(h.now + 30_000);
    for (const p of ['p1', 'p2', 'p3']) h.act(p, { type: 'loan', take: false });
    h.act('p2', { type: 'call-bank' });
    hammer(h);
    h.tick();
    expect(game(h).stage).toBe('bank');
    expect(game(h).until).toBe(h.now + 10_000);
  });

  it('calls faster above $1,000 at the Normal pace only', () => {
    const h = auctioning(3, 3);
    bid(h, 'p1', 600);
    h.tick();
    expect(game(h).auction!.closeAt).toBe(h.now + 2000);
    bid(h, 'p2', 900);
    bid(h, 'p3', 1100);
    h.tick();
    expect(game(h).auction!.close).toBe('once');
    expect(game(h).auction!.closeAt).toBe(h.now + 1500);
    h.tick();
    expect(game(h).auction!.closeAt).toBe(h.now + 1500);
  });

  it('redraws once with new titles when nobody draws anything, then ends the game', () => {
    const h = started(3, 4);
    const before = Object.values(game(h).items)
      .map((i) => i.title)
      .sort();
    for (let i = 0; i < 3; i++) h.tick();
    expect(game(h).stage).toBe('draw');
    expect(game(h).redraws).toBe(1);
    const after = Object.values(game(h).items)
      .map((i) => i.title)
      .sort();
    expect(after).not.toEqual(before);
    expect(goingOnce.view(h.state, 'p1').game!.redraw).toBe(true);
    // Drawing in the redraw plays on as usual.
    const h2 = structuredClone(h.state);
    for (let i = 0; i < 3; i++) h.tick();
    expect(h.state.phase).toBe('over');
    expect(game(h).ended).toBe('no-drawings');
    expect(game(h).winners).toEqual([]);
    h.state = h2;
    drawAll(h);
    expect(game(h).stage).toBe('auction');
  });

  it('fills a partly empty round with house pictures, no redraw', () => {
    const h = started(3, 4);
    const g = game(h);
    h.act('p1', { type: 'draw', item: g.prompts.p1![0]!, drawing: SQUIGGLE });
    for (let i = 0; i < 3; i++) h.tick();
    expect(game(h).stage).toBe('auction');
    expect(game(h).redraws).toBe(0);
  });
});

describe('the host', () => {
  const HOST_LINES = {
    'draw-start': ['Draw!'],
    'opening-first': ['First up.'],
    opening: ['Who will start?'],
    'bid-400': ['We have 400.'],
    'bid-500': ['I see 500.'],
    'going-once': ['Going once…'],
    'going-twice': ['Going twice…'],
    sold: ['Sold!'],
    congrats: ['Well done, {player}!'],
    windfall: ['What a windfall.'],
    'own-art': ['{player} bought their own art.'],
    'no-bids-first': ['Not a great start.'],
    'no-bids-1': ['No one?'],
    'no-bids-2': ['Again?'],
    unsold: ['Get rid of it!'],
    quiet: ['{player}, you are very quiet.'],
    halftime: ['Screws out!'],
    'end-intro': ['Winners and losers!'],
  };
  const withHost = () => packContent(undefined, {}, HOST_LINES);

  it('speaks at each moment, from the private pack only', () => {
    const h = harness(3, 3, withHost());
    h.act(HOST, { type: 'start' });
    expect(goingOnce.view(h.state, null).game!.host!.lines).toEqual(['Draw!']);
    drawAll(h);
    expect(game(h).host!.lines).toEqual(['First up.']);
    bid(h, 'p2', 400);
    expect(game(h).host!.lines).toEqual(['We have 400.']);
    h.tick();
    expect(game(h).host!.lines).toEqual(['Going once…']);
    h.tick();
    expect(game(h).host!.lines).toEqual(['Going twice…']);
    h.tick();
    const item = lot(h);
    const lines = game(h).host!.lines;
    expect(lines[0]).toBe('Well done, P2!');
    if (item.artist === 'p2') expect(lines[1]).toBe('P2 bought their own art.');
    else if (item.value - 400 >= 800) expect(lines[1]).toBe('What a windfall.');
    // Unsold lots: "No one?", then "Again?" on the next one.
    nextLot(h);
    h.tick();
    expect(game(h).host!.lines).toEqual(['No one?']);
    hammer(h);
    expect(game(h).host!.lines).toEqual(['Get rid of it!']);
    nextLot(h);
    h.tick();
    expect(game(h).host!.lines).toEqual(['Again?']);
  });

  it('says nothing without a host pack', () => {
    const h = auctioning(3, 3);
    expect(game(h).host).toBeNull();
    bid(h, 'p1', 400);
    expect(goingOnce.view(h.state, 'p1').game!.host).toBeNull();
  });

  it('calls out a quiet bidder before a lot', () => {
    const h = harness(3, 3, withHost());
    h.act(HOST, { type: 'start' });
    drawAll(h);
    for (let i = 0; i < 3; i++) {
      hammer(h);
      nextLot(h);
    }
    const line = game(h).host!.lines[0]!;
    expect(line).toMatch(/^P\d, you are very quiet\.$/);
  });
});

describe('the default pace', () => {
  it('is Fast at 3 players and Normal otherwise, until the host picks one', () => {
    expect(harness(3).state.settings.pace).toBe('fast');
    expect(harness(4).state.settings.pace).toBe('normal');
    const h = harness(4);
    h.state = goingOnce.playerLeft(h.state, 'p4', h.now);
    expect(h.state.settings.pace).toBe('fast');
    h.act(HOST, { type: 'update-settings', pace: 'relaxed' });
    h.state = goingOnce.playerJoined(h.state, { id: 'p9', name: 'P9' });
    expect(h.state.settings.pace).toBe('relaxed');
  });
});

describe('host pack checks', () => {
  it('refuse lines that are labels, file names or stage directions, and unfinished lines', async () => {
    const { hostPack } = await import('./content.ts');
    expect(hostPack.safeParse({ sold: ['Sold!'] }).success).toBe(true);
    for (const bad of ['New Version', 'Hello (sigh).', 'see AUC037.', 'Going once', '{player}.'])
      expect(hostPack.safeParse({ sold: [bad] }).success, bad).toBe(false);
  });
});
