import type {
  FunFact,
  GameStats,
  PlayerProfile,
  PlayerSummary,
  SeriesPoint,
  StatsFun,
  StatsGames,
  StatsHeatmap,
  StatsOverview,
  StatsPlayers,
  StatsSettings,
  StatsTimeseries,
  StatsTimeseriesMetric,
  StatsTotals,
  StatsWords,
  WordKind,
} from '@vt/protocol';
import { type Agg, FOOLED_KIND, TRICKY_KIND, split } from './aggregate.ts';
import { bucketOf, eachDay, weekday } from './days.ts';
import { buildFigures } from './figures.ts';
import type { Window } from './types.ts';

// Turns summed stats into the API's response shapes. Pure, so any store that can fill an `Agg`
// (SQLite now, a column store later) serves identical responses.

export interface PlayerInfo {
  name: string;
  firstSeen: number;
  lastSeen: number;
  names: { name: string; uses: number; firstSeen: number; lastSeen: number }[];
}

export interface ReportContext {
  /** Registered games, so empty ones still show up with zeros. */
  gameIds: readonly string[];
  gameName(id: string): string;
  /** Display label for a setting value (e.g. a word list's name). */
  label(key: string, value: string): string;
  players(ids: readonly string[]): Map<string, PlayerInfo>;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const inRange = (day: string, from: string, to: string) => day >= from && day <= to;

/** Rows of `map` whose day is in range (and game matches), split into their key parts. */
function* rows(map: Map<string, number>, from: string, to: string, game?: string) {
  for (const [k, value] of map) {
    const parts = split(k);
    if (!inRange(parts[0]!, from, to) || (game !== undefined && parts[1] !== game)) continue;
    yield { parts, value };
  }
}

function sumMetric(agg: Agg, from: string, to: string, metric: string, game?: string) {
  let total = 0;
  for (const { parts, value } of rows(agg.daily, from, to, game))
    if (parts[2] === metric)
      total = metric.startsWith('max.') ? Math.max(total, value) : total + value;
  return total;
}

function uniquePlayers(agg: Agg, from: string, to: string, game?: string) {
  const ids = new Set<string>();
  for (const { parts } of rows(agg.players, from, to, game))
    if (parts[3] === 'max.active') ids.add(parts[2]!);
  return ids.size;
}

export function totals(agg: Agg, from: string, to: string, game?: string): StatsTotals {
  const m = (metric: string) => sumMetric(agg, from, to, metric, game);
  return {
    roomsCreated: m('rooms_created'),
    gamesStarted: m('games_started'),
    gamesFinished: m('games_finished'),
    gamesAbandoned: m('games_abandoned'),
    uniquePlayers: uniquePlayers(agg, from, to, game),
    minutesPlayed: round1(m('minutes_played')),
  };
}

/** Bucket labels covering the window, in order. */
function bucketsOf(w: Window): string[] {
  if (w.bucket === 'hour') {
    return eachDay(w.from, w.to).flatMap((d) =>
      Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}`),
    );
  }
  const bucket = w.bucket;
  return [...new Set(eachDay(w.from, w.to).map((d) => bucketOf(d, bucket)))];
}

export function series(
  agg: Agg,
  w: Window,
  metric: StatsTimeseriesMetric,
  gameIds: readonly string[],
  game?: string,
): SeriesPoint[] {
  const games = game ? [game] : gameIds;
  const points = new Map<string, Record<string, number>>();
  for (const t of bucketsOf(w))
    points.set(t, Object.fromEntries([...games, '_all'].map((g) => [g, 0])));
  const add = (t: string, g: string, v: number) => {
    const p = points.get(t);
    if (!p) return;
    p[g] = (p[g] ?? 0) + v;
    p._all = (p._all ?? 0) + v;
  };
  const hourBucket = w.bucket === 'hour';
  if (metric === 'players_unique' && !hourBucket) {
    const sets = new Map<string, Set<string>>();
    const mark = (k: string, id: string) => {
      let s = sets.get(k);
      if (!s) sets.set(k, (s = new Set()));
      s.add(id);
    };
    for (const { parts } of rows(agg.players, w.from, w.to, game)) {
      if (parts[3] !== 'max.active') continue;
      const t = bucketOf(parts[0]!, w.bucket as Exclude<typeof w.bucket, 'hour'>);
      mark(`${t}\u0001${parts[1]}`, parts[2]!);
      mark(`${t}\u0001_all`, parts[2]!);
    }
    for (const [k, ids] of sets) {
      const [t, g] = k.split('\u0001') as [string, string];
      const p = points.get(t);
      if (p) p[g] = ids.size;
    }
  } else {
    // Hourly unique players add up per game: someone in two games in one hour counts twice.
    for (const { parts, value } of rows(agg.daily, w.from, w.to, game)) {
      const [day, g, m] = parts as [string, string, string];
      if (hourBucket) {
        const hour = /^h\.(\d\d)\.(.+)$/.exec(m);
        if (hour?.[2] === metric) add(`${day}T${hour[1]}`, g, value);
      } else if (m === metric) {
        add(bucketOf(day, w.bucket as Exclude<typeof w.bucket, 'hour'>), g, value);
      }
    }
  }
  return [...points].map(([t, values]) => ({
    t,
    values: Object.fromEntries(Object.entries(values).map(([g, v]) => [g, round1(v)])),
  }));
}

function calendar(agg: Agg, from: string, to: string, game?: string) {
  const perDay = new Map(eachDay(from, to).map((d) => [d, 0]));
  for (const { parts, value } of rows(agg.daily, from, to, game))
    if (parts[2] === 'games_started') perDay.set(parts[0]!, (perDay.get(parts[0]!) ?? 0) + value);
  return [...perDay].map(([day, games]) => ({ day, games }));
}

function weekHour(agg: Agg, from: string, to: string, game?: string) {
  const grid = Array.from({ length: 7 * 24 }, (_, i) => ({
    weekday: Math.floor(i / 24),
    hour: i % 24,
    games: 0,
  }));
  for (const { parts, value } of rows(agg.daily, from, to, game)) {
    const hour = /^h\.(\d\d)\.games_started$/.exec(parts[2]!);
    if (hour) grid[weekday(parts[0]!) * 24 + Number(hour[1])]!.games += value;
  }
  return grid;
}

export function heatmap(agg: Agg, w: Window, game?: string): StatsHeatmap {
  return {
    window: w,
    calendar: calendar(agg, w.from, w.to, game),
    weekHour: weekHour(agg, w.from, w.to, game),
  };
}

export function overview(agg: Agg, w: Window, ctx: ReportContext): StatsOverview {
  return {
    window: w,
    totals: totals(agg, w.from, w.to),
    previous: totals(agg, w.previousFrom, w.previousTo),
    activity: series(agg, w, 'games_started', ctx.gameIds),
    calendar: calendar(agg, w.from, w.to),
    weekHour: weekHour(agg, w.from, w.to),
    gameMix: ctx.gameIds
      .map((gameId) => ({
        gameId,
        games: sumMetric(agg, w.from, w.to, 'games_started', gameId),
        minutes: round1(sumMetric(agg, w.from, w.to, 'minutes_played', gameId)),
      }))
      .sort((a, b) => b.games - a.games || b.minutes - a.minutes),
    games: ctx.gameIds.map((id) => ({ id, name: ctx.gameName(id) })),
  };
}

function averages(agg: Agg, w: Window, gameId: string) {
  const m = (metric: string) => sumMetric(agg, w.from, w.to, metric, gameId);
  const ended = m('games_finished') + m('games_abandoned');
  const started = m('games_started');
  return {
    averageMinutes: ended ? round1(m('minutes_played') / ended) : 0,
    averagePlayers: started ? round1(m('players_sum') / started) : 0,
  };
}

export function games(agg: Agg, w: Window, ctx: ReportContext): StatsGames {
  return {
    window: w,
    games: ctx.gameIds.map((gameId) => ({
      gameId,
      totals: totals(agg, w.from, w.to, gameId),
      ...averages(agg, w, gameId),
    })),
  };
}

export function settings(agg: Agg, w: Window, gameId: string, ctx: ReportContext) {
  const counts = new Map<string, number>();
  for (const { parts, value } of rows(agg.settings, w.from, w.to, gameId)) {
    const k = `${parts[2]}\u0001${parts[3]}`;
    counts.set(k, (counts.get(k) ?? 0) + value);
  }
  return [...counts]
    .map(([k, n]) => {
      const [name, value] = k.split('\u0001') as [string, string];
      return { key: name, value, label: ctx.label(name, value), games: n };
    })
    .sort((a, b) => a.key.localeCompare(b.key) || b.games - a.games);
}

export function settingsResponse(
  agg: Agg,
  w: Window,
  gameId: string,
  ctx: ReportContext,
): StatsSettings {
  return { gameId, window: w, settings: settings(agg, w, gameId, ctx) };
}

export function game(agg: Agg, w: Window, gameId: string, ctx: ReportContext): GameStats {
  const counters = new Map<string, number>();
  const playerCounts = new Map<number, number>();
  for (const { parts, value } of rows(agg.daily, w.from, w.to, gameId)) {
    const m = parts[2]!;
    if (m.startsWith('f.') || m.startsWith('max.f.')) {
      const prev = counters.get(m);
      counters.set(
        m,
        prev === undefined ? value : m.startsWith('max.') ? Math.max(prev, value) : prev + value,
      );
    } else if (m.startsWith('players_n.')) {
      const n = Number(m.slice(10));
      playerCounts.set(n, (playerCounts.get(n) ?? 0) + value);
    }
  }
  return {
    gameId,
    window: w,
    totals: totals(agg, w.from, w.to, gameId),
    activity: series(agg, w, 'games_started', ctx.gameIds, gameId),
    ...averages(agg, w, gameId),
    playerCounts: [...playerCounts]
      .sort(([a], [b]) => a - b)
      .map(([players, n]) => ({ players, games: n })),
    settings: settings(agg, w, gameId, ctx),
    figures: buildFigures(gameId, (m) => counters.get(m) ?? 0, counters.keys()),
  };
}

export function words(
  agg: Agg,
  w: Window,
  gameId: string,
  kind: WordKind,
  limit: number,
): StatsWords {
  return { gameId, kind, window: w, words: topWords(agg, w, gameId, kind, limit) };
}

function topWords(agg: Agg, w: Window, gameId: string, kind: string, limit: number) {
  const counts = new Map<string, number>();
  for (const { parts, value } of rows(agg.words, w.from, w.to, gameId))
    if (parts[2] === kind) counts.set(parts[3]!, (counts.get(parts[3]!) ?? 0) + value);
  return [...counts]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, limit)
    .map(([word, count]) => ({ word, count }));
}

// ---- Players ----

interface PlayerTotals {
  games: number;
  wins: number;
  minutes: number;
  byGame: Record<string, number>;
  actMs: number;
  actN: number;
  assassins: number;
  echoes: number;
  fooled: number;
  perfect: number;
  guardHits: number;
  princessFalls: number;
  /** Inquest: cases this player solved. */
  casesSolved: number;
  /** Séance: cards this player found on the first try. */
  firstSight: number;
  disguises: number;
  bloodhound: number;
  suspected: number;
  /** Nightfall's fun-fact counters, by metric without the `nf.` prefix. */
  nightfall: Record<string, number>;
  /** Round Table's fun-fact counters, by metric without the `rt.` prefix. */
  roundTable: Record<string, number>;
  calendar: Map<string, number>;
}

function playerTotals(agg: Agg, from: string, to: string, only?: string) {
  const out = new Map<string, PlayerTotals>();
  for (const { parts, value } of rows(agg.players, from, to)) {
    const [day, game, id, metric] = parts as [string, string, string, string];
    if (only !== undefined && id !== only) continue;
    let t = out.get(id);
    if (!t) out.set(id, (t = emptyTotals()));
    switch (metric) {
      case 'games':
        t.games += value;
        t.byGame[game] = (t.byGame[game] ?? 0) + value;
        t.calendar.set(day, (t.calendar.get(day) ?? 0) + value);
        break;
      case 'wins':
        t.wins += value;
        break;
      case 'minutes':
        t.minutes += value;
        break;
      case 'act_ms':
        t.actMs += value;
        break;
      case 'act_n':
        t.actN += value;
        break;
      case 'assassins':
        t.assassins += value;
        break;
      case 'echoes':
        t.echoes += value;
        break;
      case 'fooled':
        t.fooled += value;
        break;
      case 'perfect':
        t.perfect += value;
        break;
      case 'guard_hits':
        t.guardHits += value;
        break;
      case 'princess_falls':
        t.princessFalls += value;
        break;
      case 'cases_solved':
        t.casesSolved += value;
        break;
      case 'first_sight':
        t.firstSight += value;
        break;
      case 'disguises':
        t.disguises += value;
        break;
      case 'bloodhound':
        t.bloodhound += value;
        break;
      case 'suspected':
        t.suspected += value;
        break;
      default:
        if (metric.startsWith('nf.'))
          t.nightfall[metric.slice(3)] = (t.nightfall[metric.slice(3)] ?? 0) + value;
        else if (metric.startsWith('rt.'))
          t.roundTable[metric.slice(3)] = (t.roundTable[metric.slice(3)] ?? 0) + value;
    }
  }
  return out;
}

function summary(id: string, t: PlayerTotals, info: PlayerInfo | undefined): PlayerSummary {
  return {
    id,
    name: info?.name || 'Someone',
    aliases: info?.names.map((n) => n.name) ?? [],
    firstSeen: info?.firstSeen ?? 0,
    lastSeen: info?.lastSeen ?? 0,
    games: t.games,
    wins: t.wins,
    minutes: round1(t.minutes),
    byGame: t.byGame,
  };
}

export function players(agg: Agg, w: Window, ctx: ReportContext): StatsPlayers {
  const all = playerTotals(agg, w.from, w.to);
  const info = ctx.players([...all.keys()]);
  return {
    window: w,
    players: [...all]
      .map(([id, t]) => summary(id, t, info.get(id)))
      .sort((a, b) => b.games - a.games || b.minutes - a.minutes || b.lastSeen - a.lastSeen),
  };
}

export function player(agg: Agg, w: Window, id: string, ctx: ReportContext): PlayerProfile | null {
  const info = ctx.players([id]).get(id);
  if (!info) return null;
  return profile(agg, w, id, playerTotals(agg, w.from, w.to, id).get(id), info, ctx);
}

function emptyTotals(): PlayerTotals {
  return {
    games: 0,
    wins: 0,
    minutes: 0,
    byGame: {},
    actMs: 0,
    actN: 0,
    assassins: 0,
    echoes: 0,
    fooled: 0,
    perfect: 0,
    guardHits: 0,
    princessFalls: 0,
    casesSolved: 0,
    firstSight: 0,
    disguises: 0,
    bloodhound: 0,
    suspected: 0,
    nightfall: {},
    roundTable: {},
    calendar: new Map(),
  };
}

function profile(
  agg: Agg,
  w: Window,
  id: string,
  t: PlayerTotals | undefined,
  info: PlayerInfo,
  ctx: ReportContext,
): PlayerProfile {
  const totalsFor = t ?? emptyTotals();
  const facts = funFacts(agg, w, ctx).filter((f) => f.playerId === id);
  const [favourite] = Object.entries(totalsFor.byGame).sort(([, a], [, b]) => b - a);
  if (favourite && favourite[1] > 0) {
    facts.push({
      id: 'favourite-game',
      title: 'Favourite game',
      text: `Played ${ctx.gameName(favourite[0])} most (${plural(favourite[1], 'game')})`,
      gameId: favourite[0],
      playerId: id,
      value: favourite[1],
    });
  }
  if (totalsFor.actN >= MIN_GUESSES && !facts.some((f) => f.id === 'fastest-guesser')) {
    const s = round1(totalsFor.actMs / totalsFor.actN / 1000);
    facts.push({
      id: 'guess-speed',
      title: 'Guess speed',
      text: `Guessed in ${s} s on average`,
      playerId: id,
      value: s,
    });
  }
  return {
    ...summary(id, totalsFor, info),
    names: info.names,
    calendar: [...totalsFor.calendar]
      .filter(([, games]) => games > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, games]) => ({ day, games })),
    facts,
  };
}

// ---- Fun ----

/** Guesses needed before someone can be the fastest guesser. */
const MIN_GUESSES = 3;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const times = (n: number) => (n === 1 ? 'once' : `${n} times`);

/** The player with the highest `score` (ties go to the earliest name), if any scored above 0. */
function best(
  all: Map<string, PlayerTotals>,
  score: (t: PlayerTotals) => number | null,
  names: Map<string, PlayerInfo>,
) {
  let top: { id: string; value: number } | null = null;
  for (const [id, t] of all) {
    const value = score(t);
    if (value === null || value <= 0) continue;
    const better =
      !top ||
      value > top.value ||
      (value === top.value && (names.get(id)?.name ?? '') < (names.get(top.id)?.name ?? ''));
    if (better) top = { id, value };
  }
  return top;
}

export function funFacts(agg: Agg, w: Window, ctx: ReportContext): FunFact[] {
  const all = playerTotals(agg, w.from, w.to);
  const info = ctx.players([...all.keys()]);
  const name = (id: string) => info.get(id)?.name || 'Someone';
  const facts: FunFact[] = [];
  const byPlayer = (
    id: string,
    title: string,
    score: (t: PlayerTotals) => number | null,
    text: (who: string, value: number) => string,
    gameId?: string,
  ) => {
    const top = best(all, score, info);
    if (!top) return;
    facts.push({
      id,
      title,
      text: text(name(top.id), top.value),
      playerId: top.id,
      value: top.value,
      ...(gameId ? { gameId } : {}),
    });
  };
  byPlayer(
    'most-games',
    'Regular',
    (t) => t.games,
    (who, n) => `${who} played ${plural(n, 'game')}`,
  );
  byPlayer(
    'most-wins',
    'Champion',
    (t) => t.wins,
    (who, n) => `${who} won ${plural(n, 'game')}`,
  );
  // Fastest means the smallest average, so score by its inverse.
  const fastest = best(
    all,
    (t) => (t.actN >= MIN_GUESSES ? 1 / (t.actMs / t.actN + 1) : null),
    info,
  );
  if (fastest) {
    const t = all.get(fastest.id)!;
    const s = round1(t.actMs / t.actN / 1000);
    facts.push({
      id: 'fastest-guesser',
      title: 'Fastest guesser',
      text: `${name(fastest.id)} guessed in ${s} s on average`,
      playerId: fastest.id,
      value: s,
    });
  }
  byPlayer(
    'the-echo',
    'The echo',
    (t) => t.echoes,
    (who, n) => `${who}'s clues matched someone else's ${times(n)}`,
    'echo',
  );
  byPlayer(
    'assassin-magnet',
    'Assassin magnet',
    (t) => t.assassins,
    (who, n) => `${who} found the assassin ${times(n)}`,
    'codenames',
  );
  byPlayer(
    'best-liar',
    'Best liar',
    (t) => t.fooled,
    (who, n) => `${who}'s lies fooled ${plural(n, 'player')}`,
    'hoodwink',
  );
  byPlayer(
    'lucky-guesser',
    'Lucky guesser',
    (t) => t.guardHits,
    (who, n) => `${who} named the right card with a Guard ${times(n)}`,
    'royal-post',
  );
  byPlayer(
    'princess-fumbler',
    'Princess fumbler',
    (t) => t.princessFalls,
    (who, n) => `${who} was knocked out holding the Princess ${times(n)}`,
    'royal-post',
  );
  byPlayer(
    'case-closer',
    'Case closer',
    (t) => t.casesSolved,
    (who, n) => `${who} named the killer’s exact cards ${times(n)}`,
    'inquest',
  );
  byPlayer(
    'first-sight',
    'First sight',
    (t) => t.firstSight,
    (who, n) => `${who} read a ghost’s vision right the first time ${times(n)}`,
    'seance',
  );
  byPlayer(
    'master-of-disguise',
    'Master of disguise',
    (t) => t.disguises,
    (who, n) => `${who} won ${plural(n, 'round')} as the spy`,
    'masquerade',
  );
  byPlayer(
    'bloodhound',
    'Bloodhound',
    (t) => t.bloodhound,
    (who, n) => `${who} voted for the real spy ${times(n)}`,
    'masquerade',
  );
  byPlayer(
    'usual-suspect',
    'Usual suspect',
    (t) => t.suspected,
    (who, n) => `${who} drew ${plural(n, 'vote')} as a suspected spy`,
    'masquerade',
  );
  const nf = (key: string) => (t: PlayerTotals) => t.nightfall[key] ?? 0;
  const NIGHTFALL_FACTS: [string, string, string, (who: string, n: number) => string][] = [
    [
      'lone-wolf',
      'Lone Wolf',
      'lone_wolf',
      (who, n) => `${who} survived as the only werewolf ${times(n)}`,
    ],
    [
      'tanners-dream',
      'Tanner’s Dream',
      'tanner_dream',
      (who, n) => `${who} won by dying as the Tanner ${times(n)}`,
    ],
    [
      'identity-crisis',
      'Identity Crisis',
      'identity_crisis',
      (who, n) => `${who} woke up on a different team ${times(n)}`,
    ],
    [
      'didnt-see-that-coming',
      'Didn’t See That Coming',
      'blindsided',
      (who, n) =>
        `${who} was switched to the other side and voted against a new teammate ${times(n)}`,
    ],
    [
      'hunters-revenge',
      'Hunter’s Revenge',
      'hunter_shots',
      (who, n) => `${who} took ${plural(n, 'player')} down with them as the Hunter`,
    ],
    [
      'bodyguard-hero',
      'Bodyguard Hero',
      'bodyguard_save',
      (who, n) => `${who} saved the player the vote would have killed ${times(n)}`,
    ],
    [
      'werewolf-whisperer',
      'Werewolf Whisperer',
      'wolf_votes',
      (who, n) => `${who} voted for a real werewolf ${times(n)}`,
    ],
    [
      'most-paranoid',
      'Most Paranoid',
      'village_votes',
      (who, n) => `${who} voted for a villager ${times(n)}`,
    ],
    [
      'village-idiot',
      'Village Idiot',
      'village_death',
      (who, n) => `${who} was voted out as a villager ${times(n)}`,
    ],
    [
      'master-thief',
      'Master Thief',
      'cards_moved',
      (who, n) => `${who} moved ${plural(n, 'card')} at night`,
    ],
    [
      'fang-fan',
      'Fang Fan',
      'vampire',
      (who, n) => `${who} ended ${plural(n, 'game')} as a Vampire`,
    ],
    [
      'heartbreaker',
      'Heartbreaker',
      'heartbreaks',
      (who, n) => `${who} dragged ${plural(n, 'lover')} to the grave`,
    ],
    [
      'plague-bearer',
      'Plague Bearer',
      'plague',
      (who, n) => `${plural(n, 'voter')} lost the game by voting for ${who}’s Disease`,
    ],
    [
      'hitman',
      'Hitman',
      'hitman',
      (who, n) => `${who} saw their Assassin’s target die ${times(n)}`,
    ],
    [
      'abducted',
      'Abducted',
      'abducted',
      (who, n) => `${who} was taken over by the aliens ${times(n)}`,
    ],
    [
      'little-green',
      'Little Green',
      'alien',
      (who, n) => `${who} ended ${plural(n, 'game')} as an Alien`,
    ],
  ];
  for (const [id, title, key, text] of NIGHTFALL_FACTS)
    byPlayer(id, title, nf(key), text, 'nightfall');
  byPlayer(
    'most-suspected',
    'Most suspected',
    (t) => t.roundTable.suspected ?? 0,
    (who, n) => `${who} drew ${plural(n, 'Reject vote')} on Round Table teams`,
    'round-table',
  );
  let streak = 0;
  for (const { parts, value } of rows(agg.daily, w.from, w.to))
    if (parts[1] === 'round-table' && parts[2] === 'max.f.streak' && value > streak) streak = value;
  if (streak >= 2) {
    facts.push({
      id: 'longest-hammer-streak',
      title: 'Longest hammer streak',
      text: `${plural(streak, 'Round Table team')} rejected in a row`,
      gameId: 'round-table',
      value: streak,
    });
  }
  const perfect = sumMetric(agg, w.from, w.to, 'f.perfect', 'echo');
  if (perfect > 0) {
    facts.push({
      id: 'perfect-echo',
      title: 'Perfect Echo games',
      text: `${plural(perfect, 'perfect Echo game')}, every card scored`,
      gameId: 'echo',
      value: perfect,
    });
  }
  let longest: { gameId: string; ms: number } | null = null;
  for (const { parts, value } of rows(agg.daily, w.from, w.to))
    if (parts[2] === 'max.longest_ms' && value > (longest?.ms ?? 0))
      longest = { gameId: parts[1]!, ms: value };
  if (longest) {
    const minutes = Math.max(1, Math.round(longest.ms / 60_000));
    facts.push({
      id: 'longest-game',
      title: 'Marathon',
      text: `The longest game was a ${minutes}-minute game of ${ctx.gameName(longest.gameId)}`,
      gameId: longest.gameId,
      value: minutes,
    });
  }
  const topWord = (
    id: string,
    title: string,
    gameId: string,
    kind: string,
    text: (w: string, n: number) => string,
  ) => {
    const [top] = topWords(agg, w, gameId, kind, 1);
    if (top) facts.push({ id, title, text: text(top.word, top.count), gameId, value: top.count });
  };
  topWord(
    'top-clue',
    'Favourite clue',
    'codenames',
    'clue',
    (word, n) => `"${word}" was given as a clue ${times(n)}`,
  );
  topWord(
    'riskiest-word',
    'Riskiest word',
    'codenames',
    'assassin',
    (word, n) => `"${word}" was the assassin ${times(n)}`,
  );
  topWord(
    'great-minds',
    'Great minds',
    'echo',
    'cancelled',
    (word, n) => `"${word}" cancelled itself out ${times(n)}`,
  );
  topWord(
    'most-convincing-lie',
    'Most convincing lie',
    'hoodwink',
    FOOLED_KIND,
    (word, n) => `"${word}" fooled ${plural(n, 'player')}`,
  );
  topWord(
    'trickiest-location',
    'Trickiest location',
    'masquerade',
    TRICKY_KIND,
    (word, n) => `The spy won at "${word}" ${times(n)}`,
  );
  return facts;
}

export function fun(agg: Agg, w: Window, ctx: ReportContext): StatsFun {
  const shared = ['copy', 'share', 'image'].reduce(
    (sum, how) => sum + sumMetric(agg, w.from, w.to, `recaps_shared.${how}`),
    0,
  );
  return {
    window: w,
    facts: funFacts(agg, w, ctx),
    recaps: { viewed: sumMetric(agg, w.from, w.to, 'recaps_viewed'), shared },
  };
}

export function timeseries(
  agg: Agg,
  w: Window,
  metric: StatsTimeseriesMetric,
  ctx: ReportContext,
  game?: string,
): StatsTimeseries {
  return { window: w, metric, series: series(agg, w, metric, ctx.gameIds, game) };
}
