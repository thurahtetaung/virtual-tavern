import type { BotCtx } from '@vt/game-sdk';
import {
  type HandCard,
  type Strength,
  flipHand,
  insertAt,
  legalShows,
  segments,
  strengthOf,
  turned,
} from './rules.ts';
import type { EncoreAction, EncoreView } from './types.ts';

/** How much a hand's sets and runs are worth (the planning weight). */
const STRUCTURE = 0.25;
/** What a recruit costs: a point to the owner (or a chip with 2 players), and tempo. */
const RECRUIT_COST = 1.5;
/** Keeping the Recruit & Show marker for later is worth a little. */
const MARKER_VALUE = 1;

/**
 * A hand's worth: its sets and runs (longer ones worth more), less a point per card held.
 * Singles that join nothing are just cards to get rid of.
 */
export function handValue(hand: readonly HandCard[]): number {
  const structure = segments(hand).reduce((sum, s) => sum + (s.to - s.from + 1) ** 2, 0);
  return STRUCTURE * structure - hand.length;
}

interface Recruited {
  end: 'left' | 'right';
  flip: boolean;
  at: number;
  hand: HandCard[];
  rest: HandCard[];
  value: number;
}

/** Every way to recruit the table into the hand, best first. */
function recruits(hand: readonly HandCard[], table: readonly HandCard[]): Recruited[] {
  const out: Recruited[] = [];
  const ends: ('left' | 'right')[] = table.length > 1 ? ['left', 'right'] : ['left'];
  for (const end of ends) {
    const card = end === 'left' ? table[0]! : table.at(-1)!;
    const rest = end === 'left' ? table.slice(1) : table.slice(0, -1);
    for (const flip of [false, true]) {
      const c = flip ? turned(card) : card;
      for (let at = 0; at <= hand.length; at++) {
        const next = insertAt(hand, c, at);
        out.push({ end, flip, at, hand: next, rest: [...rest], value: handValue(next) });
      }
    }
  }
  return out.sort((a, b) => b.value - a.value);
}

/** The best Show in a hand against a table, with what it leaves. */
function bestShow(
  hand: readonly HandCard[],
  table: Strength | null,
  captured: number,
): { from: number; to: number; value: number } | null {
  let best: { from: number; to: number; value: number } | null = null;
  for (const [from, to] of legalShows(hand, table)) {
    const left = [...hand.slice(0, from), ...hand.slice(to + 1)];
    // Emptying the hand ends the round with nothing to lose: always worth it.
    const value = handValue(left) + captured + (left.length ? 0 : 6) + (to - from) * 0.2;
    if (!best || value > best.value) best = { from, to, value };
  }
  return best;
}

/**
 * A playtest bot, from its own view only: a one-ply planning search. It values every Show, every
 * Recruit (end, way up, gap) and the best Recruit & Show by the hand they leave (sets and runs, less
 * cards held), plus captured cards, less a cost for recruiting; at a round's start it keeps or
 * flips its hand by the same value. It never gets stuck: a legal move always exists.
 */
export function encoreBot(view: EncoreView, ctx: BotCtx): EncoreAction | null {
  const g = view.game;
  if (view.phase !== 'playing' || !g || !g.hand) return null;
  const me = g.players.find((p) => p.id === ctx.me);
  if (!me) return null;
  const hand = g.hand;
  if (g.stage === 'flip') {
    if (me.done) return null;
    return { type: 'flip', flip: handValue(flipHand(hand)) > handValue(hand) };
  }
  if (g.stage === 'scores') return me.done ? null : { type: 'ready' };
  if (g.stage !== 'play' || g.current !== ctx.me) return null;

  const table = g.table?.cards ?? [];
  const strength = table.length ? strengthOf(table) : null;
  const show = bestShow(hand, strength, table.length);
  if (!table.length) return show ? { type: 'show', from: show.from, to: show.to } : null;

  // 3+ players: if the next player owns the table, recruiting ends the round with this hand held.
  const order = g.order;
  const next = order[(order.indexOf(ctx.me) + 1) % order.length];
  const endsRound = !g.twoPlayer && next === g.table?.owner;
  const canRecruit = !g.twoPlayer || me.chips > 0;
  const options = canRecruit ? recruits(hand, table) : [];
  const recruit = options[0];
  const recruitValue = recruit
    ? endsRound
      ? -recruit.hand.length - RECRUIT_COST
      : recruit.value - (g.twoPlayer ? 1 : RECRUIT_COST)
    : -Infinity;

  let double: (Recruited & { from: number; to: number; total: number }) | null = null;
  if (!g.twoPlayer && me.marker) {
    for (const s of options.slice(0, 12)) {
      const after = bestShow(s.hand, s.rest.length ? strengthOf(s.rest) : null, s.rest.length);
      if (!after) continue;
      const total = after.value - RECRUIT_COST - MARKER_VALUE;
      if (!double || total > double.total) double = { ...s, from: after.from, to: after.to, total };
    }
  }

  const showValue = show?.value ?? -Infinity;
  if (double && double.total > showValue && double.total > recruitValue)
    return {
      type: 'recruit-show',
      end: double.end,
      flip: double.flip,
      at: double.at,
      from: double.from,
      to: double.to,
    };
  if (show && (showValue >= recruitValue || !recruit))
    return { type: 'show', from: show.from, to: show.to };
  if (recruit) return { type: 'recruit', end: recruit.end, flip: recruit.flip, at: recruit.at };
  return show ? { type: 'show', from: show.from, to: show.to } : null;
}
