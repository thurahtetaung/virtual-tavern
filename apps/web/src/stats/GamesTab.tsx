import { type GameStats, WORD_KINDS, type WordKind } from '@vt/protocol';
import { cn } from '@vt/ui';
import { useMemo, useState } from 'react';
import { statsApi } from './api.ts';
import { type GameInfo, gameColor, useLoad, useStats } from './context.tsx';
import {
  type FigureModel,
  cloudSize,
  figureModel,
  isTileFigure,
  matrixCell,
  settingLabel,
} from './figures.ts';
import { bucketLabel, compact, duration, percent, plain } from './format.ts';
import { columnsOption, isEmptySeries, matrixOption } from './options.ts';
import { type ChartTokens, slotColor } from './palette.ts';
import { useChartTokens } from './theme.ts';
import { kindsWithWords, knownWordKinds, wordKindLabel } from './word-kinds.ts';
import { ChartCard, Chip, ChipRow, EChart, EmptyState, Legend, Skeleton, StatTile } from './ui.tsx';

/** Games tab: one sub-tab per game. */
export function GamesTab() {
  const ctx = useStats();
  const selected = ctx.games.find((g) => g.id === ctx.params.game) ?? ctx.games[0];
  if (!selected) return <EmptyState>No games yet.</EmptyState>;
  return (
    <div className="space-y-4">
      <ChipRow label="Game">
        {ctx.games.map((g) => (
          <Chip
            key={g.id}
            selected={g.id === selected.id}
            onClick={() => ctx.setParams({ game: g.id })}
          >
            <span aria-hidden>{g.icon}</span> {g.name}
          </Chip>
        ))}
      </ChipRow>
      <GameView key={selected.id} game={selected} />
    </div>
  );
}

function GameView({ game }: { game: GameInfo }) {
  const ctx = useStats();
  const tokens = useChartTokens();
  const { query, epoch } = ctx;
  const { data, loading } = useLoad(`game/${game.id}?${query}#${epoch}`, () =>
    statsApi.game(game.id, query),
  );
  const color = gameColor(ctx, tokens, game.id);
  const first = !data;
  const empty = !!data && data.totals.gamesStarted === 0;
  const figures = useMemo(() => (data ? data.figures.map(figureModel) : []), [data]);
  const tiles = figures.filter(isTileFigure);
  const charts = figures.filter((f) => !isTileFigure(f));

  return (
    <div
      className={cn('space-y-4 transition-opacity', loading && !first && 'opacity-60')}
      aria-busy={loading}
    >
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Games started"
          loading={first}
          value={data ? compact(data.totals.gamesStarted) : ''}
        />
        <StatTile
          label="Finished"
          loading={first}
          value={
            data
              ? data.totals.gamesStarted
                ? percent(data.totals.gamesFinished / data.totals.gamesStarted)
                : '–'
              : ''
          }
          hint={data ? `${plain(data.totals.gamesAbandoned)} abandoned` : undefined}
        />
        <StatTile
          label="Average length"
          loading={first}
          value={data ? (empty ? '–' : duration(data.averageMinutes)) : ''}
        />
        <StatTile
          label="Average players"
          loading={first}
          value={data ? (empty ? '–' : plain(data.averagePlayers)) : ''}
        />
        {!empty && tiles.map((f) => <FigureTile key={f.id} fig={f} color={color} />)}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <GamesOverTime data={data} color={color} game={game} tokens={tokens} />
        <PlayerCounts data={data} color={color} tokens={tokens} />
        {!empty &&
          charts.map((f) => <FigureChart key={f.id} fig={f} color={color} tokens={tokens} />)}
        <SettingsUsage data={data} color={color} />
        {/* A game that reports no words (Royal Post) has no Words card. */}
        {knownWordKinds(game.id)?.length !== 0 && <Words game={game} />}
      </div>
    </div>
  );
}

function GamesOverTime({
  data,
  color,
  game,
  tokens,
}: {
  data?: GameStats;
  color: string;
  game: GameInfo;
  tokens: ChartTokens;
}) {
  const option = useMemo(() => {
    if (!data) return null;
    const multi =
      data.activity.length > 0 &&
      data.activity[0]!.t.slice(0, 10) !== data.activity.at(-1)!.t.slice(0, 10);
    const labels = data.activity.map((p) => bucketLabel(p.t, data.window.bucket, multi));
    return columnsOption(
      labels,
      data.activity.map((p) => p.values[game.id] ?? p.values._all ?? 0),
      color,
      'games',
      tokens,
    );
  }, [data, color, game.id, tokens]);
  return (
    <ChartCard
      title="Games over time"
      subtitle="Games started"
      loading={!data}
      empty={!!data && isEmptySeries(data.activity)}
      table={
        data
          ? {
              columns: ['When', 'Games'],
              rows: data.activity.map((p) => [
                bucketLabel(p.t, data.window.bucket, true),
                p.values[game.id] ?? p.values._all ?? 0,
              ]),
            }
          : undefined
      }
    >
      {option && (
        <EChart option={option} height={200} label={`${game.name} games started over time`} />
      )}
    </ChartCard>
  );
}

