import { STATS_BUCKETS, STATS_RANGES, type StatsBucket, type StatsRange } from '@vt/protocol';

// The stats page keeps all of its state in the URL query, so a view can be bookmarked, shared
// with the other admin, and survives a reload.

export const STATS_TABS = ['live', 'overview', 'games', 'players', 'fun'] as const;
export type StatsTab = (typeof STATS_TABS)[number];

export const TAB_LABELS: Record<StatsTab, string> = {
  live: 'Live',
  overview: 'Overview',
  games: 'Games',
  players: 'Players',
  fun: 'Fun',
};

export const RANGE_LABELS: Record<StatsRange, string> = {
  today: 'Today',
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  '1y': '1 year',
  all: 'All time',
  custom: 'Custom',
};

export const BUCKET_LABELS: Record<StatsBucket, string> = {
  hour: 'By hour',
  day: 'By day',
  week: 'By week',
  month: 'By month',
};

export interface StatsParams {
  tab: StatsTab;
  range: StatsRange;
  /** Only for `custom`: inclusive UTC days. */
  from?: string;
  to?: string;
  bucket: StatsBucket;
  /** Games tab: the selected game id. */
  game?: string;
  /** Players tab: the open profile. */
  player?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

export const todayUtc = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Inclusive length of a day range, in days. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

const isDay = (v: string | null | undefined): v is string =>
  !!v && DAY.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** Roughly how many days a preset covers; `all` is treated as long. */
function spanDays(range: StatsRange, from?: string, to?: string): number {
  switch (range) {
    case 'today':
      return 1;
    case '7d':
      return 7;
    case '30d':
      return 30;
    case '90d':
      return 90;
    case '1y':
      return 365;
    case 'all':
      return 10_000;
    case 'custom':
      return from && to ? daysBetween(from, to) : 30;
  }
}

/**
 * Buckets that make sense for a window: enough points to show a shape, few enough to read
 * on a phone. The first one is the default.
 */
export function bucketsFor(range: StatsRange, from?: string, to?: string): StatsBucket[] {
  const days = spanDays(range, from, to);
  if (days <= 2) return ['hour', 'day'];
  if (days <= 7) return ['day', 'hour'];
  if (days <= 31) return ['day', 'week'];
  if (days <= 180) return ['day', 'week', 'month'];
  if (days <= 400) return ['week', 'month', 'day'];
  return ['month', 'week'];
}

export function parseParams(search: URLSearchParams, now = Date.now()): StatsParams {
  const tabRaw = search.get('tab');
  const tab = (STATS_TABS as readonly string[]).includes(tabRaw ?? '')
    ? (tabRaw as StatsTab)
    : 'live';
  const rangeRaw = search.get('range');
  const range = (STATS_RANGES as readonly string[]).includes(rangeRaw ?? '')
    ? (rangeRaw as StatsRange)
    : '30d';
  let from: string | undefined;
  let to: string | undefined;
  if (range === 'custom') {
    const f = search.get('from');
    const t = search.get('to');
    if (isDay(f) && isDay(t)) [from, to] = f <= t ? [f, t] : [t, f];
    else {
      to = todayUtc(now);
      from = addDays(to, -29);
    }
  }
  const allowed = bucketsFor(range, from, to);
  const bucketRaw = search.get('bucket');
  const bucket =
    (STATS_BUCKETS as readonly string[]).includes(bucketRaw ?? '') &&
    allowed.includes(bucketRaw as StatsBucket)
      ? (bucketRaw as StatsBucket)
      : allowed[0]!;
  if (range !== 'custom') {
    from = undefined;
    to = undefined;
  }
  const game = search.get('game') || undefined;
  const player = search.get('player') || undefined;
  return { tab, range, from, to, bucket, game, player };
}

/** The URL query for a state, leaving out defaults so links stay short. */
export function writeParams(p: StatsParams): URLSearchParams {
  const out = new URLSearchParams();
  if (p.tab !== 'live') out.set('tab', p.tab);
  if (p.range !== '30d') out.set('range', p.range);
  if (p.range === 'custom' && p.from && p.to) {
    out.set('from', p.from);
    out.set('to', p.to);
  }
  if (p.bucket !== bucketsFor(p.range, p.from, p.to)[0]) out.set('bucket', p.bucket);
  if (p.tab === 'games' && p.game) out.set('game', p.game);
  if (p.tab === 'players' && p.player) out.set('player', p.player);
  return out;
}

/** Applies a change and keeps the bucket valid for the (possibly new) range. */
export function updateParams(p: StatsParams, change: Partial<StatsParams>): StatsParams {
  const next = { ...p, ...change };
  if (next.range !== 'custom') {
    next.from = undefined;
    next.to = undefined;
  }
  const allowed = bucketsFor(next.range, next.from, next.to);
  // A new range starts on its own default bucket unless the change picks one.
  const rangeChanged = change.range !== undefined && change.range !== p.range;
  if ((rangeChanged && change.bucket === undefined) || !allowed.includes(next.bucket)) {
    next.bucket = allowed[0]!;
  }
  return next;
}

/** The query string the historical endpoints take (`statsQuery` in the protocol). */
export function apiQuery(p: Pick<StatsParams, 'range' | 'from' | 'to' | 'bucket'>): string {
  const q = new URLSearchParams({ range: p.range });
  if (p.range === 'custom' && p.from && p.to) {
    q.set('from', p.from);
    q.set('to', p.to);
  }
  q.set('bucket', p.bucket);
  return q.toString();
}
