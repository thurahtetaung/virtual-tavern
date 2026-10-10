import type { FunFact } from '@vt/protocol';
import { Panel, cn } from '@vt/ui';
import { statsApi } from './api.ts';
import { gameColor, useLoad, useStats } from './context.tsx';
import { useChartTokens } from './theme.ts';
import { EmptyState, Skeleton } from './ui.tsx';

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
    <section
      aria-labelledby="tavern-tales"
      className={cn('space-y-3 transition-opacity', loading && 'opacity-60')}
    >
      <h3 id="tavern-tales" className="text-xl font-bold">
        📜 Tavern tales
      </h3>
      {data.facts.length === 0 ? (
        <EmptyState>No tales in this range yet. Go play something!</EmptyState>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.facts.map((f) => (
            <li key={f.id}>
              <FactCard fact={f} />
            </li>
          ))}
        </ul>
      )}
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
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-stone-500">
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
          className="-mb-2 -ml-2 h-11 self-start rounded-lg px-2 text-sm font-semibold text-amber-700 hover:bg-amber-100/60 dark:text-amber-400 dark:hover:bg-amber-500/10"
        >
          See player →
        </button>
      )}
    </Panel>
  );
}
