import { type Rng, createRng, isGameError } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { conveyorBot } from './bot.ts';
import { PRESETS } from './cards.ts';
import { askable, conveyor, copyTargets, fits, takeoutTargets, waitingOn } from './game.ts';
import { HOST, content, game, ids, pickAll, playing, tray } from './test-utils.ts';
import type { Card, ConveyorAction, ConveyorState } from './types.ts';

/**
 * The state with everything `viewer` may not see changed: the other players' hands and piles
 * (dealt out again among them, sizes kept), their picks and chopsticks choices, the deck and the
 * dessert pile (reversed), a menu's draw (swapped with the deck), a spoon's request (unless the
 * viewer made it or must answer it) and the hidden seed. A view that leaks nothing is the same.
 */
function scramble(state: ConveyorState, viewer: string | null): ConveyorState {
  const s = structuredClone(state);
  s.seed = (s.seed + 12345) >>> 0;
  const g = s.game;
  if (!g || s.phase === 'over') return s;
  g.deck.reverse();
  g.dessertPile.reverse();
  const others = g.order.filter((id) => id !== viewer);
  const step = g.step;
  // The giver's hand decides their options, which only they see; a requester sees neither.
  const keep = new Set([viewer, step?.kind === 'give' && viewer === step.from ? step.from : null]);
  const shuffled = others.filter((id) => !keep.has(id));
  const pool: Card[] = shuffled.flatMap((id) => g.players[id]!.hand).reverse();
  const piles: Card[] = shuffled.flatMap((id) => g.players[id]!.pile).reverse();
  for (const id of shuffled) {
    const p = g.players[id]!;
    p.hand = pool.splice(0, p.hand.length);
    p.pile = piles.splice(0, p.pile.length);
  }
  for (const id of others) {
    const p = g.players[id]!;
    if (p.pick) p.pick = { card: 'zz', target: 'yy' };
  }
  if (step?.kind === 'chop')
    for (const id of Object.keys(step.choices))
      if (id !== viewer) step.choices[id] = { card: 'zz' };
  if (step?.kind === 'menu' && step.by !== viewer) {
    const swap = g.deck.splice(0, step.drawn.length, ...step.drawn);
    step.drawn = swap.length === step.drawn.length ? swap : step.drawn.reverse();
  }
  if (step?.kind === 'give' && viewer !== step.by && viewer !== step.from)
    step.request = { type: step.request.type === 'nigiri' ? 'pudding' : 'nigiri' };
  return s;
}

/** The first viewer whose view changes when their hidden information does, or undefined. */
function leak(state: ConveyorState): string | null | undefined {
  const viewers = new Set([null, ...Object.keys(state.seats), ...(state.game?.order ?? [])]);
  for (const v of viewers) {
    if (
      JSON.stringify(conveyor.view(scramble(state, v), v)) !==
      JSON.stringify(conveyor.view(state, v))
    )
      return v;
  }
  return undefined;
}

/** A move by someone the table waits on: mostly random and legal, sometimes the bot's or junk. */
function randomMove(state: ConveyorState, rng: Rng): { by: string; action: ConveyorAction } {
  const g = state.game!;
  const pick = <T>(xs: readonly T[]) => xs[rng.int(xs.length)]!;
  const waiting = waitingOn(g);
  const by = waiting.length ? pick(waiting) : g.order[0]!;
  if (rng.next() < 0.02) return { by: HOST, action: { type: 'act-for', player: by } };
  if (rng.next() < 0.15) {
    const move = conveyorBot(conveyor.view(state, by), { me: by, now: 0, rng, words: () => [] });
    if (move) return { by, action: move };
  }
  const p = g.players[by]!;
  const target = () => pick([...copyTargets(p.tray).map((c) => c.id), 'nope']);
  if (g.stage === 'scores')
    return rng.next() < 0.1
      ? { by: HOST, action: { type: 'next-round' } }
      : { by, action: { type: 'ready' } };
  if (g.stage === 'pick') {
    if (!p.hand.length) return { by, action: { type: 'unpick' } };
    const card = pick(p.hand);
    const bonus = p.tray.filter((c) => /^(chopsticks|spoon)/.test(c.k)).map((c) => c.id);
    return {
      by,
      action: {
        type: 'pick',
        card: card.id,
        ...(card.k === 'order' && rng.next() < 0.9 && { target: target() }),
        ...(bonus.length && rng.next() < 0.5 && { bonus: pick(bonus) }),
      },
    };
  }
  const step = g.step!;
  switch (step.kind) {
    case 'chop': {
      const card = p.hand.length ? pick(p.hand).id : 'none';
      return { by, action: { type: 'chop', card, ...(rng.next() < 0.5 && { target: target() }) } };
    }
    case 'spoon': {
      const types = askable(g);
      const want = pick(types);
      return { by, action: { type: 'spoon', want } };
    }
    case 'give': {
      const options = fits(p.hand, step.request);
      return { by, action: { type: 'give', card: options.length ? pick(options).id : 'x' } };
    }
    case 'menu':
      return {
        by,
        action: {
          type: 'menu',
          card: pick(step.drawn).id,
          ...(rng.next() < 0.5 && { target: target() }),
        },
      };
    case 'copy':
      return { by, action: { type: 'copy', target: target() } };
    case 'takeout':
      return {
        by,
        action: {
          type: 'takeout',
          cards: takeoutTargets(g, by, step.id)
            .filter(() => rng.next() < 0.4)
            .map((c) => c.id),
        },
      };
  }
}

