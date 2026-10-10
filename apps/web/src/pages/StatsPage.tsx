import type { GameSummary, StatsRange } from '@vt/protocol';
import { STATS_RANGES } from '@vt/protocol';
import { Button, Modal, Panel } from '@vt/ui';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AdminNav } from '../components/AdminNav.tsx';
import { Layout } from '../components/Layout.tsx';
import { clientGames } from '../games/registry.ts';
import { api } from '../lib/api.ts';
import { useToast } from '../lib/toast.tsx';
import { FunTab } from '../stats/FunTab.tsx';
import { GamesTab } from '../stats/GamesTab.tsx';
import { LiveTab } from '../stats/LiveTab.tsx';
import { OverviewTab } from '../stats/OverviewTab.tsx';
import { PlayersTab } from '../stats/PlayersTab.tsx';
import { statsApi } from '../stats/api.ts';
import {
  type GameInfo,
  StatsContext,
  type StatsContextValue,
  useLoad,
  useStats,
} from '../stats/context.tsx';
import { gameSlots } from '../stats/palette.ts';
import {
  BUCKET_LABELS,
  RANGE_LABELS,
  STATS_TABS,
  type StatsParams,
  type StatsTab,
  TAB_LABELS,
  addDays,
  apiQuery,
  bucketsFor,
  parseParams,
  todayUtc,
  updateParams,
  writeParams,
} from '../stats/range.ts';
import { Chip, ChipRow } from '../stats/ui.tsx';

interface Session {
  enabled: boolean;
  signedIn: boolean;
}

export function StatsPage() {
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    void api<Session>('/api/admin/session').then(setSession);
  }, []);

  return (
    <Layout>
      <h1 className="mb-4 text-3xl font-bold">Tavern keeper</h1>
      {!session ? (
        <p className="text-stone-500">Loading…</p>
      ) : !session.enabled || !session.signedIn ? (
        <Panel className="mx-auto max-w-sm space-y-3 text-center">
          <p>The stats are for the tavern keeper. Sign in first.</p>
          <Link
            to="/admin"
            className="inline-flex h-11 items-center justify-center rounded-lg bg-amber-600 px-4 font-semibold text-white hover:bg-amber-500 dark:bg-amber-500 dark:text-stone-950"
          >
            Sign in
          </Link>
        </Panel>
      ) : (
        <>
          <AdminNav current="stats" className="mb-4" />
          <Stats />
        </>
      )}
    </Layout>
  );
}

const ICONS = new Map(clientGames.map((g) => [g.id, g.icon]));

function Stats() {
  const [search, setSearch] = useSearchParams();
  const params = useMemo(() => parseParams(search), [search]);
  const setParams = useCallback(
    (change: Partial<StatsParams>) => {
      setSearch(writeParams(updateParams(params, change)), { replace: change.tab === undefined });
    },
    [params, setSearch],
  );
  const query = apiQuery(params);
  const [epoch, setEpoch] = useState(0);

  // Game names come from the server; private games only appear there for an unlocked browser,
  // so ids that show up in the data are added too (named after their id).
  const [summaries, setSummaries] = useState<GameSummary[]>([]);
  useEffect(() => {
    void api<GameSummary[]>('/api/games')
      .then(setSummaries)
      .catch(() => {});
  }, []);
  const needsMix = params.tab === 'games';
  const mix = useLoad(needsMix ? `overview?${query}#${epoch}` : null, () =>
    statsApi.overview(query),
  );

  const ctx = useMemo<StatsContextValue>(() => {
    const ids = [...summaries.map((g) => g.id), ...(mix.data?.gameMix.map((g) => g.gameId) ?? [])];
    const byId = new Map<string, GameInfo>();
    const info = (id: string): GameInfo => {
      const summary = summaries.find((g) => g.id === id);
      return {
        id,
        name: summary?.name ?? id.charAt(0).toUpperCase() + id.slice(1),
        icon: ICONS.get(id) ?? '🎲',
      };
    };
    for (const id of ids) if (!byId.has(id)) byId.set(id, info(id));
    const slots = gameSlots(ids);
    const games = [...byId.values()].sort(
      (a, b) => (slots.get(a.id) ?? 99) - (slots.get(b.id) ?? 99),
    );
    return {
      params,
      setParams,
      query,
      epoch,
      games,
      slots,
      gameInfo: (id) => byId.get(id) ?? info(id),
    };
  }, [summaries, mix.data, params, setParams, query, epoch]);

  return (
    <StatsContext.Provider value={ctx}>
      <div className="space-y-4">
        <div
          role="tablist"
          aria-label="Stats sections"
          className="-mx-4 flex gap-1.5 overflow-x-auto px-4 [scrollbar-width:none]"
        >
          {STATS_TABS.map((tab) => (
            <Chip
              key={tab}
              role="tab"
              controls="stats-panel"
              selected={params.tab === tab}
              onClick={() => setParams({ tab, player: undefined })}
            >
              {TAB_LABELS[tab]}
            </Chip>
          ))}
        </div>
        {params.tab !== 'live' && <RangePicker />}
        <div id="stats-panel" role="tabpanel" aria-label={TAB_LABELS[params.tab]}>
          <TabBody tab={params.tab} />
        </div>
        <DataTools onReset={() => setEpoch((e) => e + 1)} />
      </div>
    </StatsContext.Provider>
  );
}

