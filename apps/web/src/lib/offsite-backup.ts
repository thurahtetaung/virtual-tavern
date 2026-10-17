import type { OffsiteBackupStatus } from '@vt/protocol';
import { clock, dateOf, zoneName } from '../stats/format.ts';

/** 981898 → "959 KB", 1963796 → "1.9 MB". */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let n = bytes / 1024;
  let unit = 0;
  while (n >= 1024 && unit < units.length - 1) {
    n /= 1024;
    unit++;
  }
  return `${n < 10 ? n.toFixed(1) : Math.round(n)} ${units[unit]}`;
}

/** "Oct 17, 2026, 10:40 GMT+7", in the viewer's time zone (fixed in tests). */
const when = (iso: string, timeZone?: string) => {
  const ts = Date.parse(iso);
  return `${dateOf(ts, timeZone)}, ${clock(ts, timeZone)} ${zoneName(ts, timeZone)}`;
};

/** The admin page's one line about the nightly off-site copy, and whether it is a warning. */
export function offsiteLine(
  status: OffsiteBackupStatus,
  timeZone?: string,
): { warn: boolean; text: string } {
  if (!status.recorded) return { warn: false, text: 'No offsite backup recorded yet.' };
  const at = when(status.at, timeZone);
  if (!status.ok) {
    const why = status.error ?? 'no reason given';
    return { warn: true, text: `Last offsite backup failed (${at}): ${why}` };
  }
  const details = [
    status.bytes !== undefined && fileSize(status.bytes),
    status.copies !== undefined &&
      `${status.copies} ${status.copies === 1 ? 'copy' : 'copies'}` +
        (status.totalBytes !== undefined ? ` (${fileSize(status.totalBytes)})` : ''),
  ].filter(Boolean);
  const text = `Last offsite backup: ${[at, ...details].join(', ')}`;
  return status.stale
    ? { warn: true, text: `${text}. That is over 26 hours ago: the nightly copy may have stopped.` }
    : { warn: false, text };
}
