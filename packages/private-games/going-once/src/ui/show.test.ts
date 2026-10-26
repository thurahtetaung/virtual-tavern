import { createRng } from '@vt/game-sdk';
import { type Moment, type Rig, playsOn, schedule } from '@vt/game-sdk/show';
import { describe, expect, it } from 'vitest';
import { goingOnce } from '../logic/definition.ts';
import { auctioning, bid, hammer, harness, nextLot, started } from '../logic/test-utils.ts';
import { BID_SETTLE_MS, type GoingOnceView } from '../logic/types.ts';
import {
  BANK_PARTS,
  WINNERS_SETTLE_MS,
  endTrack,
  moments,
  ROW_BOUNDS,
  raiseOf,
  rowOf,
  shapeKey,
  soldMoment,
  winnersShownAt,
} from './show.ts';
import { endGroups, endTimes } from './audio.ts';

// The show's moments are pure: built from real views (the game's own harness), the same for
// every device, with only the steps meant for someone personal.

const stage = (v: GoingOnceView) => moments(v, { you: null, profile: 'stage' });
const ids = (list: Moment[]) => list.map((m) => m.id);
const steps = (m: Moment | undefined, target: string) =>
  (m?.steps ?? []).filter((s) => 'target' in s && s.target === target);
const tracks: Rig['tracks'] = {};

