import type { FunFact, RecentNight, RoomRecap } from '@vt/protocol';
import { Panel, cn } from '@vt/ui';
import { useEffect, useMemo, useState } from 'react';
import { Drawer } from '../components/Drawer.tsx';
import { type CardContext, NightCard, nightLabel } from '../recap/RecapSheet.tsx';
import { statsApi } from './api.ts';
import { gameColor, useLoad, useStats } from './context.tsx';
import { useChartTokens } from './theme.ts';
import { EmptyState, Skeleton, StatTile } from './ui.tsx';

/** Fun: "Tavern tales", the superlatives of the range. */
export function FunTab() {
  const { query, epoch } = useStats();
  const { data, loading } = useLoad(`fun?${query}#${epoch}`, () => statsApi.fun(query));
  if (!data) {
    return (
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} height={110} />
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-6">
      <TavernTales facts={data.facts} loading={loading} />
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <StatTile label="Recaps viewed" value={data.recaps.viewed} loading={loading} />
        <StatTile
          label="Recaps shared"
          value={data.recaps.shared}
          hint="Copied, shared or saved as a picture"
          loading={loading}
        />
      </div>
      <RecentNights />
    </div>
  );
}

function TavernTales({ facts, loading }: { facts: FunFact[]; loading: boolean }) {
  return (
    <section
      aria-labelledby="tavern-tales"
      className={cn('space-y-3 transition-opacity', loading && 'opacity-60')}
    >
      <h3 id="tavern-tales" className="text-xl font-bold">
        📜 Tavern tales
      </h3>
      {facts.length === 0 ? (
        <EmptyState>No tales in this range yet. Go play something!</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {facts.map((f) => (
            <li key={f.id}>
              <FactCard fact={f} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** "Recent tavern nights": the latest frozen night cards, each opening as it was frozen. */
function RecentNights() {
  const ctx = useStats();
  const { epoch } = ctx;
  const [nights, setNights] = useState<RecentNight[] | null>(null);
  const [open, setOpen] = useState<{ night: RecentNight; card: RoomRecap | null } | null>(null);
  useEffect(() => {
    let live = true;
    void statsApi
      .nights()
      .then((r) => {
        if (live) setNights(r.nights);
      })
      .catch(() => {
        if (live) setNights([]);
      });
    return () => {
      live = false;
    };
  }, [epoch]);
  const show = (night: RecentNight) => {
    setOpen({ night, card: null });
    void statsApi
      .night(night.roomId, night.nightKey)
      .then((card) => setOpen((o) => (o?.night === night ? { night, card } : o)))
      .catch(() => setOpen(null));
  };
  const card = open?.card ?? null;
  const cardCtx = useMemo((): CardContext => {
    const names = new Map<string, string>();
    for (const p of card?.players ?? []) names.set(p.id, p.name);
    for (const p of card?.audience ?? []) names.set(p.id, p.name);
    return {
      names,
      labels: null,
      gameInfo: (id) => {
        const g = ctx.gameInfo(id);
        return { name: card?.games.find((x) => x.gameId === id)?.name ?? g.name, icon: g.icon };
      },
    };
  }, [card, ctx]);

  return (
    <section aria-labelledby="recent-nights" className="space-y-3">
      <h3 id="recent-nights" className="text-xl font-bold">
        🍻 Recent tavern nights
      </h3>
      {!nights ? (
        <Skeleton height={90} />
      ) : nights.length === 0 ? (
        <EmptyState>No wrapped-up nights yet. The tavern awaits!</EmptyState>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {nights.map((n) => (
            <li key={`${n.roomId}:${n.nightKey}`}>
              <button
                type="button"
                onClick={() => show(n)}
                className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl bg-white px-3 py-2 text-left text-sm ring-1 ring-stone-200 hover:bg-stone-100 dark:bg-stone-900 dark:ring-stone-800 dark:hover:bg-stone-800"
              >
                <span>
                  <b>{nightLabel(n, (id) => ctx.gameInfo(id))}</b>
                  <span className="text-stone-600 dark:text-stone-400">
                    {' '}
                    · {n.games} {n.games === 1 ? 'game' : 'games'}
                    {n.mvp && <> · 👑 {n.mvp}</>}
                  </span>
                </span>
                <span aria-hidden>›</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <Drawer open={open !== null} onClose={() => setOpen(null)} title="🍻 A night at the tavern">
        {card ? (
          <div className="flex flex-col gap-4">
            <NightCard recap={card} ctx={cardCtx} />
          </div>
        ) : (
          <p className="py-10 text-center text-ink-muted">Pouring…</p>
        )}
      </Drawer>
    </section>
  );
}

export function FactCard({ fact }: { fact: FunFact }) {
  const ctx = useStats();
  const tokens = useChartTokens();
  const game = fact.gameId ? ctx.gameInfo(fact.gameId) : undefined;
  return (
    <Panel className="flex h-full flex-col gap-1.5 p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="font-semibold">{fact.title}</h4>
        {game && (
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-muted">
            <span
              aria-hidden
              className="inline-block size-2 rounded-full"
              style={{ background: gameColor(ctx, tokens, game.id) }}
            />
            {game.name}
          </span>
        )}
      </div>
      <p className="text-sm text-stone-700 dark:text-stone-300">{fact.text}</p>
      {fact.playerId && fact.playerId !== ctx.params.player && (
        <button
          type="button"
          onClick={() => ctx.setParams({ tab: 'players', player: fact.playerId })}
          className="-mb-2 -ml-2 h-11 self-start rounded-lg px-2 text-sm font-semibold text-amber-700 hover:bg-accent-soft/60 dark:text-amber-400 dark:hover:bg-amber-500/10"
        >
          See player →
        </button>
      )}
    </Panel>
  );
}
