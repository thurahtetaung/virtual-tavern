import type { AwardCandidate, AwardModule, AwardRule, GameEvents, Tone } from '@vt/game-sdk';
import type { GameRecap, RecapLine } from '@vt/protocol';
import { MVP, NIGHT_RULES, type NightContext, fallbacksFor, nightPlayers } from './night-awards.ts';
import {
  type RuleInfo,
  type Scored,
  fnv1a,
  jitterOf,
  pickNight,
  pickStrip,
  scoreOf,
  shareable,
  toLine,
} from './select.ts';

/** Most "Past rounds" lines kept per game. */
const MAX_HISTORY = 15;
/** Nuggets on the card. */
const MAX_NUGGETS = 4;

export interface EngineInput {
  roomId: string;
  nightKey: string;
  /** Changes whenever the room's events do, so the card's seed moves with them. */
  lastEventId: string;
  /** The night's finished games, oldest first. */
  games: readonly GameEvents[];
  /** The room game's award rules (none: only the night awards). */
  module: AwardModule | undefined;
  tone: Tone;
  tzOffsetMin: number | null;
  /** Players to leave out entirely (removed by the host, forgotten). */
  exclude: ReadonlySet<string>;
}

export interface EngineOutput {
  games: GameRecap[];
  moment?: RecapLine;
  mvp?: RecapLine;
  awards: RecapLine[];
  nuggets: { emoji: string; text: string }[];
}

/** Runs a rule without letting a bad one break the recap. */
function safely<T>(run: () => T[]): T[] {
  try {
    const out = run();
    return Array.isArray(out) ? out : [];
  } catch {
    return [];
  }
}

/** Drops excluded players from a candidate; null if that leaves it meaningless. */
function without(rule: RuleInfo, c: AwardCandidate, exclude: ReadonlySet<string>) {
  if (!c.players.some((p) => exclude.has(p))) return shareable(rule, c) ? c : null;
  if (rule.kind !== 'team') return null;
  const players = c.players.filter((p) => !exclude.has(p));
  return players.length ? { ...c, players } : null;
}

/** One game's scored candidates (strip and card alike). */
function candidates(
  g: GameEvents,
  rules: readonly AwardRule[],
  input: EngineInput,
  seed: number,
): Scored[] {
  const out: Scored[] = [];
  for (const rule of rules) {
    if (!rule.compute || (rule.minPlayers ?? 0) > g.players.length) continue;
    for (const raw of safely(() => rule.compute!(g))) {
      const cand = without(rule, raw, input.exclude);
      if (!cand) continue;
      const jitter = jitterOf(seed, rule.id, g.gameNo, cand.players.join());
      out.push({ rule, cand, gameNo: g.gameNo, score: scoreOf(rule, cand, input.tone, jitter) });
    }
  }
  return out;
}

