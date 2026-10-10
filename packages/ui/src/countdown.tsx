import { useEffect, useState } from 'react';

/** Seconds left until `deadline` (server epoch ms), corrected by the client/server clock offset. */
export function useSecondsLeft(deadline: number | null, clockOffset: number): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [deadline]);
  if (deadline === null) return null;
  return Math.max(0, Math.ceil((deadline - (now + clockOffset)) / 1000));
}

export function Countdown({
  deadline,
  clockOffset,
  expiredLabel,
}: {
  deadline: number | null;
  clockOffset: number;
  /** Shown instead of 0:00 once time is up (for timers that don't end anything by themselves). */
  expiredLabel?: string;
}) {
  const left = useSecondsLeft(deadline, clockOffset);
  if (left === null) return null;
  const urgent = left <= 10;
  const label =
    left === 0 && expiredLabel
      ? expiredLabel
      : `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  return (
    <span
      aria-label={left === 0 && expiredLabel ? expiredLabel : `${left} seconds left`}
      className={
        'inline-flex min-w-16 justify-center rounded-lg px-2 py-1 font-mono text-lg font-bold tabular-nums ' +
        (urgent
          ? 'animate-pulse bg-rose-600 text-white'
          : 'bg-stone-200 text-stone-800 dark:bg-stone-800 dark:text-stone-100')
      }
    >
      ⏱ {label}
    </span>
  );
}
