import type { StatsBucket } from '@vt/protocol';

const compactFmt = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const plainFmt = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

/** 1,284 → "1.3K"; below 1,000 numbers stay exact (with at most one decimal). */
export const compact = (n: number) =>
  Math.abs(n) >= 1000 ? compactFmt.format(n) : plainFmt.format(n);

export const plain = (n: number) => plainFmt.format(n);

/** A 0–1 share as a whole percent, e.g. 0.537 → "54%". */
export const percent = (share: number) => `${Math.round(share * 100)}%`;

/** Minutes as hours with one decimal: 754 → "12.6". */
export const hours = (minutes: number) => plainFmt.format(minutes / 60);

/** A length of time: "45 s", "12 min", "1 h 05 min". */
export function duration(minutes: number): string {
  if (minutes < 1) return `${Math.round(minutes * 60)} s`;
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes - h * 60);
  return `${h} h ${String(m).padStart(2, '0')} min`;
}

export type DeltaDirection = 'up' | 'down' | 'flat' | 'new';

export interface Delta {
  direction: DeltaDirection;
  text: string;
}

/** Change against the previous window, as a signed percent ("+12%"), or "new" from zero. */
export function delta(current: number, previous: number): Delta {
  if (previous === 0) {
    return current === 0 ? { direction: 'flat', text: '±0%' } : { direction: 'new', text: 'new' };
  }
  const change = (current - previous) / previous;
  const rounded = Math.round(change * 100);
  if (rounded === 0) return { direction: 'flat', text: '±0%' };
  return {
    direction: rounded > 0 ? 'up' : 'down',
    text: `${rounded > 0 ? '+' : '−'}${Math.abs(rounded)}%`,
  };
}

/** Change between two shares, in percentage points ("+4 pts"). */
export function pointsDelta(current: number, previous: number): Delta {
  const pts = Math.round((current - previous) * 100);
  if (pts === 0) return { direction: 'flat', text: '±0 pts' };
  return { direction: pts > 0 ? 'up' : 'down', text: `${pts > 0 ? '+' : '−'}${Math.abs(pts)} pts` };
}

/** "just now", "4 min ago", "3 h ago", "2 days ago". */
export function ago(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

/** An age without "ago": "12 min", "3 h". */
export function age(since: number, now: number): string {
  const m = Math.max(0, Math.round((now - since) / 60_000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return h < 48 ? `${h} h` : `${Math.floor(h / 24)} days`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-09" → "Oct 9". */
export function shortDay(day: string): string {
  const [, m, d] = day.split('-');
  return `${MONTHS[Number(m) - 1]} ${Number(d)}`;
}

/** "2026-10-09" → "Oct 9, 2026". */
export function longDay(day: string): string {
  return `${shortDay(day)}, ${day.slice(0, 4)}`;
}

/*
 * Data and day buckets are UTC; times of day show in the viewer's time zone. `timeZone` is left
 * out in the app (the browser's own) and fixed in tests.
 */

const zoned = (ts: number, timeZone?: string) => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(ts);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '00';
  return {
    day: `${part('year')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  };
};

/** The viewer's local time of a moment: "21:05". */
export const clock = (ts: number, timeZone?: string) => zoned(ts, timeZone).time;

/** The viewer's local day of a moment: "2026-10-09". */
export const localDay = (ts: number, timeZone?: string) => zoned(ts, timeZone).day;

/** The viewer's local date of a moment: "Oct 9, 2026". */
export const dateOf = (ts: number, timeZone?: string) => longDay(localDay(ts, timeZone));

/** The time zone's short name: "GMT+7", "UTC", "PDT". */
export function zoneName(ts: number, timeZone?: string): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
    .formatToParts(ts)
    .find((p) => p.type === 'timeZoneName')?.value;
  return !name || name === 'GMT' ? 'UTC' : name;
}

/** How far the time zone is ahead of UTC at `ts`, in minutes. */
export function zoneOffset(ts: number, timeZone?: string): number {
  const { day, time } = zoned(ts, timeZone);
  const local = Date.parse(`${day}T${time}:00Z`);
  return Math.round((local - Math.floor(ts / 60_000) * 60_000) / 60_000);
}

/** The start of an hour bucket ("2026-10-09T14") as a moment. */
const hourStart = (t: string) => {
  const [day, hour] = t.split('T');
  return Date.parse(`${day}T${(hour ?? '00').padStart(2, '0')}:00:00Z`);
};

/** Whether a series' labels need the day: its buckets fall on more than one (local, for hours) day. */
export function spansDays(ts: readonly string[], bucket: StatsBucket, timeZone?: string): boolean {
  if (ts.length === 0) return false;
  const dayOf = (t: string) =>
    bucket === 'hour' ? localDay(hourStart(t), timeZone) : t.slice(0, 10);
  return dayOf(ts[0]!) !== dayOf(ts[ts.length - 1]!);
}

/**
 * A series bucket label: hours show the viewer's local time (with the day when the window spans
 * several), days and weeks the (UTC) day, months the month and year.
 */
export function bucketLabel(
  t: string,
  bucket: StatsBucket,
  multiDay = false,
  timeZone?: string,
): string {
  if (bucket === 'hour') {
    const { day, time } = zoned(hourStart(t), timeZone);
    return multiDay ? `${shortDay(day)} ${time}` : time;
  }
  if (bucket === 'month') {
    const [y, m] = t.split('-');
    return `${MONTHS[Number(m) - 1]} ${y}`;
  }
  return shortDay(t.slice(0, 10));
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Escapes text for the HTML strings ECharts tooltips take. Labels are untrusted data. */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
