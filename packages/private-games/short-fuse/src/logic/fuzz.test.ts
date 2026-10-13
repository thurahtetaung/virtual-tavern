import { type ContentProvider, type Rng, createRng, isGameError } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { CARDS, NAMEABLE } from './cards.ts';
import { awaited, comboOf, shortFuse, targetable } from './game.ts';
import { everyCard, ids, leaks } from './test-utils.ts';
import type { Settings, ShortFuseAction, ShortFuseState } from './types.ts';

const content: ContentProvider = { wordLists: () => [], words: () => [] };

/** A random legal-looking move for someone (refusals are fine: they must leave the state alone). */
function randomMove(
  state: ShortFuseState,
  rng: Rng,
): { by: string; action: ShortFuseAction } | null {
  const g = state.game!;
  const pick = <T>(xs: readonly T[]) => xs[rng.int(xs.length)]!;
  if (state.stage === 'window') {
    const holders = g.players.filter((p) => g.hands[p]!.some((id) => g.cards[id]!.t === 'nope'));
    if (holders.length && rng.next() < 0.3)
      return { by: pick(holders), action: { type: 'nope', window: g.window!.id } };
    return null;
  }
  const who = awaited(state)[0];
  if (!who) return null;
  if (rng.next() < 0.01) return { by: 'host', action: { type: 'act-for', player: who } };
  const hand = g.hands[who]!;
  switch (state.stage) {
    case 'turn': {
      if (rng.next() < 0.45 || !hand.length) return { by: who, action: { type: 'draw' } };
      // Mostly sensible plays (a playable card, a matching pair or triple), sometimes junk.
      const r = rng.next();
      let cards: string[];
      if (r < 0.1) cards = rng.shuffle(hand).slice(0, pick([1, 2, 3, 5]));
      else {
        const byType = new Map<string, string[]>();
        for (const id of hand) {
          const t = g.cards[id]!.t;
          byType.set(t, [...(byType.get(t) ?? []), id]);
        }
        const sets = [...byType.values()];
        const size = r < 0.75 ? 1 : r < 0.92 ? 2 : 3;
        const ok = sets.filter(
          (ids) => ids.length >= size && (size > 1 || CARDS[g.cards[ids[0]!]!.t].playable),
        );
        if (!ok.length) return { by: who, action: { type: 'draw' } };
        cards = pick(ok).slice(0, size);
      }
      const types = cards.map((id) => g.cards[id]!.t);
      const combo = comboOf(types, g.fiveCombo);
      const others = g.players.filter((p) => p !== who);
      const targets = targetable(g, who);
      const target =
        !('error' in combo) &&
        combo.kind === 'card' &&
        CARDS[combo.t!].targeted &&
        combo.t !== 'favor'
          ? pick(others)
          : targets.length
            ? pick(targets)
            : pick(others);
      return { by: who, action: { type: 'play', cards, target, named: pick(NAMEABLE) } };
    }
    case 'favor':
      return { by: who, action: { type: 'give', card: pick(hand) } };
    case 'alter': {
      const k = g.alter!.cards.length;
      return { by: who, action: { type: 'order', order: rng.shuffle([...Array(k).keys()]) } };
    }
    case 'salvage': {
      const options = g.discard.filter((id) => !CARDS[g.cards[id]!.t].bombLike);
      return { by: who, action: { type: 'salvage', card: pick(options) } };
    }
    case 'bomb':
      return { by: who, action: { type: 'defuse' } };
    case 'place':
      return { by: who, action: { type: 'place', position: rng.int(g.pile.length + 1) } };
    default:
      return null;
  }
}

/** Hot-path checks: plain throws (vitest's `expect` is too slow for 100k steps). */
function check(ok: boolean, what: string, label: () => string) {
  if (!ok) throw new Error(`${label()}: ${what}`);
}

function checkInvariants(state: ShortFuseState, label: () => string, deep = true) {
  const g = state.game!;
  const all = everyCard(g);
  check(new Set(all).size === all.length, 'a card is in two places', label);
  check(all.length === Object.keys(g.cards).length, 'a card went missing', label);
  check(g.turn.owed >= 1, 'owed below 1', label);
  if (deep) check(JSON.stringify(state).length < 256 * 1024, 'state too large', label);
  if (state.phase === 'playing') {
    const live = g.players.filter((p) => !g.left.includes(p) && !g.dead.some((d) => d.id === p));
    check(live.length >= 2, 'fewer than two players left in play', label);
    check(live.includes(g.turn.player), 'the turn is with someone out', label);
  }
}

function playOne(seed: number) {
  const rng = createRng(seed);
  const n = 2 + (seed % 9);
  const players = ids(10).slice(0, n);
  const settings: Partial<Settings> = {
    core: rng.next() < 0.3 ? 'party' : 'classic',
    art: rng.next() < 0.3 ? 'adult' : 'classic',
    x1: rng.next() < 0.5,
    faster: rng.next() < 0.2,
    fiveCombo: rng.next() < 0.3,
    nonStacking: rng.next() < 0.2,
    strict: rng.next() < 0.3,
    decisionSeconds: 20,
  };
  let now = 1_000_000;
  const run = (s: ShortFuseState, action: ShortFuseAction, by: string) =>
    shortFuse.reduce(s, action, { by, isHost: by === 'host', now, rng, content });
  let state = shortFuse.create(
    { now, rng, content },
    players.map((id) => ({ id, name: id })),
  );
  state = run(state, { type: 'update-settings', ...settings }, 'host') as ShortFuseState;
  state = run(state, { type: 'start' }, 'host') as ShortFuseState;
  for (let step = 0; step < 3000 && state.phase === 'playing'; step++) {
    const label = () => `seed ${seed} step ${step} ${state.stage}`;
    if (rng.next() < 0.004 && state.game!.players.length > 2) {
      const live = state.game!.players.filter((p) => !state.game!.left.includes(p));
      state = shortFuse.playerLeft(state, live[rng.int(live.length)]!, now);
      checkInvariants(state, label);
      continue;
    }
    const move = randomMove(state, rng);
    if (move) {
      now += 200 + rng.int(1500);
      const next = run(state, move.action, move.by);
      if (!isGameError(next)) state = next;
    } else {
      const due = shortFuse.nextDeadline!(state);
      if (due === null) {
        // A soft clock: somebody must act, so this is a stuck game.
        throw new Error(`${label()}: nobody to act and no deadline`);
      }
      now = Math.max(now + 1, due);
      state = shortFuse.onDeadline!(state, now);
      const after = shortFuse.nextDeadline!(state);
      check(
        after === null || after > now || state.phase !== 'playing',
        'deadline did not move',
        label,
      );
    }
    checkInvariants(state, label, step % 20 === 0);
    if (step % 20 === 0)
      for (const v of [...state.game!.players, null]) {
        const found = leaks(state, v);
        check(found.length === 0, `leak to ${v}: ${found.join(', ')}`, label);
      }
  }
  expect(state.phase, `seed ${seed} finished`).toBe('over');
  const g = state.game!;
  const live = g.players.filter((p) => !g.left.includes(p) && !g.dead.some((d) => d.id === p));
  expect(live.length).toBeLessThanOrEqual(1);
  if (live.length === 1) expect(g.winner).toBe(live[0]);
}

describe('fuzz', () => {
  it('1,000 seeded random games keep every invariant and finish', () => {
    for (let seed = 1; seed <= 1000; seed++) playOne(seed);
  }, 300_000);
});
