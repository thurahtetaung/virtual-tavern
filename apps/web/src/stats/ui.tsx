import { Panel, cn } from '@vt/ui';
import type { EChartsCoreOption } from 'echarts/core';
import { type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { echarts } from './echarts.ts';
import type { Delta } from './format.ts';
import type { TableData } from './options.ts';
import type { ChartTokens } from './palette.ts';

/** An ECharts canvas (SVG renderer) that follows its container's size and redraws on new options. */
export function EChart({
  option,
  height,
  width,
  label,
}: {
  option: EChartsCoreOption;
  height: number;
  /** A fixed width makes the chart scroll sideways inside its card (wide calendars on phones). */
  width?: number;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<ReturnType<typeof echarts.init> | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const instance = echarts.init(el, undefined, { renderer: 'svg' });
    chart.current = instance;
    const observer = new ResizeObserver(() => {
      instance.resize();
    });
    observer.observe(el);
    return () => {
      observer.disconnect();
      instance.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true });
  }, [option]);

  const plot = <div ref={ref} role="img" aria-label={label} style={{ height, width }} />;
  // The scroller takes focus so keyboard users can scroll it too.
  return width ? (
    <div
      role="region"
      aria-label={`${label}, scrolls sideways`}
      tabIndex={0}
      className="-mx-1 overflow-x-auto rounded-lg px-1 pb-1 focus-visible:outline-2 focus-visible:outline-accent dark:focus-visible:outline-amber-500"
    >
      {plot}
    </div>
  ) : (
    plot
  );
}

