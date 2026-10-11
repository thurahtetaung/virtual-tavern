/**
 * Tavern night recap: the award contract each game implements next to its `insights`.
 *
 * A game's award rules read the stats events its own `insights()` reported for one finished game
 * (`GameEvents`) and propose candidates. The server scores and picks among them; the web app only
 * ever receives finished lines. Everything here is pure, so rules are easy to test with fixtures.
 *
 * Text produced for players never contains names or private labels directly: it carries
 * placeholders the browser resolves (`{p:<playerId>}`, `{role:<id>}`, `{loc:<id>}`,
 * `{card:<id>}`), so back-room names never leave the manifest.
 */
import type { InsightEvent } from './types.ts';

export type Tone = 'cheeky' | 'wholesome';
export const TONES: readonly Tone[] = ['cheeky', 'wholesome'];

/** `glory`: a win or a skill. `chaos`: a funny blunder. `gentle`: a quirk. */
export type Valence = 'glory' | 'chaos' | 'gentle';

/** One stats event of a finished game, with the `insight.` prefix stripped from its type. */
export interface RecapEvent {
  type: string;
  ts: number;
  playerId: string | null;
  props: Record<string, unknown>;
}

/** Everything one finished game reported, from its `game.started` to its `game.ended`. */
export interface GameEvents {
  gameId: string;
  /** The room's game counter when it started (1 for the first game in the room). */
  gameNo: number;
  startedAt: number;
  endedAt: number;
  /** Who played (seated), from `game.started`. */
  players: string[];
  /** Who won, from `game.ended`. */
  winners: string[];
  finished: boolean;
  /** Insight events in the order they happened. */
  events: RecapEvent[];
  /** The events of one type. */
  of(type: string): RecapEvent[];
}

/** One proposal for an award: who earned it, how strongly, and the values its copy shows. */
export interface AwardCandidate {
  /** The players named, best first. Empty for a moment that names nobody. */
  players: string[];
  /** The measured value (a count, a time…). Higher is stronger unless the rule says otherwise. */
  value: number;
  /** The next best value, for "most X" rules: the closer it is, the weaker the award. */
  runnerUp?: number;
  /**
   * Values the copy uses: `{n}`, `{m}`, `{s}`, `{w}`, `{team}`… Keys starting with `role`, `loc`
   * or `card` become placeholders (`{role:<id>}`) that the browser names.
   */
  params?: Record<string, string | number>;
}

/** A rule for one award or moment. Copy uses `{who}` (or `{a}`/`{b}` for pairs), `{n}`, `{n|time}`… */
export interface AwardRule {
  id: string;
  emoji: string;
  title: string;
  /** The title in Wholesome mode, when the cheeky one would not fit. */
  wholesomeTitle?: string;
  valence: Valence;
  weight: 1 | 2 | 3 | 4 | 5;
  /** `team` and `pair` awards may name more players; `moment`s are scene-stealers. */
  kind: 'award' | 'moment' | 'team' | 'pair';
  /** Diversity bucket ("speed", "deception"…): one line per family on a strip or card. */
  family?: string;
  /** Fewest players the game needs for this rule to count. */
  minPlayers?: number;
  /** At least two variants per tone; the night's seed picks one. */
  copy: Record<Tone, string[]>;
  /** Proposals for one game, best first; [] when it does not apply. Must never throw. */
  compute?(g: GameEvents): AwardCandidate[];
  /** Night-card only: proposals across every finished game of the night. */
  computeNight?(games: readonly GameEvents[]): AwardCandidate[];
  /** Night card only (a per-game version would just repeat the strip). */
  nightOnly?: boolean;
  /** Strip only (timeout-flavoured rules never reach the shareable card). */
  stripOnly?: boolean;
}

/** A "by the numbers" fact for the night card. */
export interface NuggetRule {
  id: string;
  emoji: string;
  /** How interesting it is, 1–5. */
  interest: number;
  /**
   * A room record: the Hall of fame keeps the best `value` ever seen in the room (`max`: the
   * highest, `min`: the lowest), and a card that beats it shows "🆕 Room record".
   */
  record?: 'max' | 'min';
  /** `text` may carry placeholders. Null when there is nothing to say. */
  compute(games: readonly GameEvents[]): { value: number; text: string } | null;
}

export interface AwardModule {
  rules: AwardRule[];
  nuggets: NuggetRule[];
  /** Lines on each game's end-screen strip. Default 3. */
  stripSize?: number;
  /**
   * "Past rounds": one short line per round (with placeholders), for the recap's game history.
   * Who won the game is added by the server, so this is only the rounds.
   */
  history?(g: GameEvents): string[];
}

// ---- Placeholders ----

/** Strips the braces that would open a placeholder from text players wrote (clues, lies…). */
export const plain = (text: string | number | null | undefined): string =>
  String(text ?? '')
    .replace(/[{}]/g, '')
    .slice(0, 60);

