import { describe, expect, it } from 'vitest';
import {
  addDays,
  apiQuery,
  bucketsFor,
  daysBetween,
  parseParams,
  updateParams,
  writeParams,
} from './range.ts';

const NOW = Date.UTC(2026, 9, 10, 12);
const parse = (q: string) => parseParams(new URLSearchParams(q), NOW);

describe('stats URL state', () => {
  it('defaults to the live tab, 30 days by day', () => {
    expect(parse('')).toEqual({
      tab: 'live',
      range: '30d',
      bucket: 'day',
      from: undefined,
      to: undefined,
      game: undefined,
      player: undefined,
    });
  });

  it('ignores unknown tabs, ranges and buckets', () => {
    const p = parse('tab=nope&range=forever&bucket=decade');
    expect(p).toMatchObject({ tab: 'live', range: '30d', bucket: 'day' });
  });

  it('drops a bucket that does not suit the range', () => {
    expect(parse('range=1y&bucket=hour').bucket).toBe('week');
    expect(parse('range=today&bucket=month').bucket).toBe('hour');
    expect(parse('range=90d&bucket=month').bucket).toBe('month');
  });

  it('reads a custom range, swapping reversed days and filling missing ones', () => {
    expect(parse('range=custom&from=2026-10-05&to=2026-09-01')).toMatchObject({
      from: '2026-09-01',
      to: '2026-10-05',
      bucket: 'day',
    });
    expect(parse('range=custom&from=bad')).toMatchObject({ from: '2026-09-11', to: '2026-10-10' });
    expect(parse('range=7d&from=2026-01-01&to=2026-01-02')).toMatchObject({
      from: undefined,
      to: undefined,
    });
  });

  it('round-trips through the query, leaving out defaults', () => {
    const p = parse('tab=games&range=90d&bucket=week&game=echo');
    const q = writeParams(p);
    expect(q.toString()).toBe('tab=games&range=90d&bucket=week&game=echo');
    expect(parseParams(q, NOW)).toEqual(p);
    expect(writeParams(parse('')).toString()).toBe('');
  });

  it('keeps the game and player only on their own tabs', () => {
    const p = parse('tab=overview&game=echo&player=p1');
    expect(writeParams(p).toString()).toBe('tab=overview');
    expect(writeParams({ ...p, tab: 'players' }).toString()).toBe('tab=players&player=p1');
  });

  it('fixes the bucket when the range changes', () => {
    const p = parse('range=today');
    expect(p.bucket).toBe('hour');
    expect(updateParams(p, { range: '1y' }).bucket).toBe('week');
    expect(updateParams(p, { range: '7d' })).toMatchObject({ range: '7d', bucket: 'day' });
    const custom = updateParams(p, { range: 'custom', from: '2026-10-01', to: '2026-10-02' });
    expect(custom.bucket).toBe('hour');
    expect(updateParams(custom, { range: '30d' })).toMatchObject({
      from: undefined,
      to: undefined,
    });
  });

  it('builds the API query', () => {
    expect(apiQuery(parse('range=7d'))).toBe('range=7d&bucket=day');
    expect(apiQuery(parse('range=custom&from=2026-01-01&to=2026-03-31&bucket=month'))).toBe(
      'range=custom&from=2026-01-01&to=2026-03-31&bucket=month',
    );
  });

  it('counts days inclusively and adds days in UTC', () => {
    expect(daysBetween('2026-10-01', '2026-10-01')).toBe(1);
    expect(daysBetween('2026-02-01', '2026-03-01')).toBe(29);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(bucketsFor('custom', '2026-01-01', '2026-12-31')).toEqual(['week', 'month', 'day']);
    expect(bucketsFor('all')).toEqual(['month', 'week']);
  });
});
