import {
  Fragment,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { cn } from './cn.ts';

/** Wider screens (Tailwind's `lg`) show the whole end screen at once, as they always have. */
const WIDE = '(min-width: 1024px)';

const subscribe = (onChange: () => void) => {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const mq = window.matchMedia(WIDE);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
};
const wide = () => typeof window !== 'undefined' && !!window.matchMedia?.(WIDE).matches;

/** Whether the screen is wide enough for a whole end screen (read at once, so nothing flashes). */
export function useWideScreen(): boolean {
  return useSyncExternalStore(subscribe, wide, () => false);
}

/** The least a part keeps when the page is short: it then scrolls inside. */
const MIN_PART_PX = 120;

/**
 * Keeps the page within the screen: when it is taller, the part gets the height that fits (no
 * less than `MIN_PART_PX`) and scrolls inside, so a long replay or log never pushes Play again
 * and the room's buttons away. Measured again whenever the part or the page changes size.
 */
function useFitToScreen(on: boolean, key: string) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!on || !el) return;
    const fit = () => {
      el.style.maxHeight = '';
      const over = document.documentElement.scrollHeight - window.innerHeight;
      // Fractional heights round up in the page's height, so a pixel more comes off.
      const fits = Math.floor(el.getBoundingClientRect().height - over - 1);
      if (over > 0) el.style.maxHeight = `${Math.max(MIN_PART_PX, fits)}px`;
    };
    fit();
    window.addEventListener('resize', fit);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    if (inner.current) observer?.observe(inner.current);
    observer?.observe(document.body);
    return () => {
      window.removeEventListener('resize', fit);
      observer?.disconnect();
      el.style.maxHeight = '';
    };
  }, [on, key]);
  return { box, inner };
}

export interface EndTab {
  id: string;
  /** Short, with its emoji: "🏆 Scores". */
  label: string;
  content: ReactNode;
}

/**
 * A finished game's end screen on phones: a tab strip and one part at a time (the scores, the
 * awards, the game's own details), so the end, the room's buttons and Play again fit the screen.
 * A part taller than the screen leaves scrolls inside, never the page. Wider screens get every
 * part in order with no strip, exactly as without it. Leave out parts
 * with nothing to show (`null` or `false`); with one part left there is no strip.
 */
export function EndTabs({
  tabs,
  label = 'The end',
  testId = 'end-tabs',
  className,
}: {
  tabs: readonly (EndTab | null | false | undefined)[];
  label?: string;
  testId?: string;
  /** Classes for the strip. */
  className?: string;
}) {
  const parts = tabs.filter((t): t is EndTab => !!t);
  const isWide = useWideScreen();
  const [chosen, setChosen] = useState(parts[0]?.id ?? '');
  const current = parts.find((t) => t.id === chosen) ?? parts[0];
  const { box, inner } = useFitToScreen(!isWide && parts.length > 1, current?.id ?? '');
  if (isWide || parts.length < 2)
    return (
      <>
        {parts.map((t) => (
          <Fragment key={t.id}>{t.content}</Fragment>
        ))}
      </>
    );
  return (
    <>
      <div
        role="tablist"
        aria-label={label}
        data-testid={testId}
        className={cn(
          'flex shrink-0 gap-1 rounded-lg bg-page p-1 dark:bg-stone-900 [&>*]:min-w-0 [&>*]:flex-1',
          className,
        )}
      >
        {parts.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={t.id === current?.id}
            onClick={() => setChosen(t.id)}
            data-testid={`${testId}-${t.id}`}
            className={cn(
              'truncate rounded-md py-1.5 font-semibold',
              // More parts share a phone's width: smaller labels keep every word whole.
              parts.length > 4
                ? 'px-0.5 text-[11px]'
                : parts.length > 3
                  ? 'px-1 text-xs'
                  : 'px-1 text-sm',
              t.id === current?.id
                ? 'bg-card shadow-sm dark:bg-stone-700'
                : 'text-ink-muted dark:text-stone-400',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        ref={box}
        role="tabpanel"
        aria-label={current?.label}
        className="min-w-0 overflow-y-auto overscroll-contain"
      >
        <div ref={inner} className="p-px">
          {current?.content}
        </div>
      </div>
    </>
  );
}
