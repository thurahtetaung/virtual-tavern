import type { PlayerId, Rng } from '@vt/game-sdk';
import type { TitleGroup } from './content.ts';
import {
  HIGH_MAX,
  HIGH_MIN,
  HOUSE_MAX,
  HOUSE_MIN,
  type Item,
  PAIR_TOTAL,
  type WishEntry,
} from './types.ts';

/** House drawings per group: one at 3–5 players, none at 6. */
export const housePerGroup = (players: number) => (players >= 6 ? 0 : 1);

/** Lots in a game: every player's two drawings plus the house's. */
export const lotCount = (players: number) => 2 * (players + housePerGroup(players));

/** The lot after which screws unlock (the second half starts at this index). */
export const halfAt = (lots: number) => Math.floor(lots / 2);

const ID_CHARS = 'abcdefghijkmnpqrstuvwxyz23456789';
const randomId = (rng: Rng) =>
  Array.from({ length: 8 }, () => ID_CHARS[rng.int(ID_CHARS.length)]).join('');

const steps = (min: number, max: number, rng: Rng) => min + rng.int((max - min) / 100 + 1) * 100;

export interface Deal {
  items: Record<string, Item>;
  lots: string[];
  prompts: Record<PlayerId, string[]>;
}

/**
 * Deals a game: one title from each group to every player (no two drawings share a title), the
 * house's extra drawing per group at 3–5 players, the values (each player's pair sums to $4,500,
 * one high and one low, random which; the house's $500–$4,500), and the lot order (the first group,
 * shuffled, then the second). `fixed` (the test rig) skips every shuffle.
 */
export function deal(
  order: readonly PlayerId[],
  groups: readonly [TitleGroup, TitleGroup],
  rng: Rng,
  fixed = false,
): Deal {
  const shuffle = <T>(xs: readonly T[]) => (fixed ? [...xs] : rng.shuffle(xs));
  const items: Record<string, Item> = {};
  const prompts: Record<PlayerId, string[]> = Object.fromEntries(order.map((id) => [id, []]));
  const lots: string[] = [];
  const highGroup = Object.fromEntries(order.map((id) => [id, fixed ? 0 : rng.int(2)]));
  const highValue = Object.fromEntries(
    order.map((id) => [id, fixed ? 3500 : steps(HIGH_MIN, HIGH_MAX, rng)]),
  );
  const houses = housePerGroup(order.length);
  for (const g of [0, 1] as const) {
    const group = groups[g];
    const picks = shuffle(group.titles.map((_, i) => i)).slice(0, order.length + houses);
    const inGroup: string[] = [];
    const make = (titleIdx: number, drawer: PlayerId | null, value: number) => {
      let id = randomId(rng);
      while (items[id]) id = randomId(rng);
      items[id] = {
        id,
        group: g,
        title: group.titles[titleIdx]!,
        value,
        drawer,
        artist: null,
        drawing: null,
        house: group.house[titleIdx]!,
        hidden: false,
        sale: null,
      };
      inGroup.push(id);
      return id;
    };
    order.forEach((p, k) => {
      const value = highGroup[p] === g ? highValue[p]! : PAIR_TOTAL - highValue[p]!;
      prompts[p]!.push(make(picks[k]!, p, value));
    });
    for (let h = 0; h < houses; h++)
      make(picks[order.length + h]!, null, fixed ? 2000 : steps(HOUSE_MIN, HOUSE_MAX, rng));
    lots.push(...shuffle(inGroup));
  }
  return { items, lots, prompts };
}

/**
 * Wish lists: every player is told the true value of three drawings, never their own and never
 * the house's, at most two from one group. In turn, everyone gets a high one nobody else has, then
 * a low one nobody has yet, then a low one exactly one other player has; a backtracking search
 * makes sure all three exist. Drawings nobody sent count as the house's, so with several missing a
 * list may come up short.
 */
export function wishLists(
  order: readonly PlayerId[],
  items: Record<string, Item>,
  rng: Rng,
  fixed = false,
): Record<PlayerId, WishEntry[]> {
  const shuffle = <T>(xs: readonly T[]) => (fixed ? [...xs] : rng.shuffle(xs));
  const players = shuffle(order);
  const art = Object.values(items).filter((i) => i.artist !== null && i.drawer !== null);
  const high = art.filter((i) => i.value >= HIGH_MIN);
  const low = art.filter((i) => i.value < HIGH_MIN);
  const lists = new Map<PlayerId, Item[]>(order.map((p) => [p, []]));
  const holders = new Map<string, number>();
  const slots: { player: PlayerId; round: 0 | 1 | 2 }[] = ([0, 1, 2] as const).flatMap((round) =>
    players.map((player) => ({ player, round })),
  );

  const candidates = (player: PlayerId, round: 0 | 1 | 2) => {
    const mine = lists.get(player)!;
    const pool = round === 0 ? high : low;
    return shuffle(pool).filter((i) => {
      if (i.drawer === player || mine.includes(i)) return false;
      if (mine.filter((m) => m.group === i.group).length >= 2) return false;
      const held = holders.get(i.id) ?? 0;
      return round === 2 ? held === 1 : held === 0;
    });
  };

  let budget = 50_000;
  // Strict first; if that is impossible (drawings missing), allow gaps.
  for (const gaps of [false, true]) {
    const solve = (k: number): boolean => {
      if (k === slots.length) return true;
      if (--budget < 0) return false;
      const { player, round } = slots[k]!;
      for (const item of candidates(player, round)) {
        lists.get(player)!.push(item);
        holders.set(item.id, (holders.get(item.id) ?? 0) + 1);
        if (solve(k + 1)) return true;
        lists.get(player)!.pop();
        holders.set(item.id, holders.get(item.id)! - 1);
      }
      return gaps && solve(k + 1);
    };
    for (const p of order) lists.set(p, []);
    holders.clear();
    budget = 50_000;
    if (solve(0)) break;
  }
  return Object.fromEntries(
    order.map((p) => [
      p,
      lists.get(p)!.map((i) => ({ item: i.id, title: i.title, value: i.value })),
    ]),
  );
}
