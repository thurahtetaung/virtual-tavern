import { z } from 'zod';
import {
  COLOURS,
  type CardId,
  type CardMatch,
  type Colour,
  DECK,
  SUITS,
  type Suit,
  TRUMP,
  isCard,
  isTrump,
  matches,
  suitOf,
  valueOf,
} from './cards.ts';

// The task checkers. A task card's condition is data (a kind and its numbers, from the private
// content packs); this file knows only the kinds. Each check says, from the tricks so far and the
// true deal, whether its condition is met for good (`done`), can no longer be met (`failed`), or
// is still open.

const cardId = z.string().refine(isCard, 'not a card');
const value = z.number().int().min(1).max(9);
const suit = z.enum(SUITS);
const colour = z.enum(COLOURS);

export const cardMatchSchema = z
  .object({
    suits: z.array(suit).min(1).max(5).optional(),
    values: z.array(value).min(1).max(9).optional(),
    cards: z.array(cardId).min(1).max(40).optional(),
  })
  .refine((m) => m.suits || m.values || m.cards, 'match some cards');

/** A number per table size (difficulty columns: 3, 4 and 5 players; 2 players use 3). */
const bySize = z.object({ 3: z.number().int(), 4: z.number().int(), 5: z.number().int() });

/** 1-based trick numbers, or the last trick. */
const trickRef = z.union([z.number().int().min(1).max(14), z.literal('last')]);

export type Check =
  | { kind: 'win-cards'; cards: CardId[]; last?: boolean }
  | { kind: 'win-count'; match: CardMatch; op: 'exactly' | 'atLeast'; n: number }
  | { kind: 'win-with'; match: CardMatch }
  | { kind: 'win-with-card'; target: CardMatch; using: CardMatch }
  | { kind: 'tricks'; win: (number | 'last')[]; only?: boolean }
  | { kind: 'avoid-first'; n: number }
  | { kind: 'trick-count'; n: number }
  | { kind: 'run'; n: number; exact?: boolean }
  | { kind: 'no-run' }
  | { kind: 'compare'; with: 'each' | 'together' | 'captain'; op: 'more' | 'fewer' | 'same' }
  | {
      kind: 'trick-sum';
      above?: Record<3 | 4 | 5, number>;
      below?: Record<3 | 4 | 5, number>;
      oneOf?: number[];
    }
  | { kind: 'trick-all'; above?: number; below?: number; parity?: 'odd' | 'even' }
  | { kind: 'equal'; a: Colour; b: Colour; inTrick?: boolean }
  | { kind: 'more'; more: Suit; than: Suit }
  | { kind: 'colour-set'; mode: 'full' | 'each' }
  | { kind: 'no-lead'; suits: Suit[] }
  | { kind: 'predict'; secret: boolean }
  | { kind: 'all'; checks: Check[] }
  // Crew conditions (missions without task cards): they belong to nobody.
  | { kind: 'balance'; value: number; gap: number }
  | { kind: 'leader' }
  | { kind: 'last-card'; card: CardId };

