import { type Rng, createRng, isGameError } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { encoreBot } from './bot.ts';
import { HAND_SIZE } from './cards.ts';
import { encore } from './game.ts';
import { turned } from './rules.ts';
import { HOST, content, game, harness, ids, keepAll, playing } from './test-utils.ts';
import type { EncoreAction, EncoreState } from './types.ts';

/**
 * The state with everything `viewer` may not see changed: the other players' cards (dealt out
 * again among them, each turned over, hand sizes kept), their secret flip choices, the cards set
 * aside for the next round, the recruited-card notes and the hidden seed. A view that leaks
 * nothing is the same for both.
 */
function scramble(state: EncoreState, viewer: string | null): EncoreState {
  const s = structuredClone(state);
  s.seed = (s.seed + 12345) >>> 0;
  const g = s.game;
  if (!g) return s;
  g.reserve.reverse();
  const others = g.order.filter((id) => id !== viewer);
  for (const id of others) {
    const p = g.players[id]!;
    if (p.flip !== null) p.flip = !p.flip;
    p.recruited.reverse();
  }
  if (s.phase === 'over') return s;
  const pool = others.flatMap((id) => g.players[id]!.hand).reverse();
  for (const id of others) {
    const p = g.players[id]!;
    p.hand = pool.splice(0, p.hand.length).map(turned);
  }
  return s;
}

/** The first viewer whose view changes when their hidden information does, or undefined. */
function leak(state: EncoreState): string | null | undefined {
  const viewers = new Set([null, ...Object.keys(state.seats), ...(state.game?.order ?? [])]);
  for (const v of viewers) {
    if (
      JSON.stringify(encore.view(scramble(state, v), v)) !== JSON.stringify(encore.view(state, v))
    )
      return v;
  }
  return undefined;
}

/** A move by someone the table waits on: mostly the bot's, sometimes anything at all. */
function randomMove(state: EncoreState, rng: Rng): { by: string; action: EncoreAction } {
  const g = state.game!;
  const pick = <T>(xs: readonly T[]) => xs[rng.int(xs.length)]!;
  const waiting =
    g.stage === 'flip'
      ? g.order.filter((id) => g.players[id]!.flip === null)
      : g.stage === 'scores'
        ? g.order.filter((id) => !g.players[id]!.ready)
        : [g.current];
  const by = waiting.length ? pick(waiting) : g.current;
  if (rng.next() < 0.02) return { by: HOST, action: { type: 'act-for', player: by } };
  if (rng.next() < 0.75) {
    const move = encoreBot(encore.view(state, by), { me: by, now: 0, rng, words: () => [] });
    if (move) return { by, action: move };
  }
  const n = g.players[by]?.hand.length ?? 1;
  const i = rng.int(n);
  const j = i + rng.int(3);
  const roll = rng.next();
  if (g.stage === 'flip') return { by, action: { type: 'flip', flip: rng.next() < 0.5 } };
  if (g.stage === 'scores')
    return roll < 0.1
      ? { by: HOST, action: { type: 'next-round' } }
      : { by, action: { type: 'ready' } };
  const end = rng.next() < 0.5 ? 'left' : 'right';
  if (roll < 0.4) return { by, action: { type: 'show', from: i, to: j } };
  if (roll < 0.8)
    return { by, action: { type: 'recruit', end, flip: rng.next() < 0.5, at: rng.int(n + 1) } };
  return {
    by,
    action: {
      type: 'recruit-show',
      end,
      flip: rng.next() < 0.5,
      at: rng.int(n + 1),
      from: i,
      to: j,
    },
  };
}

