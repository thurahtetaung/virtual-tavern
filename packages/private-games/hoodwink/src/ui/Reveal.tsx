import { Button, cn } from '@vt/ui';
import { useEffect, useMemo, useState } from 'react';
import { revealOrder, revealProgress } from '../logic/game.ts';
import type { HoodwinkView, OptionView, RoundView } from '../logic/types.ts';
import { listNames, nameOf } from './status.ts';

const reducedMotion = () =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface RevealState {
  /** Board indexes in the order they are turned over. */
  order: number[];
  /** Where the one-by-one reveal is, or null once the whole board is out. */
  progress: { step: number; flipped: boolean } | null;
}

/**
 * Paces the reveal on the server clock, so every phone turns the same answer over at the same
 * moment. With reduced motion (or when the host skipped it) the whole board shows at once.
 */
export function useReveal(round: RoundView | null, clockOffset: number): RevealState {
  const start = round?.stage === 'reveal' ? round.revealAt : null;
  const options = round?.options;
  const order = useMemo(() => (options ? revealOrder(options) : []), [options]);
  const [now, setNow] = useState(() => Date.now());
  // A new reveal needs a fresh reading at once, or a stale clock would skip straight to the end.
  const [ticking, setTicking] = useState(start);
  if (ticking !== start) {
    setTicking(start);
    // eslint-disable-next-line react-hooks/purity -- a fresh reading for the new reveal's first render
    setNow(Date.now());
  }
  const [reduced] = useState(reducedMotion);
  const running =
    start !== null && !reduced && !revealProgress(order.length, now + clockOffset - start).done;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => {
      clearInterval(id);
    };
  }, [running]);
  if (!running || start === null) return { order, progress: null };
  const { step, flipped } = revealProgress(order.length, now + clockOffset - start);
  return { order, progress: { step, flipped } };
}

/** What an answer turned out to be, as the reveal stamps it. */
function verdict(o: OptionView, name: (id: string) => string): string {
  if (o.truth) return '✅ The truth';
  if (o.house) return '🏠 House fake';
  return `🎭 Lie by ${listNames((o.authors ?? []).map(name))}`;
}

/**
 * The reveal, one answer at a time: who picked it first, then what it really was. The answers
 * already turned over shrink into a list above, and the truth comes last.
 */
export function RevealSequence({
  view,
  round,
  reveal,
  isHost,
  onSkip,
}: {
  view: HoodwinkView;
  round: RoundView;
  reveal: RevealState;
  isHost: boolean;
  onSkip: () => void;
}) {
  const { order, progress } = reveal;
  if (!progress) return null;
  const name = (id: string) => (id === view.me?.id ? 'you' : nameOf(view, id));
  const shown = order.slice(0, progress.step).map((i) => round.options[i]!);
  const current = round.options[order[progress.step]!]!;
  const voters = current.voters ?? [];
  return (
    <div className="space-y-3" data-testid="reveal-sequence">
      {shown.length > 0 && (
        <ul aria-label="Answers so far" className="space-y-1">
          {shown.map((o) => (
            <li
              key={o.index}
              className={cn(
                'flex items-baseline justify-between gap-2 rounded-lg px-3 py-1 text-sm ring-1',
                o.truth
                  ? 'bg-success-soft ring-success dark:bg-emerald-500/10 dark:ring-emerald-500'
                  : 'bg-white ring-stone-200 dark:bg-stone-800/70 dark:ring-stone-700',
              )}
            >
              <span className="min-w-0 font-semibold break-words">{o.text}</span>
              <span className="shrink-0 text-xs text-ink-muted">{verdict(o, name)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-center text-xs font-semibold tracking-wide text-ink-muted uppercase">
        {current.truth ? 'And the truth is…' : `Answer ${progress.step + 1} of ${order.length}`}
      </p>
      <div
        key={current.index}
        data-testid="reveal-card"
        aria-live="polite"
        className={cn(
          'space-y-3 rounded-2xl px-4 py-6 text-center ring-2 motion-safe:transition motion-safe:duration-500 motion-safe:starting:scale-95 motion-safe:starting:opacity-0',
          progress.flipped && current.truth
            ? 'bg-success-soft ring-success dark:bg-emerald-500/15 dark:ring-emerald-500'
            : progress.flipped
              ? 'bg-danger-soft ring-danger-line dark:bg-rose-500/15 dark:ring-rose-500/50'
              : 'bg-white ring-stone-300 dark:bg-stone-800 dark:ring-stone-600',
        )}
      >
        <p className="text-2xl font-bold text-balance break-words sm:text-3xl">{current.text}</p>
        <p className="text-sm">
          {voters.length > 0 ? (
            <>
              <span className="text-ink-muted">Picked by </span>
              <span className="font-semibold">{listNames(voters.map(name))}</span>
            </>
          ) : (
            <span className="text-ink-muted">Nobody picked it…</span>
          )}
        </p>
        {progress.flipped && (
          <p
            data-testid="reveal-verdict"
            className={cn(
              'text-xl font-extrabold motion-safe:transition motion-safe:duration-300 motion-safe:starting:scale-150 motion-safe:starting:opacity-0',
              current.truth
                ? 'text-emerald-800 dark:text-emerald-200'
                : 'text-rose-800 dark:text-rose-200',
            )}
          >
            {verdict(current, name)}
            {current.truth && voters.length === 0 && ': nobody found it!'}
          </p>
        )}
      </div>
      {isHost && (
        <Button variant="ghost" className="h-11 w-full" onClick={onSkip}>
          Skip to the results ⏭
        </Button>
      )}
    </div>
  );
}
