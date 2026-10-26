import {
  DUMPLING,
  FRUIT,
  type Fruit,
  ONIGIRI,
  TYPES,
  type TypeId,
  URAMAKI_PLACES,
  isDessert,
  makiPlaces,
  typeOf,
  variantOf,
} from './cards.ts';
import type { Part, Played, RoundRow } from './types.ts';

/** Cards that still count as what they show (not turned face down). */
export const live = (tray: readonly Played[]) => tray.filter((c) => !c.flipped);

export const countOf = (tray: readonly Played[], type: TypeId) =>
  live(tray).filter((c) => typeOf(c.k) === type).length;

/** Roll icons of a type (maki or uramaki) among the live cards. */
export const iconsOf = (tray: readonly Played[], type: 'maki' | 'uramaki') =>
  live(tray)
    .filter((c) => typeOf(c.k) === type)
    .reduce((sum, c) => sum + (variantOf(c.k).icons ?? 0), 0);

/** A card's colour for tea and soy sauce: face-down cards are a colour of their own. */
export const colourOf = (c: Played) => (c.flipped ? 'flipped' : TYPES[typeOf(c.k)].colour);

export function colourCounts(tray: readonly Played[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of tray) out.set(colourOf(c), (out.get(colourOf(c)) ?? 0) + 1);
  return out;
}

/** Onigiri: sets of different shapes, biggest first (each set n shapes scores n²). */
export function onigiriScore(tray: readonly Played[]): { points: number; sets: number } {
  const counts = new Map<string, number>();
  for (const c of live(tray))
    if (typeOf(c.k) === 'onigiri') counts.set(c.k, (counts.get(c.k) ?? 0) + 1);
  let points = 0;
  let sets = 0;
  for (;;) {
    const shapes = [...counts.entries()].filter(([, n]) => n > 0);
    if (!shapes.length) break;
    points += ONIGIRI[shapes.length]!;
    sets += 1;
    for (const [k] of shapes) counts.set(k, counts.get(k)! - 1);
  }
  return { points, sets };
}