/** Placeholders the browser resolves; ids are made safe the same way. */
export const ph = {
  p: (id: string) => `{p:${plain(id)}}`,
  role: (id: string) => `{role:${plain(id)}}`,
  loc: (id: string) => `{loc:${plain(id)}}`,
  card: (id: string) => `{card:${plain(id)}}`,
};

/** "{p:a}", "{p:a} & {p:b}", "{p:a}, {p:b} & {p:c}". */
export function namesOf(ids: readonly string[]): string {
  const parts = ids.map(ph.p);
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} & ${parts[parts.length - 1]}`;
}

/** "once", "twice", "3 times". */
export const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

const PLACEHOLDER_KEY = /^(role|loc|card)/;

/**
 * Fills a copy template for a candidate: `{who}` names everyone, `{a}`/`{b}` the first two,
 * `{x|time}` says "once"/"twice"/"N times", and every other `{key}` comes from `params`
 * (role, loc and card keys become placeholders). Unknown keys are left out.
 */
export function renderCopy(template: string, c: AwardCandidate): string {
  const params: Record<string, string | number> = {
    n: c.value,
    ...c.params,
  };
  return template.replace(/\{(\w+)(\|time)?\}/g, (_m, key: string, time?: string) => {
    if (key === 'who') return namesOf(c.players);
    if (key === 'a') return c.players[0] ? ph.p(c.players[0]) : '';
    if (key === 'b') return c.players[1] ? ph.p(c.players[1]) : '';
    const v = params[key];
    if (v === undefined) return '';
    if (time) return times(Number(v));
    if (PLACEHOLDER_KEY.test(key)) {
      const kind = key.match(PLACEHOLDER_KEY)![1] as 'role' | 'loc' | 'card';
      return ph[kind](String(v));
    }
    return typeof v === 'number' ? fmt(v) : plain(v);
  });
}

/** Whole numbers as they are; others to one decimal place. */
const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// ---- Reading events ----

/** A string prop, or undefined. */
export const str = (e: RecapEvent | undefined, key: string): string | undefined => {
  const v = e?.props[key];
  return typeof v === 'string' ? v : undefined;
};

/** A finite number prop, or undefined. */
export const num = (e: RecapEvent | undefined, key: string): number | undefined => {
  const v = e?.props[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};

/** A boolean prop, or undefined. */
export const bool = (e: RecapEvent | undefined, key: string): boolean | undefined => {
  const v = e?.props[key];
  return typeof v === 'boolean' ? v : undefined;
};

/** A string-array prop, or [] (old events simply lack the newer props). */
export const strs = (e: RecapEvent | undefined, key: string): string[] => {
  const v = e?.props[key];
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
};

/** A number-array prop, or []. */
export const nums = (e: RecapEvent | undefined, key: string): number[] => {
  const v = e?.props[key];
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number') : [];
};

// ---- Picking winners ----

/** Most a tie may share: four or more equal players single nobody out. */
export const MAX_SHARED = 3;

export interface MostOptions {
  /** The value a leader needs. Default 1 (zero never wins). */
  min?: number;
  /** Lower values win (fastest times). */
  lowest?: boolean;
  /** Only these players count (e.g. the game's players). */
  among?: readonly string[];
}

/**
 * The leaders of a per-player tally, applying the tie rules: up to three equal leaders share the
 * award, more drop it. Returns at most one candidate.
 */
export function leaders(
  tally: ReadonlyMap<string, number>,
  opts: MostOptions = {},
): AwardCandidate[] {
  const { min = 1, lowest = false, among } = opts;
  // Everyone with a value counts as a runner-up; only those reaching `min` can lead.
  const all = [...tally].filter(
    ([id, v]) => Number.isFinite(v) && (!among || among.includes(id)) && (lowest || v > 0),
  );
  const entries = all.filter(([, v]) => lowest || v >= min);
  if (!entries.length) return [];
  const best = lowest
    ? Math.min(...entries.map(([, v]) => v))
    : Math.max(...entries.map(([, v]) => v));
  if (!lowest && best <= 0) return [];
  const top = entries
    .filter(([, v]) => v === best)
    .map(([id]) => id)
    .sort();
  if (top.length > MAX_SHARED) return [];
  const rest = all.filter(([, v]) => v !== best).map(([, v]) => v);
  const runnerUp = rest.length ? (lowest ? Math.min(...rest) : Math.max(...rest)) : undefined;
  return [
    {
      players: top,
      value: best,
      ...(runnerUp !== undefined && {
        runnerUp: lowest ? best - (runnerUp - best) : runnerUp,
      }),
    },
  ];
}

/** Counts events per key (by default the event's player). Events without a key are skipped. */
export function tally(
  events: readonly RecapEvent[],
  keyOf: (e: RecapEvent) => string | readonly string[] | null | undefined = (e) => e.playerId,
  weight: (e: RecapEvent) => number = () => 1,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of events) {
    const k = keyOf(e);
    const keys: readonly string[] = typeof k === 'string' ? [k] : (k ?? []);
    for (const id of keys) out.set(id, (out.get(id) ?? 0) + weight(e));
  }
  return out;
}

/** Most events per player (`min` at least, default 1), with the tie rules. */
export function mostBy(
  events: readonly RecapEvent[],
  keyOf?: (e: RecapEvent) => string | readonly string[] | null | undefined,
  opts: MostOptions = {},
): AwardCandidate[] {
  return leaders(tally(events, keyOf), opts);
}

/** Mean of a numeric prop per player, over players with at least `atLeast` samples. */
export function meanBy(
  events: readonly RecapEvent[],
  value: (e: RecapEvent) => number | undefined,
  atLeast = 1,
): Map<string, number> {
  const sums = new Map<string, { sum: number; n: number }>();
  for (const e of events) {
    const v = value(e);
    if (!e.playerId || v === undefined) continue;
    const s = sums.get(e.playerId) ?? { sum: 0, n: 0 };
    s.sum += v;
    s.n += 1;
    sums.set(e.playerId, s);
  }
  const out = new Map<string, number>();
  for (const [id, s] of sums) if (s.n >= atLeast) out.set(id, s.sum / s.n);
  return out;
}

/** Counts unordered player pairs (`a|b`, sorted) or ordered ones (`from>to`). */
export function pairTally(
  pairs: readonly (readonly [string, string])[],
  ordered = false,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [a, b] of pairs) {
    if (!a || !b || a === b) continue;
    const k = ordered ? `${a}>${b}` : [a, b].sort().join('|');
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/** The single strongest pair from `pairTally` (ties between pairs drop it), at least `min`. */
export function topPair(tallies: ReadonlyMap<string, number>, min = 2): AwardCandidate[] {
  const entries = [...tallies].filter(([, v]) => v >= min);
  if (!entries.length) return [];
  const best = Math.max(...entries.map(([, v]) => v));
  const top = entries.filter(([, v]) => v === best);
  if (top.length !== 1) return [];
  const rest = entries.filter(([, v]) => v !== best).map(([, v]) => v);
  const players = top[0]![0].split(/[|>]/);
  return [
    {
      players,
      value: best,
      ...(rest.length ? { runnerUp: Math.max(...rest) } : {}),
    },
  ];
}

/** Seconds, to one decimal place, from milliseconds. */
export const seconds = (ms: number) => Math.round(ms / 100) / 10;

/** Groups events into consecutive runs by a key (e.g. per round). */
export function groupBy<K>(events: readonly RecapEvent[], keyOf: (e: RecapEvent) => K) {
  const out = new Map<K, RecapEvent[]>();
  for (const e of events) {
    const k = keyOf(e);
    const list = out.get(k);
    if (list) list.push(e);
    else out.set(k, [e]);
  }
  return out;
}

// ---- Building events (the server and tests) ----

/** Wraps events into `GameEvents`. */
export function gameEvents(init: Omit<GameEvents, 'of'>): GameEvents {
  const byType = new Map<string, RecapEvent[]>();
  for (const e of init.events) {
    const list = byType.get(e.type);
    if (list) list.push(e);
    else byType.set(e.type, [e]);
  }
  return { ...init, of: (type) => byType.get(type) ?? [] };
}

/**
 * What the stats recorder stores for an insight: its props, plus `words` and `winners` when it
 * has them. Tests use it to turn a real game's `insights()` into recap events.
 */
export function recapEventOf(ev: InsightEvent, ts = 0, extra: Record<string, unknown> = {}) {
  const props: Record<string, unknown> = { ...ev.props, ...extra };
  if (ev.words?.length) props.words = ev.words;
  if (ev.winners?.length) props.winners = ev.winners;
  return { type: ev.type, ts, playerId: ev.playerId ?? null, props } satisfies RecapEvent;
}

/** A recap event for fixtures. */
export const recapEv = (
  type: string,
  playerId: string | null = null,
  props: Record<string, unknown> = {},
  ts = 0,
): RecapEvent => ({ type, ts, playerId, props });

/**
 * A test fixture game: events in order (timestamps count up from 1 if missing), every player
 * named in an event counted as playing unless `players` says otherwise.
 */
export function fixtureGame(
  events: readonly (RecapEvent | InsightEvent)[],
  init: Partial<Omit<GameEvents, 'of' | 'events'>> = {},
): GameEvents {
  const list: RecapEvent[] = events.map((e, i) =>
    'ts' in e && typeof e.ts === 'number' && 'props' in e && e.props !== undefined
      ? { ...e, ts: e.ts || i + 1 }
      : recapEventOf(e as InsightEvent, i + 1),
  );
  const players =
    init.players ?? [...new Set(list.flatMap((e) => (e.playerId ? [e.playerId] : [])))].sort();
  const outcome = list.findLast((e) => e.type === 'outcome');
  return gameEvents({
    gameId: init.gameId ?? 'test',
    gameNo: init.gameNo ?? 1,
    startedAt: init.startedAt ?? 0,
    endedAt: init.endedAt ?? list.length + 1,
    players,
    winners: init.winners ?? strs(outcome, 'winners'),
    finished: init.finished ?? true,
    events: list,
  });
}

/** "1 round", "3 rounds": a count with its noun in the right number. */
export const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
