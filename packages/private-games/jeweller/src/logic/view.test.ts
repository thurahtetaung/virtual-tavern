import { type Rng, createRng, isGameError } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { jewellerBot } from './bot.ts';
import { cardOf } from './cards.ts';
import { jeweller } from './game.ts';
import { totalOf } from './rules.ts';
import { conquestCard, holdMoves, supplyOf } from './strongholds.ts';
import { HOST, content, game, ids, setPlayer, started } from './test-utils.ts';
import {
  GEMS,
  GEMS_FOR,
  type JewellerAction,
  type JewellerState,
  LEVELS,
  TOKENS,
  TOKEN_LIMIT,
} from './types.ts';

/**
 * The state with everything `viewer` may not see changed: every deck's order, the hidden
 * reserved cards of other players (each swapped for another card of the same level from the
 * deck, the log entry too) and the hidden seed. A view that leaks nothing is the same for both.
 */
function scramble(state: JewellerState, viewer: string | null): JewellerState {
  const s = structuredClone(state);
  s.seed = (s.seed + 12345) >>> 0;
  const g = s.game;
  if (!g) return s;
  for (const l of LEVELS) g.decks[l].reverse();
  if (s.phase === 'over') return s;
  for (const id of g.order) {
    if (id === viewer) continue;
    for (const r of g.players[id]!.reserved) {
      if (!r.blind && s.settings.showReserved) continue;
      const deck = g.decks[cardOf(r.card).level];
      if (!deck.length) continue;
      const other = deck.shift()!;
      deck.push(r.card);
      for (const e of s.log) if (e.kind === 'reserve' && e.card === r.card) e.card = other;
      r.card = other;
    }
  }
  return s;
}

/** The first viewer whose view changes when their hidden information does, or undefined. */
function leak(state: JewellerState): string | null | undefined {
  const viewers = new Set([null, ...Object.keys(state.seats), ...(state.game?.order ?? [])]);
  for (const v of viewers) {
    if (
      JSON.stringify(jeweller.view(scramble(state, v), v)) !==
      JSON.stringify(jeweller.view(state, v))
    )
      return v;
  }
  return undefined;
}

/** A random move by the current player: mostly the bot's, sometimes anything (refusals are fine). */
function randomMove(state: JewellerState, rng: Rng): { by: string; action: JewellerAction } {
  const g = state.game!;
  const by = g.current;
  const pick = <T>(xs: readonly T[]) => xs[rng.int(xs.length)]!;
  if (rng.next() < 0.02) return { by: HOST, action: { type: 'act-for', player: by } };
  if (rng.next() < 0.7) {
    const move = jewellerBot(jeweller.view(state, by), {
      me: by,
      now: 0,
      rng,
      words: () => [],
    });
    if (move) return { by, action: move };
  }
  const p = g.players[by]!;
  const market = LEVELS.flatMap((l) => g.market[l]).filter((c): c is string => c !== null);
  switch (g.stage) {
    case 'return': {
      const tokens: Partial<Record<(typeof TOKENS)[number], number>> = {};
      let over = totalOf(p.tokens) - TOKEN_LIMIT;
      for (const t of rng.shuffle(TOKENS))
        while (over > 0 && (tokens[t] ?? 0) < p.tokens[t]) {
          tokens[t] = (tokens[t] ?? 0) + 1;
          over -= 1;
        }
      return { by, action: { type: 'return', tokens } };
    }
    case 'noble':
      return { by, action: { type: 'noble', noble: pick(g.nobleChoice) } };
    case 'hold': {
      const moves = holdMoves(g.market, g.holds, by);
      // Now and then an illegal one (refused).
      if (!moves.length || rng.next() < 0.1)
        return { by, action: { type: 'stronghold', card: pick([...market, 'L1-01']) } };
      return { by, action: { ...pick(moves) } };
    }
    case 'conquer':
      return rng.next() < 0.5
        ? { by, action: { type: 'no-conquest' } }
        : { by, action: { type: 'buy', card: conquestCard(g.holds, by) ?? pick(market) } };
    case 'action': {
      const roll = rng.next();
      if (roll < 0.4)
        return { by, action: { type: 'take', gems: rng.shuffle(GEMS).slice(0, 1 + rng.int(3)) } };
      if (roll < 0.6)
        return rng.next() < 0.5 || !market.length
          ? { by, action: { type: 'reserve', level: pick(LEVELS) } }
          : { by, action: { type: 'reserve', card: pick(market) } };
      if (roll < 0.95) {
        const own = p.reserved.map((r) => r.card);
        return { by, action: { type: 'buy', card: pick([...market, ...own, 'L1-01']) } };
      }
      return { by, action: { type: 'pass' } };
    }
  }
}

