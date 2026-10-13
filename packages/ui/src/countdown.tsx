import { useEffect, useState } from 'react';
import { cn } from './cn.ts';

/** Seconds left until `deadline` (server epoch ms), corrected by the client/server clock offset. */
export function useSecondsLeft(deadline: number | null, clockOffset: number): number | null {
  const [now, setNow] = useState(() => Date.now());
  // `now` only ticks while a deadline runs, so it can be long stale when a new one arrives (a 2:00
  // timer showed 2:03 until the first tick): restart the clock with the deadline.
  const [ticking, setTicking] = useState(deadline);
  if (ticking !== deadline) {
    setTicking(deadline);
    // eslint-disable-next-line react-hooks/purity -- a fresh reading for the new deadline's first render
    setNow(Date.now());
  }
  useEffect(() => {
    if (deadline === null) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadline]);
  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline - (now + clockOffset)) / 1000));
}

/** "1:05" */
export const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/** What soft timers say once they reach zero, unless the game says something more specific. */
export const SOFT_TIMEUP_HINT = 'Nothing happens by itself: finish up when you can.';

export function Countdown({
  deadline,
  clockOffset,
  label,
  soft,
  expiredLabel,
  expiredHint,
  atZero,
}: {
  deadline: number | null;
  clockOffset: number;
  /** What the clock times, read after the time: "to give a clue" → "⏱ 0:42 to give a clue". */
  label?: string;
  /**
   * A reminder timer: it never pulses, and at zero it turns into a calm "Time's up" with
   * `expiredHint` underneath, because nothing ends by itself. Implied by `expiredLabel`.
   */
  soft?: boolean;
  /** Soft timers: shown instead of 0:00 once time is up. Default "Time's up". */
  expiredLabel?: string;
  /** Soft timers: what happens now that time is up, shown as text (never only as a tooltip). */
  expiredHint?: string;
  /** Strict timers: what happens at 0:00, shown under the clock, e.g. "then a word is picked". */
  atZero?: string;
}) {
  const left = useSecondsLeft(deadline, clockOffset);
  if (left === null) return null;
  const isSoft = soft === true || expiredLabel !== undefined;
  const expired = left === 0 && isSoft;
  const urgent = left <= 10 && !isSoft;
  const time = expired ? (expiredLabel ?? "Time's up") : clock(left);
  const caption = expired ? (expiredHint ?? SOFT_TIMEUP_HINT) : isSoft ? undefined : atZero;
  return (
    <span className="inline-flex max-w-full flex-col items-end gap-0.5 text-right">
      <span
        role="timer"
        aria-label={
          expired
            ? time
            : `${left} seconds left${label ? ` ${label}` : ''}${caption ? `, ${caption}` : ''}`
        }
        className={cn(
          'inline-flex min-w-16 flex-wrap items-baseline justify-center gap-x-1.5 rounded-lg px-2 py-1',
          urgent
            ? 'animate-pulse bg-danger text-white motion-reduce:animate-none dark:bg-rose-600'
            : expired
              ? 'bg-warn-soft text-warn-ink ring-1 ring-warn-line dark:bg-amber-500/15 dark:text-amber-100 dark:ring-amber-500/40'
              : 'bg-panel text-stone-800 ring-1 ring-line dark:bg-stone-800 dark:ring-0 dark:text-stone-100',
        )}
      >
        <span className={cn('font-bold tabular-nums', expired ? 'text-base' : 'font-mono text-lg')}>
          ⏱ {time}
        </span>
        {label && !expired && <span className="text-xs font-medium sm:text-sm">{label}</span>}
      </span>
      {caption && (
        <span className="text-xs text-stone-600 dark:text-stone-400" aria-hidden>
          {caption}
        </span>
      )}
    </span>
  );
}

/**
 * Says what the timer did on someone's behalf, in one calm line: "⏱ Time ran out: a word was
 * picked for you". Pair it with `timedOut()` from `@vt/game-sdk` for logs.
 */
export function TimeoutNote({ children, className }: { children: string; className?: string }) {
  return (
    <p
      role="status"
      className={cn(
        'rounded-xl bg-info-soft px-3 py-2 text-sm text-info-ink ring-1 ring-info-line dark:bg-sky-500/10 dark:text-sky-100 dark:ring-sky-500/30',
        className,
      )}
    >
      <span aria-hidden>⏱ </span>Time ran out: {children}
    </p>
  );
}
