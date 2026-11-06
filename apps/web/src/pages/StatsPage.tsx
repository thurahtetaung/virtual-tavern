import type { GameSummary, StatsGameName, StatsRange } from '@vt/protocol';
import { STATS_RANGES } from '@vt/protocol';
import {
  Button,
  Modal,
  Panel,
  Slate,
  buttonClass,
  Tabs,
  Chips,
  Chip,
  Field,
  Input,
  Select,
  tabPanelProps,
} from '@vt/ui';
import { type FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { AdminFrame, AdminTitle } from '../components/AdminNav.tsx';
import { Layout } from '../components/Layout.tsx';
import { clientGames, usePrivateGames } from '../games/registry.ts';
import { api } from '../lib/api.ts';
import { usePageTitle } from '../lib/title.ts';
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
  exportQuery,
  parseParams,
  todayUtc,
  updateParams,
  writeParams,
} from '../stats/range.ts';
import { fetchGames } from '../lib/games.ts';

interface Session {
  enabled: boolean;
  signedIn: boolean;
}

export function StatsPage() {
  usePageTitle('Stats');
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    void api<Session>('/api/admin/session').then(setSession);
  }, []);

  return (
    <Layout admin>
      <AdminTitle
        signedIn={session?.signedIn}
        onSignOut={() => setSession((s) => s && { ...s, signedIn: false })}
      />
      {!session ? (
        <Slate kind="loading" title="Loading…" />
      ) : !session.enabled || !session.signedIn ? (
        <Slate
          icon="lock"
          className="mx-auto max-w-sm"
          title={<>The stats are for the tavern keeper. Sign in first.</>}
        >
          <Link to="/tavern-keeper" className={buttonClass()}>
            Sign in
          </Link>
        </Slate>
      ) : (
        <AdminFrame current="stats">
          <Stats />
        </AdminFrame>
      )}
    </Layout>
  );
}

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

  // Game names: /api/games lists the public ones (private games only for an unlocked browser),
  // and the stats responses name every game in their data, private ones included.
  const [summaries, setSummaries] = useState<GameSummary[]>([]);
  useEffect(() => {
    void fetchGames()
      .then(setSummaries)
      .catch(() => {});
  }, []);
  const [learned, setLearned] = useState<ReadonlyMap<string, string>>(new Map());
  const learnGames = useCallback((games: readonly StatsGameName[]) => {
    setLearned((known) =>
      games.every((g) => known.get(g.id) === g.name)
        ? known
        : new Map([...known, ...games.map((g) => [g.id, g.name] as const)]),
    );
  }, []);
  const needsMix = params.tab === 'games' || params.tab === 'fun';
  const mix = useLoad(needsMix ? `overview?${query}#${epoch}` : null, () =>
    statsApi.overview(query),
  );

  // Every game's own emoji: the back room's come with its registry (the admin always has it).
  const privateGames = usePrivateGames(true);
  const ctx = useMemo<StatsContextValue>(() => {
    const icons = new Map([...clientGames, ...privateGames].map((g) => [g.id, g.icon]));
    const names = new Map([
      ...learned,
      ...(mix.data?.games.map((g) => [g.id, g.name] as const) ?? []),
    ]);
    const ids = [
      ...summaries.map((g) => g.id),
      ...names.keys(),
      ...(mix.data?.gameMix.map((g) => g.gameId) ?? []),
    ];
    const byId = new Map<string, GameInfo>();
    const info = (id: string): GameInfo => ({
      id,
      name:
        names.get(id) ??
        summaries.find((g) => g.id === id)?.name ??
        id.charAt(0).toUpperCase() + id.slice(1),
      icon: icons.get(id) ?? '🎲',
    });
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
      learnGames,
    };
  }, [summaries, privateGames, learned, learnGames, mix.data, params, setParams, query, epoch]);

  return (
    <StatsContext.Provider value={ctx}>
      <div className="space-y-4">
        <Tabs
          id="stats"
          label="Stats sections"
          tabs={STATS_TABS.map((id) => ({ id, label: TAB_LABELS[id] }))}
          value={params.tab}
          onChange={(tab) => setParams({ tab, player: undefined })}
        />
        {params.tab !== 'live' && <RangePicker />}
        <div {...tabPanelProps('stats', params.tab)} aria-label={TAB_LABELS[params.tab]}>
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
    <div className="sticky top-0 z-20 space-y-2 border-b border-line bg-panel p-2 backdrop-blur ">
      <div className="flex items-center gap-2">
        <Chips label="Time range" className="min-w-0 flex-1">
          {STATS_RANGES.map((range: StatsRange) => (
            <Chip
              key={range}
              pressed={params.range === range}
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
        </Chips>
        <label className="shrink-0">
          <span className="sr-only">Group by</span>
          <Select
            value={params.bucket}
            onChange={(e) => setParams({ bucket: e.target.value as StatsParams['bucket'] })}
            className="w-32"
          >
            {buckets.map((b) => (
              <option key={b} value={b}>
                {BUCKET_LABELS[b]}
              </option>
            ))}
          </Select>
        </label>
      </div>
      {params.range === 'custom' && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-1.5">
            From
            <Input
              type="date"
              value={params.from ?? ''}
              max={params.to ?? today}
              onChange={(e) => e.target.value && setParams({ from: e.target.value })}
              className="w-auto"
            />
          </label>
          <label className="flex items-center gap-1.5">
            to
            <Input
              type="date"
              value={params.to ?? ''}
              min={params.from}
              max={today}
              onChange={(e) => e.target.value && setParams({ to: e.target.value })}
              className="w-auto"
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
  const { params } = useStats();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const exportRange = exportQuery(params.tab === 'live' ? { range: 'all' } : params);

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
    <Panel className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between lg:p-5">
      <div>
        <h2 className="text-sub font-semibold">Stats data</h2>
        <p className="text-small text-ink-muted">
          {params.tab === 'live'
            ? 'Exports every recorded event.'
            : 'Exports the raw events in the selected range.'}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <a
          href={statsApi.exportUrl(exportRange)}
          download="tavern-stats.ndjson"
          className={buttonClass({ variant: 'secondary' })}
        >
          Export events (NDJSON)
        </a>
        <div className="grid justify-items-start gap-1 sm:justify-items-end">
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Reset stats
          </Button>
          <p className="text-caption text-ink-muted">It cannot be undone.</p>
        </div>
      </div>
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Reset all stats?"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
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
          <p className="text-small text-ink-2">
            This deletes every recorded event, daily rollup and player history. It cannot be undone.
            Export first if you might want them later.
          </p>
          <Field
            label={
              <>
                Type <b>reset</b> to confirm
              </>
            }
          >
            <Input
              data-autofocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
            />
          </Field>
        </form>
      </Modal>
    </Panel>
  );
}
