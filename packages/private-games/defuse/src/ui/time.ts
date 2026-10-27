import { useEffect, useState } from 'react';

/** The server's clock as this device estimates it. */
export const serverNow = (offset: number) => Date.now() + offset;

/**
 * The server time, re-read every `ms` (by animation frame when it is short), for clocks that must
 * look live: the timer's hundredths, flashing lights, countdowns.
 */
export function useServerNow(offset: number, ms = 100, on = true): number {
  const [now, setNow] = useState(() => serverNow(offset));
  useEffect(() => {
    if (!on) return;
    let frame = 0;
    let last = 0;
    const tick = (t: number) => {
      if (t - last >= ms) {
        last = t;
        setNow(serverNow(offset));
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [offset, ms, on]);
  return now;
}

export const clockText = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
