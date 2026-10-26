import { type Rng, createRng, isGameError } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { MULTI_MODES, RANKS, deckFor } from './cards.ts';
import { CLUE_COLOURS } from './clues.ts';
import { skyfireBot } from './bot.ts';
import { skyfire } from './game.ts';
import { HOST, content, game, harness, ids, playing } from './test-utils.ts';
import { MEMORY_MODES, REACTIONS, type SkyfireAction, type SkyfireState } from './types.ts';

/**
 * The state with everything `viewer` may not see changed: the faces of their own cards and of the
 * deck dealt out again among them (ids and order kept), who clued each card, the replay and the
 * hidden seed. A view that leaks nothing is the same for both.
 */
function scramble(state: SkyfireState, viewer: string | null): SkyfireState {
  const s = structuredClone(state);
  s.seed = (s.seed + 12345) >>> 0;
  const g = s.game;
  if (!g || s.phase === 'over') return s;
  const hidden = [...g.deck, ...(viewer && g.hands[viewer] ? g.hands[viewer] : [])];
  const faces = hidden.map((id) => g.cards[id]!).reverse();
  // Rotate too, so a palindrome of faces still changes.
  faces.push(faces.shift()!);
  hidden.forEach((id, i) => {
    g.cards[id] = faces[i]!;
  });
  g.cluedBy = Object.fromEntries(Object.keys(g.cluedBy).map((id) => [id, { by: 'x', turn: -1 }]));
  g.turns = [];
  g.start = { hands: {}, clues: 0, fuses: 0, fireworks: {}, deck: 0, discards: 0 };
  return s;
}

/** The first viewer whose view changes when their hidden information does, or undefined. */
function leak(state: SkyfireState): string | null | undefined {
  const viewers = new Set([null, ...Object.keys(state.seats), ...(state.game?.order ?? [])]);
  for (const v of viewers) {
    if (
      JSON.stringify(skyfire.view(scramble(state, v), v)) !== JSON.stringify(skyfire.view(state, v))
    )
      return v;
  }
  return undefined;
}

/** A move by the player on turn: mostly the bot's, sometimes anything at all. */
function randomMove(state: SkyfireState, rng: Rng): { by: string; action: SkyfireAction } {
  const g = state.game!;
  const pick = <T>(xs: readonly T[]) => xs[rng.int(xs.length)]!;
  const by = g.current;
  const roll = rng.next();
  if (roll < 0.02) return { by: HOST, action: { type: 'act-for', player: by } };
  if (roll < 0.05) {
    const who = pick(g.order);
    return { by: who, action: { type: 'reorder', order: rng.shuffle(g.hands[who]!) } };
  }
  if (roll < 0.07) return { by: pick(g.order), action: { type: 'react', emoji: pick(REACTIONS) } };
  if (roll < 0.8) {
    const move = skyfireBot(skyfire.view(state, by), { me: by, now: 0, rng, words: () => [] });
    if (move) return { by, action: move };
  }
  const hand = g.hands[by]!;
  const card = hand.length ? pick(hand) : 'c1';
  if (roll < 0.86) return { by, action: { type: 'play', card } };
  if (roll < 0.92) return { by, action: { type: 'discard', card } };
  const to = pick(g.order);
  return rng.next() < 0.5
    ? { by, action: { type: 'clue', to, colour: pick(CLUE_COLOURS) } }
    : { by, action: { type: 'clue', to, rank: pick(RANKS) } };
}

