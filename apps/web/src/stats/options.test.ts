/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- reading ECharts options back as JSON */
import type { SeriesPoint } from '@vt/protocol';
import { describe, expect, it } from 'vitest';
import {
  activityTable,
  barsOption,
  calendarOption,
  columnsOption,
  heatPieces,
  isEmptySeries,
  localWeekHour,
  sparklineOption,
  stackedActivityOption,
  topOfStack,
  tooltipRow,
  weekHourOption,
  weekHourTable,
} from './options.ts';
import { gameSlots, slotColor, slotFor, tokensFor } from './palette.ts';

// Hour labels and times show in the browser's zone; pin it so the expectations hold anywhere.
process.env.TZ = 'UTC';

const light = tokensFor('light');
const dark = tokensFor('dark');

const points: SeriesPoint[] = [
  { t: '2026-10-08', values: { codenames: 2, echo: 1, _all: 3 } },
  { t: '2026-10-09', values: { codenames: 3, echo: 0, _all: 3 } },
  { t: '2026-10-10', values: { codenames: 0, echo: 0, _all: 0 } },
];
const series = [
  { id: 'codenames', name: 'Codenames', color: '#111111' },
  { id: 'echo', name: 'Echo', color: '#222222' },
];

// ECharts options are loosely typed unions; the tests read them back as plain JSON.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

describe('chart colours', () => {
  it('gives known games fixed slots and hashes others into the rest, by id alone', () => {
    const slots = gameSlots(['zeta', 'echo', 'alpha']);
    expect(slots.get('codenames')).toBe(0);
    expect(slots.get('enigma')).toBe(1);
    expect(slots.get('echo')).toBe(2);
    // Reverie keeps the slot its id hashed to before the order was fixed; Hoodwink comes next.
    expect(slots.get('reverie')).toBe(3);
    expect(slots.get('hoodwink')).toBe(4);
    // Masquerade and Royal Post keep the slots their ids hashed to; the originals take the last.
    expect(slots.get('masquerade')).toBe(5);
    expect(slots.get('royal-post')).toBe(6);
    expect(slots.get('masquerade-originals')).toBe(7);
    expect(slots.get('nightfall')).toBe(8);
    expect(slots.get('round-table')).toBe(9);
    expect(slots.get('inquest')).toBe(10);
    expect(slots.get('hydra')).toBe(11);
    expect(slots.get('seance')).toBe(12);
    expect(slots.get('hogwarts')).toBe(13);
    expect(slots.get('tavern-brawl')).toBe(14);
    expect(slots.get('short-fuse')).toBe(15);
    expect(slots.get('starlight')).toBe(16);
    expect(slots.get('thorns')).toBe(17);
    expect(slots.get('iconic')).toBe(18);
    expect(slots.get('stampede')).toBe(19);
    expect(slots.get('jeweller')).toBe(20);
    expect(slots.get('going-once')).toBe(21);
    expect(slots.get('sketchy')).toBe(22);
    expect(slots.get('mosaic')).toBe(23);
    expect(slots.get('encore')).toBe(24);
    // With every slot taken, other games get the neutral colour.
    for (const id of ['zeta', 'alpha']) expect(slotColor(light, slotFor(id))).toBe(light.other);
    // A filter that hides a game never repaints the others.
    expect(gameSlots(['zeta']).get('zeta')).toBe(slots.get('zeta'));
  });

  it('falls back to the neutral colour past the last slot', () => {
    expect(slotColor(light, 0)).toBe(light.series[0]);
    expect(slotColor(light, 24)).toBe(light.series[24]);
    expect(slotColor(light, 25)).toBe(light.other);
    expect(slotColor(dark, undefined)).toBe(dark.other);
    expect(dark.series).not.toEqual(light.series);
  });
});

