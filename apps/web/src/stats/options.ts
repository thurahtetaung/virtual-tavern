import type { SeriesPoint, StatsBucket } from '@vt/protocol';
import type { EChartsCoreOption } from 'echarts/core';
import { WEEKDAYS, bucketLabel, compact, escapeHtml, plain, shortDay } from './format.ts';
import type { ChartTokens } from './palette.ts';

// Pure builders from API data to ECharts options (and to the matching "Show as table" rows), so
// the mapping is unit-tested without a DOM. Mark specs follow the dataviz guide: bars at most
// 24 px with a 4 px rounded end, a 2 px surface gap between touching fills, 2 px lines, solid
// hairline grids, values in text colours rather than series colours.

export interface TableData {
  columns: string[];
  rows: (string | number)[][];
}

export interface SeriesMeta {
  id: string;
  name: string;
  color: string;
}

const BAR_MAX = 24;
/**
 * The page's font stack (Tailwind's sans). ECharts measures label widths with it, so it must be a
 * real family list: 'inherit' would be measured as the canvas default and labels would clip.
 */
const FONT = "ui-sans-serif, system-ui, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'";
const RADIUS = 4;

function baseText(t: ChartTokens) {
  return { color: t.muted, fontFamily: FONT, fontSize: 11 };
}

function tooltip(t: ChartTokens, trigger: 'axis' | 'item', pointer: 'line' | 'shadow' | 'none') {
  return {
    trigger,
    confine: true,
    backgroundColor: t.surface,
    borderColor: t.axis,
    borderWidth: 1,
    padding: [6, 10],
    textStyle: { color: t.ink, fontSize: 12, fontFamily: FONT },
    extraCssText: 'border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.12);',
    axisPointer:
      pointer === 'none'
        ? { type: 'none' }
        : pointer === 'line'
          ? { type: 'line', lineStyle: { color: t.axis, width: 1, type: 'solid' } }
          : {
              type: 'shadow',
              shadowStyle: {
                color: t.theme === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
              },
            },
  };
}

/** One tooltip row: a short line key in the series colour, the value strong, the name after. */
export function tooltipRow(t: ChartTokens, color: string, value: string, name: string): string {
  return (
    `<div style="display:flex;align-items:center;gap:6px;line-height:1.6">` +
    `<span style="display:inline-block;width:10px;height:2px;border-radius:1px;background:${color}"></span>` +
    `<b style="color:${t.ink}">${escapeHtml(value)}</b>` +
    `<span style="color:${t.inkSecondary}">${escapeHtml(name)}</span></div>`
  );
}

const tooltipHeader = (t: ChartTokens, text: string) =>
  `<div style="color:${t.muted};margin-bottom:2px">${escapeHtml(text)}</div>`;

function categoryAxis(t: ChartTokens, labels: string[]) {
  return {
    type: 'category',
    data: labels,
    axisLine: { lineStyle: { color: t.axis, width: 1 } },
    axisTick: { show: false },
    axisLabel: { ...baseText(t), hideOverlap: true },
  };
}

function valueAxis(t: ChartTokens) {
  return {
    type: 'value',
    minInterval: 1,
    axisLabel: { ...baseText(t), formatter: (v: number) => compact(v) },
    splitLine: { lineStyle: { color: t.grid, width: 1, type: 'solid' } },
  };
}

// `containLabel` keeps axis labels inside the box, so nothing is clipped at the card edge.
const grid = { left: 4, right: 8, top: 12, bottom: 4, containLabel: true };

/**
 * Index of the topmost non-zero series in each bucket of a stack, so only that segment gets the
 * rounded data end (the baseline stays square).
 */
export function topOfStack(points: SeriesPoint[], ids: string[]): number[] {
  return points.map((p) => {
    for (let i = ids.length - 1; i >= 0; i--) if ((p.values[ids[i]!] ?? 0) > 0) return i;
    return -1;
  });
}

/** Spans more than one day (hour buckets then show the day in labels). */
const spansDays = (points: SeriesPoint[]) =>
  points.length > 0 && points[0]!.t.slice(0, 10) !== points[points.length - 1]!.t.slice(0, 10);