describe('moments', () => {
  it('drops the hourglass and the sign when the drawing starts', () => {
    const h = started();
    const v = goingOnce.view(h.state, null);
    const draw = stage(v).find((m) => m.id.startsWith('draw:'))!;
    expect(draw.at).toBe(v.game!.since);
    expect(steps(draw, 'timer')[0]).toMatchObject({ kind: 'anim', track: 'timer.Appear' });
    expect(steps(draw, 'sign')[0]).toMatchObject({ on: ['stage'] });
  });

  it('brings a lot in, then its picture, with stable ids every view', () => {
    const h = auctioning();
    const v = goingOnce.view(h.state, null);
    const list = stage(v);
    expect(ids(list)).toEqual(['lot0:in', 'lot0:painting']);
    expect(steps(list[1], 'painting')[0]).toMatchObject({ track: 'painting.Appear' });
    // Re-built from the same state: the same moments, so nothing replays.
    expect(stage(goingOnce.view(h.state, null))).toEqual(list);
  });

  it('raises the bidder with the same wobble on every device and drops the one they beat', () => {
    const h = auctioning();
    bid(h, 'p2', 400);
    bid(h, 'p3', 500);
    const v = goingOnce.view(h.state, null);
    const list = stage(v);
    const newest = list.find((m) => m.id === 'lot0:bid500')!;
    expect(newest.at).toBe(v.game!.auction!.since);
    expect(steps(newest, 'pad:p3').find((s) => s.kind === 'anim')).toMatchObject({
      track: raiseOf(0, 500),
    });
    expect(steps(newest, 'pad:p2')[0]).toMatchObject({ track: 'paddle.Unraise' });
    // Only the newest bid has a moment: older ones are played, and their paddles show it.
    expect(list.find((m) => m.id === 'lot0:bid400')).toBeUndefined();
    // Every viewer gets the same moments: players' views and the table screen's.
    for (const who of ['p1', 'p2', 'p3'])
      expect(
        ids(moments(goingOnce.view(h.state, who), { you: who, profile: 'phone-full' })),
      ).toEqual(ids(list));
  });

  it('times Sold to the sound: the stamp at once, the value, PROFIT, then the artist', () => {
    const h = auctioning();
    bid(h, 'p2', 400);
    hammer(h);
    const v = goingOnce.view(h.state, null);
    expect(v.game!.stage).toBe('sold');
    const r = v.game!.results.at(-1)!;
    const sold = soldMoment(v)!;
    expect(sold.id).toBe(`sold${r.index}`);
    expect(sold.at).toBe(v.game!.since);
    expect(steps(sold, 'stamp')[0]).toMatchObject({ t: 0 });
    const count = sold.steps.find((s) => s.kind === 'count')!;
    expect(count).toMatchObject({ from: r.price, to: r.value, on: ['stage'] });
    const line = sold.steps.filter((s) => s.kind === 'text' && s.target === 'stamp.line').at(-1)!;
    expect(line.kind === 'text' && line.text).toMatch(/PROFIT|LOSS|BROKE EVEN/);
    if (r.artistKnown && r.artist) {
      const flip = steps(sold, `pad:${r.artist}`).find((s) => s.kind === 'anim')!;
      const pay = steps(sold, `artpay:${r.artist}`)[0];
      // The commission comes after the flip, each on its own beat.
      if (pay) expect(pay.t).toBeGreaterThan(flip.t);
    }
  });

  it('keeps a quiet phone to the short stamp and its own cues', () => {
    const h = auctioning();
    bid(h, 'p2', 400);
    hammer(h);
    const v = goingOnce.view(h.state, 'p2');
    const sold = soldMoment(v)!;
    const at = (you: string | null, profile: 'stage' | 'phone-quiet' | 'phone-full') =>
      schedule(sold, sold.at, { you, profile, reduced: false, low: false, tracks }).map(
        (s) => s.step,
      );
    const quiet = at('p3', 'phone-quiet');
    expect(quiet.some((s) => s.kind === 'count')).toBe(false);
    expect(quiet.some((s) => s.kind === 'css' && s.target === 'stampSpin')).toBe(false);
    expect(quiet.some((s) => s.kind === 'anim' && s.target === 'stamp')).toBe(true);
    // The buyer's buzz is theirs alone.
    expect(at('p2', 'phone-quiet').some((s) => s.kind === 'haptic')).toBe(true);
    expect(quiet.some((s) => s.kind === 'haptic')).toBe(false);
    expect(at(null, 'stage').some((s) => s.kind === 'haptic')).toBe(false);
  });

  it('lets an unsold picture leave', () => {
    const h = auctioning();
    hammer(h);
    const v = goingOnce.view(h.state, null);
    const sold = soldMoment(v)!;
    expect(v.game!.results.at(-1)!.buyer).toBeNull();
    expect(steps(sold, 'painting')[0]).toMatchObject({ track: 'painting.Disappear' });
    expect(steps(sold, 'stamp')).toEqual([]);
  });

  it('marks personal steps for their player only', () => {
    const h = auctioning();
    bid(h, 'p2', 400);
    hammer(h);
    const v = goingOnce.view(h.state, 'p2');
    for (const m of moments(v, { you: 'p2', profile: 'phone-quiet' }))
      for (const s of m.steps)
        if (s.kind === 'haptic') {
          expect(s.for).not.toBe('all');
          expect(playsOn(s, { profile: 'stage', you: null })).toBe(false);
        }
  });

  it('pops a newcomer’s paddle in the lobby, and not the ones already seated', () => {
    const h = harness(3);
    const v = goingOnce.view(h.state, null);
    const list = moments(v, { you: null, profile: 'stage', joined: { p1: 0, p3: 5_000 } });
    expect(list.find((m) => m.id === 'login:p1')!.at).toBe(0);
    expect(list.find((m) => m.id === 'login:p3')!.at).toBe(5_000);
  });

  it('swaps the bank sign’s art where the rig says', () => {
    const h = auctioning();
    // p2 wins at $2,100 and is left with $900: the bank comes by itself.
    for (let amount = 400; amount <= 2100; amount += 100)
      bid(h, amount % 200 ? 'p2' : 'p3', amount);
    hammer(h);
    for (let i = 0; i < 20 && h.state.game!.stage !== 'bank'; i++) h.tick();
    const v = goingOnce.view(h.state, null);
    expect(v.game!.stage).toBe('bank');
    const swaps: Rig['swaps'] = { 'bank-d35': { Appear: [[2600, 'bank-d35~478']] } };
    const bank = moments(v, { you: null, profile: 'stage', swaps }).find((m) =>
      m.id.startsWith('bank:'),
    )!;
    expect(BANK_PARTS.every((p) => steps(bank, `bank-${p}`).length > 0)).toBe(true);
    expect(steps(bank, 'bank-d35').find((s) => s.kind === 'set')).toMatchObject({
      t: 2600,
      value: 'bank-d35~478',
    });
  });

  it('racks up every buyer’s art in groups from their cash, then the finale lowest first', () => {
    const h = auctioning();
    bid(h, 'p2', 400);
    for (let i = 0; i < 60 && h.state.phase !== 'over'; i++) nextLot(h);
    const v = goingOnce.view(h.state, null);
    expect(v.game!.stage).toBe('done');
    const list = stage(v);
    const times = endTimes(v)!;
    const buyers = v.game!.final!.filter((f) => f.bought.length > 0);
    // Every drawing bought shows, in groups of two or three.
    expect(times.groups.flatMap((g) => g.items).sort()).toEqual(
      buyers.flatMap((f) => f.bought).sort(),
    );
    expect(list.filter((m) => m.id.includes(':group'))).toHaveLength(times.groups.length);
    const first = list.find((m) => m.id.endsWith(':group0'))!;
    const n = times.groups[0]!.items.length;
    expect(steps(first, 'end:0:0')[0]).toMatchObject({ track: `${endTrack(n, 0)}.Appear` });
    // The total counts up from the buyer's cash.
    expect(first.steps.find((s) => s.kind === 'count')).toMatchObject({
      from: buyers[0]!.cash,
      to: times.groups[0]!.to,
    });
    // The finale: lowest score before debt first, a second apart.
    const totals = v.game!.final!.map((f) => f.score + f.debt);
    expect(
      times.finale.map(
        (id) =>
          v.game!.final!.find((f) => f.id === id)!.score +
          v.game!.final!.find((f) => f.id === id)!.debt,
      ),
    ).toEqual([...totals].sort((a, b) => a - b));
    const winner = list.find((m) => m.id.endsWith(':winner'))!;
    expect(winner.steps.some((s) => s.kind === 'confetti')).toBe(true);
    for (const id of v.game!.winners) expect(steps(winner, `win:${id}`)).toHaveLength(1);
  });

  it('groups a buyer’s drawings in threes and twos, never one alone', () => {
    const sizes = (n: number) =>
      endGroups(Array.from({ length: n }, (_, i) => i)).map((g) => g.length);
    expect(sizes(1)).toEqual([1]);
    expect(sizes(3)).toEqual([3]);
    expect(sizes(4)).toEqual([2, 2]);
    expect(sizes(5)).toEqual([3, 2]);
    expect(sizes(7)).toEqual([3, 2, 2]);
    expect(sizes(14).reduce((a, b) => a + b, 0)).toBe(14);
  });

  it('keeps the winners on show whatever the view does after the end', () => {
    const h = auctioning();
    bid(h, 'p2', 400);
    for (let i = 0; i < 60 && h.state.phase !== 'over'; i++) nextLot(h);
    const before = goingOnce.view(h.state, null);
    const winner = stage(before).find((m) => m.id.endsWith(':winner'))!;
    // Later updates (a player leaving after the end, the clock running on) keep the very same
    // winner moment, so the table screen never settles or replays it.
    h.wait(30_000);
    h.state = goingOnce.playerLeft(h.state, 'p3', h.now);
    const after = goingOnce.view(h.state, null);
    expect(after).not.toEqual(before);
    expect(stage(after).find((m) => m.id.endsWith(':winner'))).toEqual(winner);
    // And once it has settled, the page shows the winners itself (`winnersShownAt`), so even a
    // moment cut short leaves the line and the winners up.
    expect(winnersShownAt(after)).toBe(endTimes(after)!.winner + WINNERS_SETTLE_MS);
    expect(winner.at).toBe(endTimes(after)!.winner);
    const last = Math.max(
      ...winner.steps.map((st) => st.t + ('ms' in st && typeof st.ms === 'number' ? st.ms : 450)),
    );
    expect(last).toBeLessThanOrEqual(WINNERS_SETTLE_MS);
    expect(winnersShownAt(goingOnce.view(auctioning().state, null))).toBeNull();
  });
});

