import {
  type AwardCandidate,
  type AwardRule,
  MAX_SHARED,
  type Tone,
  createRng,
  renderCopy,
} from '@vt/game-sdk';
import type { RecapLine } from '@vt/protocol';

/** What selection needs to know about a rule (game rules and night rules alike). */
export type RuleInfo = Pick<
  AwardRule,
  | 'id'
  | 'emoji'
  | 'title'
  | 'wholesomeTitle'
  | 'valence'
  | 'weight'
  | 'kind'
  | 'family'
  | 'copy'
  | 'stripOnly'
>;

/** A candidate with its rule, the game it came from, and its score. */
export interface Scored {
  rule: RuleInfo;
  cand: AwardCandidate;
  gameNo?: number;
  score: number;
}

/** 32-bit FNV-1a, for seeds. */
export function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * How good a candidate is (§3.2 of the plan): weight first, then how clearly it beat the
 * runner-up, then tone fit, plus a little seeded jitter so equal awards take turns.
 */
export function scoreOf(
  rule: RuleInfo,
  cand: AwardCandidate,
  tone: Tone,
  jitter: number,
  fresh = 1,
): number {
  const strength =
    rule.kind === 'moment' || cand.runnerUp === undefined
      ? 1
      : clamp((cand.value - cand.runnerUp) / Math.max(Math.abs(cand.value), 1), 0.15, 1);
  const toneFit = tone === 'wholesome' && rule.valence === 'chaos' ? 0.6 : 1;
  return rule.weight * 20 * (0.5 + 0.5 * strength) * fresh * toneFit + jitter;
}

/** Seeded jitter in [-2, 2] for one candidate. */
export function jitterOf(seed: number, ...parts: (string | number | undefined)[]): number {
  return createRng(fnv1a(`${seed}:${parts.join(':')}`)).next() * 4 - 2;
}

/** Whether a candidate may appear: shared by at most three, unless it names a team. */
export function shareable(rule: RuleInfo, cand: AwardCandidate): boolean {
  if (rule.kind === 'team') return cand.players.length > 0;
  if (rule.kind === 'moment') return true;
  if (rule.kind === 'pair') return cand.players.length === 2;
  return cand.players.length > 0 && cand.players.length <= MAX_SHARED;
}

const byScore = (a: Scored, b: Scored) =>
  b.score - a.score || a.rule.id.localeCompare(b.rule.id) || (a.gameNo ?? 0) - (b.gameNo ?? 0);

/**
 * A game's strip (§3.3): the best line first, then by score with different players and
 * families, at most one blunder, and a win or skill whenever there is one.
 */
export function pickStrip(
  scored: readonly Scored[],
  size: number,
  tone: Tone = 'cheeky',
): Scored[] {
  const sorted = [...scored].sort(byScore);
  const picked: Scored[] = [];
  const named = new Set<string>();
  const families = new Set<string>();
  const ids = new Set<string>();
  const fits = (s: Scored, ignoreChaos = false) =>
    !ids.has(s.rule.id) &&
    (s.rule.kind === 'team' || !s.cand.players.some((p) => named.has(p))) &&
    (!s.rule.family || !families.has(s.rule.family)) &&
    (ignoreChaos || s.rule.valence !== 'chaos' || !picked.some((p) => p.rule.valence === 'chaos'));
  const take = (s: Scored) => {
    picked.push(s);
    ids.add(s.rule.id);
    if (s.rule.kind !== 'team') for (const p of s.cand.players) named.add(p);
    if (s.rule.family) families.add(s.rule.family);
  };
  for (const s of sorted) {
    if (picked.length >= size) break;
    if (picked.length === 0 || fits(s)) take(s);
  }
  // Make room for a win or a skill if the strip has none and one is available.
  if (!picked.some((p) => p.rule.valence === 'glory')) {
    const keep = picked.length >= size ? dropLast(picked) : picked;
    const taken = new Set(
      keep.filter((p) => p.rule.kind !== 'team').flatMap((p) => p.cand.players),
    );
    const glory = sorted.find(
      (s) =>
        s.rule.valence === 'glory' &&
        !keep.some((p) => p.rule.id === s.rule.id) &&
        (s.rule.kind === 'team' || !s.cand.players.some((p) => taken.has(p))),
    );
    if (glory) return finish([...keep, glory].sort(byScore), tone);
  }
  return finish(picked, tone);
}

/** The strip without its weakest line that isn't a moment. */
function dropLast(lines: Scored[]): Scored[] {
  const drop = lines.findLastIndex((p) => p.rule.kind !== 'moment');
  return drop < 0 ? lines : lines.filter((_, i) => i !== drop);
}

