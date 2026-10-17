import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OffsiteBackupLine } from '../pages/AdminPage.tsx';
import { fileSize, offsiteLine } from './offsite-backup.ts';

const ok = {
  recorded: true as const,
  at: '2026-10-17T03:40:12Z',
  ok: true,
  key: 'tavern/2026-10-17.db.gz',
  bytes: 981898,
  copies: 2,
  totalBytes: 1963796,
  stale: false,
};

describe('the offsite backup line', () => {
  it('names the time in the viewer’s zone, the size and the copies', () => {
    expect(offsiteLine(ok, 'Asia/Bangkok')).toEqual({
      warn: false,
      text: 'Last offsite backup: Oct 17, 2026, 10:40 GMT+7, 959 KB, 2 copies (1.9 MB)',
    });
  });

  it('warns about a failed run with its error', () => {
    const line = offsiteLine(
      { recorded: true, at: ok.at, ok: false, error: 'upload timed out', stale: false },
      'UTC',
    );
    expect(line).toEqual({
      warn: true,
      text: 'Last offsite backup failed (Oct 17, 2026, 03:40 UTC): upload timed out',
    });
  });

  it('warns when the last success is too old', () => {
    const line = offsiteLine({ ...ok, stale: true }, 'UTC');
    expect(line.warn).toBe(true);
    expect(line.text).toContain('over 26 hours ago');
  });

  it('says when nothing is recorded', () => {
    expect(offsiteLine({ recorded: false })).toEqual({
      warn: false,
      text: 'No offsite backup recorded yet.',
    });
  });

  it('renders as a status, or as an alert when it warns', () => {
    const fine = renderToStaticMarkup(<OffsiteBackupLine status={ok} timeZone="UTC" />);
    expect(fine).toContain('role="status"');
    expect(fine).toContain('Last offsite backup: Oct 17, 2026, 03:40 UTC');
    const bad = renderToStaticMarkup(
      <OffsiteBackupLine status={{ ...ok, ok: false, error: 'nope' }} timeZone="UTC" />,
    );
    expect(bad).toContain('role="alert"');
  });

  it('sizes files in binary units', () => {
    expect(fileSize(512)).toBe('512 B');
    expect(fileSize(981898)).toBe('959 KB');
    expect(fileSize(1963796)).toBe('1.9 MB');
    expect(fileSize(5 * 1024 ** 3)).toBe('5.0 GB');
  });
});
