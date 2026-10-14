import { type ActionCtx, type Rng, createRng, isGameError } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { ENABLED_HEROES } from './cards.ts';
import { tavernBrawl } from './game.ts';
import { NOW, arrange, checkConservation, started } from './test-utils.ts';
import type { TavernBrawlAction, TavernBrawlState } from './types.ts';

const NO_CONTENT = { wordLists: () => [], words: () => [] };
const MAX_STATE = 256 * 1024;

/**
 * Hidden from `viewer`: every deck, and every other player's hand. The log may name cards that
 * were public when they happened (played, in a discard pile, in play), so it's checked apart.
 */
function checkView(state: TavernBrawlState, viewer: string | null) {
  const g = state.game;
  const view = tavernBrawl.view(state, viewer);
  const json = JSON.stringify(view);
  expect(json).not.toContain('"seed"');
  expect(json).not.toContain('"frames"');
  if (!g) return;
  const body = JSON.stringify({ ...view, log: [] });
  const over = state.phase === 'over';
  for (const p of g.order) {
    const pl = g.players[p]!;
    for (const inst of pl.deck) expect(body).not.toContain(inst);
    if (p !== viewer && !over) for (const inst of pl.hand) expect(body).not.toContain(inst);
  }
  // Log entries never carry a hidden card: only counts for draws and secret takes.
  for (const e of view.log) {
    if (e.kind === 'draw' || e.kind === 'scout') expect(Object.keys(e)).not.toContain('inst');
  }
  const c = g.choice;
  if (c && c.chooser !== viewer) expect(view.game!.choice!.options).toEqual([]);
  if (viewer && !over) {
    expect(view.hand.map((r) => r.id)).toEqual(g.players[viewer]?.hand ?? []);
  }
}

function randomGame(seed: number) {
  const rng = createRng(seed);
  const n = 2 + rng.int(5);
  const players = Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `P${i + 1}` }));
  let now = NOW;
  let state = tavernBrawl.create({ now, rng, content: NO_CONTENT }, players);
  for (const p of players) state = tavernBrawl.playerJoined(state, p);
  const act = (by: string, action: TavernBrawlAction, r: Rng = rng) => {
    const ctx: ActionCtx = { now, rng: r, content: NO_CONTENT, by, isHost: by === 'p1' };
    const next = tavernBrawl.reduce(state, action, ctx);
    if (isGameError(next)) throw new Error(`${by} ${JSON.stringify(action)}: ${next.code}`);
    state = next;
  };
  const modes = [
    { seconds: null, timerMode: 'soft' as const },
    { seconds: 30, timerMode: 'soft' as const },
    { seconds: 30, timerMode: 'strict' as const },
  ];
  act('p1', { type: 'update-settings', ...modes[rng.int(modes.length)]! });
  const heroes = rng.shuffle(ENABLED_HEROES);
  players.forEach((p, i) => act(p.id, { type: 'pick-hero', hero: heroes[i]! }));
  act('p1', { type: 'start' });
  return {
    get state() {
      return state;
    },
    set state(s) {
      state = s;
    },
    get now() {
      return now;
    },
    set now(t) {
      now = t;
    },
    rng,
    act,
    players: players.map((p) => p.id),
  };
}

function step(t: ReturnType<typeof randomGame>): boolean {
  const g = t.state.game!;
  const due = tavernBrawl.nextDeadline!(t.state);
  if (due !== null && t.rng.next() < 0.08) {
    t.now = Math.max(t.now, due);
    t.state = tavernBrawl.onDeadline!(t.state, t.now);
    const after = tavernBrawl.nextDeadline!(t.state);
    expect(after === null || after > t.now).toBe(true);
    return true;
  }
  if (t.rng.next() < 0.004) {
    const alive = g.order.filter((p) => !g.players[p]!.out && !g.left[p]);
    const who = alive[t.rng.int(alive.length)];
    if (who) {
      t.state = tavernBrawl.playerLeft(t.state, who, t.now);
      return true;
    }
  }
  t.now += 1000;
  if (g.choice) {
    const c = g.choice;
    if (g.left[c.chooser] !== undefined) return fire(t);
    t.act(c.chooser, {
      type: 'choose',
      choice: c.id,
      pick: c.options[t.rng.int(c.options.length)]!,
    });
    return true;
  }
  const p = g.turn.player;
  if (g.left[p] !== undefined) return fire(t);
  const hand = g.players[p]!.hand;
  if (hand.length === 0) throw new Error('stuck with an empty hand');
  t.act(p, { type: 'play', card: hand[t.rng.int(hand.length)]! });
  return true;
}