/** Stacked columns of games started per bucket, one series per game. */
export function stackedActivityOption(
  points: SeriesPoint[],
  series: SeriesMeta[],
  bucket: StatsBucket,
  t: ChartTokens,
): EChartsCoreOption {
  const multi = spansDays(points);
  const labels = points.map((p) => bucketLabel(p.t, bucket, multi));
  const ids = series.map((s) => s.id);
  const tops = topOfStack(points, ids);
  return {
    backgroundColor: 'transparent',
    animationDuration: 300,
    grid,
    tooltip: {
      ...tooltip(t, 'axis', 'shadow'),
      formatter: (params: { dataIndex: number }[]) => {
        const i = params[0]?.dataIndex ?? 0;
        const p = points[i];
        if (!p) return '';
        const rows = series
          .map((s) => ({ s, v: p.values[s.id] ?? 0 }))
          .filter((r) => r.v > 0)
          .reverse()
          .map((r) => tooltipRow(t, r.s.color, plain(r.v), r.s.name));
        const total = series.reduce((sum, s) => sum + (p.values[s.id] ?? 0), 0);
        return (
          tooltipHeader(t, bucketLabel(p.t, bucket, true)) +
          (rows.join('') || `<div style="color:${t.inkSecondary}">No games</div>`) +
          (rows.length > 1
            ? `<div style="color:${t.inkSecondary};margin-top:2px">${plain(total)} in all</div>`
            : '')
        );
      },
    },
    xAxis: categoryAxis(t, labels),
    yAxis: valueAxis(t),
    series: series.map((s, si) => ({
      type: 'bar',
      name: s.name,
      stack: 'games',
      barMaxWidth: BAR_MAX,
      itemStyle: { color: s.color, borderColor: t.surface, borderWidth: 1 },
      emphasis: { focus: 'none' },
      data: points.map((p, i) => ({
        value: p.values[s.id] ?? 0,
        itemStyle: tops[i] === si ? { borderRadius: [RADIUS, RADIUS, 0, 0] } : undefined,
      })),
    })),
  };
}

export function activityTable(
  points: SeriesPoint[],
  series: SeriesMeta[],
  bucket: StatsBucket,
): TableData {
  return {
    columns: ['When', ...series.map((s) => s.name), 'Total'],
    rows: points.map((p) => {
      const values = series.map((s) => p.values[s.id] ?? 0);
      return [bucketLabel(p.t, bucket, true), ...values, values.reduce((a, b) => a + b, 0)];
    }),
  };
}

/** Plain columns for one series: games over time, players per game, a histogram figure. */
export function columnsOption(
  labels: string[],
  values: number[],
  color: string,
  valueName: string,
  t: ChartTokens,
): EChartsCoreOption {
  // A handful of columns can carry their values on the cap; dense series leave it to the axis.
  const showLabels = labels.length <= 12;
  return {
    backgroundColor: 'transparent',
    animationDuration: 300,
    grid: { ...grid, top: showLabels ? 20 : 12 },
    tooltip: {
      ...tooltip(t, 'axis', 'shadow'),
      formatter: (params: { dataIndex: number }[]) => {
        const i = params[0]?.dataIndex ?? 0;
        return (
          tooltipHeader(t, labels[i] ?? '') + tooltipRow(t, color, plain(values[i] ?? 0), valueName)
        );
      },
    },
    xAxis: categoryAxis(t, labels),
    yAxis: valueAxis(t),
    series: [
      {
        type: 'bar',
        name: valueName,
        barMaxWidth: BAR_MAX,
        itemStyle: { color, borderRadius: [RADIUS, RADIUS, 0, 0] },
        label: showLabels
          ? {
              show: true,
              position: 'top',
              color: t.inkSecondary,
              fontSize: 11,
              formatter: (p: { value: number }) => (p.value ? compact(p.value) : ''),
            }
          : { show: false },
        data: values,
      },
    ],
  };
}

/** Horizontal bars, one per row, each with its own colour (game identity) and the value at the tip. */
export function barsOption(
  rows: { label: string; value: number; color: string }[],
  valueName: string,
  t: ChartTokens,
): EChartsCoreOption {
  return {
    backgroundColor: 'transparent',
    animationDuration: 300,
    grid: { left: 4, right: 40, top: 4, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltip(t, 'item', 'none'),
      formatter: (p: { dataIndex: number }) => {
        const r = rows[p.dataIndex];
        return r ? tooltipRow(t, r.color, plain(r.value), `${valueName} · ${r.label}`) : '';
      },
    },
    xAxis: { type: 'value', show: false, max: (v: { max: number }) => Math.max(1, v.max) },
    yAxis: {
      type: 'category',
      inverse: true,
      data: rows.map((r) => r.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: t.inkSecondary, fontSize: 12, fontFamily: FONT },
    },
    series: [
      {
        type: 'bar',
        name: valueName,
        barMaxWidth: 18,
        label: {
          show: true,
          position: 'right',
          color: t.inkSecondary,
          fontSize: 12,
          formatter: (p: { value: number }) => compact(p.value),
        },
        data: rows.map((r) => ({
          value: r.value,
          itemStyle: { color: r.color, borderRadius: [0, RADIUS, RADIUS, 0] },
        })),
      },
    ],
  };
}

