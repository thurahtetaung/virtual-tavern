import type { PlayerProfile } from '@vt/protocol';
import { Button, Panel, cn } from '@vt/ui';
import { useMemo, useState } from 'react';
import { statsApi } from './api.ts';
import { gameColor, useLoad, useStats } from './context.tsx';
import { ago, compact, dateOf, hours, plain } from './format.ts';
import { barsOption, calendarOption, calendarTable } from './options.ts';
import { useChartTokens } from './theme.ts';
import { ChartCard, EChart, EmptyState, HeatKey, Skeleton } from './ui.tsx';
import { FactCard } from './FunTab.tsx';
import { type SortKey, sortPlayers } from './players.ts';

export function PlayersTab() {
  const { params } = useStats();
  return params.player ? <Profile id={params.player} /> : <Leaderboard />;
}

const SORTS: { key: SortKey; label: string; className?: string }[] = [
  { key: 'games', label: 'Games' },
  { key: 'wins', label: 'Wins' },
  { key: 'minutes', label: 'Hours', className: 'hidden sm:table-cell' },
  { key: 'lastSeen', label: 'Last seen', className: 'hidden sm:table-cell' },
];

/** Rows the table shows at first, and how many more each "Show more" adds. */
const PAGE = 25;

function Leaderboard() {
  const ctx = useStats();
  const { query, epoch } = ctx;
  const { data, loading } = useLoad(`players?${query}#${epoch}`, () => statsApi.players(query));
  const [sort, setSort] = useState<SortKey>('games');
  const rows = useMemo(() => sortPlayers(data?.players ?? [], sort), [data, sort]);
  const [now] = useState(() => Date.now());
  // How many rows show; a new range starts again from the first page.
  const [page, setPage] = useState({ query, limit: PAGE });
  const limit = page.query === query ? page.limit : PAGE;

  if (!data) return <Skeleton height={320} />;
  if (rows.length === 0) return <EmptyState>No players in this range yet</EmptyState>;
  return (
    <Panel className={cn('overflow-hidden transition-opacity', loading && 'opacity-60')}>
      <table className="w-full text-sm">
        <caption className="sr-only">
          Players, sorted by {SORTS.find((s) => s.key === sort)!.label.toLowerCase()}
        </caption>
        <thead className="bg-stone-100/80 text-xs text-stone-600 dark:bg-stone-800/60 dark:text-stone-300">
          <tr>
            <th scope="col" className="w-8 py-2 pl-3 text-left font-semibold">
              #
            </th>
            <th scope="col" className="px-2 py-2 text-left font-semibold">
              Player
            </th>
            {SORTS.map((s) => (
              <th
                key={s.key}
                scope="col"
                aria-sort={sort === s.key ? 'descending' : 'none'}
                className={cn('px-1 text-right', s.className)}
              >
                <button
                  type="button"
                  onClick={() => setSort(s.key)}
                  className={cn(
                    'h-11 rounded-lg px-2 font-semibold hover:bg-stone-200/70 dark:hover:bg-stone-700',
                    sort === s.key && 'text-stone-900 dark:text-stone-100',
                  )}
                >
                  {s.label}
                  {sort === s.key && <span aria-hidden> ↓</span>}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((p, i) => (
            <tr
              key={p.id}
              className="border-t border-stone-100 hover:bg-stone-50 dark:border-stone-800 dark:hover:bg-stone-800/40"
            >
              <td className="py-1 pl-3 text-ink-muted tabular-nums">{i + 1}</td>
              <th scope="row" className="max-w-0 px-2 py-1 text-left font-normal sm:max-w-none">
                <button
                  type="button"
                  onClick={() => ctx.setParams({ player: p.id })}
                  className="flex min-h-11 w-full min-w-0 flex-col justify-center rounded-lg text-left hover:text-amber-700 focus-visible:outline-2 focus-visible:outline-accent dark:focus-visible:outline-amber-500 dark:hover:text-amber-400"
                >
                  <span className="truncate font-semibold">{p.name}</span>
                  {p.aliases.length > 1 && (
                    <span className="truncate text-xs text-ink-muted">
                      aka {p.aliases.filter((a) => a !== p.name).join(', ')}
                    </span>
                  )}
                </button>
              </th>
              <td className="px-3 text-right tabular-nums">{plain(p.games)}</td>
              <td className="px-3 text-right tabular-nums">{plain(p.wins)}</td>
              <td className="hidden px-3 text-right tabular-nums sm:table-cell">
                {hours(p.minutes)}
              </td>
              <td className="hidden px-3 text-right whitespace-nowrap text-ink-muted sm:table-cell">
                {ago(p.lastSeen, now)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > limit && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stone-100 px-3 py-2 dark:border-stone-800">
          <span className="text-xs text-ink-muted">
            Showing {plain(limit)} of {plain(rows.length)} players
          </span>
          <Button
            variant="secondary"
            className="h-11"
            onClick={() => setPage({ query, limit: limit + PAGE })}
          >
            Show {plain(Math.min(PAGE, rows.length - limit))} more
          </Button>
        </div>
      )}
    </Panel>
  );
}

function Profile({ id }: { id: string }) {
  const ctx = useStats();
  const { data, loading } = useLoad(`player/${id}#${ctx.epoch}`, () => statsApi.player(id));
  return (
    <div className="space-y-4">
      <Button
        variant="ghost"
        className="-ml-2 h-11"
        onClick={() => ctx.setParams({ player: undefined })}
      >
        ← All players
      </Button>
      {!data || data.id !== id ? (
        loading ? (
          <Skeleton height={320} />
        ) : (
          <EmptyState>That player could not be loaded.</EmptyState>
        )
      ) : (
        <ProfileView p={data} />
      )}
    </div>
  );
}

function ProfileView({ p }: { p: PlayerProfile }) {
  const ctx = useStats();
  const tokens = useChartTokens();
  const byGame = useMemo(
    () =>
      Object.entries(p.byGame)
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([id, n]) => ({
          label: ctx.gameInfo(id).name,
          value: n,
          color: gameColor(ctx, tokens, id),
        })),
    [p.byGame, ctx, tokens],
  );
  const games = useMemo(() => barsOption(byGame, 'games', tokens), [byGame, tokens]);
  const cal = useMemo(() => {
    const days = p.calendar;
    if (days.length === 0) return null;
    return calendarOption(days, days[0]!.day, days[days.length - 1]!.day, tokens);
  }, [p.calendar, tokens]);

  return (
    <>
      <Panel className="space-y-2">
        <h3 className="text-2xl font-bold">{p.name}</h3>
        {p.aliases.length > 1 && (
          <p className="text-sm text-stone-600 dark:text-stone-400">
            Also known as{' '}
            {p.aliases
              .filter((a) => a !== p.name)
              .map((a, i) => (
                <span key={a}>
                  {i > 0 && ', '}
                  <b className="font-semibold">{a}</b>
                </span>
              ))}
          </p>
        )}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 pt-2 text-sm sm:grid-cols-4">
          <Fact label="Games" value={plain(p.games)} />
          <Fact label="Wins" value={plain(p.wins)} />
          <Fact label="Hours" value={hours(p.minutes)} />
          <Fact label="First seen" value={dateOf(p.firstSeen)} />
        </dl>
      </Panel>

      {p.facts.length > 0 && (
        <section aria-label="Fun facts" className="grid gap-3 sm:grid-cols-3">
          {p.facts.map((f) => (
            <FactCard key={f.id} fact={f} />
          ))}
        </section>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Games by game"
          empty={byGame.length === 0}
          table={{ columns: ['Game', 'Games'], rows: byGame.map((r) => [r.label, r.value]) }}
          height={Math.max(60, byGame.length * 36)}
        >
          <EChart
            option={games}
            height={Math.max(60, byGame.length * 36)}
            label={`${p.name}'s games per game`}
          />
        </ChartCard>

        <ChartCard
          title="Names used"
          table={{
            columns: ['Name', 'Uses', 'First', 'Last'],
            rows: p.names.map((n) => [n.name, n.uses, dateOf(n.firstSeen), dateOf(n.lastSeen)]),
          }}
        >
          <ul className="divide-y divide-stone-100 text-sm dark:divide-stone-800">
            {p.names.map((n) => (
              <li key={n.name} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0 truncate font-semibold">{n.name}</span>
                <span className="shrink-0 text-xs text-ink-muted">
                  {compact(n.uses)}× · {dateOf(n.firstSeen)} – {dateOf(n.lastSeen)}
                </span>
              </li>
            ))}
          </ul>
        </ChartCard>
      </div>

      <ChartCard
        title="Activity"
        subtitle="Games per day"
        empty={!p.calendar.some((d) => d.games > 0)}
        legend={<HeatKey tokens={tokens} />}
        table={calendarTable(p.calendar)}
      >
        {cal && (
          <EChart
            option={cal.option}
            width={cal.width}
            height={cal.height}
            label={`Calendar of ${p.name}'s games`}
          />
        )}
      </ChartCard>
    </>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
