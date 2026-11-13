import { type BotCtx, type PlayerId, createRng, playWithBots } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { goingOnceBot, goingOnceWakeAt, scribble } from './bot.ts';
import { goingOnce } from './definition.ts';
import { HOST, auctioning, bid, game, harness, packContent } from './test-utils.ts';
import { BID_SETTLE_MS, TIMINGS, type GoingOnceAction, type GoingOnceView } from './types.ts';
import { validateDrawing } from '@vt/game-sdk';

const seats = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));

const host = (view: GoingOnceView, _me: PlayerId): GoingOnceAction | null =>
  view.phase === 'lobby' ? { type: 'start' } : null;

describe('bots', () => {
  for (const n of [3, 4, 5, 6]) {
    for (const seed of [1, 2, 3]) {
      it(`play a ${n}-player game to the end (seed ${seed})`, () => {
        const r = playWithBots(goingOnce, seats(n), {
          seed,
          host,
          content: packContent(),
          stepMs: 300,
          maxSteps: 6000,
        });
        expect(r.over).toBe(true);
        // Only bids beaten to the price on screen may be refused.
        for (const x of r.refused) expect(['too-late', 'too-fast', 'leading']).toContain(x.code);
        const g = r.state.game!;
        expect(Object.values(g.items).some((i) => i.sale?.buyer)).toBe(true);
      });
    }
  }

  it('draw scribbles that pass the checks', () => {
    for (let seed = 1; seed <= 20; seed++)
      expect(validateDrawing(scribble(createRng(seed))).ok).toBe(true);
  });

  it('takes the view as its first parameter', () => {
    const hook: (view: GoingOnceView, ctx: BotCtx) => unknown = goingOnceBot;
    expect(hook).toBeTypeOf('function');
  });

  type H = ReturnType<typeof auctioning>;
  const look = (h: H, me: string, seed = 1, at = h.now) =>
    goingOnceBot(goingOnce.view(h.state, me), {
      me,
      now: at,
      rng: createRng(seed),
      words: () => [],
    });
  const wake = (h: H, me: string, at = h.now) =>
    goingOnceWakeAt(goingOnce.view(h.state, me), {
      me,
      now: at,
      rng: createRng(1),
      words: () => [],
    });

  it('make up their mind once per price: every look at one price agrees', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const h = auctioning(4, seed);
      for (const id of game(h).order) {
        const first = JSON.stringify(look(h, id));
        for (let k = 2; k <= 12; k++)
          expect(JSON.stringify(look(h, id, k, h.now + k * 300))).toBe(first);
      }
    }
  });

  it('bid as a lot opens, well before “going once” at the default pace', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const h = auctioning(4, seed);
      const a = game(h).auction!;
      expect(a.close).toBe('open');
      // A bot's bid lands within its quick pause (0.6–1.2 s), the call comes seconds later.
      expect(a.closeAt - h.now).toBeGreaterThanOrEqual(TIMINGS.normal.open);
      const bids = game(h)
        .order.map((id) => look(h, id))
        .filter((m) => m?.type === 'bid');
      expect(bids.length).toBeGreaterThan(0);
    }
  });

  it('stay out until the price moves, then decide again', () => {
    let flipped = 0;
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const h = auctioning(4, seed);
      const order = game(h).order;
      const out = order.find((id) => look(h, id) === null);
      if (!out) continue;
      // Out at this price, on every look and through the auctioneer's call.
      h.tick();
      expect(game(h).auction!.close).toBe('once');
      expect(look(h, out, 9, h.now + 500)).toBeNull();
      // Someone else moves the price: once the bid has landed it looks afresh.
      const other = order.find((id) => id !== out)!;
      bid(h, other);
      expect(wake(h, out)).toBe(h.now + BID_SETTLE_MS);
      expect(look(h, out)).toBeNull();
      if (look(h, out, 1, h.now + BID_SETTLE_MS) !== null) flipped += 1;
    }
    // At a new price some of them do bid (deterministically, from the price).
    expect(flipped).toBeGreaterThan(0);
  });

  it('wait for the auctioneer to call for the drawings, and look again then', () => {
    const h = harness(3, 5);
    for (let i = 0; i < 3; i++)
      h.state = goingOnce.playerJoined(h.state, {
        id: `p${i + 1}`,
        name: `P${i + 1}`,
        color: (['red', 'yellow', 'blue'] as const)[i],
      });
    h.act(HOST, { type: 'update-settings', pace: 'normal', voice: true });
    h.act(HOST, { type: 'start' });
    h.tick(); // past the 3-2-1
    const from = game(h).drawStart;
    expect(from).toBeGreaterThan(h.now);
    expect(look(h, 'p2')).toBeNull();
    expect(wake(h, 'p2')).toBe(from);
    const move = look(h, 'p2', 1, from);
    expect(move?.type).toBe('draw');
    h.now = from;
    h.act('p2', move!);
  });
});
