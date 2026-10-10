import { hourOf } from './days.ts';
import { figureCounters, isAssassinGuess, isPerfectEcho } from './figures.ts';
import type { StatsEvent } from './types.ts';

// Rollups and queries share one aggregation: a day rolled up into the daily tables holds exactly
// what aggregating its raw events gives, so a query can mix rolled-up days with raw ones.

const SEP = '\u0001';
export const key = (...parts: (string | number)[]) => parts.join(SEP);
export const split = (k: string) => k.split(SEP);

/** `max.*` metrics keep the largest value; everything else adds up. */
const merge = (metric: string, a: number | undefined, b: number) =>
  a === undefined ? b : metric.startsWith('max.') ? Math.max(a, b) : a + b;

/** Hour-of-day metrics are stored as `h.<HH>.<metric>`. */
export const hourly = (hour: number, metric: string) =>
  `h.${String(hour).padStart(2, '0')}.${metric}`;

/** Normalises a reported word so 'Apple ' and 'apple' count together. */
export const normWord = (w: string) => w.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 40);

/** Summed stats, keyed per day and game (see the `stats_daily*` tables). */
export class Agg {
  /** day, game, metric */
  readonly daily = new Map<string, number>();
  /** day, game, player, metric */
  readonly players = new Map<string, number>();
  /** day, game, kind, word */
  readonly words = new Map<string, number>();
  /** day, game, key, value */
  readonly settings = new Map<string, number>();

  addDaily(day: string, game: string, metric: string, v: number) {
    const k = key(day, game, metric);
    this.daily.set(k, merge(metric, this.daily.get(k), v));
  }
  addPlayer(day: string, game: string, player: string, metric: string, v: number) {
    const k = key(day, game, player, metric);
    this.players.set(k, merge(metric, this.players.get(k), v));
  }
  addWord(day: string, game: string, kind: string, word: string, v: number) {
    const k = key(day, game, kind, word);
    this.words.set(k, (this.words.get(k) ?? 0) + v);
  }
  addSetting(day: string, game: string, name: string, value: string, v: number) {
    const k = key(day, game, name, value);
    this.settings.set(k, (this.settings.get(k) ?? 0) + v);
  }
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Internal word kind: Hoodwink lies weighted by players fooled (read by fun facts only). */
export const FOOLED_KIND = 'fooled';

/** Insight types whose actor's time-to-act counts as a guess. */
const GUESS_TYPES = new Set(['guess', 'card']);

/** Adds raw events (any number of days) to `agg`. */
export function aggregate(events: Iterable<StatsEvent>, agg = new Agg()): Agg {
  /** day, game -> active players; and per hour. */
  const active = new Map<string, Set<string>>();
  const seen = (k: string, player: string) => {
    let set = active.get(k);
    if (!set) active.set(k, (set = new Set()));
    set.add(player);
  };
  for (const e of events) {
    const { day, gameId: game, props } = e;
    const hour = hourOf(e.ts);
    const touch = (player: string) => {
      agg.addPlayer(day, game, player, 'max.active', 1);
      seen(key(day, game), player);
      seen(key(day, game, hour), player);
    };
    const daily = (metric: string, v = 1) => {
      agg.addDaily(day, game, metric, v);
      agg.addDaily(day, game, hourly(hour, metric), v);
    };
    if (e.playerId) touch(e.playerId);
    switch (e.type) {
      case 'room.created':
        daily('rooms_created');
        break;
      case 'action':
        daily('actions');
        break;
      case 'game.started': {
        const players = strings(props.players);
        daily('games_started');
        agg.addDaily(day, game, 'players_sum', players.length);
        for (const s of strings(props.settings)) {
          const at = s.indexOf('=');
          if (at > 0) agg.addSetting(day, game, s.slice(0, at), s.slice(at + 1), 1);
        }
        for (const p of players) {
          touch(p);
          agg.addPlayer(day, game, p, 'games', 1);
        }
        break;
      }
      case 'game.ended': {
        const players = strings(props.players);
        const minutes = (num(props.durationMs) ?? 0) / 60_000;
        daily(props.finished === true ? 'games_finished' : 'games_abandoned');
        daily('minutes_played', minutes);
        agg.addDaily(day, game, 'max.longest_ms', num(props.durationMs) ?? 0);
        if (props.finished === true) agg.addDaily(day, game, `players_n.${players.length}`, 1);
        for (const p of players) {
          touch(p);
          agg.addPlayer(day, game, p, 'minutes', minutes);
        }
        for (const p of strings(props.winners)) agg.addPlayer(day, game, p, 'wins', 1);
        break;
      }
      default:
        if (e.type.startsWith('insight.')) insight(agg, e, e.type.slice(8));
    }
  }
  for (const [k, players] of active) {
    const [day, game, hour] = split(k) as [string, string, string?];
    const metric = 'players_unique';
    agg.addDaily(
      day,
      game,
      hour === undefined ? metric : hourly(Number(hour), metric),
      players.size,
    );
  }
  return agg;
}

function insight(agg: Agg, e: StatsEvent, type: string) {
  const { day, gameId: game, props, playerId } = e;
  agg.addDaily(day, game, `i.${type}`, 1);
  for (const [metric, v] of figureCounters(game, type, props)) agg.addDaily(day, game, metric, v);
  if (Array.isArray(props.words)) {
    for (const w of props.words as { kind?: unknown; word?: unknown }[]) {
      if (typeof w?.kind !== 'string' || typeof w.word !== 'string') continue;
      const word = normWord(w.word);
      if (word) agg.addWord(day, game, w.kind, word, 1);
    }
  }
  const credit = (player: string, metric: string, v = 1) =>
    agg.addPlayer(day, game, player, metric, v);
  if (playerId && GUESS_TYPES.has(type)) {
    // The recorder measures this: from the last step change to the guesser's action.
    const ms = num(props.actMs);
    if (ms !== null && ms >= 0) {
      credit(playerId, 'act_ms', ms);
      credit(playerId, 'act_n');
    }
  }
  if (game === 'codenames' && type === 'guess' && playerId && isAssassinGuess(props))
    credit(playerId, 'assassins');
  if (game === 'hoodwink' && type === 'lie') {
    // "Best liar": every author of a lie shares the credit for everyone it fooled. "Most
    // convincing lie": the lie's words, weighted by how many it fooled.
    const fooled = num(props.fooled) ?? 0;
    if (fooled > 0) {
      for (const p of strings(props.authors)) credit(p, 'fooled', fooled);
      for (const w of Array.isArray(props.words) ? props.words : []) {
        const word =
          typeof (w as { word?: unknown })?.word === 'string'
            ? normWord((w as { word: string }).word)
            : '';
        if (word) agg.addWord(day, game, FOOLED_KIND, word, fooled);
      }
    }
  }
  if (game === 'echo') {
    // "The echo": whose clues most often matched someone else's (and so were cancelled). Each
    // `match` event is one pair of players whose clues cancelled; both get the credit.
    if (type === 'match')
      for (const p of [props.a, props.b]) if (typeof p === 'string' && p) credit(p, 'echoes');
    if (type === 'outcome' && isPerfectEcho(props))
      for (const p of strings(props.winners)) credit(p, 'perfect');
  }
}