export const checkSchema: z.ZodType<Check> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('win-cards'),
      cards: z.array(cardId).min(1).max(9),
      last: z.boolean().optional(),
    }),
    z.object({
      kind: z.literal('win-count'),
      match: cardMatchSchema,
      op: z.enum(['exactly', 'atLeast']),
      n: z.number().int().min(0).max(40),
    }),
    z.object({ kind: z.literal('win-with'), match: cardMatchSchema }),
    z.object({ kind: z.literal('win-with-card'), target: cardMatchSchema, using: cardMatchSchema }),
    z.object({
      kind: z.literal('tricks'),
      win: z.array(trickRef).min(1).max(14),
      only: z.boolean().optional(),
    }),
    z.object({ kind: z.literal('avoid-first'), n: z.number().int().min(1).max(14) }),
    z.object({ kind: z.literal('trick-count'), n: z.number().int().min(0).max(14) }),
    z.object({
      kind: z.literal('run'),
      n: z.number().int().min(2).max(14),
      exact: z.boolean().optional(),
    }),
    z.object({ kind: z.literal('no-run') }),
    z.object({
      kind: z.literal('compare'),
      with: z.enum(['each', 'together', 'captain']),
      op: z.enum(['more', 'fewer', 'same']),
    }),
    z.object({
      kind: z.literal('trick-sum'),
      above: bySize.optional(),
      below: bySize.optional(),
      oneOf: z.array(z.number().int().min(1).max(60)).min(1).max(10).optional(),
    }),
    z.object({
      kind: z.literal('trick-all'),
      above: value.optional(),
      below: value.optional(),
      parity: z.enum(['odd', 'even']).optional(),
    }),
    z.object({ kind: z.literal('equal'), a: colour, b: colour, inTrick: z.boolean().optional() }),
    z.object({ kind: z.literal('more'), more: suit, than: suit }),
    z.object({ kind: z.literal('colour-set'), mode: z.enum(['full', 'each']) }),
    z.object({ kind: z.literal('no-lead'), suits: z.array(suit).min(1).max(5) }),
    z.object({ kind: z.literal('predict'), secret: z.boolean() }),
    z.object({ kind: z.literal('all'), checks: z.array(checkSchema).min(2).max(4) }),
    z.object({ kind: z.literal('balance'), value, gap: z.number().int().min(1).max(9) }),
    z.object({ kind: z.literal('leader') }),
    z.object({ kind: z.literal('last-card'), card: cardId }),
  ]),
);

/** Kinds the captain may never hold (comparisons with the captain). */
export const captainCannot = (c: Check): boolean =>
  (c.kind === 'compare' && c.with === 'captain') ||
  (c.kind === 'all' && c.checks.some(captainCannot));

/** A prediction task (the owner names a number of tricks before the first trick). */
export const predictionOf = (c: Check): { secret: boolean } | null =>
  c.kind === 'predict'
    ? { secret: c.secret }
    : c.kind === 'all'
      ? (c.checks.map(predictionOf).find((p) => p) ?? null)
      : null;

// ---- Evaluation ----

export interface Play {
  by: string;
  card: CardId;
}

export interface Trick {
  plays: Play[];
  winner: string;
}

/** What a check sees: the tricks so far and where every unplayed card is. */
export interface Table {
  tricks: Trick[];
  /** The trick being played (its cards are still to be won). */
  current: Play[];
  /** How many tricks the attempt has. */
  total: number;
  /** Everyone at the table, the dummy included, in seat order. */
  crew: string[];
  captain: string;
  /** Unplayed cards by seat. */
  hands: Record<string, CardId[]>;
  /** The difficulty column: 3, 4 or 5 (two players use 3). */
  size: 3 | 4 | 5;
  /** Every trick has been played. */
  final: boolean;
}

export type Status =
  | { state: 'done'; progress?: string }
  | { state: 'open'; progress?: string }
  | { state: 'failed'; why: string; progress?: string };