describe('view()', () => {
  it('sends your own hand only, others’ as counts', () => {
    const h = harness(3);
    h.act(HOST, { type: 'start' });
    const v = encore.view(h.state, 'p1').game!;
    expect(v.hand).toEqual(game(h).players.p1!.hand);
    expect(v.players.map((p) => p.hand)).toEqual([12, 12, 12]);
    for (const c of game(h).players.p2!.hand) expect(JSON.stringify(v)).not.toContain(`"${c.id}"`);
    expect(encore.view(h.state, 'w1').game?.hand ?? null).toBeNull();
  });

  it('keeps the 2-player reserve on the server', () => {
    const h = harness(2);
    h.act(HOST, { type: 'start' });
    const v = encore.view(h.state, 'p1').game!;
    expect(v.reserve).toBe(22);
    for (const id of game(h).reserve) expect(JSON.stringify(v)).not.toContain(`"${id}"`);
  });

  it('never says where a recruited card went or which way up', () => {
    const h = playing(3, { p1: '1/2 9/2' }, { table: '6/1 7/2 8/3', owner: 'p3' });
    h.act('p1', { type: 'recruit', end: 'left', flip: true, at: 2 });
    expect(leak(h.state)).toBeUndefined();
  });

  it('shows the last hands at the end', () => {
    const h = playing(3, { p1: '5/1', p2: '6/1 7/2', p3: '8/1' });
    h.rig((s) => {
      s.game!.round = 3;
    });
    h.act('p1', { type: 'show', from: 0, to: 0 });
    expect(h.state.phase).toBe('over');
    expect(encore.view(h.state, 'p3').game!.finalHands!.p2!.map((c) => c.up)).toEqual([6, 7]);
  });

  it('leaks nothing to any viewer at any point of 1,000 seeded games', () => {
    let finished = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const rng = createRng(seed);
      // With the watcher seated when there's room: 2 to 5 players.
      const n = 1 + (seed % 4);
      const settings = {
        twoEach: seed % 9 === 0,
        seconds: seed % 3 === 0 ? 30 : null,
        timerMode: seed % 2 ? ('strict' as const) : ('soft' as const),
      };
      let now = 1_000_000;
      let state = encore.create(
        { now, rng, content },
        [...ids(n), 'w1'].map((id) => ({ id, name: id })),
      );
      const act = (by: string, action: EncoreAction) => {
        const r = encore.reduce(state, action, { by, isHost: by === HOST, now, rng, content });
        if (!isGameError(r)) state = r;
      };
      act(HOST, { type: 'update-settings', ...settings });
      act(HOST, { type: 'start' });
      for (let step = 0; step < 3000 && state.phase === 'playing'; step++) {
        now += 1000;
        const g = state.game!;
        const roll = rng.next();
        if (roll < 0.004) {
          state = encore.playerLeft(state, g.order[1 + rng.int(g.order.length - 1)]!, now);
        } else if (roll < 0.01 && Object.keys(g.left).length) {
          const id = Object.keys(g.left)[0]!;
          state = encore.playerJoined(state, { id, name: id });
        } else if (roll < 0.03 && encore.nextDeadline!(state) !== null) {
          now = Math.max(now, encore.nextDeadline!(state)!);
          state = encore.onDeadline!(state, now);
        } else {
          const move = randomMove(state, rng);
          act(move.by, move.action);
        }
        if (step % 9 !== 8) continue;
        const leaked = leak(state);
        if (leaked !== undefined) expect.fail(`seed ${seed}, step ${step}: leak to ${leaked}`);
        // Cards are never made or lost: hands, the table, captures and the reserve add up.
        const s = state.game!;
        if (s.stage !== 'play') continue;
        const count =
          s.order.reduce(
            (sum, id) => sum + s.players[id]!.hand.length + s.players[id]!.captured,
            0,
          ) +
          (s.table?.cards.length ?? 0) +
          s.reserve.length;
        const dealt = HAND_SIZE[s.order.length]! * s.order.length + s.reserve.length;
        if (count !== dealt) expect.fail(`seed ${seed}, step ${step}: ${count} cards`);
      }
      expect(leak(state)).toBeUndefined();
      if (state.phase === 'over') finished++;
    }
    expect(finished).toBeGreaterThan(950);
  }, 600_000);

  it('a whole table of leavers still finishes the game', () => {
    const h = harness(3);
    h.act(HOST, { type: 'start' });
    keepAll(h);
    for (const id of ['p1', 'p2', 'p3']) h.state = encore.playerLeft(h.state, id, h.now);
    for (let i = 0; i < 2000 && h.state.phase === 'playing'; i++) h.tick();
    expect(h.state.phase).toBe('over');
  });
});