/** Every card of the game, wherever it is: none made or lost. */
function cardCount(state: ConveyorState): number {
  const g = state.game!;
  const step = g.step;
  return (
    g.deck.length +
    g.dessertPile.length +
    (step?.kind === 'menu' ? step.drawn.length : 0) +
    g.order.reduce((sum, id) => {
      const p = g.players[id]!;
      return sum + p.hand.length + p.pile.length + p.tray.length + p.desserts.length;
    }, 0)
  );
}

describe('view()', () => {
  it('sends your own hand only, others’ as counts', () => {
    const h = playing(3, {
      hands: { p1: ['tempura', 'tea'], p2: ['sashimi', 'miso'], p3: ['maki-1', 'tea'] },
    });
    const v = conveyor.view(h.state, 'p1').game!;
    expect(v.hand!.map((c) => c.k)).toEqual(['tempura', 'tea']);
    expect(v.players.map((p) => p.hand)).toEqual([2, 2, 2]);
    expect(JSON.stringify(v)).not.toContain('p2-0');
    expect(conveyor.view(h.state, 'w1').game?.hand ?? null).toBeNull();
    expect(leak(h.state)).toBeUndefined();
  });

  it('keeps picks, the deck and a menu’s draw secret', () => {
    const h = playing(3, {
      menu: ['temaki', 'tempura', 'dumpling', 'tofu', 'wasabi', 'menu', 'icecream'],
      hands: { p1: ['menu-7', 'tofu'], p2: ['tofu', 'tofu'], p3: ['tofu', 'tofu'] },
    });
    h.act('p2', { type: 'pick', card: 'p2-0' });
    expect(leak(h.state)).toBeUndefined();
    h.act('p1', { type: 'pick', card: 'p1-0' });
    h.act('p3', { type: 'pick', card: 'p3-0' });
    expect(h.state.game!.step?.kind).toBe('menu');
    expect(leak(h.state)).toBeUndefined();
  });

  it('keeps a spoon’s request between its player and the giver', () => {
    const h = playing(4, {
      menu: ['temaki', 'eel', 'tofu', 'miso', 'spoon', 'soy', 'pudding'],
      turn: 2,
      hands: {
        p1: ['tofu', 'eel'],
        p2: ['eel', 'miso'],
        p3: ['tofu', 'nigiri-squid', 'nigiri-egg'],
        p4: ['tofu', 'tofu'],
      },
      trays: { p1: [tray('spoon-4', 1, { id: 'sp' })] },
    });
    pickAll(h, { p1: { card: 'p1-0', bonus: 'sp' } });
    h.act('p1', { type: 'spoon', want: 'nigiri' });
    expect(game(h).step?.kind).toBe('give');
    expect(leak(h.state)).toBeUndefined();
  });

  it('leaks nothing to any viewer at any point of 1,000 seeded games', () => {
    let finished = 0;
    for (let seed = 1; seed <= 1000; seed++) {
      const rng = createRng(seed);
      // With the watcher seated when there's room: 2 to 8 players.
      const n = 2 + (seed % 7);
      const legal = PRESETS.filter((p) =>
        p.types.every((t) =>
          t === 'spoon' || t === 'edamame' ? n >= 3 : t === 'menu' || t === 'order' ? n <= 6 : true,
        ),
      );
      const settings = {
        menu: seed % 5 === 0 ? 'random' : legal[seed % legal.length]!.id,
        passBoth: seed % 3 === 0,
        golf: seed % 11 === 0,
        drawPile: seed % 2 === 0,
        seconds: seed % 3 === 0 ? 30 : null,
        timerMode: seed % 2 ? ('strict' as const) : ('soft' as const),
      };
      let now = 1_000_000;
      let state = conveyor.create(
        { now, rng, content },
        [...ids(n), 'w1'].map((id) => ({ id, name: id })),
      );
      const act = (by: string, action: ConveyorAction) => {
        const r = conveyor.reduce(state, action, { by, isHost: by === HOST, now, rng, content });
        if (!isGameError(r)) state = r;
      };
      act('w1', { type: 'sit', playing: false });
      act(HOST, { type: 'update-settings', ...settings });
      act(HOST, { type: 'start' });
      expect(state.phase, `seed ${seed}`).toBe('playing');
      const total = cardCount(state);
      for (let step = 0; step < 3000 && state.phase === 'playing'; step++) {
        now += 1000;
        const g = state.game!;
        const roll = rng.next();
        if (roll < 0.003) {
          state = conveyor.playerLeft(state, g.order[1 + rng.int(g.order.length - 1)]!, now);
        } else if (roll < 0.008 && Object.keys(g.left).length) {
          const id = Object.keys(g.left)[0]!;
          state = conveyor.playerJoined(state, { id, name: id });
        } else if (roll < 0.04 && conveyor.nextDeadline!(state) !== null) {
          now = Math.max(now, conveyor.nextDeadline!(state)!);
          state = conveyor.onDeadline!(state, now);
        } else {
          const move = randomMove(state, rng);
          act(move.by, move.action);
        }
        if (state.phase === 'playing' && cardCount(state) !== total)
          expect.fail(
            `seed ${seed}, step ${step}: ${cardCount(state)} cards, not ${total} ${JSON.stringify(state.log.slice(-3))} ${JSON.stringify(state.game!.step)}`,
          );
        if (step % 11 !== 0) continue;
        const leaked = leak(state);
        if (leaked !== undefined) expect.fail(`seed ${seed}, step ${step}: leak to ${leaked}`);
        const hands = state.game!.order.map((id) => state.game!.players[id]!.hand.length);
        if (state.game!.stage === 'pick' && new Set(hands).size !== 1)
          expect.fail(`seed ${seed}, step ${step}: hands ${hands.join(' ')}`);
      }
      expect(leak(state)).toBeUndefined();
      if (state.phase === 'over') finished++;
    }
    expect(finished).toBeGreaterThan(950);
  }, 900_000);
});
