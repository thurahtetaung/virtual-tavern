import type { StatsBucket, StatsRange, StatsWindow } from '@vt/protocol';

// Every day is a UTC 'YYYY-MM-DD' string; they sort and compare as plain strings.

const DAY_MS = 24 * 60 * 60_000;

export const dayOf = (ts: number) => new Date(ts).toISOString().slice(0, 10);
export const hourOf = (ts: number) => new Date(ts).getUTCHours();
const toMs = (day: string) => Date.parse(`${day}T00:00:00Z`);
export const addDays = (day: string, n: number) => dayOf(toMs(day) + n * DAY_MS);
/** Inclusive number of days from `from` to `to`. */
export const spanDays = (from: string, to: string) =>
  Math.round((toMs(to) - toMs(from)) / DAY_MS) + 1;
/** 0 = Monday … 6 = Sunday. */
export const weekday = (day: string) => (new Date(toMs(day)).getUTCDay() + 6) % 7;

export function eachDay(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** The bucket a day falls in: the day itself, its week's Monday, or the 1st of its month. */
export function bucketOf(day: string, bucket: Exclude<StatsBucket, 'hour'>): string {
  if (bucket === 'week') return addDays(day, -weekday(day));
  if (bucket === 'month') return `${day.slice(0, 7)}-01`;
  return day;
}

/** Longest window a custom range may ask for. */
export const MAX_SPAN_DAYS = 3660;
/** Hourly buckets beyond this many days fall back to daily ones. */
const MAX_HOURLY_DAYS = 31;

const LAST: Record<Exclude<StatsRange, 'all' | 'custom'>, number> = {
  today: 1,
  '7d': 7,
  '30d': 30,
  '90d': 90,
  '1y': 365,
};

function defaultBucket(days: number): StatsBucket {
  if (days <= 1) return 'hour';
  if (days <= 92) return 'day';
  if (days <= 366) return 'week';
  return 'month';
}

/**
 * Turns a range choice into concrete days, plus the equally long window just before it for
 * deltas. Returns a message instead when the request cannot be served.
 */
export function resolveWindow(
  q: { range: StatsRange; from?: string; to?: string; bucket?: StatsBucket },
  today: string,
  firstDay: string | null,
): StatsWindow | string {
  let from: string;
  let to = today;
  if (q.range === 'custom') {
    if (!q.from || !q.to) return 'A custom range needs from and to.';
    if (Number.isNaN(toMs(q.from)) || Number.isNaN(toMs(q.to))) return 'Use real dates.';
    from = q.from;
    to = q.to;
    if (from > to) return 'from must not be after to.';
    if (spanDays(from, to) > MAX_SPAN_DAYS) return 'That range is too long.';
  } else if (q.range === 'all') {
    from = firstDay && firstDay < today ? firstDay : today;
  } else {
    from = addDays(today, -(LAST[q.range] - 1));
  }
  const days = spanDays(from, to);
  let bucket = q.bucket ?? defaultBucket(days);
  if (bucket === 'hour' && days > MAX_HOURLY_DAYS) bucket = 'day';
  return {
    from,
    to,
    bucket,
    previousFrom: addDays(from, -days),
    previousTo: addDays(from, -1),
  };
}