describe('view()', () => {
  it('sends every hand but your own; yours only as ids and clue marks', () => {
    const h = harness(3);
    h.act(HOST, { type: 'start' });
    const v = skyfire.view(h.state, 'p1').game!;
    expect(v.hands.p1!.every((s) => s.card === null && s.know)).toBe(true);
    expect(v.hands.p2!.every((s) => s.card)).toBe(true);
    expect(v.deck).toBe(35);
    expect(v.replay).toBeNull();
    const text = JSON.stringify(skyfire.view(h.state, 'p1'));
    for (const id of game(h).deck) expect(text).not.toContain(`"${id}"`);
    expect(leak(h.state)).toBeUndefined();
  });

  it('ids say nothing about the card: they are dealing positions', () => {
    const h = harness(2);
    h.act(HOST, { type: 'start' });
    expect(game(h).hands.p1).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
    expect(game(h).hands.p2).toEqual(['c6', 'c7', 'c8', 'c9', 'c10']);
  });

  it('shows every hand and the whole replay at the end', () => {
    const h = playing(2, { p1: 'r1 b2', p2: 'g1' }, { deck: 'y1 y2' });
    h.act('p1', { type: 'play', card: 'hp1-0' });
    h.act(HOST, { type: 'end-game' });
    const v = skyfire.view(h.state, 'p1').game!;
    expect(v.hands.p1!.every((s) => s.card)).toBe(true);
    expect(v.replay!.turns).toHaveLength(1);
    expect(v.replay!.turns[0]).toMatchObject({ kind: 'play', card: 'hp1-0', ok: true });
    expect(v.replay!.cards['d0']).toEqual({ suit: 'yellow', rank: 1 });
  });

  it('leaks nothing to any viewer at any point of 1,000 seeded games', () => {
    let finished = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const rng = createRng(seed);
      // With a watcher: 2 to 5 players, and every variant now and then.
      const n = 2 + (seed % 4);
      const settings = {
        multi: MULTI_MODES[seed % 4]!,
        black: seed % 3 === 0,
        expert: seed % 5 === 0,
        zeroClues: seed % 7 !== 0,
        memory: MEMORY_MODES[seed % 3]!,
        seconds: seed % 2 ? 30 : null,
        timerMode: seed % 4 < 2 ? ('strict' as const) : ('soft' as const),
      };
      let now = 1_000_000;
      let state = skyfire.create(
        { now, rng, content },
        [...ids(n), 'w1'].map((id) => ({ id, name: id })),
      );
      const act = (by: string, action: SkyfireAction) => {
        const r = skyfire.reduce(state, action, { by, isHost: by === HOST, now, rng, content });
        if (!isGameError(r)) state = r;
      };
      act(HOST, { type: 'update-settings', ...settings });
      act(HOST, { type: 'start' });
      const total = deckFor(settings).length;
      for (let step = 0; step < 600 && state.phase === 'playing'; step++) {
        now += 1000;
        const g = state.game!;
        const roll = rng.next();
        if (roll < 0.005) {
          state = skyfire.playerLeft(state, g.order[1 + rng.int(g.order.length - 1)]!, now);
        } else if (roll < 0.01 && Object.keys(g.left).length) {
          const id = Object.keys(g.left)[0]!;
          state = skyfire.playerJoined(state, { id, name: id });
        } else if (roll < 0.04 && skyfire.nextDeadline!(state) !== null) {
          now = Math.max(now, skyfire.nextDeadline!(state)!);
          state = skyfire.onDeadline!(state, now);
        } else {
          const move = randomMove(state, rng);
          act(move.by, move.action);
        }
        if (step % 3 !== 2) continue;
        const leaked = leak(state);
        if (leaked !== undefined) expect.fail(`seed ${seed}, step ${step}: leak to ${leaked}`);
        // Cards are never made or lost.
        const s = state.game!;
        const lit = Object.values(s.fireworks).reduce((a, b) => a + b, 0);
        const count =
          s.order.reduce((sum, id) => sum + s.hands[id]!.length, 0) +
          s.deck.length +
          s.discards.length +
          lit;
        if (count !== total) expect.fail(`seed ${seed}, step ${step}: ${count} cards of ${total}`);
        if (s.clues < 0 || s.clues > 8 || s.fuses > 3) expect.fail(`seed ${seed}: tokens`);
      }
      expect(leak(state)).toBeUndefined();
      if (state.phase === 'over') finished++;
    }
    expect(finished).toBeGreaterThan(900);
  }, 600_000);

  it('a whole table of leavers still finishes the show', () => {
    const h = harness(3);
    h.act(HOST, { type: 'start' });
    for (const id of ['p1', 'p2', 'p3']) h.state = skyfire.playerLeft(h.state, id, h.now);
    for (let i = 0; i < 3000 && h.state.phase === 'playing'; i++) h.tick();
    expect(h.state.phase).toBe('over');
  });
});
