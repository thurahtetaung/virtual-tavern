import { type Rng, createRng, isGameError } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { groups, mosaicBot } from './bot.ts';
import { mosaic } from './game.ts';
import { linesFor } from './rules.ts';
import { HOST, content, ids, started, tileCount } from './test-utils.ts';
import { COLOURS, type MosaicAction, type MosaicState, SIZE, type Split, TILES } from './types.ts';

/**
 * The state with everything nobody may see changed: the bag's order and the hidden seed. A view
 * that leaks nothing is the same for both, for every viewer.
 */
function scramble(state: MosaicState): MosaicState {
  const s = structuredClone(state);
  s.seed = (s.seed + 12345) >>> 0;
  if (s.game) s.game.bag.reverse();
  return s;
}

/** The first viewer whose view changes when the hidden information does, or undefined. */
function leak(state: MosaicState): string | null | undefined {
  const viewers = new Set([null, ...Object.keys(state.seats), ...(state.game?.order ?? [])]);
  const other = scramble(state);
  for (const v of viewers)
    if (JSON.stringify(mosaic.view(other, v)) !== JSON.stringify(mosaic.view(state, v))) return v;
  return undefined;
}

/** A random move by the current player: mostly the bot's, sometimes anything (refusals are fine). */
function randomMove(state: MosaicState, rng: Rng): { by: string; action: MosaicAction } {
  const g = state.game!;
  if (g.stage === 'wall') {
    const waiting = Object.keys(g.walls!).filter((id) => g.walls![id]!.row !== null);
    const by = waiting[rng.int(waiting.length)]!;
    if (rng.next() < 0.5) {
      const move = mosaicBot(mosaic.view(state, by), { me: by, now: 0, rng, words: () => [] });
      if (move) return { by, action: move };
    }
    return { by, action: { type: 'wall', row: g.walls![by]!.row!, col: rng.int(SIZE) } };
  }
  if (g.stage === 'tiling') {
    if (rng.next() < 0.1) return { by: HOST, action: { type: 'skip-tiling' } };
    const by = g.order[rng.int(g.order.length)]!;
    return { by, action: { type: 'ready' } };
  }
  const by = g.current;
  if (rng.next() < 0.02) return { by: HOST, action: { type: 'act-for', player: by } };
  if (rng.next() < 0.25) {
    const move = mosaicBot(mosaic.view(state, by), { me: by, now: 0, rng, words: () => [] });
    if (move) return { by, action: move };
  }
  const options = groups({
    factories: g.factories,
    centre: g.centre,
    marker: g.marker,
    specials: g.specials ?? null,
  });
  const pick = options[rng.int(options.length)]!;
  // Mostly a legal line; now and then the floor, or a line that may well be refused.
  const legal = linesFor(g.players[by]!, pick.colour, !!state.settings.grey);
  const roll = rng.next();
  const target =
    roll < 0.15 || !legal.length
      ? ('floor' as const)
      : roll < 0.25
        ? rng.int(SIZE)
        : legal[rng.int(legal.length)]!;
  const split: Split = {};
  for (const t of TILES) split[t] = rng.next() < 0.5 ? 'left' : 'right';
  return {
    by,
    action: {
      type: 'take',
      source: pick.source,
      colour: pick.colour,
      target,
      ...(pick.jokers && { jokers: true }),
      ...(rng.next() < 0.9 && { split }),
    },
  };
}

describe('view()', () => {
  it('sends the bag only as counts per colour', () => {
    const h = started(3);
    const v = mosaic.view(h.state, 'p2');
    const g = h.state.game!;
    // What's out on the factories plus what's left in the bag: 20 of each.
    for (const c of COLOURS)
      expect(v.game!.bag[c] + g.factories.flat().filter((t) => t === c).length).toBe(20);
    expect('seed' in v).toBe(false);
    expect(Array.isArray(v.game!.bag)).toBe(false);
  });

  it('every viewer sees the same table at every stage', () => {
    const h = started(3);
    for (let i = 0; i < 400 && h.state.phase === 'playing'; i++) {
      const g = h.state.game!;
      if (g.stage === 'tiling') h.tick();
      else {
        const move = mosaicBot(mosaic.view(h.state, g.current), {
          me: g.current,
          now: h.now,
          rng: createRng(i),
          words: () => [],
        })!;
        h.act(g.current, move);
      }
      const views = [null, 'p1', 'p2', 'p3'].map((v) => mosaic.view(h.state, v));
      const strip = (x: (typeof views)[number]) => JSON.stringify({ ...x, me: null });
      expect(new Set(views.map(strip)).size).toBe(1);
      expect(leak(h.state)).toBeUndefined();
    }
    expect(h.state.phase).toBe('over');
  });

  it('leaks nothing to any viewer at any point of 1,000 seeded games, with every option combination', () => {
    let finished = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const rng = createRng(seed);
      // With a watcher seated when there's room: 2 to 4 players.
      const n = 1 + (seed % 3);
      // Every combination of the three options, in turn.
      const settings = {
        seconds: seed % 3 === 0 ? 30 : null,
        timerMode: seed % 2 ? ('strict' as const) : ('soft' as const),
        grey: !!(seed & 8),
        jokers: !!(seed & 16),
        specials: !!(seed & 32),
      };
      let now = 1_000_000;
      let state = mosaic.create(
        { now, rng, content },
        [...ids(n), 'w1'].map((id) => ({ id, name: id })),
      );
      const act = (by: string, action: MosaicAction) => {
        const r = mosaic.reduce(state, action, { by, isHost: by === HOST, now, rng, content });
        if (!isGameError(r)) state = r;
      };
      act(HOST, { type: 'update-settings', ...settings });
      act(HOST, { type: 'start' });
      for (let step = 0; step < 600 && state.phase === 'playing'; step++) {
        now += 1000;
        const g = state.game!;
        const roll = rng.next();
        if (roll < 0.004) {
          state = mosaic.playerLeft(state, g.order[1 + rng.int(g.order.length - 1)]!, now);
        } else if (roll < 0.01 && Object.keys(g.left).length) {
          const id = Object.keys(g.left)[0]!;
          // Some come back; the host removes the others.
          if (rng.next() < 0.5) state = mosaic.playerJoined(state, { id, name: id });
          else act(HOST, { type: 'remove', player: id });
        } else if (roll < 0.05 && mosaic.nextDeadline!(state) !== null) {
          now = Math.max(now, mosaic.nextDeadline!(state)!);
          state = mosaic.onDeadline!(state, now);
        } else {
          const move = randomMove(state, rng);
          act(move.by, move.action);
        }
        if (step % 10 !== 9) continue;
        const leaked = leak(state);
        if (leaked !== undefined) expect.fail(`seed ${seed}, step ${step}: leak to ${leaked}`);
        // Tiles are never made or lost.
        const all = tileCount(state);
        if (all !== 100) expect.fail(`seed ${seed}, step ${step}: ${all} tiles`);
      }
      expect(leak(state)).toBeUndefined();
      if (state.phase === 'over') finished++;
    }
    expect(finished).toBeGreaterThan(950);
  }, 300_000);
});
