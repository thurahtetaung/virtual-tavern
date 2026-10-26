import { type CardId, type CardMatch, DECK, deckCount, matches } from './cards.ts';
import type { Check } from './checks.ts';

// Task pairs that can't both be met: the rulebook redraws the later one when two revealed tasks
// can't be done by different players and nobody could end up holding both, and always when not
// even one player could do both. Only plain facts of the tasks count here, never the deal.

interface Footprint {
  winTricks: Set<number>;
  avoidTricks: Set<number>;
  winCards: Set<CardId>;
  /** Every card of these must be won. */
  winAll: CardMatch[];
  /** None of these may be won. */
  avoid: CardMatch[];
  /** Win more tricks than everyone else (or than everyone together). */
  most: boolean;
  min: number;
  max: number;
}

function footprint(c: Check, total: number): Footprint {
  const f: Footprint = {
    winTricks: new Set(),
    avoidTricks: new Set(),
    winCards: new Set(),
    winAll: [],
    avoid: [],
    most: false,
    min: 0,
    max: total,
  };
  const all = Array.from({ length: total }, (_, i) => i + 1);
  switch (c.kind) {
    case 'all':
      for (const part of c.checks) {
        const p = footprint(part, total);
        p.winTricks.forEach((t) => f.winTricks.add(t));
        p.avoidTricks.forEach((t) => f.avoidTricks.add(t));
        p.winCards.forEach((x) => f.winCards.add(x));
        f.winAll.push(...p.winAll);
        f.avoid.push(...p.avoid);
        f.most ||= p.most;
        f.min = Math.max(f.min, p.min);
        f.max = Math.min(f.max, p.max);
      }
      return f;
    case 'win-cards':
      c.cards.forEach((x) => f.winCards.add(x));
      if (c.last) f.winTricks.add(total);
      f.min = 1;
      return f;
    case 'win-count':
      if (c.op === 'exactly' && c.n === 0) f.avoid.push(c.match);
      else if (c.n >= deckCount(c.match)) f.winAll.push(c.match);
      if (c.n > 0) f.min = 1;
      return f;
    case 'tricks': {
      const wanted = c.win.map((r) => (r === 'last' ? total : r));
      wanted.forEach((t) => f.winTricks.add(t));
      if (c.only) all.filter((t) => !wanted.includes(t)).forEach((t) => f.avoidTricks.add(t));
      f.min = new Set(wanted).size;
      if (c.only) f.max = f.min;
      return f;
    }
    case 'avoid-first':
      for (let t = 1; t <= c.n; t++) f.avoidTricks.add(t);
      f.max = Math.max(0, total - c.n);
      return f;
    case 'trick-count':
      f.min = c.n;
      f.max = c.n;
      if (c.n === 0) all.forEach((t) => f.avoidTricks.add(t));
      return f;
    case 'run':
      f.min = c.n;
      if (c.exact) f.max = c.n;
      return f;
    case 'compare':
      if (c.op === 'more' && c.with !== 'captain') f.most = true;
      if (c.op === 'more') f.min = 1;
      return f;
    case 'win-with':
    case 'win-with-card':
    case 'trick-sum':
    case 'trick-all':
      f.min = 1;
      return f;
    case 'equal':
    case 'colour-set':
      f.min = 1;
      return f;
    default:
      return f;
  }
}

const overlap = (a: CardMatch, b: CardMatch) => DECK.some((x) => matches(a, x) && matches(b, x));
const meets = <T>(a: Set<T>, b: Set<T>) => [...a].some((x) => b.has(x));

/** Two different players can't both meet these. */
function clashApart(a: Footprint, b: Footprint): boolean {
  if (meets(a.winTricks, b.winTricks) || meets(a.winCards, b.winCards)) return true;
  if (a.most && b.most) return true;
  const cardsInAll = (all: CardMatch[], cards: Set<CardId>) =>
    all.some((m) => [...cards].some((x) => matches(m, x)));
  if (cardsInAll(a.winAll, b.winCards) || cardsInAll(b.winAll, a.winCards)) return true;
  return a.winAll.some((m) => b.winAll.some((n) => overlap(m, n)));
}

/** One player can't meet both. */
function clashTogether(a: Footprint, b: Footprint): boolean {
  if (meets(a.winTricks, b.avoidTricks) || meets(b.winTricks, a.avoidTricks)) return true;
  const hits = (cards: Set<CardId>, avoid: CardMatch[]) =>
    [...cards].some((x) => avoid.some((m) => matches(m, x)));
  if (hits(a.winCards, b.avoid) || hits(b.winCards, a.avoid)) return true;
  if (a.winAll.some((m) => b.avoid.some((n) => overlap(m, n)))) return true;
  if (b.winAll.some((m) => a.avoid.some((n) => overlap(m, n)))) return true;
  return Math.max(a.min, b.min) > Math.min(a.max, b.max);
}

export interface Clash {
  /** Different players can't both meet them. */
  apart: boolean;
  /** One player can't meet both. */
  together: boolean;
}

export function clash(a: Check, b: Check, total: number): Clash {
  const fa = footprint(a, total);
  const fb = footprint(b, total);
  return { apart: clashApart(fa, fb), together: clashTogether(fa, fb) };
}

/**
 * Whether a newly revealed task must go back: it can't be met alongside an earlier one by anyone
 * (`together` and `apart`), or only by one player holding both when nobody can hold two.
 */
export function mustRedraw(
  earlier: Check[],
  next: Check,
  total: number,
  canHoldTwo: boolean,
): boolean {
  return earlier.some((e) => {
    const c = clash(e, next, total);
    return (c.apart && c.together) || (c.apart && !canHoldTwo);
  });
}