describe('series → chart options', () => {
  it('rounds only the topmost non-zero segment of each stack', () => {
    expect(topOfStack(points, ['codenames', 'echo'])).toEqual([1, 0, -1]);
    const opt: Json = stackedActivityOption(points, series, 'day', light);
    expect(opt.xAxis.data).toEqual(['Oct 8', 'Oct 9', 'Oct 10']);
    expect(opt.series).toHaveLength(2);
    expect(opt.series[0].stack).toBe('games');
    expect(opt.series[0].barMaxWidth).toBeLessThanOrEqual(24);
    expect(opt.series[0].data.map((d: Json) => d.value)).toEqual([2, 3, 0]);
    expect(opt.series[0].data[1].itemStyle.borderRadius).toEqual([4, 4, 0, 0]);
    expect(opt.series[0].data[0].itemStyle).toBeUndefined();
    expect(opt.series[1].data[0].itemStyle.borderRadius).toEqual([4, 4, 0, 0]);
    // The 2 px surface gap between stacked segments.
    expect(opt.series[0].itemStyle.borderColor).toBe(light.surface);
  });

  it('lists every series at a bucket in the tooltip, values first, labels escaped', () => {
    const opt: Json = stackedActivityOption(
      points,
      [...series, { id: 'x', name: '<b>x</b>', color: '#333' }],
      'day',
      dark,
    );
    const html: string = opt.tooltip.formatter([{ dataIndex: 0 }]);
    expect(html).toContain('Oct 8, 2026'.slice(0, 5));
    expect(html.indexOf('Echo')).toBeLessThan(html.indexOf('Codenames'));
    expect(html).toContain('3 in all');
    expect(tooltipRow(dark, '#fff', '1', '<script>')).toContain('&#60;script&#62;');
    expect(opt.tooltip.formatter([{ dataIndex: 2 }])).toContain('No games');
  });

  it('labels hour buckets with the day once the window spans days', () => {
    const hourly: SeriesPoint[] = [
      { t: '2026-10-09T23', values: { a: 1 } },
      { t: '2026-10-10T00', values: { a: 2 } },
    ];
    const opt: Json = stackedActivityOption(
      hourly,
      [{ id: 'a', name: 'A', color: '#000' }],
      'hour',
      light,
    );
    expect(opt.xAxis.data).toEqual(['Oct 9 23:00', 'Oct 10 00:00']);
  });

  it('builds the matching table with totals', () => {
    expect(activityTable(points, series, 'day')).toEqual({
      columns: ['When', 'Codenames', 'Echo', 'Total'],
      rows: [
        ['Oct 8', 2, 1, 3],
        ['Oct 9', 3, 0, 3],
        ['Oct 10', 0, 0, 0],
      ],
    });
  });

  it('detects an empty series', () => {
    expect(isEmptySeries(points)).toBe(false);
    expect(isEmptySeries([points[2]!])).toBe(true);
    expect(isEmptySeries([])).toBe(true);
  });

  it('labels few columns on the cap and leaves dense ones to the axis', () => {
    const few: Json = columnsOption(['1', '2'], [3, 4], '#000', 'games', light);
    expect(few.series[0].label.show).toBe(true);
    const many: Json = columnsOption(
      Array.from({ length: 30 }, (_, i) => `${i}`),
      Array.from({ length: 30 }, () => 1),
      '#000',
      'games',
      light,
    );
    expect(many.series[0].label.show).toBe(false);
    expect(many.yAxis.splitLine.lineStyle.type).toBe('solid');
  });

  it('colours horizontal bars per row and puts the value at the tip', () => {
    const opt: Json = barsOption(
      [
        { label: 'Codenames', value: 5, color: '#a' },
        { label: 'Echo', value: 2, color: '#b' },
      ],
      'games',
      light,
    );
    expect(opt.yAxis.data).toEqual(['Codenames', 'Echo']);
    expect(opt.series[0].data[1]).toEqual({
      value: 2,
      itemStyle: { color: '#b', borderRadius: [0, 4, 4, 0] },
    });
    expect(opt.series[0].label.position).toBe('right');
  });

  it('marks only the latest sparkline point, with a surface ring', () => {
    const opt: Json = sparklineOption(
      [
        { ts: 0, value: 1 },
        { ts: 60_000, value: 4 },
      ],
      '#123',
      'players',
      dark,
    );
    const data = opt.series[0].data;
    expect(data[0]).toBe(1);
    expect(data[1]).toMatchObject({
      value: 4,
      symbolSize: 8,
      itemStyle: { borderColor: dark.surface, borderWidth: 2 },
    });
    expect(opt.series[0].lineStyle.width).toBe(2);
    expect(opt.series[0].areaStyle.opacity).toBe(0.1);
  });

  it('steps heat colours from empty through the sequential ramp', () => {
    expect(heatPieces(0, light)).toEqual([{ lte: 0, color: light.empty }]);
    const two = heatPieces(2, light);
    expect(two).toHaveLength(3);
    expect(two[2]!.color).toBe(light.sequential[4]);
    const many = heatPieces(50, dark);
    expect(many).toHaveLength(6);
    expect(many[1]).toMatchObject({ gt: 0, lte: 10, color: dark.sequential[0] });
    expect(many[5]!.lte).toBe(50);
  });

  it('sizes the calendar to its weeks so it can scroll inside its card', () => {
    const days = [
      { day: '2026-10-01', games: 2 },
      { day: '2026-10-10', games: 0 },
    ];
    const short = calendarOption(days, '2026-10-01', '2026-10-10', light);
    const long = calendarOption(days, '2025-10-11', '2026-10-10', light);
    expect(long.width).toBeGreaterThan(short.width);
    const opt: Json = short.option;
    expect(opt.calendar.range).toEqual(['2026-10-01', '2026-10-10']);
    expect(opt.series[0].data).toEqual([
      ['2026-10-01', 2],
      ['2026-10-10', 0],
    ]);
  });

  it('maps weekday × hour cells to heatmap points and a 7-row table', () => {
    const cells = [
      { weekday: 0, hour: 20, games: 3 },
      { weekday: 6, hour: 1, games: 1 },
    ];
    const opt: Json = weekHourOption(cells, light);
    expect(opt.series[0].data).toEqual([
      [20, 0, 3],
      [1, 6, 1],
    ]);
    expect(opt.yAxis.data[0]).toBe('Mon');
    const table = weekHourTable(cells);
    expect(table.rows).toHaveLength(7);
    expect(table.rows[0]![21]).toBe(3);
    expect(table.rows[6]![2]).toBe(1);
  });

  it('moves the UTC heatmap and sparkline times to the viewer’s zone', () => {
    const now = Date.UTC(2026, 9, 11, 12);
    const cells = [
      { weekday: 0, hour: 20, games: 3 },
      { weekday: 6, hour: 1, games: 1 },
    ];
    // Bangkok: Mon 20:00 UTC is Tue 03:00; Sun 01:00 UTC is Sun 08:00.
    expect(localWeekHour(cells, now, 'Asia/Bangkok')).toEqual({
      cells: [
        { weekday: 1, hour: 3, games: 3 },
        { weekday: 6, hour: 8, games: 1 },
      ],
      zone: 'GMT+7',
    });
    // Los Angeles (summer): Mon 01:00 UTC is Sun 18:00.
    expect(
      localWeekHour([{ weekday: 0, hour: 1, games: 2 }], now, 'America/Los_Angeles').cells,
    ).toEqual([{ weekday: 6, hour: 18, games: 2 }]);
    // A zone off the whole hour keeps UTC.
    expect(localWeekHour(cells, now, 'Asia/Kolkata')).toEqual({ cells, zone: 'UTC' });
    const opt: Json = weekHourOption(cells, light, 'GMT+7');
    expect(opt.tooltip.formatter({ value: [3, 1, 3] })).toContain('Tue 03:00 GMT+7');

    const spark: Json = sparklineOption(
      [{ ts: Date.UTC(2026, 9, 11, 18, 55), value: 2 }],
      '#123',
      'players',
      light,
      'Asia/Bangkok',
    );
    expect(spark.tooltip.formatter([{ dataIndex: 0 }])).toContain('01:55');
  });
});
