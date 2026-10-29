import { ProtectedImage, cn } from '@vt/ui';
import { useEffect, useState } from 'react';
import type { CliffhangerView } from '../logic/types.ts';
import { useArt } from './assets.ts';
import { type Moment, momentAt, nextMomentAt } from './moments.ts';
import { TEAM_EMOJI, teamName } from './parts.tsx';

/** The moment on screen now, re-read when it ends or the next one starts. */
export function useMoment(view: CliffhangerView, clockOffset: number): Moment | null {
  const [now, setNow] = useState(() => Date.now() + clockOffset);
  const moment = momentAt(view, now);
  const next = nextMomentAt(view, now);
  const wake = Math.min(moment?.until ?? Infinity, next ?? Infinity);
  useEffect(() => {
    const look = () => setNow(Date.now() + clockOffset);
    // A view change can start a moment that has already begun: look again at once.
    const ids = [setTimeout(look, 0)];
    if (Number.isFinite(wake))
      ids.push(setTimeout(look, Math.max(0, wake - (Date.now() + clockOffset)) + 20));
    return () => {
      ids.forEach(clearTimeout);
    };
  }, [view, wake, clockOffset]);
  return moment;
}

/**
 * The 3-2-1, GO!, TIME'S UP and a clean sweep over the screen: the manifest's own words when it
 * has them (GO!, TIME'S UP), big type otherwise. Never in the way: it ignores taps. `big` is the
 * table screen's size.
 */
export function MomentOverlay({
  view,
  clockOffset,
  big = false,
}: {
  view: CliffhangerView;
  clockOffset: number;
  big?: boolean;
}) {
  const moment = useMoment(view, clockOffset);
  const art = useArt();
  if (!moment) return null;
  const key = `${moment.kind}:${moment.until}`;
  const picture =
    moment.kind === 'go' ? art.app('go') : moment.kind === 'times-up' ? art.app('timesUp') : null;
  const words =
    moment.kind === 'count'
      ? String(moment.n)
      : moment.kind === 'go'
        ? 'GO!'
        : moment.kind === 'times-up'
          ? 'TIME’S UP!'
          : `${TEAM_EMOJI[moment.team]} All three!`;
  return (
    <div
      aria-live="assertive"
      data-testid="moment"
      data-moment={moment.kind}
      className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center"
    >
      <div key={key} className="cl-pop flex flex-col items-center gap-2">
        {picture ? (
          <ProtectedImage
            src={picture}
            alt={words}
            className={cn('w-auto drop-shadow-2xl', big ? 'max-h-[45vh]' : 'max-h-40')}
          />
        ) : (
          <span
            className={cn(
              'rounded-3xl px-6 py-3 font-black tracking-tight shadow-2xl ring-1 ring-black/10',
              moment.kind === 'times-up'
                ? 'bg-danger text-white dark:bg-rose-600' // vt-palette
                : 'bg-card text-ink dark:bg-stone-900 dark:text-stone-50',
              big ? 'text-[12vh]' : moment.kind === 'count' ? 'text-8xl' : 'text-5xl',
            )}
          >
            {words}
          </span>
        )}
        {moment.kind === 'sweep' && (
          <span className="rounded-full bg-card px-3 py-1 text-sm font-semibold shadow dark:bg-stone-900">
            {teamName(moment.team)} got every card in time
          </span>
        )}
      </div>
    </div>
  );
}
