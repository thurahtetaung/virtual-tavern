import type { StatsOverview } from '@vt/protocol';
import { cn } from '@vt/ui';
import { useMemo } from 'react';
import { statsApi } from './api.ts';
import { gameColor, useLoad, useStats } from './context.tsx';
import { compact, delta, hours, longDay, percent, plain, pointsDelta } from './format.ts';
import {
  activityTable,
  barsOption,
  calendarOption,
  calendarTable,
  isEmptySeries,
  stackedActivityOption,
  weekHourOption,
  weekHourTable,
} from './options.ts';
import { useChartTokens } from './theme.ts';
import { ChartCard, EChart, HeatKey, Legend, StatTile } from './ui.tsx';

export function OverviewTab() {
  const { query, epoch } = useStats();
  const { data, loading } = useLoad(`overview?${query}#${epoch}`, () => statsApi.overview(query));
  return <OverviewView data={data} loading={loading} />;
}

const finishedShare = (t: StatsOverview['totals']) =>
  t.gamesStarted ? t.gamesFinished / t.gamesStarted : 0;

function OverviewView({ data, loading }: { data?: StatsOverview; loading: boolean }) {
  const ctx = useStats();
  const tokens = useChartTokens();
  const first = !data;
  const t = data?.totals;
  const p = data?.previous;

  const gamesInData = useMemo(() => {
    if (!data) return [];
    // Every game in the mix, in slot order, so colours and stacking order are stable.
    return data.gameMix
      .map((g) => g.gameId)
      .sort((a, b) => (ctx.slots.get(a) ?? 99) - (ctx.slots.get(b) ?? 99) || a.localeCompare(b));
  }, [data, ctx.slots]);
  const series = useMemo(
    () =>
      gamesInData.map((id) => ({
        id,
        name: ctx.gameInfo(id).name,
        color: gameColor(ctx, tokens, id),
      })),
    [gamesInData, ctx, tokens],
  );

  const activity = useMemo(
    () => (data ? stackedActivityOption(data.activity, series, data.window.bucket, tokens) : null),
    [data, series, tokens],
  );
  const calendar = useMemo(
    () => (data ? calendarOption(data.calendar, data.window.from, data.window.to, tokens) : null),
    [data, tokens],
  );
  const weekHour = useMemo(
    () => (data ? weekHourOption(data.weekHour, tokens) : null),
    [data, tokens],
  );
  const mixRows = useMemo(
    () =>
      data
        ? [...data.gameMix]
            .filter((g) => g.games > 0)
            .sort((a, b) => b.games - a.games)
            .map((g) => ({
              label: ctx.gameInfo(g.gameId).name,
              value: g.games,
              color: gameColor(ctx, tokens, g.gameId),
              minutes: g.minutes,
            }))
        : [],
    [data, ctx, tokens],
  );
  const mix = useMemo(() => barsOption(mixRows, 'games', tokens), [mixRows, tokens]);

  const noGames = !!data && data.totals.gamesStarted === 0;
  const windowText = data ? `${longDay(data.window.from)} – ${longDay(data.window.to)}` : '';

  return (
    <div
      className={cn('space-y-4 transition-opacity', loading && !first && 'opacity-60')}
      aria-busy={loading}
    >
      {data && (
        <p className="text-xs text-stone-500">
          {windowText} · deltas compare with the window before
        </p>
      )}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile
          label="Rooms created"
          loading={first}
          value={t ? compact(t.roomsCreated) : ''}
          delta={t && p ? delta(t.roomsCreated, p.roomsCreated) : undefined}
        />
        <StatTile
          label="Games started"
          loading={first}
          value={t ? compact(t.gamesStarted) : ''}
          delta={t && p ? delta(t.gamesStarted, p.gamesStarted) : undefined}
        />
        <StatTile
          label="Finished"
          loading={first}
          value={t ? percent(finishedShare(t)) : ''}
          delta={
            t && p && p.gamesStarted > 0
              ? pointsDelta(finishedShare(t), finishedShare(p))
              : undefined
          }
          hint={t ? `${plain(t.gamesAbandoned)} abandoned` : undefined}
        />
        <StatTile
          label="Unique players"
          loading={first}
          value={t ? compact(t.uniquePlayers) : ''}
          delta={t && p ? delta(t.uniquePlayers, p.uniquePlayers) : undefined}
        />
        <StatTile
          className="col-span-2 sm:col-span-1"
          label="Hours played"
          loading={first}
          value={t ? hours(t.minutesPlayed) : ''}
          delta={t && p ? delta(t.minutesPlayed, p.minutesPlayed) : undefined}
        />
      </div>

      <ChartCard
        title="Games started"
        subtitle="Stacked by game"
        loading={first}
        empty={!!data && isEmptySeries(data.activity)}
        legend={<Legend items={series} />}
        table={data ? activityTable(data.activity, series, data.window.bucket) : undefined}
      >
        {activity && (
          <EChart
            option={activity}
            height={220}
            label={`Games started per ${data!.window.bucket}, stacked by game`}
          />
        )}
      </ChartCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Game nights calendar"
          subtitle="Games started per day"
          loading={first}
          empty={noGames}
          legend={<HeatKey tokens={tokens} />}
          table={data ? calendarTable(data.calendar) : undefined}
          height={130}
        >
          {calendar && (
            <EChart
              option={calendar.option}
              width={calendar.width}
              height={calendar.height}
              label="Calendar of games started per day"
            />
          )}
        </ChartCard>

        <ChartCard
          title="When we play"
          subtitle="Games started by weekday and hour (UTC)"
          loading={first}
          empty={noGames}
          legend={<HeatKey tokens={tokens} />}
          table={data ? weekHourTable(data.weekHour) : undefined}
          height={200}
        >
          {weekHour && (
            <EChart
              option={weekHour}
              height={200}
              label="Heatmap of games started by weekday and hour"
            />
          )}
        </ChartCard>
      </div>

      <ChartCard
        title="Game mix"
        subtitle="Games started per game"
        loading={first}
        empty={noGames}
        table={{
          columns: ['Game', 'Games', 'Hours'],
          rows: mixRows.map((r) => [r.label, r.value, hours(r.minutes)]),
        }}
        height={Math.max(60, mixRows.length * 36)}
      >
        <EChart
          option={mix}
          height={Math.max(60, mixRows.length * 36)}
          label="Games started per game"
        />
      </ChartCard>
    </div>
  );
}
