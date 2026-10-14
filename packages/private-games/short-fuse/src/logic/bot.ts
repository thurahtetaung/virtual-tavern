import { type BotCtx, type BotInfo, chance, pickOne } from '@vt/game-sdk';
import { type CardType, isCat } from './cards.ts';
import type { CardView, GameView, ShortFuseAction, ShortFuseView } from './types.ts';

/** A stable 0–1 roll per decision, so asking the bot twice gives the same answer. */
function roll(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const c of parts.join('|')) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return (h % 10_000) / 10_000;
}

const ESCAPES: CardType[] = [
  'superskip',
  'skip',
  'attack',
  'aim',
  'reverse',
  'bottom',
  'swap',
  'shuffle',
];

/** What the bot knows is on top: a Bomb it saw this turn, or a face-up Black Hole showing there. */
function dangerOnTop(g: GameView): boolean {
  if (g.pile.voidTop || g.pile.knownTop > 0) return true;
  const seen = g.memory.findLast((m) => m.kind === 'peek' || m.kind === 'altered');
  if (!seen || (seen.kind !== 'peek' && seen.kind !== 'altered')) return false;
  if (seen.turn !== g.turn.n || seen.version !== g.pile.version) return false;
  return seen.cards[0]?.t === 'bomb' || seen.cards[0]?.t === 'void';
}

/** The other player with the most cards (a good mark for a Favor or a steal). */
function richest(g: GameView, me: string): string | undefined {
  return g.players
    .filter((p) => p.id !== me && !p.dead && !p.left && p.hand > 0)
    .sort((a, b) => b.hand - a.hand)[0]?.id;
}

function pairIn(hand: CardView[]): CardView[] | null {
  const by = new Map<CardType, CardView[]>();
  for (const c of hand) by.set(c.t, [...(by.get(c.t) ?? []), c]);
  for (const [t, cards] of by) if (isCat(t) && cards.length >= 2) return cards.slice(0, 2);
  return null;
}

function turnMove(g: GameView, me: string): ShortFuseAction {
  const hand = g.hand ?? [];
  const has = (t: CardType) => hand.find((c) => c.t === t);
  if (dangerOnTop(g)) {
    for (const t of ESCAPES) {
      const c = has(t);
      if (!c) continue;
      if (t === 'aim') {
        const target = richest(g, me);
        if (target) return { type: 'play', cards: [c.id], target };
        continue;
      }
      return { type: 'play', cards: [c.id] };
    }
  }
  if (g.turn.plays < 2 && roll(me, g.turn.n, g.turn.plays, 'play') < 0.3) {
    const target = richest(g, me);
    const peek = has('peek3') ?? has('alter3') ?? has('peek5') ?? has('alter5');
    if (peek) return { type: 'play', cards: [peek.id] };
    const pair = pairIn(hand);
    if (pair && target) return { type: 'play', cards: pair.map((c) => c.id), target };
    const favor = has('favor');
    if (favor && target) return { type: 'play', cards: [favor.id], target };
  }
  return { type: 'draw' };
}

/**
 * A playtest bot, from its own seat's view only. On its turn it sometimes (30%) plays one useful
 * card (a peek, a pair of cats or a Favor on the player with most cards), and dodges a Bomb it
 * knows is on top; then it draws. It Nopes a play aimed at it now and then, defuses every Bomb,
 * hides it at random, gives away a cat when asked and keeps a rearranged pile's order apart from
 * moving danger to the back. It never plays cards off its turn beyond a Nope.
 */
export function shortFuseBot(view: ShortFuseView, ctx: BotCtx): ShortFuseAction | null {
  const { me, rng } = ctx;
  if (view.phase === 'lobby')
    return view.me && !view.me.playing ? { type: 'sit', playing: true } : null;
  const g = view.game;
  if (view.phase !== 'playing' || !g) return null;
  if (g.canNope && g.window && g.pending) {
    const atMe = g.pending.target === me || (g.pending.t === 'attack' && g.turn.player !== me);
    const once = !g.window.chain.includes(me);
    if (atMe && once && roll(me, g.window.id, g.window.chain.length, 'nope') < 0.4)
      return { type: 'nope', window: g.window.id };
    return null;
  }
  const p = g.prompt;
  if (!p) return null;
  // What a bot would rather part with: a cat, then anything but a Defuse, a Bomb or its Shelter.
  const spare = (): CardView | undefined => {
    const hand = g.hand ?? [];
    const keep = (c: CardView) => ['defuse', 'bomb', 'void', 'shelter'].includes(c.t);
    return (
      hand.find((c) => isCat(c.t) || c.t === 'wild') ??
      pickOne(
        rng,
        hand.filter((c) => !keep(c)),
      ) ??
      hand[0]
    );
  };
  const slot = (n: number) => ({ slot: rng.int(Math.max(1, n)) });
  switch (p.kind) {
    case 'turn':
      // Blindfolded, a safe draw is the way out.
      return p.blind ? { type: 'draw' } : turnMove(g, me);
    case 'each': {
      if (p.done) return null;
      if (p.blind) return { type: 'choose', ...slot(g.blindCount ?? 1) };
      const card = spare();
      return card ? { type: 'choose', card: card.id } : null;
    }
    case 'target':
      return { type: 'target', player: pickOne(rng, p.options)! };
    case 'search':
      return { type: 'search', slot: 0 };
    case 'give': {
      if (p.blind) return { type: 'give', ...slot(g.blindCount ?? 1) };
      const card = spare();
      return card ? { type: 'give', card: card.id } : null;
    }
    case 'alter': {
      const order = p.cards.map((_, i) => i);
      const bad = (i: number) => p.cards[i]!.t === 'bomb' || p.cards[i]!.t === 'void';
      return { type: 'order', order: [...order.filter((i) => !bad(i)), ...order.filter(bad)] };
    }
    case 'salvage': {
      const card = p.options.find((c) => c.t === 'defuse') ?? pickOne(rng, p.options);
      return card ? { type: 'salvage', card: card.id } : null;
    }
    case 'bomb':
      return p.canDefuse ? { type: 'defuse' } : null;
    case 'place':
      return {
        type: 'place',
        position: chance(rng, 0.3) ? 0 : rng.int(p.count + 1),
      };
  }
}

export const shortFuseBotInfo: BotInfo = {};
