import { cardOf } from './cards.ts';

/** A card as held or shown: which of its two numbers is up (the one that counts). */
export interface HandCard {
  id: string;
  up: number;
}

/** The number at the card's other end (out of play while held this way up). */
export const downOf = (c: HandCard) => {
  const d = cardOf(c.id);
  return d.a + d.b - c.up;
};

/** The card turned the other way up. */
export const turned = (c: HandCard): HandCard => ({ id: c.id, up: downOf(c) });

/** A single card, a set (all the same number) or a run (consecutive numbers, up or down). */
export type Kind = 'single' | 'set' | 'run';

export function kindOf(nums: readonly number[]): Kind | null {
  if (nums.length === 0) return null;
  if (nums.length === 1) return 'single';
  if (nums.every((n) => n === nums[0])) return 'set';
  const step = nums[1]! - nums[0]!;
  if (step !== 1 && step !== -1) return null;
  for (let i = 1; i < nums.length; i++) if (nums[i]! - nums[i - 1]! !== step) return null;
  return 'run';
}

export interface Strength {
  size: number;
  kind: Kind;
  /** The lowest number in the group. */
  low: number;
}

export function strengthOf(cards: readonly HandCard[]): Strength | null {
  const nums = cards.map((c) => c.up);
  const kind = kindOf(nums);
  return kind ? { size: nums.length, kind, low: Math.min(...nums) } : null;
}

/**
 * Whether a group beats the table: more cards wins; with as many cards, a set beats a run; with
 * the same count and type, the higher lowest number wins (equal never beats). An empty table
 * takes any group.
 */
export function beats(group: Strength, table: Strength | null): boolean {
  if (!table) return true;
  if (group.size !== table.size) return group.size > table.size;
  const rank = (k: Kind) => (k === 'run' ? 0 : 1);
  if (rank(group.kind) !== rank(table.kind)) return rank(group.kind) > rank(table.kind);
  return group.low > table.low;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Why a group beats the table, in a few words ("4 cards beat 3"). */
export function beatReason(group: Strength, table: Strength | null): string {
  if (!table) return 'the table is empty';
  if (group.size !== table.size)
    return `${plural(group.size, 'card')} beat${group.size === 1 ? 's' : ''} ${table.size}`;
  if (group.kind !== table.kind) return 'a set beats a run';
  return `lowest ${group.low} beats ${table.low}`;
}

/** Why a group can't be shown ("2 cards can't beat 3"), or null when it can. */
export function showProblem(cards: readonly HandCard[], table: Strength | null): string | null {
  const s = strengthOf(cards);
  if (!s) return 'Show one card, a set (all the same number) or a run (numbers in a row).';
  if (beats(s, table)) return null;
  if (!table) return null;
  if (s.size < table.size) return `${plural(s.size, 'card')} can’t beat ${table.size}.`;
  if (s.kind === 'run' && table.kind === 'set') return 'A run can’t beat a set of as many cards.';
  return s.low === table.low
    ? `Equal isn’t enough: the lowest number must be higher than ${table.low}.`
    : `The lowest number must be higher than ${table.low}.`;
}

/** Every Show in a hand (as index ranges, inclusive) that beats the table, longest first. */
export function legalShows(
  hand: readonly HandCard[],
  table: Strength | null,
): [from: number, to: number][] {
  const out: [number, number][] = [];
  for (let from = 0; from < hand.length; from++) {
    for (let to = from; to < hand.length; to++) {
      const s = strengthOf(hand.slice(from, to + 1));
      if (!s) break;
      if (beats(s, table)) out.push([from, to]);
    }
  }
  return out.sort((x, y) => y[1] - y[0] - (x[1] - x[0]) || x[0] - y[0]);
}

/** The whole hand turned upside down: the order reverses and every card shows its other end. */
export const flipHand = (hand: readonly HandCard[]): HandCard[] => [...hand].reverse().map(turned);

/** The hand with a card put in at a gap (0: before the first card; length: after the last). */
export function insertAt(hand: readonly HandCard[], card: HandCard, at: number): HandCard[] {
  return [...hand.slice(0, at), card, ...hand.slice(at)];
}

export interface Segment {
  from: number;
  to: number;
  kind: 'set' | 'run';
}

/** The sets and runs a hand already holds, read left to right (the longest from each card). */
export function segments(hand: readonly HandCard[]): Segment[] {
  const out: Segment[] = [];
  let i = 0;
  while (i < hand.length) {
    let j = i;
    while (j + 1 < hand.length && kindOf(hand.slice(i, j + 2).map((c) => c.up))) j++;
    if (j > i)
      out.push({
        from: i,
        to: j,
        kind: kindOf(hand.slice(i, j + 1).map((c) => c.up)) as 'set' | 'run',
      });
    i = j > i ? j + 1 : i + 1;
  }
  return out;
}

/** "2 sets, 1 run" for a hand, or "no sets or runs". */
export function shapeLine(hand: readonly HandCard[]): string {
  const segs = segments(hand);
  const sets = segs.filter((s) => s.kind === 'set').length;
  const runs = segs.filter((s) => s.kind === 'run').length;
  const longest = Math.max(1, ...segs.map((s) => s.to - s.from + 1));
  if (!sets && !runs) return 'no sets or runs';
  return [
    sets && plural(sets, 'set'),
    runs && plural(runs, 'run'),
    longest > 2 && `longest ${longest}`,
  ]
    .filter(Boolean)
    .join(', ');
}

/** "6-7-8" for a group. */
export const groupLine = (cards: readonly HandCard[]) => cards.map((c) => c.up).join('-');

/** "a run of 3" / "a set of 2" / "a single 7". */
export function kindLine(cards: readonly HandCard[]): string {
  const s = strengthOf(cards);
  if (!s) return 'a group';
  return s.kind === 'single' ? `a single ${s.low}` : `a ${s.kind} of ${s.size}`;
}
