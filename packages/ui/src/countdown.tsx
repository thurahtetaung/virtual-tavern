import { useEffect, useState } from 'react';
import { cn } from './cn.ts';
import { Icon } from './icon.tsx';

/** Whole seconds from `now` (server time, ms) until `deadline`, never below 0. */
export const secondsUntil = (deadline: number, now: number) =>
  Math.max(0, Math.ceil((deadline - now) / 1000));

/**
 * What a clock shows next: the new reading, but never more than it already showed for the same
 * deadline. Each snapshot re-measures the clock offset, latency included, so a slower snapshot would
 * otherwise push a running clock back up (a 2:00 timer briefly read 2:03). A new deadline starts over.
 */
export function shownSeconds(
  shown: { deadline: number; left: number } | null,
  deadline: number,
  left: number,
): number {
  return shown?.deadline === deadline ? Math.min(shown.left, left) : left;
}

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
  const [shown, setShown] = useState<{ deadline: number; left: number } | null>(null);
  if (deadline === null) return null;
  const left = shownSeconds(shown, deadline, secondsUntil(deadline, now + clockOffset));
  if (shown?.deadline !== deadline || shown.left !== left) setShown({ deadline, left });
  return left;
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
  tone = 'page',
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
  /** `dark` for a panel that stays dark in both themes (a night scene), so the caption stays light. */
  tone?: 'page' | 'dark';
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
        data-ui="countdown"
        data-urgent={urgent || undefined}
        className={cn(
          'inline-flex min-w-16 flex-wrap items-center justify-center gap-x-1.5 rounded-lg border px-2.5 py-1',
          urgent
            ? // The ring pulse (index.css) moves a shadow, never the digits' opacity.
              'vt-urgent border-danger bg-danger text-on-fill'
            : expired
              ? 'border-warn-line bg-warn-soft text-warn-ink'
              : 'border-line bg-card text-ink shadow-vt-1',
        )}
      >
        <Icon name="clock" size={16} className="self-center" />
        <span
          className={cn(
            'leading-none font-semibold tabular-nums',
            expired ? 'text-body' : 'text-num',
          )}
        >
          {time}
        </span>
        {label && !expired && (
          <span className={cn('text-caption font-medium', !urgent && 'text-ink-muted')}>
            {label}
          </span>
        )}
      </span>
      {caption && (
        <span
          className={cn('text-xs', tone === 'dark' ? 'text-stone-300' : 'text-ink-muted')}
          aria-hidden
        >
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
        'rounded-xl border border-info-line bg-info-soft px-3 py-2 text-small text-info-ink',
        className,
      )}
    >
      <span aria-hidden>⏱ </span>Time ran out: {children}
    </p>
  );
}