describe('the paddles over many bids', () => {
  it('has exactly the leader’s paddle up after every bid, over 30 seeded bids', () => {
    const h = auctioning(4, 11);
    const rng = createRng(29);
    // What the table screen does with the moments (`useShow`): a new one plays, one that leaves
    // the list settles at its end. Each paddle keeps the pose of the last track it was given.
    const playing = new Map<string, Moment>();
    const pose: Record<string, string> = {};
    const ctx = { profile: 'stage' as const, you: null, reduced: false, low: false, tracks };
    const apply = (m: Moment, now: number) => {
      for (const sc of schedule(m, now, ctx))
        if (sc.step.kind === 'anim' && sc.step.target.startsWith('pad:'))
          pose[sc.step.target.slice(4)] = sc.step.track;
    };
    const sync = () => {
      const list = stage(goingOnce.view(h.state, null));
      const live = new Set(list.map((m) => m.id));
      for (const [id, m] of playing)
        if (!live.has(id)) {
          apply(m, Number.MAX_SAFE_INTEGER);
          playing.delete(id);
        }
      for (const m of list)
        if (!playing.has(m.id)) {
          playing.set(m.id, m);
          apply(m, h.now);
        }
    };
    sync();
    for (let n = 0; n < 30;) {
      const g = h.state.game!;
      const a = g.auction;
      if (g.stage !== 'auction' || !a || a.close === 'intro') {
        h.tick();
        sync();
        continue;
      }
      const amount = a.bid ? a.bid.amount + 100 : 400;
      const can = g.order.filter((id) => id !== a.bid?.by && g.players[id]!.cash >= amount);
      if (!can.length) {
        // Sold: every view on the way, as the table screen sees them.
        h.tick();
        sync();
        continue;
      }
      const by = can[rng.int(can.length)]!;
      h.wait(BID_SETTLE_MS);
      h.act(by, { type: 'bid', amount, seq: a.seq });
      n++;
      sync();
      const up = Object.entries(pose)
        .filter(([, track]) => /Raise\d$/.test(track))
        .map(([id]) => id);
      expect(up, `after bid ${n} (${by} at ${amount})`).toEqual([by]);
    }
  });
});

