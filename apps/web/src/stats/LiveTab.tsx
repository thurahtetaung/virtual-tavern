import type { LiveStats } from '@vt/protocol';
import { Badge, Panel, cn } from '@vt/ui';
import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../lib/toast.tsx';
import { statsApi } from './api.ts';
import { gameColor, useInterval, useStats } from './context.tsx';
import { age, ago, compact } from './format.ts';
import { sparklineOption } from './options.ts';
import { useChartTokens } from './theme.ts';
import { ChartCard, EChart, EmptyState, Skeleton, StatTile } from './ui.tsx';

export const LIVE_POLL_MS = 5000;

const PHASE_LABEL: Record<string, string> = {
  lobby: 'In the lobby',
  playing: 'Playing',
  over: 'Finished',
};

/** Live: polls every 5 s while the tab is visible. Times are measured against the server's clock. */
export function LiveTab() {
  const toast = useToast();
  const [live, setLive] = useState<LiveStats | null>(null);
  const [failed, setFailed] = useState(false);

  const poll = () => {
    statsApi
      .live()
      .then((l) => {
        setLive(l);
        setFailed(false);
      })
      .catch((err: Error) => {
        // One toast per outage, not one every five seconds.
        setFailed((was) => {
          if (!was) toast(err.message);
          return true;
        });
      });
  };
  useInterval(poll, LIVE_POLL_MS);

  if (!live) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <StatTile key={i} label="…" value="" loading />
          ))}
        </div>
        <Skeleton height={120} />
        {failed && <EmptyState>Live stats are unavailable right now.</EmptyState>}
      </div>
    );
  }
  return <LiveView live={live} stale={failed} />;
}

function LiveView({ live, stale }: { live: LiveStats; stale: boolean }) {
  const ctx = useStats();
  const { learnGames } = ctx;
  useEffect(() => {
    learnGames(live.games);
  }, [live.games, learnGames]);
  const tokens = useChartTokens();
  const playing = live.rooms.filter((r) => r.phase === 'playing').length;
  const spark = useMemo(
    () =>
      sparklineOption(
        live.lastHour.map((p) => ({ ts: p.ts, value: p.players })),
        tokens.series[0]!,
        'players online',
        tokens,
      ),
    [live.lastHour, tokens],
  );
  const peak = live.lastHour.reduce((m, p) => Math.max(m, p.players), 0);

  return (
    <div className={cn('space-y-4 transition-opacity', stale && 'opacity-60')}>
      <p className="text-xs text-stone-500" aria-live="polite">
        <span
          aria-hidden
          className={cn(
            'mr-1 inline-block size-2 rounded-full',
            stale
              ? 'bg-stone-400'
              : 'animate-pulse bg-success motion-reduce:animate-none dark:bg-green-600',
          )}
        />
        {stale ? 'Reconnecting… showing the last answer.' : 'Live · refreshes every 5 seconds'}
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile
          label="Players online"
          value={compact(live.playersOnline)}
          hint={`${live.playersRecent} in the last 5 min`}
        />
        <StatTile label="Rooms open" value={compact(live.rooms.length)} />
        <StatTile label="Games in progress" value={compact(playing)} />
        <StatTile label="Open tabs" value={compact(live.sockets)} />
      </div>
      {(live.playtests ?? 0) > 0 && (
        <p className="text-sm text-stone-600 dark:text-stone-400">
          <span aria-hidden>🧪 </span>
          {live.playtests} {live.playtests === 1 ? 'playtest' : 'playtests'} running (not counted
          above)
        </p>
      )}

      {live.byGame.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Rooms per game">
          {live.byGame.map((g) => {
            const info = ctx.gameInfo(g.gameId);
            return (
              <li
                key={g.gameId}
                className="flex items-center gap-2 rounded-full bg-white/80 px-3 py-1.5 text-sm ring-1 ring-stone-200 dark:bg-stone-900/80 dark:ring-stone-800"
              >
                <span
                  aria-hidden
                  className="inline-block size-2.5 rounded-full"
                  style={{ background: gameColor(ctx, tokens, g.gameId) }}
                />
                <span className="font-semibold">
                  {info.icon} {info.name}
                </span>
                <span className="text-stone-500">
                  {g.rooms} room{g.rooms === 1 ? '' : 's'} · {g.playing} playing · {g.players}{' '}
                  players
                </span>
              </li>
            );
          })}
        </ul>
      )}

      <ChartCard
        title="Players online, last hour"
        subtitle={`Peak ${peak} · now ${live.playersOnline}`}
        height={96}
        table={{
          columns: ['Time (UTC)', 'Players'],
          rows: live.lastHour
            .filter((_, i) => i % 5 === 0 || i === live.lastHour.length - 1)
            .map((p) => [new Date(p.ts).toISOString().slice(11, 16), p.players]),
        }}
      >
        <EChart
          option={spark}
          height={96}
          label={`Players online over the last hour, peak ${peak}, now ${live.playersOnline}`}
        />
      </ChartCard>

      <section aria-labelledby="live-rooms" className="space-y-2">
        <h3 id="live-rooms" className="font-semibold">
          Live rooms
        </h3>
        {live.rooms.length === 0 ? (
          <EmptyState>Nobody is in a room right now.</EmptyState>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {[...live.rooms]
              .sort((a, b) => b.updatedAt - a.updatedAt)
              .map((room) => {
                const info = ctx.gameInfo(room.gameId);
                const online = room.players.filter((p) => p.connected).length;
                return (
                  <li key={room.id}>
                    <Panel className="space-y-2 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2 font-semibold">
                          <span
                            aria-hidden
                            className="inline-block size-2.5 shrink-0 rounded-full"
                            style={{ background: gameColor(ctx, tokens, room.gameId) }}
                          />
                          <span className="truncate">
                            {info.icon} {info.name}
                          </span>
                        </span>
                        <Badge
                          className={
                            room.phase === 'playing'
                              ? 'bg-accent-soft text-amber-900 dark:bg-amber-500/20 dark:text-amber-200'
                              : undefined
                          }
                        >
                          {PHASE_LABEL[room.phase] ?? room.phase}
                        </Badge>
                      </div>
                      <ul className="flex flex-wrap gap-1.5 text-sm" aria-label="Players">
                        {room.players.map((p) => (
                          <li
                            key={p.id}
                            className={cn(
                              'flex items-center gap-1 rounded-full px-2 py-0.5',
                              p.connected
                                ? 'bg-stone-100 dark:bg-stone-800'
                                : 'text-stone-400 line-through decoration-stone-400/60',
                            )}
                          >
                            {p.id === room.hostId && (
                              <span role="img" aria-label="host">
                                👑
                              </span>
                            )}
                            {p.name}
                            {!p.connected && <span className="sr-only"> (offline)</span>}
                          </li>
                        ))}
                      </ul>
                      <p className="text-xs text-stone-500">
                        {online}/{room.players.length} online · open {age(room.createdAt, live.now)}{' '}
                        · last move {ago(room.updatedAt, live.now)}
                      </p>
                    </Panel>
                  </li>
                );
              })}
          </ul>
        )}
      </section>
    </div>
  );
}
