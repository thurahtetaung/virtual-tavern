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

export const dateOf = (ts: number) => longDay(new Date(ts).toISOString().slice(0, 10));

/**
 * A series bucket label: hours show the time (with the day when the window spans several),
 * days and weeks the day, months the month and year.
 */
export function bucketLabel(t: string, bucket: StatsBucket, multiDay = false): string {
  if (bucket === 'hour') {
    const [day, hour] = t.split('T');
    const time = `${(hour ?? '00').padStart(2, '0')}:00`;
    return multiDay && day ? `${shortDay(day)} ${time}` : time;
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