function PlayerCounts({
  data,
  color,
  tokens,
}: {
  data?: GameStats;
  color: string;
  tokens: ChartTokens;
}) {
  const rows = useMemo(
    () => [...(data?.playerCounts ?? [])].sort((a, b) => a.players - b.players),
    [data],
  );
  const option = useMemo(
    () =>
      columnsOption(
        rows.map((r) => `${r.players}`),
        rows.map((r) => r.games),
        color,
        'games',
        tokens,
      ),
    [rows, color, tokens],
  );
  return (
    <ChartCard
      title="Players per game"
      subtitle="Finished games by table size"
      loading={!data}
      empty={!!data && rows.every((r) => r.games === 0)}
      table={{ columns: ['Players', 'Games'], rows: rows.map((r) => [r.players, r.games]) }}
    >
      <EChart option={option} height={180} label="Finished games by number of players" />
    </ChartCard>
  );
}

function FigureTile({ fig, color }: { fig: FigureModel; color: string }) {
  if (fig.kind === 'stat') return <StatTile label={fig.label} value={fig.value} unit={fig.unit} />;
  if (fig.kind !== 'meter') return null;
  return (
    <StatTile
      label={fig.label}
      value={fig.value}
      hint={
        <span
          role="meter"
          aria-label={fig.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fig.ratio * 100)}
          className="mt-1 block h-1.5 overflow-hidden rounded-full bg-stone-200 dark:bg-stone-800"
        >
          <span
            className="block h-full rounded-full"
            style={{ width: `${fig.ratio * 100}%`, background: color }}
          />
        </span>
      }
    />
  );
}

/** Split and histogram figures, rendered by kind. */
export function FigureChart({
  fig,
  color,
  tokens,
}: {
  fig: FigureModel;
  color: string;
  tokens: ChartTokens;
}) {
  const histogram = useMemo(
    () =>
      fig.kind === 'histogram'
        ? columnsOption(fig.labels, fig.values, color, 'games', tokens)
        : null,
    [fig, color, tokens],
  );
  if (fig.kind === 'split') {
    const parts = fig.parts.map((p) => ({
      ...p,
      color: p.slot < 0 ? tokens.other : slotColor(tokens, p.slot),
    }));
    return (
      <ChartCard
        title={fig.label}
        empty={fig.total === 0}
        legend={
          <Legend
            items={parts.map((p) => ({ name: `${p.label} · ${percent(p.share)}`, color: p.color }))}
          />
        }
        table={{
          columns: ['Part', 'Count', 'Share'],
          rows: parts.map((p) => [p.label, p.value, percent(p.share)]),
        }}
      >
        <SplitBar parts={parts} label={fig.label} />
      </ChartCard>
    );
  }
  if (fig.kind === 'matrix') return <MatrixChart fig={fig} tokens={tokens} />;
  if (fig.kind === 'histogram' && histogram) {
    return (
      <ChartCard
        title={fig.label}
        empty={fig.values.every((v) => v === 0)}
        table={{
          columns: ['Bin', 'Count'],
          rows: fig.labels.map((l, i) => [l, fig.values[i] ?? 0]),
        }}
      >
        <EChart option={histogram} height={180} label={fig.label} />
      </ChartCard>
    );
  }
  return null;
}

/** A heatmap table (roles by setup and wins, teams by table size), with its table view. */
function MatrixChart({
  fig,
  tokens,
}: {
  fig: Extract<FigureModel, { kind: 'matrix' }>;
  tokens: ChartTokens;
}) {
  const labels = useMemo(
    () => fig.values.map((r) => r.map((v, c) => matrixCell(v, fig.units[c]!))),
    [fig],
  );
  const option = useMemo(
    () => matrixOption(fig.columns, fig.rows, fig.shades, labels, tokens),
    [fig, labels, tokens],
  );
  return (
    <ChartCard
      title={fig.label}
      empty={fig.rows.length === 0 || fig.columns.length === 0}
      table={{ columns: ['', ...fig.columns], rows: fig.rows.map((r, i) => [r, ...labels[i]!]) }}
    >
      <EChart option={option} height={Math.max(120, 28 * fig.rows.length + 40)} label={fig.label} />
    </ChartCard>
  );
}

/** A 100% bar: one segment per part, a 2 px surface gap between them, the first and last rounded. */
function SplitBar({
  parts,
  label,
}: {
  parts: { label: string; value: number; share: number; color: string }[];
  label: string;
}) {
  return (
    <div
      role="img"
      aria-label={`${label}: ${parts.map((p) => `${p.label} ${percent(p.share)}`).join(', ')}`}
      className="flex h-6 gap-0.5 overflow-hidden rounded"
    >
      {parts.map((p) => (
        <div
          key={p.label}
          title={`${p.label}: ${plain(p.value)} (${percent(p.share)})`}
          style={{ flexGrow: p.value, flexBasis: 0, background: p.color, minWidth: 3 }}
        />
      ))}
    </div>
  );
}

