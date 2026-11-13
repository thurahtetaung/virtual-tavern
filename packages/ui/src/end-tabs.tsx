import {
  createContext,
  Fragment,
  type ReactNode,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useFitToScreen } from './fit-area.tsx';
import { MoreBelow, markMore } from './more-below.tsx';
import { Tabs, tabPanelProps } from './tabs.tsx';

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

/** True inside `EndLayout`'s wide columns: the finale and the end's parts size for a column. */
export const EndColumns = createContext(false);

/** Whether a finale without art may become a banner across the top (`EndLayout`'s `banner`). */
export const EndBanner = createContext(true);

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
 * part in order with no strip; with `columns`, they flow into two columns from `xl` (each part kept
 * whole), so a long end uses the width instead of a long scroll. Leave out parts with nothing to
 * show (`null` or `false`); with one part left there is no strip.
 */
export function EndTabs({
  tabs,
  label = 'The end',
  testId = 'end-tabs',
  className,
  columns = false,
}: {
  tabs: readonly (EndTab | null | false | undefined)[];
  label?: string;
  testId?: string;
  /** Classes for the strip. */
  className?: string;
  /** Wide screens: flow the parts into two columns from `xl` instead of one long stack. */
  columns?: boolean;
}) {
  const parts = tabs.filter((t): t is EndTab => !!t);
  const isWide = useWideScreen();
  // In `EndLayout`'s right column the parts stack in that column, which scrolls on its own.
  const inColumn = useContext(EndColumns);
  const id = useId();
  const [chosen, setChosen] = useState(parts[0]?.id ?? '');
  const current = parts.find((t) => t.id === chosen) ?? parts[0];
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useFitToScreen(box, {
    on: !isWide && parts.length > 1,
    resetKey: current?.id ?? '',
    content: inner,
  });
  // A part that scrolls inside shows "More below" at its foot until it is read to the end.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const mark = () => markMore(el);
    mark();
    el.addEventListener('scroll', mark, { passive: true });
    const capped = new MutationObserver(mark);
    capped.observe(el, { attributes: true, attributeFilter: ['style'] });
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(mark);
    if (inner.current) sizes?.observe(inner.current);
    return () => {
      el.removeEventListener('scroll', mark);
      capped.disconnect();
      sizes?.disconnect();
    };
  }, [isWide, current?.id, parts.length]);
  if (isWide && columns && !inColumn && parts.length > 1)
    return (
      <div data-ui="end-columns" className="gap-4 xl:columns-2">
        {parts.map((t) => (
          <div key={t.id} className="mb-4 break-inside-avoid">
            {t.content}
          </div>
        ))}
      </div>
    );
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
      <Tabs
        id={id}
        label={label}
        testId={testId}
        tabs={parts.map((t) => ({ id: t.id, label: t.label }))}
        value={current?.id ?? ''}
        onChange={setChosen}
        className={className}
      />
      <div className="relative min-w-0">
        <div
          ref={box}
          {...tabPanelProps(id, current?.id ?? '')}
          aria-label={current?.label}
          className="peer min-w-0 overflow-y-auto overscroll-contain"
        >
          <div ref={inner} className="p-px">
            {current?.content}
          </div>
        </div>
        <MoreBelow column={box} surface="panel" />
      </div>
    </>
  );
}