describe('the table screen’s layout', () => {
  it('finds every dealt paddle’s silhouette by its picture’s name, the bell included', () => {
    const manifest = {
      ui: { paddles: ['ui/paddles/thumbs-up.webp', 'ui/paddles/bell.webp', 'ui/paddles/x.webp'] },
    };
    const rig = { symbols: { 'shape.ThumbsUp': '<path/>', 'shape.Bell': '<path/>' } };
    expect(shapeKey(manifest, rig, 0)).toBe('shape.ThumbsUp');
    expect(shapeKey(manifest, rig, 1)).toBe('shape.Bell');
    // One the rig lacks draws no head (the export refuses to leave one out).
    expect(shapeKey(manifest, rig, 2)).toBeNull();
    expect(shapeKey(null, rig, 0)).toBeNull();
  });

  it('centres the row: across the room, or right of the painting during a lot', () => {
    // The original's seat layouts (made-up numbers in their shape: 200 apart, 3 to 6 seats).
    const places = Object.fromEntries(
      (['Three', 'Four', 'Five', 'Six'] as const).map((k, i) => [
        `row.${k}`,
        Array.from({ length: 6 }, (_, j) => [0.9, 0, 0, 0.9, 140 + j * 200 + (3 - i) * 100, 300]),
      ]),
    );
    for (const n of [3, 4, 5, 6])
      for (const where of ['room', 'lot'] as const) {
        const xs = rowOf(places, n, where);
        expect(xs).toHaveLength(n);
        const [lo, hi] = ROW_BOUNDS[where];
        expect((xs[0]! + xs.at(-1)!) / 2).toBeCloseTo((lo + hi) / 2);
        expect(xs[0]!).toBeGreaterThanOrEqual(lo);
        expect(xs.at(-1)!).toBeLessThanOrEqual(hi);
      }
    expect((rowOf(places, 3, 'room')[0]! + rowOf(places, 3, 'room')[2]!) / 2).toBe(640);
  });
});