const finish = (lines: Scored[], tone: Tone) => (tone === 'wholesome' ? kindFirst(lines) : lines);

/** Wholesome mode never leads with a blunder: the first non-blunder moves to the top. */
function kindFirst(lines: Scored[]): Scored[] {
  const first = lines.findIndex((s) => s.rule.valence !== 'chaos');
  return first > 0 ? [lines[first]!, ...lines.filter((_, i) => i !== first)] : lines;
}

/** Picks a copy variant with the seed, so a night reads the same for everyone. */
export function toLine(s: Scored, tone: Tone, seed: number): RecapLine {
  const variants = s.rule.copy[tone].length ? s.rule.copy[tone] : s.rule.copy.cheeky;
  const pick = fnv1a(`${seed}:${s.rule.id}:${s.gameNo ?? 'night'}`) % variants.length;
  return {
    awardId: s.rule.id,
    emoji: s.rule.emoji,
    title: tone === 'wholesome' ? (s.rule.wholesomeTitle ?? s.rule.title) : s.rule.title,
    text: renderCopy(variants[pick]!, s.cand),
    players: [...s.cand.players],
    ...(s.gameNo !== undefined && { gameNo: s.gameNo }),
    valence: s.rule.valence,
  };
}

export interface NightPick {
  moment?: Scored;
  awards: Scored[];
}

/** Most lines on the night card (the moment and MVP not counted). */
export const cardCap = (members: number) => Math.min(10, members + 4);

/**
 * The night card (§3.4): the moment of the night, then one award for everyone who played (a
 * win, a skill or a quirk, never only a blunder), then the best of the rest up to the cap with
 * at most two awards and one blunder per player and one line per family.
 */
export function pickNight(opts: {
  scored: readonly Scored[];
  /** Players who played tonight, in a seeded order. */
  members: readonly string[];
  /** Award lines for players nothing else covers, in order of preference. */
  fallbacks: (player: string) => Scored[];
  tone?: Tone;
}): NightPick {
  const pool = [...opts.scored].filter((s) => !s.rule.stripOnly).sort(byScore);
  const moments = pool.filter((s) => s.rule.kind === 'moment');
  const moment = moments[0] ?? pool.find((s) => s.rule.weight === 5);
  const awards: Scored[] = [];
  const ids = new Set<string>(moment ? [moment.rule.id] : []);
  const count = new Map<string, number>();
  const chaos = new Set<string>();
  const families = new Set<string>();
  const covered = (p: string) => (count.get(p) ?? 0) > 0;
  const allowed = (s: Scored, limit: number) =>
    s.rule.kind !== 'moment' &&
    !ids.has(s.rule.id) &&
    s.cand.players.every((p) => (count.get(p) ?? 0) < limit) &&
    (s.rule.valence !== 'chaos' || s.cand.players.every((p) => !chaos.has(p)));
  const take = (s: Scored) => {
    awards.push(s);
    ids.add(s.rule.id);
    if (s.rule.family) families.add(s.rule.family);
    for (const p of s.cand.players) {
      count.set(p, (count.get(p) ?? 0) + 1);
      if (s.rule.valence === 'chaos') chaos.add(p);
    }
  };

  // Everyone gets one: the players with the fewest options choose first.
  const options = (p: string) =>
    pool.filter((s) => s.cand.players.includes(p) && s.rule.valence !== 'chaos');
  const order = [...opts.members].sort((a, b) => options(a).length - options(b).length);
  for (const p of order) {
    if (covered(p)) continue;
    const best = options(p).find((s) => allowed(s, 1));
    if (best) {
      take(best);
      continue;
    }
    const fallback = opts.fallbacks(p)[0];
    if (!fallback) continue;
    count.set(p, (count.get(p) ?? 0) + 1);
    // The same fallback for the same reason: one shared line ("Ana & Ben played all 4").
    const share = awards.findIndex(
      (a) =>
        a.rule.id === fallback.rule.id &&
        a.cand.value === fallback.cand.value &&
        a.cand.players.length < MAX_SHARED,
    );
    if (share >= 0) {
      const a = awards[share]!;
      awards[share] = { ...a, cand: { ...a.cand, players: [...a.cand.players, p] } };
    } else awards.push(fallback);
  }

  // Then the best of the rest.
  const cap = cardCap(opts.members.length);
  for (const s of pool) {
    if (awards.length >= cap) break;
    if (!allowed(s, 2)) continue;
    if (s.rule.family && families.has(s.rule.family)) continue;
    take(s);
  }
  awards.sort(byScore);
  return {
    ...(moment && { moment }),
    awards: opts.tone === 'wholesome' ? kindFirst(awards) : awards,
  };
}
