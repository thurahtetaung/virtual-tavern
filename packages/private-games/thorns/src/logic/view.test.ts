import { type ContentProvider, type Rng, createRng, isGameError } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { awaited, flipTargets, thorns } from './game.ts';
import { HOST, ids, rigStacks, started } from './test-utils.ts';
import type { Disc, ThornsAction, ThornsState } from './types.ts';

const content: ContentProvider = { wordLists: () => [], words: () => [] };
const swap = (d: Disc): Disc => (d === 'rose' ? 'thorn' : d === 'thorn' ? 'rose' : d);

/**
 * The state with everything `viewer` may not see changed: other players' hands, owned and lost
 * discs, and the face-down part of their stacks (unless shown), with roses and thorns swapped,
 * and the hidden seed. A view that leaks nothing is the same for both.
 */
function scramble(state: ThornsState, viewer: string | null): ThornsState {
  const s = structuredClone(state);
  s.seed = (s.seed + 12345) >>> 0;
  const g = s.game;
  if (!g || s.phase === 'over') return s;
  const r = g.round;
  for (const id of g.order) {
    if (id === viewer) continue;
    const p = g.players[id]!;
    p.hand = p.hand.map(swap);
    p.discs = p.discs.map(swap);
    p.lost = p.lost.map(swap);
    if (r.shown.includes(id)) continue;
    const flipped = r.flips.filter((f) => f.owner === id).length;
    p.stack = p.stack.map((d, i) => (i >= p.stack.length - flipped ? d : swap(d)));
  }
  return s;
}

/** The first viewer whose view changes when their hidden information does, or undefined. */
function leak(state: ThornsState): string | null | undefined {
  const viewers = new Set([null, ...Object.keys(state.seats), ...(state.game?.order ?? [])]);
  for (const v of viewers) {
    if (
      JSON.stringify(thorns.view(scramble(state, v), v)) !== JSON.stringify(thorns.view(state, v))
    )
      return v;
  }
  return undefined;
}

export function expectNoLeaks(state: ThornsState) {
  expect(leak(state)).toBeUndefined();
}

/** A random move for someone the table waits on (refusals are fine: they change nothing). */
function randomMove(state: ThornsState, rng: Rng): { by: string; action: ThornsAction } | null {
  const g = state.game!;
  const r = g.round;
  const who = awaited(g);
  const pick = <T>(xs: readonly T[]) => xs[rng.int(xs.length)]!;
  const failed = r.result?.outcome === 'failed';
  if (failed && rng.next() < 0.3) return { by: pick(g.order), action: { type: 'show' } };
  if (!who.length) return null;
  const by = pick(who);
  if (rng.next() < 0.03) return { by: HOST, action: { type: 'act-for', player: by } };
  const p = g.players[by]!;
  switch (r.stage) {
    case 'place':
      return { by, action: { type: 'place', disc: pick(p.hand.length ? p.hand : ['rose']) } };
    case 'turns':
      if (p.hand.length && rng.next() < 0.6)
        return { by, action: { type: 'place', disc: pick(p.hand) } };
      return { by, action: { type: 'bid', amount: 1 + rng.int(3) } };
    case 'bid': {
      const high = r.bids.at(-1)!.amount;
      return rng.next() < 0.6
        ? { by, action: { type: 'pass' } }
        : { by, action: { type: 'bid', amount: high + 1 + rng.int(2) } };
    }
    case 'flip': {
      const t = flipTargets(g);
      return { by, action: { type: 'flip', owner: rng.next() < 0.9 ? pick(t) : pick(g.order) } };
    }
    case 'lose':
      return { by, action: { type: 'lose', disc: pick(p.discs) } };
    case 'starter':
      return { by, action: { type: 'starter', player: pick(g.order) } };
    case 'result':
      return null;
  }
}

describe('view()', () => {
  it('shows your own discs only, others’ as counts, until the end', () => {
    const h = started(3, { first: 'p1' });
    rigStacks(h, { p1: ['rose', 'thorn'], p2: ['rose'], p3: ['thorn'] }, 'p1');
    const v = thorns.view(h.state, 'p2');
    expect(v.mine).toMatchObject({ stack: ['rose'], lost: [] });
    expect(v.game!.players.find((p) => p.id === 'p1')).toMatchObject({
      stack: 2,
      hand: 2,
      discs: 4,
      flipped: [],
    });
    expect(v.reveal).toBeNull();
    expect(thorns.view(h.state, null).mine).toBeNull();
    expectNoLeaks(h.state);
  });

  it('reveals everything at the end', () => {
    const h = started(3, { first: 'p1' });
    const s = structuredClone(h.state);
    s.game!.players.p1!.points = 1;
    h.state = s;
    rigStacks(h, { p1: ['rose'], p2: ['rose'], p3: ['thorn'] }, 'p1');
    h.act('p1', { type: 'bid', amount: 2 });
    h.act('p2', { type: 'pass' });
    h.act('p3', { type: 'pass' });
    h.act('p1', { type: 'flip', owner: 'p1' });
    h.act('p1', { type: 'flip', owner: 'p2' });
    expect(h.state.phase).toBe('over');
    expect(thorns.view(h.state, 'p2').reveal!.find((r) => r.id === 'p3')!.stack).toEqual(['thorn']);
  });

  it('leaks nothing to any viewer at any point of 500 seeded games', () => {
    let finished = 0;
    for (let seed = 1; seed <= 500; seed++) {
      const rng = createRng(seed);
      const n = 3 + (seed % 4);
      const settings = {
        lastChance: seed % 5 !== 0,
        seconds: seed % 3 === 0 ? 20 : null,
        timerMode: seed % 2 ? ('strict' as const) : ('soft' as const),
      };
      let now = 1_000_000;
      let state = thorns.create(
        { now, rng, content },
        ids(n).map((id) => ({ id, name: id })),
      );
      const act = (by: string, action: ThornsAction) => {
        const r = thorns.reduce(state, action, { by, isHost: by === HOST, now, rng, content });
        if (!isGameError(r)) state = r;
      };
      act(HOST, { type: 'update-settings', ...settings });
      act(HOST, { type: 'start' });
      for (let step = 0; step < 600 && state.phase === 'playing'; step++) {
        now += 500;
        if (rng.next() < 0.004) {
          const g = state.game!;
          const leaver = g.order[rng.int(g.order.length)]!;
          state = thorns.playerLeft(state, leaver, now);
        } else {
          const move = randomMove(state, rng);
          if (move) act(move.by, move.action);
          else {
            const at = thorns.nextDeadline!(state);
            if (at === null) break;
            now = Math.max(now, at);
            state = thorns.onDeadline!(state, now);
          }
        }
        // Every few steps (and at the end below) every viewer's view is checked.
        if (step % 6 !== 5) continue;
        const leaked = leak(state);
        if (leaked !== undefined) expect.fail(`seed ${seed}, step ${step}: leak to ${leaked}`);
        // Every player still in owns 1–4 discs; with the lost ones, always 4.
        for (const id of state.game!.order) {
          const p = state.game!.players[id]!;
          if (!p.out && (p.discs.length === 0 || p.discs.length + p.lost.length !== 4))
            expect.fail(`seed ${seed}, step ${step}: ${id} has ${p.discs.length} discs`);
        }
      }
      expectNoLeaks(state);
      if (state.phase === 'over') finished++;
    }
    expect(finished).toBeGreaterThan(450);
  }, 120_000);
});