export function DataTable({ table, caption }: { table: TableData; caption: string }) {
  return (
    <div className="max-h-80 overflow-auto rounded-lg ring-1 ring-stone-200 dark:ring-stone-800">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-stone-100 text-xs text-stone-600 dark:bg-stone-800 dark:text-stone-300">
          <tr>
            {table.columns.map((c, i) => (
              <th
                key={i}
                scope="col"
                className={cn('px-3 py-2 font-semibold whitespace-nowrap', i > 0 && 'text-right')}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {table.rows.map((row, r) => (
            <tr key={r} className="border-t border-stone-100 dark:border-stone-800">
              {row.map((cell, i) =>
                i === 0 ? (
                  <th key={i} scope="row" className="px-3 py-1.5 font-medium whitespace-nowrap">
                    {cell}
                  </th>
                ) : (
                  <td key={i} className="px-3 py-1.5 text-right">
                    {cell}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Skeleton({ height = 160, className }: { height?: number; className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-pulse rounded-xl bg-stone-200/70 motion-reduce:animate-none dark:bg-stone-800/70',
        className,
      )}
      style={{ height }}
    />
  );
}

export function EmptyState({ children = 'No games in this range yet' }: { children?: ReactNode }) {
  return (
    <div className="flex min-h-24 flex-col items-center justify-center gap-1 rounded-xl bg-stone-100/70 px-4 py-6 text-center text-sm text-ink-muted dark:bg-stone-800/40 dark:text-stone-400">
      <span aria-hidden className="text-2xl">
        🕯️
      </span>
      {children}
    </div>
  );
}

/** Legend entries: a swatch beside each name, names in text colours (never the series colour). */
export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600 dark:text-stone-400">
      {items.map((i) => (
        <li key={i.name} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block size-2.5 rounded-sm"
            style={{ background: i.color }}
          />
          {i.name}
        </li>
      ))}
    </ul>
  );
}

/** The Less → More key for a heatmap. */
export function HeatKey({ tokens }: { tokens: ChartTokens }) {
  return (
    <div className="flex items-center gap-1 text-xs text-ink-muted" aria-hidden>
      Less
      {[tokens.empty, ...tokens.sequential].map((c) => (
        <span key={c} className="inline-block size-2.5 rounded-sm" style={{ background: c }} />
      ))}
      More
    </div>
  );
}

/**
 * A chart card: title, optional legend, the chart (or its table), plus a "Show as table" toggle,
 * a loading skeleton and an empty state. While new data loads the old chart stays, dimmed.
 */
export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  empty,
  loading,
  height = 220,
  className,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  legend?: ReactNode;
  table?: TableData;
  /** No data at all (once loaded). */
  empty?: boolean;
  /** No data yet: show a skeleton. */
  loading?: boolean;
  height?: number;
  className?: string;
  children?: ReactNode;
}) {
  const [asTable, setAsTable] = useState(false);
  const titleId = useId();
  return (
    <Panel
      className={cn('flex min-w-0 flex-col gap-3', className)}
      aria-labelledby={titleId}
      role="region"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={titleId} className="font-semibold">
            {title}
          </h3>
          {subtitle && <p className="text-xs text-ink-muted">{subtitle}</p>}
        </div>
        {table && !empty && !loading && (
          <button
            type="button"
            aria-pressed={asTable}
            onClick={() => setAsTable((v) => !v)}
            className="-my-2 -mr-2 h-11 shrink-0 rounded-lg px-3 text-xs font-semibold text-stone-600 hover:bg-stone-200/70 focus-visible:outline-2 focus-visible:outline-accent dark:focus-visible:outline-amber-500 dark:text-stone-300 dark:hover:bg-stone-800"
          >
            {asTable ? 'Show as chart' : 'Show as table'}
          </button>
        )}
      </div>
      {loading ? (
        <Skeleton height={height} />
      ) : empty ? (
        <EmptyState />
      ) : asTable && table ? (
        <DataTable table={table} caption={title} />
      ) : (
        <>
          {legend}
          {children}
        </>
      )}
    </Panel>
  );
}

const DELTA_STYLE = {
  good: 'text-green-700 dark:text-green-500',
  bad: 'text-rose-700 dark:text-rose-400',
  flat: 'text-ink-muted',
};

/** A KPI tile: label, value, and optionally the change against the previous window. */
export function StatTile({
  label,
  value,
  unit,
  delta,
  upIsGood = true,
  hint,
  loading,
  className,
}: {
  className?: string;
  label: string;
  value: ReactNode;
  unit?: string;
  delta?: Delta;
  upIsGood?: boolean;
  hint?: ReactNode;
  loading?: boolean;
}) {
  const tone =
    !delta || delta.direction === 'flat'
      ? 'flat'
      : delta.direction === 'new' || (delta.direction === 'up') === upIsGood
        ? 'good'
        : 'bad';
  const arrow = !delta
    ? ''
    : delta.direction === 'up'
      ? '▲'
      : delta.direction === 'down'
        ? '▼'
        : delta.direction === 'new'
          ? '✦'
          : '•';
  return (
    <Panel className={cn('flex min-w-0 flex-col gap-1 p-3 sm:p-4', className)}>
      <span className="truncate text-xs font-medium text-stone-600 dark:text-stone-400">
        {label}
      </span>
      {loading ? (
        <Skeleton height={32} className="w-16" />
      ) : (
        <span className="text-2xl leading-tight font-semibold sm:text-3xl">
          {value}
          {unit && <span className="ml-1 text-sm font-medium text-ink-muted">{unit}</span>}
        </span>
      )}
      {delta && !loading && (
        <span className={cn('text-xs font-medium', DELTA_STYLE[tone])}>
          <span aria-hidden>{arrow}</span> {delta.text}
          <span className="hidden font-normal text-ink-muted sm:inline"> vs previous</span>
        </span>
      )}
      {hint && !loading && <span className="text-xs text-ink-muted">{hint}</span>}
    </Panel>
  );
}

/** A horizontal chip row that scrolls sideways on phones instead of wrapping or overflowing. */
export function ChipRow({
  label,
  children,
  className,
  bleed = true,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  /** Scroll right to the screen edge (through the page's 16 px gutter). */
  bleed?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        // The fade and the end spacer show there is more to scroll to, and let the last chip clear it.
        "flex gap-1.5 overflow-x-auto [mask-image:linear-gradient(to_right,black_calc(100%-1.5rem),transparent)] [scrollbar-width:none] after:shrink-0 after:basis-4 after:content-['']",
        bleed && '-mx-4 px-4',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Chip({
  selected,
  onClick,
  children,
  role,
  controls,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  role?: 'tab';
  controls?: string;
}) {
  return (
    <button
      type="button"
      role={role}
      aria-selected={role === 'tab' ? selected : undefined}
      aria-pressed={role === 'tab' ? undefined : selected}
      aria-controls={controls}
      onClick={onClick}
      className={cn(
        'h-11 shrink-0 rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-amber-500',
        selected
          ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
          : 'bg-white text-stone-700 ring-1 ring-stone-300 hover:bg-stone-50 dark:bg-stone-900 dark:text-stone-300 dark:ring-stone-700 dark:hover:bg-stone-800',
      )}
    >
      {children}
    </button>
  );
}