function fire(t: ReturnType<typeof randomGame>): boolean {
  const due = tavernBrawl.nextDeadline!(t.state);
  if (due === null) throw new Error('waiting on a leaver with no deadline');
  t.now = Math.max(t.now, due);
  t.state = tavernBrawl.onDeadline!(t.state, t.now);
  return true;
}

function invariants(state: TavernBrawlState) {
  const g = state.game!;
  checkConservation(state);
  for (const p of g.order) {
    const pl = g.players[p]!;
    expect(pl.hp).toBeGreaterThanOrEqual(0);
    expect(pl.hp).toBeLessThanOrEqual(10);
    // Knockouts wait until the card being played has fully resolved (A7).
    if (!pl.out && state.phase === 'playing' && g.frames.length === 0)
      expect(pl.hp).toBeGreaterThan(0);
    for (const sh of pl.shields) expect(sh.damage).toBeGreaterThanOrEqual(0);
  }
  expect(g.turn.debt).toBeGreaterThanOrEqual(0);
  if (state.phase === 'playing') {
    const turn = g.players[g.turn.player]!;
    expect(!turn.out || turn.ghost === true).toBe(true);
    for (const p of g.order) if (g.players[p]!.ghost) expect(g.players[p]!.out).toBe(true);
    if (!g.zone) for (const p of g.order) expect(g.players[p]!.ghost).toBeFalsy();
    expect(g.order.filter((p) => !g.players[p]!.out).length).toBeGreaterThan(1);
  }
}

describe('view', () => {
  it('hides hands and decks from everyone else at every step of a game', () => {
    const t = randomGame(42);
    for (let i = 0; i < 400 && t.state.phase === 'playing'; i++) {
      for (const v of [...t.players, null]) checkView(t.state, v);
      step(t);
    }
    for (const v of [...t.players, null]) checkView(t.state, v);
  });

  it('shows the chooser their options and only a waiting note to others', () => {
    const h = started(['mage', 'brute', 'knight']);
    arrange(h, 'p1', { hand: ['mage.06', 'mage.01'] });
    h.play('p1', 'mage.06');
    expect(tavernBrawl.view(h.state, 'p1').game!.choice!.options.sort()).toEqual(['p2', 'p3']);
    expect(tavernBrawl.view(h.state, 'p2').game!.choice).toMatchObject({
      kind: 'target',
      chooser: 'p1',
      options: [],
    });
    expect(tavernBrawl.view(h.state, null).hand).toEqual([]);
  });

  it('keeps scouted cards secret: only a count goes to the table', () => {
    const h = started(['ranger', 'mage', 'brute']);
    arrange(h, 'p1', { hand: ['ranger.09', 'ranger.01'] });
    h.play('p1', 'ranger.09');
    const taken = h.state.game!.players.p1!.hand;
    for (const v of ['p2', 'p3', null]) {
      const json = JSON.stringify(tavernBrawl.view(h.state, v));
      for (const inst of taken) expect(json).not.toContain(inst);
    }
    expect(h.state.log.find((e) => e.kind === 'scout')).toMatchObject({ count: 2 });
  });

  it('shows every hand at the end', () => {
    const h = started(['mage', 'brute']);
    arrange(h, 'p1', { hand: ['mage.06', 'mage.01'] });
    arrange(h, 'p2', { hp: 2 });
    h.play('p1', 'mage.06');
    const v = tavernBrawl.view(h.state, 'p2');
    expect(v.game!.hands!.p1!.map((r) => r.card)).toEqual(['mage.01']);
  });
});

describe('fuzz', () => {
  it('plays 1,000 seeded games to the end with every invariant held', () => {
    let ties = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const t = randomGame(seed);
      let steps = 0;
      try {
        while (t.state.phase === 'playing') {
          step(t);
          invariants(t.state);
          if (seed % 50 === 0 && steps % 7 === 0)
            for (const v of [...t.players, null]) checkView(t.state, v);
          if (++steps > 5000) throw new Error('game never ended');
        }
      } catch (e) {
        throw new Error(`seed ${seed}, step ${steps}: ${(e as Error).message}`, { cause: e });
      }
      const g = t.state.game!;
      expect(JSON.stringify(t.state).length).toBeLessThan(MAX_STATE);
      expect(t.state.phase).toBe('over');
      expect(g.winners.length).toBeLessThanOrEqual(1);
      if (g.endReason === 'last-standing') expect(g.winners).toHaveLength(1);
      if (g.winners.length === 0) ties += 1;
      expect(tavernBrawl.nextDeadline!(t.state)).toBeNull();
    }
    expect(ties).toBeLessThan(200);
  }, 120_000);
});