function TabBody({ tab }: { tab: StatsTab }) {
  switch (tab) {
    case 'live':
      return <LiveTab />;
    case 'overview':
      return <OverviewTab />;
    case 'games':
      return <GamesTab />;
    case 'players':
      return <PlayersTab />;
    case 'fun':
      return <FunTab />;
  }
}

/** Sticky range and bucket controls; they scope every card below them. */
function RangePicker() {
  const { params, setParams } = useStats();
  const buckets = bucketsFor(params.range, params.from, params.to);
  const today = todayUtc();
  return (
    <div className="sticky top-0 z-20 -mx-4 space-y-2 border-b border-stone-200/80 bg-stone-100/90 px-4 py-2 backdrop-blur dark:border-stone-800 dark:bg-stone-950/90">
      <div className="flex items-center gap-2">
        <ChipRow label="Time range" bleed={false} className="min-w-0 flex-1">
          {STATS_RANGES.map((range: StatsRange) => (
            <Chip
              key={range}
              selected={params.range === range}
              onClick={() =>
                setParams(
                  range === 'custom'
                    ? { range, from: params.from ?? addDays(today, -29), to: params.to ?? today }
                    : { range },
                )
              }
            >
              {RANGE_LABELS[range]}
            </Chip>
          ))}
        </ChipRow>
        <label className="shrink-0">
          <span className="sr-only">Group by</span>
          <select
            value={params.bucket}
            onChange={(e) => setParams({ bucket: e.target.value as StatsParams['bucket'] })}
            className="h-11 rounded-lg bg-white px-2 text-sm font-semibold ring-1 ring-stone-300 dark:bg-stone-900 dark:ring-stone-700"
          >
            {buckets.map((b) => (
              <option key={b} value={b}>
                {BUCKET_LABELS[b]}
              </option>
            ))}
          </select>
        </label>
      </div>
      {params.range === 'custom' && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5">
            From
            <input
              type="date"
              value={params.from ?? ''}
              max={params.to ?? today}
              onChange={(e) => e.target.value && setParams({ from: e.target.value })}
              className="h-11 rounded-lg bg-white px-2 ring-1 ring-stone-300 dark:bg-stone-900 dark:ring-stone-700"
            />
          </label>
          <label className="flex items-center gap-1.5">
            to
            <input
              type="date"
              value={params.to ?? ''}
              min={params.from}
              max={today}
              onChange={(e) => e.target.value && setParams({ to: e.target.value })}
              className="h-11 rounded-lg bg-white px-2 ring-1 ring-stone-300 dark:bg-stone-900 dark:ring-stone-700"
            />
          </label>
        </div>
      )}
    </div>
  );
}

/** Export and reset, at the foot of every tab. */
function DataTools({ onReset }: { onReset: () => void }) {
  const toast = useToast();
  const { params, query } = useStats();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const exportQuery = params.tab === 'live' ? apiQuery({ ...params, range: 'all' }) : query;

  const reset = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await statsApi.reset();
      toast('Stats reset. History starts again from now.', 'info');
      setConfirming(false);
      setTyped('');
      onReset();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h2 className="font-semibold">Stats data</h2>
        <p className="text-xs text-stone-500">
          {params.tab === 'live'
            ? 'Exports every recorded event.'
            : 'Exports the raw events in the selected range.'}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <a
          href={statsApi.exportUrl(exportQuery)}
          download="tavern-stats.ndjson"
          className="inline-flex h-11 items-center justify-center rounded-lg bg-white px-4 font-semibold text-stone-800 ring-1 ring-stone-300 hover:bg-stone-50 dark:bg-stone-800 dark:text-stone-100 dark:ring-stone-600 dark:hover:bg-stone-700"
        >
          Export events (NDJSON)
        </a>
        <Button variant="danger" className="h-11" onClick={() => setConfirming(true)}>
          Reset stats
        </Button>
      </div>
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Reset all stats?"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" className="h-11" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              className="h-11"
              type="submit"
              form="reset-stats"
              disabled={typed.trim().toLowerCase() !== 'reset' || busy}
            >
              Reset stats
            </Button>
          </div>
        }
      >
        <form id="reset-stats" onSubmit={(e) => void reset(e)} className="space-y-3">
          <p className="text-sm">
            This deletes every recorded event, daily rollup and player history. It cannot be undone.
            Export first if you might want them later.
          </p>
          <label className="block">
            <span className="text-sm font-semibold">
              Type <b>reset</b> to confirm
            </span>
            <input
              data-autofocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="mt-1 h-11 w-full rounded-lg bg-white px-3 ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600"
            />
          </label>
        </form>
      </Modal>
    </Panel>
  );
}
