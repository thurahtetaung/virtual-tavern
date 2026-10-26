import type { BotCtx } from '@vt/game-sdk';
import { TYPES, URAMAKI_GOAL, URAMAKI_PLACES, typeOf, variantOf } from './cards.ts';
import { countOf, iconsOf, roundRows } from './score.ts';
import type { Card, ConveyorAction, ConveyorView, GameView, Played } from './types.ts';

/** Turns still to come after this one. */
const turnsLeft = (g: GameView) => g.turns - g.turn;

const traysOf = (g: GameView) => Object.fromEntries(g.players.map((p) => [p.id, p.tray]));

/** Points a tray makes now, among everyone's trays as they are. */
function scoreNow(g: GameView, me: string, trays: Record<string, readonly Played[]>): number {
  const rows = roundRows({
    order: g.order,
    trays,
    ura: Object.fromEntries(g.players.map((p) => [p.id, p.ura])),
    claimed: g.claimed,
  });
  return rows.find((r) => r.id === me)?.points ?? 0;
}

/** Scores of trays as they are, per view (a view's trays are fresh objects every call). */
const baseScores = new WeakMap<readonly Played[], Map<string, number>>();

function baseScore(
  g: GameView,
  me: string,
  trays: Record<string, readonly Played[]>,
  mine: readonly Played[],
) {
  let byMe = baseScores.get(mine);
  if (!byMe) baseScores.set(mine, (byMe = new Map<string, number>()));
  let v = byMe.get(me);
  if (v === undefined) byMe.set(me, (v = scoreNow(g, me, { ...trays, [me]: mine })));
  return v;
}

/**
 * What one more card in front of `me` is worth: the points it adds now (majorities included),
 * plus a rough value for what it sets up in the turns left.
 */
export function cardValue(g: GameView, me: string, k: string, tray?: readonly Played[]): number {
  const trays = traysOf(g);
  const mine = tray ?? trays[me] ?? [];
  const left = turnsLeft(g);
  const type = typeOf(k);
  const card: Played = { id: '+', k, turn: g.turn };
  // A nigiri goes on a waiting wasabi.
  const wasabi = mine.find((c) => typeOf(c.k) === 'wasabi' && !c.flipped && !c.filled);
  if (type === 'nigiri' && wasabi) card.on = wasabi.id;
  const withCard = mine.map((c) => (c === wasabi && card.on ? { ...c, filled: true } : c));
  const now =
    scoreNow(g, me, { ...trays, [me]: [...withCard, card] }) - baseScore(g, me, trays, mine);
  const have = countOf(mine, type);
  const soon = left >= 2 ? 1 : 0;
  switch (type) {
    case 'tempura':
      return now + (have % 2 === 0 ? 2 * soon : 0);
    case 'sashimi':
      return now + (have % 3 === 0 ? 1.5 * soon : have % 3 === 1 ? 3 * soon : 0);
    case 'eel':
      return now + (have === 0 ? 5 * soon : 0);
    case 'wasabi':
      return left >= 2 ? 3.5 : 0;
    case 'chopsticks':
    case 'spoon':
      return left >= 3 ? 2.5 : 0;
    case 'menu':
      return 3;
    case 'takeout':
      return Math.min(4, mine.filter((c) => !c.flipped && worthLittle(c)).length * 1.5);
    case 'order':
      return Math.max(0, ...mine.map((c) => (worthLittle(c) ? 0 : cardValue(g, me, c.k, mine))));
    case 'uramaki': {
      const icons = iconsOf(mine, 'uramaki') + (variantOf(k).icons ?? 0);
      const place = URAMAKI_PLACES[g.claimed];
      if (place !== undefined && icons >= URAMAKI_GOAL) return place;
      return now * 0.5 + (variantOf(k).icons ?? 0) * 0.6;
    }
    case 'maki':
      return now * 0.6 + (variantOf(k).icons ?? 0) * 0.8;
    case 'temaki':
      return now * 0.6 + 1.5;
    case 'pudding':
      return 2.5;
    case 'icecream': {
      const kept = g.players.find((p) => p.id === me)?.desserts ?? [];
      const n = countOf([...kept, ...mine], 'icecream');
      return n % 4 === 3 ? 6 : 2.5;
    }
    case 'fruit':
      return 2.5;
    default:
      return now;
  }
}

/** Cards that score little where they are: worth more face down (2) from a takeout box. */
function worthLittle(c: Played): boolean {
  const t = typeOf(c.k);
  return t === 'wasabi' ? !c.filled : t === 'chopsticks' || t === 'spoon' || t === 'eel';
}