function SettingsUsage({ data, color }: { data?: GameStats; color: string }) {
  const groups = useMemo(() => {
    const byKey = new Map<string, GameStats['settings']>();
    for (const s of data?.settings ?? []) byKey.set(s.key, [...(byKey.get(s.key) ?? []), s]);
    return [...byKey].map(([key, rows]) => ({
      key,
      rows: [...rows].sort((a, b) => b.games - a.games),
    }));
  }, [data]);
  return (
    <ChartCard
      title="Settings used"
      subtitle="Games started with each choice"
      loading={!data}
      empty={!!data && groups.length === 0}
      table={{
        columns: ['Setting', 'Choice', 'Games'],
        rows: groups.flatMap((g) => g.rows.map((r) => [settingLabel(g.key), r.label, r.games])),
      }}
    >
      <div className="space-y-4">
        {groups.map((g) => {
          const max = Math.max(1, ...g.rows.map((r) => r.games));
          return (
            <div key={g.key}>
              <h4 className="mb-1.5 text-xs font-semibold tracking-wide text-stone-500 uppercase">
                {settingLabel(g.key)}
              </h4>
              <ul className="space-y-1.5">
                {g.rows.map((r) => (
                  <li
                    key={r.value}
                    className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2 text-sm"
                  >
                    <span className="truncate" title={r.label}>
                      {r.label}
                    </span>
                    <span
                      className="h-2.5 rounded-r"
                      aria-hidden
                      style={{
                        width: `${(r.games / max) * 100}%`,
                        background: color,
                        minWidth: r.games ? 3 : 0,
                      }}
                    />
                    <span className="text-stone-600 tabular-nums dark:text-stone-400">
                      {plain(r.games)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}

function Words({ game }: { game: GameInfo }) {
  const { query, epoch } = useStats();
  const known = knownWordKinds(game.id);
  // A game this page doesn't know yet: offer the kinds that have words in the range.
  const probe = useLoad(known ? null : `word-kinds/${game.id}?${query}#${epoch}`, async () => {
    const found = await Promise.all(WORD_KINDS.map((k) => statsApi.words(game.id, k, query, 1)));
    return kindsWithWords(Object.fromEntries(found.map((f) => [f.kind, f.words.length])));
  });
  const kinds = known ?? probe.data;
  const [picked, setKind] = useState<WordKind | null>(null);
  const kind = kinds ? (picked && kinds.includes(picked) ? picked : kinds[0]!) : null;
  const { data, loading } = useLoad(kind && `words/${game.id}/${kind}?${query}#${epoch}`, () =>
    statsApi.words(game.id, kind!, query),
  );
  const words = kind && data && data.kind === kind ? data.words : undefined;
  const label = kind ? wordKindLabel(game.id, kind) : 'Words';
  const max = Math.max(0, ...(words ?? []).map((w) => w.count));
  const alphabetical = useMemo(
    () => [...(words ?? [])].sort((a, b) => a.word.localeCompare(b.word)),
    [words],
  );

  return (
    <ChartCard
      title="Words"
      subtitle="Bigger means more often"
      className="lg:col-span-2"
      table={
        words
          ? { columns: ['Word', 'Times'], rows: words.map((w) => [w.word, w.count]) }
          : undefined
      }
      legend={
        kinds ? (
          <ChipRow label="Word kind">
            {kinds.map((k) => (
              <Chip key={k} selected={k === kind} onClick={() => setKind(k)}>
                {wordKindLabel(game.id, k)}
              </Chip>
            ))}
          </ChipRow>
        ) : undefined
      }
    >
      {!words ? (
        <Skeleton height={120} />
      ) : words.length === 0 ? (
        <EmptyState>No {label.toLowerCase()} in this range yet</EmptyState>
      ) : (
        <ul
          className={cn(
            'flex flex-wrap items-baseline gap-x-3 gap-y-1 leading-tight',
            loading && 'opacity-60',
          )}
          aria-label={label}
        >
          {alphabetical.map((w) => {
            const size = cloudSize(w.count, max);
            return (
              <li
                key={w.word}
                title={`${w.word}: ${w.count}`}
                style={{ fontSize: size }}
                className={cn(
                  size >= 24
                    ? 'font-bold'
                    : size >= 18
                      ? 'font-semibold'
                      : 'text-stone-600 dark:text-stone-400',
                )}
              >
                {w.word}
                <span className="sr-only"> ({w.count})</span>
              </li>
            );
          })}
        </ul>
      )}
    </ChartCard>
  );
}