/** Text placeholders the UI fills: `{p:<seat>}` a player, `{c:<card>}` a card. */
const P = (seat: string) => `{p:${seat}}`;
const C = (c: CardId) => `{c:${c}}`;
/** A suit's name: `{s:p}` (the UI names colours and the theme's trumps). */
const S = (suit: Suit) => `{s:${suit}}`;
const or = (parts: string[]) =>
  parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} or ${parts.at(-1)}`;

/** Cards a filter names, in words: "{c:g9}", "a 5", "a {s:t}", "a {s:p} card". */
export function what(m: CardMatch): string {
  if (m.cards) return or(m.cards.map(C));
  const colourOnly = !m.suits || m.suits.every((x) => x !== TRUMP);
  if (m.values) {
    const v = or(m.values.map(String));
    if (m.suits?.length === 1) return `a ${S(m.suits[0]!)} ${v}`;
    return colourOnly ? `a ${v}` : `a ${v} or {trump}`;
  }
  if (m.suits) return or(m.suits.map((x) => (x === TRUMP ? `a ${S(x)}` : `a ${S(x)} card`)));
  return 'such a card';
}

const done = (progress?: string): Status => ({ state: 'done', ...(progress && { progress }) });
const open = (progress?: string): Status => ({ state: 'open', ...(progress && { progress }) });
const fail = (why: string, progress?: string): Status => ({
  state: 'failed',
  why,
  ...(progress && { progress }),
});

function facts(t: Table) {
  const wonBy = (seat: string) =>
    t.tricks.flatMap((tr) => (tr.winner === seat ? tr.plays.map((p) => p.card) : []));
  const wins = (seat: string) => t.tricks.filter((tr) => tr.winner === seat).length;
  const winnerOf = (c: CardId) => t.tricks.find((tr) => tr.plays.some((p) => p.card === c))?.winner;
  // Cards still to be won: in a hand or on the table now (none once the attempt is over).
  const pending = (m: CardMatch, owner?: string, not?: string): CardId[] => {
    if (t.final) return [];
    const out: CardId[] = [];
    for (const [seat, hand] of Object.entries(t.hands)) {
      if ((owner && seat !== owner) || (not && seat === not)) continue;
      for (const c of hand) if (matches(m, c)) out.push(c);
    }
    for (const p of t.current) {
      if ((owner && p.by !== owner) || (not && p.by === not)) continue;
      if (matches(m, p.card)) out.push(p.card);
    }
    return out;
  };
  const left = t.total - t.tricks.length;
  return { wonBy, wins, winnerOf, pending, left };
}

/** The winning card of a trick (the one its winner played). */
const winningCard = (tr: Trick) => tr.plays.find((p) => p.by === tr.winner)!.card;
const noTrump = (tr: Trick) => tr.plays.every((p) => !isTrump(p.card));
const trickNo = (t: Table, ref: number | 'last') => (ref === 'last' ? t.total : ref);

export function evaluate(
  check: Check,
  owner: string | null,
  t: Table,
  prediction: number | null = null,
): Status {
  const f = facts(t);
  const me = owner ?? '';
  switch (check.kind) {
    case 'all': {
      const parts = check.checks.map((c) => evaluate(c, owner, t, prediction));
      const failed = parts.find((p) => p.state === 'failed');
      if (failed) return failed;
      if (parts.every((p) => p.state === 'done')) return done();
      return open(parts.find((p) => p.state === 'open')?.progress);
    }
    case 'win-cards': {
      let got = 0;
      for (const c of check.cards) {
        const w = f.winnerOf(c);
        const progress = check.cards.length > 1 ? `${got}/${check.cards.length}` : undefined;
        if (w !== undefined && w !== me) return fail(`${P(w)} won ${C(c)}.`, progress);
        if (w === me && check.last) {
          const at = t.tricks.findIndex((tr) => tr.plays.some((p) => p.card === c));
          if (at !== t.total - 1) return fail(`${C(c)} was won before the last trick.`);
        }
        if (
          w === undefined &&
          check.last &&
          t.current.some((p) => p.card === c) &&
          t.tricks.length < t.total - 1
        )
          return fail(`${C(c)} was played before the last trick.`);
        if (w === undefined && t.final)
          return fail(`${C(c)} was the card left over, never played.`, progress);
        if (w === me) got++;
      }
      const progress = check.cards.length > 1 ? `${got}/${check.cards.length}` : undefined;
      return got === check.cards.length ? done(progress) : open(progress);
    }
    case 'win-count': {
      const mine = f.wonBy(me).filter((c) => matches(check.match, c));
      const have = mine.length;
      const more = f.pending(check.match).length;
      const progress = `${have}/${check.n}`;
      if (check.op === 'atLeast') {
        if (have >= check.n) return done(progress);
        if (have + more < check.n)
          return fail(
            `${P(me)} has ${have} and only ${more} more can still be won: ${check.n} were needed.`,
            progress,
          );
        return open(progress);
      }
      if (have > check.n) return fail(`${P(me)} won ${C(mine.at(-1)!)}, one too many.`, progress);
      if (have + more < check.n)
        return fail(
          `${P(me)} has ${have} and only ${more} more can still be won: exactly ${check.n} were needed.`,
          progress,
        );
      return have === check.n && more === 0 ? done(progress) : open(progress);
    }
    case 'win-with': {
      const hit = t.tricks.some((tr) => tr.winner === me && matches(check.match, winningCard(tr)));
      if (hit) return done();
      if (f.pending(check.match, me).length === 0)
        return fail(
          `${P(me)} has no ${what(check.match).replace(/^an? /, '')} left to win a trick with.`,
        );
      return open();
    }
    case 'win-with-card': {
      const hit = t.tricks.some((tr) => {
        if (tr.winner !== me) return false;
        const w = winningCard(tr);
        return (
          matches(check.using, w) &&
          tr.plays.some((p) => p.by !== me && matches(check.target, p.card))
        );
      });
      if (hit) return done();
      if (f.pending(check.using, me).length === 0)
        return fail(
          `${P(me)} has no ${what(check.using).replace(/^an? /, '')} left to win it with.`,
        );
      if (f.pending(check.target, undefined, me).length === 0) {
        // The holder can't win a card they play themself.
        const own = f.pending(check.target, me).filter((c) => !matches(check.using, c));
        if (own.length)
          return fail(
            `${P(me)} holds ${or(own.map(C))}, so nobody else can play it for ${P(me)} to win.`,
          );
        return fail(`No ${what(check.target).replace(/^an? /, '')} is left for ${P(me)} to win.`);
      }
      return open();
    }
    case 'tricks': {
      const wanted = new Set(check.win.map((r) => trickNo(t, r)));
      let got = 0;
      for (const [i, tr] of t.tricks.entries()) {
        const n = i + 1;
        if (wanted.has(n)) {
          if (tr.winner !== me) return fail(`${P(tr.winner)} won trick ${n}.`);
          got++;
        } else if (check.only && tr.winner === me) {
          return fail(`${P(me)} won trick ${n}.`);
        }
      }
      const progress = wanted.size > 1 ? `${got}/${wanted.size}` : undefined;
      if (got === wanted.size && (!check.only || t.final)) return done(progress);
      return open(progress);
    }
    case 'avoid-first': {
      for (const [i, tr] of t.tricks.slice(0, check.n).entries()) {
        if (tr.winner === me) return fail(`${P(me)} won trick ${i + 1}.`);
      }
      return t.tricks.length >= check.n ? done() : open(`${t.tricks.length}/${check.n}`);
    }
    case 'predict':
    case 'trick-count': {
      const n = check.kind === 'predict' ? prediction : check.n;
      const w = f.wins(me);
      if (n === null) return open(`${w}`);
      const progress = `${w}/${n}`;
      if (w > n) return fail(`${P(me)} won ${w} tricks, more than ${n}.`, progress);
      if (w + f.left < n)
        return fail(
          `${P(me)} has ${w} tricks with ${f.left} left: ${n} can't be reached.`,
          progress,
        );
      return t.final ? done(progress) : open(progress);
    }
    case 'run': {
      const mine = t.tricks.map((tr) => tr.winner === me);
      let best = 0;
      let run = 0;
      for (const m of mine) {
        run = m ? run + 1 : 0;
        best = Math.max(best, run);
      }
      const w = mine.filter(Boolean).length;
      if (!check.exact) {
        if (best >= check.n) return done(`${best}/${check.n}`);
        if (run + f.left < check.n)
          return fail(`Only ${f.left} tricks are left: no room for ${check.n} in a row.`);
        return open(`${run}/${check.n}`);
      }
      const first = mine.indexOf(true);
      const ended = first >= 0 && run === 0;
      if (w > check.n) return fail(`${P(me)} won ${w} tricks, more than ${check.n}.`);
      if (first >= 0 && w !== best) return fail(`${P(me)}'s tricks are not in a row.`);
      if (ended && w < check.n) return fail(`${P(me)}'s run stopped at ${w}.`);
      if (w === 0 ? f.left < check.n : w + f.left < check.n)
        return fail(`Only ${f.left} tricks are left: no room for ${check.n} in a row.`);
      return t.final ? done() : open(`${w}/${check.n}`);
    }
    case 'no-run': {
      for (let i = 1; i < t.tricks.length; i++) {
        if (t.tricks[i]!.winner === me && t.tricks[i - 1]!.winner === me)
          return fail(`${P(me)} won tricks ${i} and ${i + 1}.`);
      }
      return t.final ? done() : open();
    }
    case 'compare': {
      const w = f.wins(me);
      const others = t.crew.filter((s) => s !== me).map(f.wins);
      const R = f.left;
      let target: number;
      if (check.with === 'captain') target = f.wins(t.captain);
      else if (check.with === 'together') target = others.reduce((a, b) => a + b, 0);
      else target = check.op === 'fewer' ? Math.min(...others) : Math.max(...others);
      const progress = `${w}:${target}`;
      const them =
        check.with === 'captain'
          ? P(t.captain)
          : check.with === 'together'
            ? 'the others together'
            : check.op === 'fewer'
              ? 'the fewest of the others'
              : 'the most of the others';
      const score = `${P(me)} has ${w} tricks to ${target} for ${them}, with ${R} left`;
      if (check.op === 'more') {
        if (w > target + R) return done(progress);
        if (w + R <= target) return fail(`${score}: no longer enough to finish ahead.`, progress);
      } else if (check.op === 'fewer') {
        if (w + R < target) return done(progress);
        if (w >= target + R) return fail(`${score}: no longer able to finish behind.`, progress);
      } else {
        if (Math.abs(w - target) > R)
          return fail(`${score}: no longer able to draw level.`, progress);
        if (t.final) return done(progress);
      }
      return open(progress);
    }
    case 'trick-sum': {
      const ok = (tr: Trick) => {
        if (tr.winner !== me || !noTrump(tr)) return false;
        const sum = tr.plays.reduce((s, p) => s + valueOf(p.card), 0);
        if (check.above && !(sum > check.above[t.size])) return false;
        if (check.below && !(sum < check.below[t.size])) return false;
        if (check.oneOf && !check.oneOf.includes(sum)) return false;
        return true;
      };
      if (t.tricks.some(ok)) return done();
      return t.final ? fail(`${P(me)} never won such a trick.`) : open();
    }
    case 'trick-all': {
      const ok = (tr: Trick) =>
        tr.winner === me &&
        noTrump(tr) &&
        tr.plays.every((p) => {
          const v = valueOf(p.card);
          if (check.above !== undefined && !(v > check.above)) return false;
          if (check.below !== undefined && !(v < check.below)) return false;
          if (check.parity && (v % 2 === 1) !== (check.parity === 'odd')) return false;
          return true;
        });
      if (t.tricks.some(ok)) return done();
      return t.final ? fail(`${P(me)} never won such a trick.`) : open();
    }
    case 'equal': {
      if (check.inTrick) {
        const hit = t.tricks.some((tr) => {
          if (tr.winner !== me) return false;
          const a = tr.plays.filter((p) => suitOf(p.card) === check.a).length;
          const b = tr.plays.filter((p) => suitOf(p.card) === check.b).length;
          return a > 0 && a === b;
        });
        if (hit) return done();
        return t.final ? fail(`${P(me)} never won such a trick.`) : open();
      }
      const won = f.wonBy(me);
      const a = won.filter((c) => suitOf(c) === check.a).length;
      const b = won.filter((c) => suitOf(c) === check.b).length;
      const progress = `${a}:${b}`;
      const left = f.pending({ suits: [check.a, check.b] }).length;
      if (left === 0) {
        return a > 0 && a === b
          ? done(progress)
          : fail(`${P(me)} ended on ${a} and ${b}.`, progress);
      }
      const leftA = f.pending({ suits: [check.a] }).length;
      const leftB = f.pending({ suits: [check.b] }).length;
      if (a + leftA < b || b + leftB < a)
        return fail(
          `${P(me)} has ${a} ${S(check.a)} to ${b} ${S(check.b)}, too far apart to even up.`,
          progress,
        );
      return open(progress);
    }
    case 'more': {
      const won = f.wonBy(me);
      const m = won.filter((c) => suitOf(c) === check.more).length;
      const n = won.filter((c) => suitOf(c) === check.than).length;
      const progress = `${m}:${n}`;
      const leftM = f.pending({ suits: [check.more] }).length;
      const leftN = f.pending({ suits: [check.than] }).length;
      if (m > n + leftN) return done(progress);
      if (m + leftM <= n)
        return fail(
          `${P(me)} has ${m} ${S(check.more)} to ${n} ${S(check.than)}, and can no longer get ahead.`,
          progress,
        );
      return open(progress);
    }
    case 'colour-set': {
      const won = new Set(f.wonBy(me));
      if (check.mode === 'full') {
        const full = COLOURS.some((s) =>
          DECK.filter((c) => suitOf(c) === s).every((c) => won.has(c)),
        );
        if (full) return done();
        const possible = COLOURS.some((s) =>
          DECK.filter((c) => suitOf(c) === s).every((c) => {
            const w = f.winnerOf(c);
            return w === me || (w === undefined && !t.final);
          }),
        );
        return possible ? open() : fail(`Every colour has a card won by someone else.`);
      }
      const have = COLOURS.filter((s) => [...won].some((c) => suitOf(c) === s));
      if (have.length === COLOURS.length) return done(`${have.length}/4`);
      const missing = COLOURS.find(
        (s) => !have.includes(s) && f.pending({ suits: [s] }).length === 0,
      );
      if (missing)
        return fail(`No ${S(missing)} card is left for ${P(me)} to win.`, `${have.length}/4`);
      return open(`${have.length}/4`);
    }
    case 'no-lead': {
      const leads = [
        ...t.tricks.map((tr) => tr.plays[0]!),
        ...(t.current[0] ? [t.current[0]] : []),
      ];
      for (const [i, lead] of leads.entries()) {
        if ((owner === null || lead.by === me) && check.suits.includes(suitOf(lead.card)))
          return fail(`${P(lead.by)} opened trick ${i + 1} with ${C(lead.card)}.`);
      }
      const risky = Object.entries(t.hands).some(
        ([seat, hand]) =>
          (owner === null || seat === me) && hand.some((c) => check.suits.includes(suitOf(c))),
      );
      return t.final || !risky ? done() : open();
    }
    case 'balance': {
      const counts = t.crew.map((s) => ({
        s,
        n: f.wonBy(s).filter((c) => valueOf(c) === check.value && !isTrump(c)).length,
      }));
      const hi = counts.reduce((a, b) => (b.n > a.n ? b : a));
      const lo = counts.reduce((a, b) => (b.n < a.n ? b : a));
      if (hi.n - lo.n >= check.gap)
        return fail(`${P(hi.s)} has won ${hi.n - lo.n} more ${check.value}s than ${P(lo.s)}.`);
      const left = f.pending({ values: [check.value], suits: [...COLOURS] }).length;
      return t.final || left === 0 ? done() : open();
    }
    case 'leader': {
      if (!t.tricks.length) return open();
      const lead = t.tricks[0]!.winner;
      const mine = f.wins(lead);
      const rival = t.crew.find((s) => s !== lead && f.wins(s) >= mine);
      if (rival) return fail(`${P(rival)} caught up with ${P(lead)}.`);
      return t.final ? done() : open();
    }
    case 'last-card': {
      const c = check.card;
      const at = t.tricks.findIndex((tr) => tr.plays.some((p) => p.card === c));
      if (at >= 0) {
        const plays = t.tricks[at]!.plays;
        if (at !== t.total - 1) return fail(`${C(c)} was played in trick ${at + 1}.`);
        return plays.at(-1)!.card === c ? done() : fail(`${C(c)} was not the last card played.`);
      }
      const i = t.current.findIndex((p) => p.card === c);
      if (i >= 0) {
        if (t.tricks.length !== t.total - 1)
          return fail(`${C(c)} was played in trick ${t.tricks.length + 1}.`);
        if (i < t.current.length - 1) return fail(`${C(c)} was not the last card played.`);
      }
      if (t.final) return fail(`${C(c)} was the card left over, never played.`);
      return open();
    }
  }
}

/** The trump suit, for readers of `Check`. */
export { TRUMP };