/** A small line with a wash below it and a dot on the latest value; no axes. */
export function sparklineOption(
  points: { ts: number; value: number }[],
  color: string,
  valueName: string,
  t: ChartTokens,
): EChartsCoreOption {
  const time = (ts: number) => new Date(ts).toISOString().slice(11, 16) + ' UTC';
  return {
    backgroundColor: 'transparent',
    animationDuration: 300,
    grid: { left: 6, right: 8, top: 8, bottom: 6 },
    tooltip: {
      ...tooltip(t, 'axis', 'line'),
      formatter: (params: { dataIndex: number }[]) => {
        const p = points[params[0]?.dataIndex ?? 0];
        return p
          ? tooltipHeader(t, time(p.ts)) + tooltipRow(t, color, plain(p.value), valueName)
          : '';
      },
    },
    xAxis: { type: 'category', show: false, boundaryGap: false, data: points.map((p) => p.ts) },
    yAxis: { type: 'value', show: false, min: 0, max: (v: { max: number }) => Math.max(1, v.max) },
    series: [
      {
        type: 'line',
        name: valueName,
        symbol: 'none',
        showSymbol: true,
        lineStyle: { color, width: 2, cap: 'round', join: 'round' },
        itemStyle: { color },
        areaStyle: { color, opacity: 0.1 },
        data: points.map((p, i) =>
          i === points.length - 1
            ? {
                value: p.value,
                symbol: 'circle',
                symbolSize: 8,
                itemStyle: { color, borderColor: t.surface, borderWidth: 2 },
              }
            : p.value,
        ),
      },
    ],
  };
}

/** Pieces for a sequential heat scale: zero is the empty colour, then up to five steps. */
export function heatPieces(
  max: number,
  t: ChartTokens,
): { gt?: number; lte: number; color: string }[] {
  const pieces: { gt?: number; lte: number; color: string }[] = [{ lte: 0, color: t.empty }];
  if (max <= 0) return pieces;
  const steps = Math.min(t.sequential.length, Math.ceil(max));
  // With few distinct values, use the darker end of the ramp so a single game is still visible.
  const ramp = t.sequential.slice(t.sequential.length - steps);
  for (let i = 0; i < steps; i++) {
    pieces.push({ gt: (max * i) / steps, lte: (max * (i + 1)) / steps, color: ramp[i]! });
  }
  return pieces;
}

/**
 * A heatmap table: rows by columns, each cell shaded by its share of its column's largest value
 * (so counts and percents can sit side by side), with the value written in the cell.
 */
export function matrixOption(
  columns: string[],
  rows: string[],
  shades: number[][],
  labels: string[][],
  t: ChartTokens,
): EChartsCoreOption {
  const data = rows.flatMap((_, r) => columns.map((_, c) => [c, r, (shades[r]?.[c] ?? 0) * 5]));
  return {
    backgroundColor: 'transparent',
    animation: false,
    grid: { left: 4, right: 4, top: 4, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltip(t, 'item', 'none'),
      formatter: (p: { value: [number, number, number] }) =>
        tooltipHeader(
          t,
          `${escapeHtml(rows[p.value[1]] ?? '')} · ${escapeHtml(columns[p.value[0]] ?? '')}`,
        ) + `<b style="color:${t.ink}">${escapeHtml(labels[p.value[1]]?.[p.value[0]] ?? '')}</b>`,
    },
    visualMap: { type: 'piecewise', show: false, pieces: heatPieces(5, t), dimension: 2 },
    xAxis: {
      type: 'category',
      data: columns,
      position: 'top',
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { ...baseText(t), interval: 0, overflow: 'break', width: 90 },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: rows,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: baseText(t),
    },
    series: [
      {
        type: 'heatmap',
        data,
        label: {
          show: true,
          color: t.ink,
          fontSize: 11,
          formatter: (p: { value: [number, number, number] }) =>
            labels[p.value[1]]?.[p.value[0]] ?? '',
        },
        itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 2 },
      },
    ],
  };
}

