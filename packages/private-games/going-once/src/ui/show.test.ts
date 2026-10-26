import { type Moment, type Rig, playsOn, schedule } from '@vt/game-sdk/show';
import { describe, expect, it } from 'vitest';
import { goingOnce } from '../logic/definition.ts';
import { auctioning, bid, hammer, harness, nextLot, started } from '../logic/test-utils.ts';
import type { GoingOnceView } from '../logic/types.ts';
import { BANK_PARTS, endTrack, moments, raiseOf, soldMoment } from './show.ts';

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
    // An older bid is long past: a device arriving now only shows where it left things.
    expect(list.find((m) => m.id === 'lot0:bid400')!.at).toBeLessThan(newest.at - 10_000);
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

  it('racks up the end per buyer, then the finale and the winners', () => {
    const h = auctioning();
    bid(h, 'p2', 400);
    for (let i = 0; i < 60 && h.state.phase !== 'over'; i++) nextLot(h);
    const v = goingOnce.view(h.state, null);
    expect(v.game!.stage).toBe('done');
    const list = stage(v);
    const buyers = v.game!.final!.filter((f) => f.bought.length > 0);
    expect(list.filter((m) => m.id.includes(':buyer'))).toHaveLength(buyers.length);
    const first = list.find((m) => m.id.endsWith(':buyer0'))!;
    const n = Math.min(3, buyers[0]!.bought.length);
    expect(steps(first, 'end:0:0')[0]).toMatchObject({ track: `${endTrack(n, 0)}.Appear` });
    expect(first.steps.find((s) => s.kind === 'count')).toMatchObject({ to: buyers[0]!.art });
    const winner = list.find((m) => m.id.endsWith(':winner'))!;
    expect(winner.steps.some((s) => s.kind === 'confetti')).toBe(true);
    for (const id of v.game!.winners) expect(steps(winner, `win:${id}`)).toHaveLength(1);
  });
});