describe('view()', () => {
  it('sends deck counts only, and others’ reserved cards as levels', () => {
    const h = started(3);
    const blind = game(h).decks[2][0]!;
    h.act('p1', { type: 'reserve', level: 2 });
    const face = game(h).market[1][0]!;
    h.act('p2', { type: 'reserve', card: face });
    const v = jeweller.view(h.state, 'p3');
    expect(v.game!.decks).toEqual({ 1: 35, 2: 25, 3: 16 });
    expect(v.game!.players[0]!.reserved).toEqual([{ level: 2, card: null, blind: true }]);
    expect(v.game!.players[1]!.reserved).toEqual([{ level: 1, card: null, blind: false }]);
    expect(JSON.stringify(v)).not.toContain(blind);
    // The owner sees their own.
    expect(jeweller.view(h.state, 'p1').game!.players[0]!.reserved[0]!.card).toBe(blind);
    // The log names the card only to its owner.
    const entry = (viewer: string) =>
      jeweller.view(h.state, viewer).log.find((e) => e.kind === 'reserve' && e.by === 'p2');
    expect(entry('p3')).toMatchObject({ card: null });
    expect(entry('p2')).toMatchObject({ card: face });
  });

  it('“show reserved cards” shows the face-up ones, never the blind ones', () => {
    const h = started(2, { settings: { showReserved: true } });
    const blind = game(h).decks[3][0]!;
    h.act('p1', { type: 'reserve', level: 3 });
    const face = game(h).market[2][2]!;
    h.act('p2', { type: 'reserve', card: face });
    const v = jeweller.view(h.state, 'p1');
    expect(v.game!.players[1]!.reserved[0]!.card).toBe(face);
    expect(JSON.stringify(jeweller.view(h.state, 'p2'))).not.toContain(blind);
  });

  it('shows everyone’s reserved cards at the end', () => {
    const h = started(2);
    const blind = game(h).decks[3][0]!;
    h.act('p1', { type: 'reserve', level: 3 });
    setPlayer(h, 'p2', { cards: ['L3-01', 'L3-02', 'L3-03', 'L3-04', 'L3-05'] });
    h.act('p2', { type: 'take', gems: ['white', 'blue', 'green'] });
    expect(h.state.phase).toBe('over');
    expect(jeweller.view(h.state, 'p2').game!.players[0]!.reserved[0]!.card).toBe(blind);
  });

  it('leaks nothing to any viewer at any point of 1,000 seeded games', () => {
    let finished = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const rng = createRng(seed);
      // With the watcher seated when there's room: 2 to 4 players.
      const n = 1 + (seed % 3);
      const settings = {
        showReserved: seed % 4 === 0,
        target: 15 + (seed % 7 === 0 ? 3 : 0),
        seconds: seed % 3 === 0 ? 30 : null,
        timerMode: seed % 2 ? ('strict' as const) : ('soft' as const),
        // Both modules, alone and together.
        cities: seed % 5 === 1 || seed % 5 === 2,
        strongholds: seed % 5 === 2 || seed % 5 === 3,
      };
      let now = 1_000_000;
      let state = jeweller.create(
        { now, rng, content },
        [...ids(n), 'w1'].map((id) => ({ id, name: id })),
      );
      const act = (by: string, action: JewellerAction) => {
        const r = jeweller.reduce(state, action, { by, isHost: by === HOST, now, rng, content });
        if (!isGameError(r)) state = r;
      };
      act(HOST, { type: 'update-settings', ...settings });
      act(HOST, { type: 'start' });
      for (let step = 0; step < 1500 && state.phase === 'playing'; step++) {
        now += 1000;
        const g = state.game!;
        const roll = rng.next();
        if (roll < 0.004) {
          state = jeweller.playerLeft(state, g.order[1 + rng.int(g.order.length - 1)]!, now);
        } else if (roll < 0.01 && Object.keys(g.left).length) {
          const id = Object.keys(g.left)[0]!;
          // Some come back; the host removes the others.
          if (rng.next() < 0.5) state = jeweller.playerJoined(state, { id, name: id });
          else act(HOST, { type: 'remove', player: id });
        } else if (roll < 0.03 && jeweller.nextDeadline!(state) !== null) {
          now = Math.max(now, jeweller.nextDeadline!(state)!);
          state = jeweller.onDeadline!(state, now);
        } else {
          const move = randomMove(state, rng);
          act(move.by, move.action);
        }
        if (step % 15 !== 14) continue;
        const leaked = leak(state);
        if (leaked !== undefined) expect.fail(`seed ${seed}, step ${step}: leak to ${leaked}`);
        // Pieces are never made or lost: the bank and every player add up to the starting set.
        const s = state.game!;
        const all = s.order.reduce(
          (sum, id) => sum + totalOf(s.players[id]!.tokens),
          totalOf(s.bank),
        );
        const start = 5 + 5 * GEMS_FOR[s.order.length]!;
        if (all !== start) expect.fail(`seed ${seed}, step ${step}: ${all} pieces`);
        // Strongholds sit only on face-up cards, at most 3 a player.
        const faceUp = LEVELS.flatMap((l) => s.market[l]);
        for (const [card, h] of Object.entries(s.holds ?? {}))
          if (!faceUp.includes(card) || h.n < 1 || h.n > 3)
            expect.fail(`seed ${seed}, step ${step}: stronghold on ${card}`);
        for (const id of s.order)
          if (supplyOf(s.holds, id) < 0) expect.fail(`seed ${seed}: ${id} has too many out`);
      }
      expect(leak(state)).toBeUndefined();
      if (state.phase === 'over') finished++;
    }
    expect(finished).toBeGreaterThan(950);
  }, 300_000);
});