/** The whole recap of a night: each game's strip and rounds, and the night card. */
export function runEngine(input: EngineInput): EngineOutput {
  const rules = input.module?.rules ?? [];
  const stripSize = input.module?.stripSize ?? 3;
  const nightSeed = fnv1a(`${input.roomId}:${input.nightKey}:${input.lastEventId}:${input.tone}`);

  // ---- Per game: strips stay put once shown, so their seed is the game's own. ----
  const perGame: Scored[][] = [];
  const games: GameRecap[] = [];
  const recent: Set<string>[] = [];
  for (const g of input.games) {
    const gameSeed = fnv1a(`${input.roomId}:${g.startedAt}:${g.gameNo}:${input.tone}`);
    const scored = candidates(g, rules, input, gameSeed);
    perGame.push(scored);
    // An award that headlined the last two strips takes a back seat in this one.
    const tired =
      recent.length >= 2 ? [...recent.at(-1)!].filter((id) => recent.at(-2)!.has(id)) : [];
    const forStrip = scored
      .filter((s) => !(s.rule as AwardRule).nightOnly)
      .map((s) => (tired.includes(s.rule.id) ? { ...s, score: s.score * 0.5 } : s));
    const strip = pickStrip(forStrip, stripSize, input.tone);
    recent.push(new Set(strip.map((s) => s.rule.id)));
    games.push({
      gameNo: g.gameNo,
      gameId: g.gameId,
      startedAt: g.startedAt,
      durationMs: Math.max(0, g.endedAt - g.startedAt),
      players: g.players.filter((p) => !input.exclude.has(p)),
      winners: g.winners.filter((p) => !input.exclude.has(p)),
      lines: strip.map((s) => toLine(s, input.tone, gameSeed)),
      history: safely(() => input.module?.history?.(g) ?? []).slice(0, MAX_HISTORY),
    });
  }

  // ---- The night card ----
  const gameScored = perGame.flat();
  const glory = new Map<string, number>();
  const chaos = new Map<string, number>();
  for (const s of gameScored) {
    const into = s.rule.valence === 'glory' ? glory : s.rule.valence === 'chaos' ? chaos : null;
    if (into) for (const p of s.cand.players) into.set(p, (into.get(p) ?? 0) + 1);
  }
  const ctx: NightContext = { games: input.games, glory, chaos, tzOffsetMin: input.tzOffsetMin };
  const nightScored: Scored[] = [];
  const add = (rule: RuleInfo, raw: AwardCandidate) => {
    const cand = without(rule, raw, input.exclude);
    if (!cand) return;
    const jitter = jitterOf(nightSeed, rule.id, cand.players.join());
    nightScored.push({ rule, cand, score: scoreOf(rule, cand, input.tone, jitter) });
  };
  for (const rule of NIGHT_RULES)
    if (input.games.length >= rule.minGames)
      for (const c of safely(() => rule.compute(ctx))) add(rule, c);
  for (const rule of rules)
    if (rule.computeNight)
      for (const c of safely(() => rule.computeNight!(input.games))) add(rule, c);

  let mvp: RecapLine | undefined;
  const mvpPlayers = new Set<string>();
  if (input.games.length >= MVP.minGames) {
    const best = safely(() => MVP.compute(ctx))
      .map((c) => without(MVP, c, input.exclude))
      .find((c) => c !== null);
    if (best) {
      mvp = toLine({ rule: MVP, cand: best, score: 0 }, input.tone, nightSeed);
      for (const p of best.players) mvpPlayers.add(p);
    }
  }

  const cardPool = [...gameScored, ...nightScored].filter((s) => !(s.rule as AwardRule).stripOnly);
  const members = seededOrder(
    nightPlayers(input.games).filter((p) => !input.exclude.has(p)),
    nightSeed,
  );
  const picked = pickNight({
    scored: cardPool,
    members,
    tone: input.tone,
    fallbacks: (p) =>
      // The MVP already has the headline; anyone else gets a gentle line of their own.
      mvpPlayers.has(p)
        ? []
        : fallbacksFor(ctx, p).map(({ rule, cand }) => ({ rule, cand, score: 0 })),
  });

  return {
    games,
    ...(picked.moment && { moment: toLine(picked.moment, input.tone, nightSeed) }),
    ...(mvp && { mvp }),
    awards: picked.awards.map((s) => toLine(s, input.tone, nightSeed)),
    nuggets: nuggetsOf(input),
  };
}

/** Members in a seeded order, so equal cases take turns night to night. */
function seededOrder(ids: readonly string[], seed: number): string[] {
  return [...ids].sort(
    (a, b) => fnv1a(`${seed}:${a}`) - fnv1a(`${seed}:${b}`) || a.localeCompare(b),
  );
}

function nuggetsOf(input: EngineInput): { emoji: string; text: string }[] {
  const found: { emoji: string; text: string; interest: number }[] = [];
  for (const n of input.module?.nuggets ?? []) {
    try {
      const out = n.compute(input.games);
      if (out?.text) found.push({ emoji: n.emoji, text: out.text, interest: n.interest });
    } catch {
      // A broken nugget is simply left out.
    }
  }
  return found
    .sort((a, b) => b.interest - a.interest)
    .slice(0, MAX_NUGGETS)
    .map(({ emoji, text }) => ({ emoji, text }));
}
