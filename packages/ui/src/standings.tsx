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
 * The shared end screen: a podium for the top three places, and the full final standings below
 * only when someone is off the podium (the scores are shown once). Players who tie share a place
 * (and a step). The "X wins" line belongs to the game's banner, so this never repeats it.
 */
export function Standings({
  entries,
  you,
  scoreLabel = (n) => `${n} ${n === 1 ? 'point' : 'points'}`,
  lowerIsBetter = false,
  title = 'Final standings',
  phoneTable = false,
  className,
}: {
  entries: readonly StandingEntry[];
  /** The viewer's id, to mark their row. */
  you?: string;
  scoreLabel?: (score: number) => string;
  lowerIsBetter?: boolean;
  title?: string;
  /** Phones show the table in place of the podium (a game whose end screen is tight). */
  phoneTable?: boolean;
  className?: string;
}) {
  const ranked = rankStandings(entries, (e) => e.score, { lowerIsBetter });
  const places = [...new Set(ranked.map((r) => r.place))].filter((p) => p <= 3);
  const onPlace = (place: number) => ranked.filter((r) => r.place === place);
  // Second, first, third: the classic podium shape (only the places that exist).
  const order = [places[1], places[0], places[2]].filter((p): p is number => p !== undefined);
  // A big table on a phone: tighter rows and no podium (the table repeats it), so it fits.
  const dense = entries.length > 6;
  // A big table always shows on phones (no podium there); otherwise only someone off the podium needs it.
  const table = entries.length < 2 || dense || ranked.some((r) => r.place > 3);
  const label = (r: Placed<StandingEntry>) =>
    `${r.tied ? 'joint ' : ''}${ordinal(r.place)}: ${r.entry.name}, ${scoreLabel(r.entry.score)}`;
  return (
    <section aria-label={title} className={cn('space-y-3', className)}>
      <h3 className="text-caption font-semibold tracking-[0.08em] text-ink-muted uppercase">
        {title}
      </h3>
      {entries.length > 1 && (
        <ol
          aria-label="Podium"
          className={cn(
            'flex items-end justify-center gap-2',
            (dense || phoneTable) && 'max-lg:hidden',
          )}
        >
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
                      className="flex flex-wrap items-center justify-center gap-x-1 font-semibold"
                      aria-label={label(r)}
                    >
                      <span className="truncate">
                        {r.entry.name}
                        {r.entry.id === you && ' (you)'}
                      </span>
                      <NameDot name={r.entry.name} className="order-first" />
                      {!table && r.entry.note && (
                        // Without the table, the podium carries each player's note.
                        <span className="block basis-full text-xs font-normal text-ink-muted">
                          {r.entry.note}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                <div
                  aria-hidden
                  className={cn(
                    'flex w-full items-start justify-center rounded-t-lg border border-b-0 pt-1.5 font-display text-small font-semibold tabular-nums',
                    STEP[step],
                    step === 0
                      ? 'border-accent-line bg-accent-soft text-accent-text'
                      : 'border-line bg-sunk text-ink-2',
                  )}
                >
                  {scoreLabel(onPlace(place)[0]!.entry.score)}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {(table || phoneTable) && (
        <div className={cn(!table && 'lg:hidden')}>
          <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-card">
            {ranked.map((r) => (
              <li
                key={r.entry.id}
                className={cn(
                  'flex items-center gap-3 px-3 py-2',
                  dense && 'max-lg:py-1 max-lg:text-sm',
                  r.entry.id === you && 'bg-accent-soft',
                )}
              >
                <span className="w-10 shrink-0 font-display text-small font-semibold text-ink-muted tabular-nums">
                  {r.tied ? '=' : ''}
                  {ordinal(r.place)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 font-medium">
                    <span className="truncate">
                      {r.entry.name}
                      {r.entry.id === you && <span className="text-ink-muted"> (you)</span>}
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
      )}
    </section>
  );
}