/** Calendar cell size: roomy for a month or two, compact (and scrolling) for a year. */
export function calendarCell(weeks: number): number {
  return weeks <= 10 ? 24 : weeks <= 20 ? 18 : 14;
}

/** GitHub-style calendar heatmap of games per day. Returns the size it needs, for an inner scroll. */
export function calendarOption(
  days: { day: string; games: number }[],
  from: string,
  to: string,
  t: ChartTokens,
): { option: EChartsCoreOption; width: number; height: number } {
  const max = days.reduce((m, d) => Math.max(m, d.games), 0);
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  const weeks = Math.ceil((end - start) / (7 * 86_400_000)) + 2;
  const cell = calendarCell(weeks);
  const left = 30;
  const top = 22;
  return {
    width: left + weeks * cell + 8,
    height: top + 7 * cell + 6,
    option: {
      backgroundColor: 'transparent',
      animation: false,
      tooltip: {
        ...tooltip(t, 'item', 'none'),
        formatter: (p: { value: [string, number] }) =>
          tooltipHeader(t, shortDay(p.value[0])) +
          `<b style="color:${t.ink}">${plain(p.value[1])}</b> <span style="color:${t.inkSecondary}">games</span>`,
      },
      visualMap: { type: 'piecewise', show: false, pieces: heatPieces(max, t), dimension: 1 },
      calendar: {
        range: [from, to],
        orient: 'horizontal',
        cellSize: [cell, cell],
        left,
        top,
        right: 8,
        splitLine: { show: false },
        itemStyle: { color: t.empty, borderColor: t.surface, borderWidth: 2 },
        dayLabel: {
          firstDay: 1,
          nameMap: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
          color: t.muted,
          fontSize: 10,
          margin: 6,
        },
        monthLabel: { color: t.muted, fontSize: 10, nameMap: 'EN', margin: 6 },
        yearLabel: { show: false },
      },
      series: [
        {
          type: 'heatmap',
          coordinateSystem: 'calendar',
          itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 2 },
          data: days.map((d) => [d.day, d.games]),
        },
      ],
    },
  };
}

export function calendarTable(days: { day: string; games: number }[]): TableData {
  return {
    columns: ['Day', 'Games'],
    rows: days.filter((d) => d.games > 0).map((d) => [shortDay(d.day), d.games]),
  };
}

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'));

/** Weekday × hour heatmap (UTC), Monday on top. */
export function weekHourOption(
  cells: { weekday: number; hour: number; games: number }[],
  t: ChartTokens,
): EChartsCoreOption {
  const max = cells.reduce((m, c) => Math.max(m, c.games), 0);
  return {
    backgroundColor: 'transparent',
    animation: false,
    grid: { left: 4, right: 4, top: 4, bottom: 4, containLabel: true },
    tooltip: {
      ...tooltip(t, 'item', 'none'),
      formatter: (p: { value: [number, number, number] }) =>
        tooltipHeader(t, `${WEEKDAYS[p.value[1]]} ${HOURS[p.value[0]]}:00 UTC`) +
        `<b style="color:${t.ink}">${plain(p.value[2])}</b> <span style="color:${t.inkSecondary}">games</span>`,
    },
    visualMap: { type: 'piecewise', show: false, pieces: heatPieces(max, t), dimension: 2 },
    xAxis: {
      type: 'category',
      data: HOURS,
      axisLine: { show: false },
      axisTick: { show: false },
      splitArea: { show: false },
      axisLabel: { ...baseText(t), interval: 2 },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: WEEKDAYS,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: baseText(t),
    },
    series: [
      {
        type: 'heatmap',
        itemStyle: { borderColor: t.surface, borderWidth: 2, borderRadius: 2 },
        emphasis: { itemStyle: { borderColor: t.ink, borderWidth: 1 } },
        data: cells.map((c) => [c.hour, c.weekday, c.games]),
      },
    ],
  };
}

export function weekHourTable(
  cells: { weekday: number; hour: number; games: number }[],
): TableData {
  const grid = WEEKDAYS.map(() => HOURS.map(() => 0));
  for (const c of cells) if (grid[c.weekday]) grid[c.weekday]![c.hour] = c.games;
  return {
    columns: ['Day', ...HOURS.map((h) => `${h}h`)],
    rows: WEEKDAYS.map((d, i) => [d, ...grid[i]!]),
  };
}

/** True when nothing in the series has a value: the card shows its empty state instead. */
export const isEmptySeries = (points: SeriesPoint[]) =>
  points.every((p) => Object.entries(p.values).every(([, v]) => v === 0));