/** A nigiri's points: ×3 on a wasabi that is still face up. */
export function nigiriPoints(tray: readonly Played[], c: Played): number {
  const base = variantOf(c.k).points ?? 0;
  const wasabi = c.on ? tray.find((w) => w.id === c.on) : undefined;
  return wasabi && !wasabi.flipped ? base * 3 : base;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "Most" (+best) and "fewest" (−worst) among everyone; all equal scores nobody. */
function mostFewest(
  counts: Record<string, number>,
  best: number,
  worst: number | null,
): Record<string, { points: number; note: string }> {
  const values = Object.values(counts);
  const hi = Math.max(...values);
  const lo = Math.min(...values);
  const out: Record<string, { points: number; note: string }> = {};
  if (hi === lo) return out;
  for (const [id, n] of Object.entries(counts)) {
    if (n === hi) out[id] = { points: best, note: 'most' };
    else if (n === lo && worst !== null) out[id] = { points: worst, note: 'fewest' };
  }
  return out;
}

/** Everyone tied for a majority: said so instead of scoring. */
const allEqual = (counts: Record<string, number>) =>
  new Set(Object.values(counts)).size === 1 && Object.keys(counts).length > 1;

export interface ScoreInput {
  order: readonly string[];
  trays: Record<string, readonly Played[]>;
  /** Uramaki points already scored this round (the race to 10). */
  ura: Record<string, number>;
  /** Uramaki places taken this round. */
  claimed: number;
}

/**
 * Every player's score for the round, part by part. Desserts wait for the game's end (they score
 * nothing here); face-down cards score 2 each.
 */
export function roundRows(input: ScoreInput): RoundRow[] {
  const { order, trays } = input;
  const n = order.length;
  const parts: Record<string, Part[]> = Object.fromEntries(order.map((id) => [id, []]));
  const add = (id: string, key: Part['key'], points: number, note?: string) =>
    parts[id]!.push({ key, points, ...(note && { note }) });

  // Majorities first: maki, temaki, uramaki's end-of-round place, edamame, soy sauce.
  const maki = Object.fromEntries(order.map((id) => [id, iconsOf(trays[id]!, 'maki')]));
  const places = makiPlaces(n);
  const distinct = [...new Set(Object.values(maki).filter((x) => x > 0))].sort((a, b) => b - a);
  for (const id of order) {
    if (!countOf(trays[id]!, 'maki')) continue;
    const place = distinct.indexOf(maki[id]!);
    const points = places[place] ?? 0;
    add(
      id,
      'maki',
      points,
      `${plural(maki[id]!, 'icon')}${points ? `, ${['most', 'second', 'third'][place]}` : ''}`,
    );
  }

  const anyTemaki = order.some((id) => countOf(trays[id]!, 'temaki') > 0);
  if (anyTemaki) {
    const temaki = Object.fromEntries(order.map((id) => [id, countOf(trays[id]!, 'temaki')]));
    const result = mostFewest(temaki, 4, n === 2 ? null : -4);
    const tied = allEqual(temaki);
    for (const id of order) {
      const r = result[id];
      if (r) add(id, 'temaki', r.points, `${plural(temaki[id]!, 'card')}, ${r.note}`);
      else if (temaki[id]! > 0 || tied)
        add(id, 'temaki', 0, tied ? 'everyone tied' : plural(temaki[id]!, 'card'));
    }
  }

  const uraLeft = Object.fromEntries(order.map((id) => [id, iconsOf(trays[id]!, 'uramaki')]));
  const uraBest = Math.max(0, ...Object.values(uraLeft));
  const uraPlace = URAMAKI_PLACES[input.claimed];
  for (const id of order) {
    const mid = input.ura[id] ?? 0;
    const end =
      uraPlace !== undefined &&
      uraBest > 0 &&
      uraLeft[id] === uraBest &&
      countOf(trays[id]!, 'uramaki')
        ? uraPlace
        : 0;
    if (mid || end || countOf(trays[id]!, 'uramaki'))
      add(
        id,
        'uramaki',
        mid + end,
        end ? `most left (${plural(uraLeft[id]!, 'icon')})` : mid ? 'reached 10' : undefined,
      );
  }

  const withEdamame = order.filter((id) => countOf(trays[id]!, 'edamame') > 0);
  const colours = Object.fromEntries(order.map((id) => [id, colourCounts(trays[id]!).size]));
  const mostColours = Math.max(...Object.values(colours));

  for (const id of order) {
    const tray = trays[id]!;
    const count = (t: TypeId) => countOf(tray, t);

    const nigiri = live(tray).filter((c) => typeOf(c.k) === 'nigiri');
    if (nigiri.length) {
      const tripled = nigiri.filter((c) => nigiriPoints(tray, c) > (variantOf(c.k).points ?? 0));
      add(
        id,
        'nigiri',
        nigiri.reduce((sum, c) => sum + nigiriPoints(tray, c), 0),
        tripled.length ? `${tripled.length} on wasabi` : undefined,
      );
    }
    const simple: [TypeId, (k: number) => number, (k: number) => string | undefined][] = [
      ['tempura', (k) => Math.floor(k / 2) * 5, (k) => plural(Math.floor(k / 2), 'pair')],
      ['sashimi', (k) => Math.floor(k / 3) * 10, (k) => plural(Math.floor(k / 3), 'set')],
      ['dumpling', (k) => DUMPLING[Math.min(5, k)]!, (k) => plural(k, 'card')],
      ['eel', (k) => (k === 1 ? -3 : 7), (k) => plural(k, 'card')],
      ['tofu', (k) => (k === 1 ? 2 : k === 2 ? 6 : 0), (k) => plural(k, 'card')],
      ['miso', (k) => 3 * k, (k) => plural(k, 'bowl')],
    ];
    for (const [type, score, note] of simple) {
      const k = count(type);
      if (k) add(id, type, score(k), note(k));
    }
    if (count('onigiri')) {
      const o = onigiriScore(tray);
      add(id, 'onigiri', o.points, plural(o.sets, 'set'));
    }
    if (count('edamame')) {
      const others = Math.min(4, withEdamame.filter((o) => o !== id).length);
      add(id, 'edamame', count('edamame') * others, `${others} with edamame`);
    }
    if (count('soy')) {
      const best = colours[id] === mostColours;
      add(id, 'soy', best ? 4 * count('soy') : 0, `${plural(colours[id]!, 'colour')}`);
    }
    if (count('tea')) {
      const biggest = Math.max(0, ...colourCounts(tray).values());
      add(id, 'tea', biggest * count('tea'), `biggest colour ${biggest}`);
    }
    const flipped = tray.filter((c) => c.flipped).length;
    if (flipped) add(id, 'flipped', flipped * 2, plural(flipped, 'card'));
  }
  return order.map((id) => ({
    id,
    parts: parts[id]!,
    points: parts[id]!.reduce((sum, p) => sum + p.points, 0),
  }));
}

/** The desserts each player kept from this round (face up only). */
export const keptDesserts = (tray: readonly Played[]) => live(tray).filter((c) => isDessert(c.k));

/**
 * The desserts at the game's end. Pudding and fruit score everyone (none at all can cost points);
 * ice cream only its sets.
 */
export function dessertRows(
  order: readonly string[],
  kept: Record<string, readonly Played[]>,
  dessert: TypeId,
): RoundRow[] {
  const n = order.length;
  const parts: Record<string, Part[]> = Object.fromEntries(order.map((id) => [id, []]));
  const count = (id: string, t: TypeId) => kept[id]!.filter((c) => typeOf(c.k) === t).length;
  if (dessert === 'pudding') {
    const pud = Object.fromEntries(order.map((id) => [id, count(id, 'pudding')]));
    const r = mostFewest(pud, 6, n === 2 ? null : -6);
    const tied = allEqual(pud);
    for (const id of order) {
      const x = r[id];
      parts[id]!.push(
        x
          ? { key: 'pudding', points: x.points, note: `${plural(pud[id]!, 'card')}, ${x.note}` }
          : { key: 'pudding', points: 0, note: tied ? 'everyone tied' : plural(pud[id]!, 'card') },
      );
    }
  }
  for (const id of order) {
    if (dessert === 'fruit') parts[id]!.push(fruitPart(kept[id]!));
    const ice = count(id, 'icecream');
    if (dessert === 'icecream')
      parts[id]!.push({
        key: 'icecream',
        points: Math.floor(ice / 4) * 12,
        note: `${plural(ice, 'card')}, ${plural(Math.floor(ice / 4), 'set')}`,
      });
  }
  return order.map((id) => ({
    id,
    parts: parts[id]!,
    points: parts[id]!.reduce((sum, p) => sum + p.points, 0),
  }));
}

/** Fruit at the game's end, for every player when the menu has fruit (none at all costs 6). */
export function fruitPart(kept: readonly Played[]): Part {
  const icons: Record<Fruit, number> = { w: 0, p: 0, o: 0 };
  for (const c of kept) {
    if (typeOf(c.k) !== 'fruit') continue;
    for (const [f, x] of Object.entries(variantOf(c.k).fruit ?? {})) icons[f as Fruit] += x;
  }
  const points = (['w', 'p', 'o'] as const).reduce(
    (sum, f) => sum + FRUIT[Math.min(5, icons[f])]!,
    0,
  );
  return { key: 'fruit', points, note: `${icons.w}/${icons.p}/${icons.o}` };
}

const PERSONAL = new Set<Part['key']>([
  'nigiri',
  'tempura',
  'sashimi',
  'dumpling',
  'eel',
  'tofu',
  'onigiri',
]);

/** What a tray's own sets are worth (nothing that depends on the others' cards). */
export function personalPoints(tray: readonly Played[]): number {
  const [row] = roundRows({
    order: ['me'],
    trays: { me: tray },
    ura: {},
    claimed: URAMAKI_PLACES.length,
  });
  return row!.parts.filter((p) => PERSONAL.has(p.key)).reduce((sum, p) => sum + p.points, 0);
}