/** The best card in front of `me` for a special order to copy. */
function bestTarget(
  g: GameView,
  me: string,
  tray: readonly Played[],
  self?: string,
): string | undefined {
  let best: { id: string; value: number } | undefined;
  for (const c of tray) {
    if (c.id === self || typeOf(c.k) === 'menu' || typeOf(c.k) === 'takeout') continue;
    const value = c.flipped ? 2 : cardValue(g, me, c.k, tray);
    if (!best || value > best.value) best = { id: c.id, value };
  }
  return best?.id;
}

function ranked(g: GameView, me: string, cards: readonly Card[], ctx: BotCtx) {
  return cards
    .map((c) => ({ card: c, value: cardValue(g, me, c.k) + ctx.rng.next() * 0.6 }))
    .sort((a, b) => b.value - a.value);
}

/**
 * A playtest bot, from its own view only: a greedy picker. It values each card in hand by the
 * points it adds now among everyone's trays, plus a rough worth for sets it starts; calls its
 * chopsticks when the second-best card is worth having, and its spoon for the best dish on the
 * menu; copies, orders, gives and turns face down the same greedy way.
 */
export function conveyorBot(view: ConveyorView, ctx: BotCtx): ConveyorAction | null {
  const g = view.game;
  if (view.phase !== 'playing' || !g || !g.hand) return null;
  const me = g.players.find((p) => p.id === ctx.me);
  if (!me) return null;
  const tray = me.tray;
  if (g.stage === 'scores') return me.done ? null : { type: 'ready' };

  if (g.stage === 'pick') {
    if (g.myPick || !g.hand.length) return null;
    const order = ranked(g, ctx.me, g.hand, ctx);
    const best = order[0]!.card;
    const target = best.k === 'order' ? bestTarget(g, ctx.me, tray) : undefined;
    const sticks = tray.find((c) => !c.flipped && typeOf(c.k) === 'chopsticks');
    const spoon = tray.find((c) => !c.flipped && typeOf(c.k) === 'spoon');
    let bonus: string | undefined;
    if (sticks && g.hand.length >= 2 && (order[1]?.value ?? 0) >= 3) bonus = sticks.id;
    else if (spoon && g.hand.length >= 3 && turnsLeft(g) >= 2) bonus = spoon.id;
    return {
      type: 'pick',
      card: best.id,
      ...(target && { target }),
      ...(bonus && { bonus }),
    };
  }

  const step = g.step;
  if (!step) return null;
  switch (step.kind) {
    case 'chop': {
      if (!step.players.includes(ctx.me) || step.done.includes(ctx.me) || !g.hand.length)
        return null;
      const card = ranked(g, ctx.me, g.hand, ctx)[0]!.card;
      const target = card.k === 'order' ? bestTarget(g, ctx.me, tray) : undefined;
      return { type: 'chop', card: card.id, ...(target && { target }) };
    }
    case 'spoon': {
      if (step.by !== ctx.me) return null;
      const types = ['nigiri' as const, ...g.menu];
      const best = types
        .map((t) => ({
          t,
          value:
            Math.max(...TYPES[t].variants.map((x) => cardValue(g, ctx.me, x.id))) +
            ctx.rng.next() * 0.6,
        }))
        .sort((a, b) => b.value - a.value)[0]!;
      return { type: 'spoon', want: best.t };
    }
    case 'give': {
      if (step.from !== ctx.me || !step.options?.length) return null;
      // The least useful card for whoever asked.
      const worst = [...step.options].sort(
        (a, b) => cardValue(g, step.by, a.k) - cardValue(g, step.by, b.k),
      )[0]!;
      return { type: 'give', card: worst.id };
    }
    case 'menu': {
      if (step.by !== ctx.me || !step.drawn) return null;
      const options = step.drawn.filter((c) => typeOf(c.k) !== 'menu');
      const card = ranked(g, ctx.me, options, ctx)[0]?.card;
      if (!card) return null;
      const target = card.k === 'order' ? bestTarget(g, ctx.me, tray) : undefined;
      return { type: 'menu', card: card.id, ...(target && { target }) };
    }
    case 'copy': {
      if (step.by !== ctx.me) return null;
      const order = tray.find((c) => c.k === 'order');
      const target = bestTarget(g, ctx.me, tray, order?.id);
      return target ? { type: 'copy', target } : null;
    }
    case 'takeout': {
      if (step.by !== ctx.me) return null;
      const late = turnsLeft(g) <= 1;
      const flip = tray.filter(
        (c) =>
          c.turn < g.turn &&
          !c.flipped &&
          worthLittle(c) &&
          (late || !['chopsticks', 'spoon'].includes(typeOf(c.k))) &&
          !(typeOf(c.k) === 'eel' && countOf(tray, 'eel') !== 1),
      );
      return { type: 'takeout', cards: flip.map((c) => c.id) };
    }
  }
}
