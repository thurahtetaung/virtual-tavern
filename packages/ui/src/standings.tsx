import { type Placed, ordinal, rankStandings } from '@vt/game-sdk';
import type { ReactNode } from 'react';
import { cn } from './cn.ts';
import { NameDot } from './player-colors.tsx';

export interface StandingEntry {
  id: string;
  name: string;
  score: number;
  /** Shown under the name in the full standings, e.g. "fooled 3". */
  note?: ReactNode;
}

const MEDALS = ['🥇', '🥈', '🥉'];
/** Podium step heights, by place. */
const STEP = ['h-20', 'h-14', 'h-10'];

/**
 * The shared end screen: a podium for the top three places and the full final standings below.
 * Players who tie share a place (and a step). The "X wins" line belongs to the game's status
 * line, so this never repeats it.
 */
export function Standings({
  entries,
  you,
  scoreLabel = (n) => `${n} ${n === 1 ? 'point' : 'points'}`,
  lowerIsBetter = false,
  title = 'Final standings',
  className,
}: {
  entries: readonly StandingEntry[];
  /** The viewer's id, to mark their row. */
  you?: string;
  scoreLabel?: (score: number) => string;
  lowerIsBetter?: boolean;
  title?: string;
  className?: string;
}) {
  const ranked = rankStandings(entries, (e) => e.score, { lowerIsBetter });
  const places = [...new Set(ranked.map((r) => r.place))].filter((p) => p <= 3);
  const onPlace = (place: number) => ranked.filter((r) => r.place === place);
  // Second, first, third: the classic podium shape (only the places that exist).
  const order = [places[1], places[0], places[2]].filter((p): p is number => p !== undefined);
  const label = (r: Placed<StandingEntry>) =>
    `${r.tied ? 'joint ' : ''}${ordinal(r.place)}: ${r.entry.name}, ${scoreLabel(r.entry.score)}`;
  return (
    <section aria-label={title} className={cn('space-y-3', className)}>
      {entries.length > 1 && (
        <ol aria-label="Podium" className="flex items-end justify-center gap-2">
          {order.map((place) => {
            const step = places.indexOf(place);
            return (
              <li key={place} className="flex w-28 min-w-0 flex-col items-center gap-1">
                <span aria-hidden className="text-2xl">
                  {MEDALS[step]}
                </span>
                <ul className="w-full text-center text-sm leading-tight">
                  {onPlace(place).map((r) => (
                    <li
                      key={r.entry.id}
                      className="flex items-center justify-center gap-1 font-semibold"
                      aria-label={label(r)}
                    >
                      <span className="truncate">
                        {r.entry.name}
                        {r.entry.id === you && ' (you)'}
                      </span>
                      <NameDot name={r.entry.name} className="order-first" />
                    </li>
                  ))}
                </ul>
                <div
                  aria-hidden
                  className={cn(
                    'flex w-full items-start justify-center rounded-t-lg pt-1 text-sm font-bold tabular-nums',
                    STEP[step],
                    step === 0
                      ? 'bg-accent-soft text-accent-text ring-1 ring-accent-line dark:bg-amber-500 dark:text-stone-950 dark:ring-0'
                      : 'bg-stone-200 text-stone-700 dark:bg-stone-700 dark:text-stone-100',
                  )}
                >
                  {scoreLabel(onPlace(place)[0]!.entry.score)}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      <div>
        <h3 className="mb-1 text-sm font-semibold text-stone-600 dark:text-stone-400">{title}</h3>
        <ol className="divide-y divide-stone-200 rounded-xl ring-1 ring-stone-200 dark:divide-stone-800 dark:ring-stone-800">
          {ranked.map((r) => (
            <li
              key={r.entry.id}
              className={cn(
                'flex items-center gap-3 px-3 py-2',
                r.entry.id === you && 'bg-accent-soft dark:bg-amber-500/10',
              )}
            >
              <span className="w-10 shrink-0 text-sm font-bold text-ink-muted tabular-nums dark:text-stone-400">
                {r.tied ? '=' : ''}
                {ordinal(r.place)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1 font-medium">
                  <span className="truncate">
                    {r.entry.name}
                    {r.entry.id === you && ' (you)'}
                  </span>
                  <NameDot name={r.entry.name} className="order-first" />
                </span>
                {r.entry.note && (
                  <span className="block text-xs text-ink-muted">{r.entry.note}</span>
                )}
              </span>
              <span className="shrink-0 font-semibold tabular-nums">
                {scoreLabel(r.entry.score)}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
