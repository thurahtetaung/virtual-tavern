import { type ReactNode, type RefObject, useLayoutEffect, useRef } from 'react';
import { cn } from './cn.ts';
import { EndBanner, EndColumns, useWideScreen } from './end-tabs.tsx';
import { Icon } from './icon.tsx';

/** The least a column keeps when the window is short: past it the page scrolls instead. */
const MIN_COLUMN_PX = 320;

function cap(el: HTMLElement, max: number | null) {
  el.style.maxHeight = max === null ? '' : `${max}px`;
  el.style.overflowY = max === null ? '' : 'auto';
  el.style.overscrollBehavior = max === null ? '' : 'contain';
}

/** Marks a capped column that still has more below its fold, which shows its `MoreBelow` cue. */
function markMore(el: HTMLElement) {
  const more = !!el.style.maxHeight && el.scrollTop + el.clientHeight < el.scrollHeight - 8;
  if (more) el.dataset.more = '';
  else delete el.dataset.more;
}

/** The foot of a column that scrolls inside: a fade and a "More below" chip that scrolls it on. */
function MoreBelow({ column }: { column: RefObject<HTMLElement | null> }) {
  return (
    <div
      data-ui="end-layout-more"
      className="pointer-events-none invisible absolute inset-x-px bottom-0 flex h-16 items-end justify-center bg-linear-to-t from-page to-transparent pb-2 opacity-0 transition-opacity peer-data-more:visible peer-data-more:opacity-100"
    >
      <button
        type="button"
        onClick={() => {
          const el = column.current;
          el?.scrollBy({ top: el.clientHeight * 0.75, behavior: 'smooth' });
        }}
        className="pointer-events-auto inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-card px-3.5 py-1.5 text-sm font-semibold text-ink shadow-vt-2 hover:bg-sunk focus-visible:outline-2 focus-visible:outline-focus"
      >
        More below
        <Icon name="arrow-down" size={16} />
      </button>
    </div>
  );
}

/**
 * Keeps side-by-side columns within the window: when the page is taller than the window, every
 * column taller than the height that fits gets that height and scrolls inside, so the whole end
 * (the finale, the standings, the game's reveal and Play again) is on one screen. Each column's own
 * scroll is kept across re-fits.
 */
function useFitColumns(cols: readonly RefObject<HTMLElement | null>[], on: boolean) {
  useLayoutEffect(() => {
    const els = cols.map((c) => c.current).filter((el): el is HTMLElement => !!el);
    if (!on || !els.length) return;
    const fit = () => {
      const tops = els.map((el) => (el.style.maxHeight ? el.scrollTop : 0));
      for (const el of els) cap(el, null);
      els.forEach(markMore);
      const page = document.scrollingElement ?? document.documentElement;
      const over = page.scrollHeight - page.clientHeight;
      if (over <= 0) return;
      const heights = els.map((el) => el.getBoundingClientRect().height);
      const room = Math.max(MIN_COLUMN_PX, Math.floor(Math.max(...heights) - over - 1));
      els.forEach((el, i) => {
        if (heights[i]! <= room) return;
        cap(el, room);
        el.scrollTop = tops[i]!;
        markMore(el);
      });
    };
    const scrolled = (e: Event) => markMore(e.currentTarget as HTMLElement);
    for (const el of els) el.addEventListener('scroll', scrolled, { passive: true });
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    fit();
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(later);
    const watch = () => {
      for (const el of els) for (const child of el.children) sizes?.observe(child);
    };
    watch();
    for (let n = els[0]!.parentElement; n; n = n.parentElement) sizes?.observe(n);
    const added = new MutationObserver(watch);
    for (const el of els) added.observe(el, { childList: true });
    const bars = new MutationObserver(later);
    bars.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    window.addEventListener('resize', later);
    return () => {
      cancelAnimationFrame(frame);
      sizes?.disconnect();
      added.disconnect();
      bars.disconnect();
      window.removeEventListener('resize', later);
      for (const el of els) {
        el.removeEventListener('scroll', scrolled);
        cap(el, null);
        markMore(el);
      }
    };
  });
}

/**
 * A finished game's whole end screen. Phones get the finale and then the rest, exactly as passed
 * (the rest uses `EndTabs`, one part at a time). Wide screens (`lg`) get two columns that fit the
 * window: the finale (`hero`, usually `EndHero` with the game's art) on the left, and the rest (the
 * standings and the game's own reveal, through `EndTabs`) on the right, each scrolling inside when
 * the window is short, so nothing sits below the fold; a column that scrolls shows a fade and a
 * "More below" chip at its foot until it is read to the end. A finale without art is a banner across the
 * top instead, with the rest centred under it.
 */
export function EndLayout({
  hero,
  children,
  className,
  banner = true,
}: {
  /** The finale: `EndHero`, plus anything that belongs beside it (Play again). */
  hero: ReactNode;
  /** The rest: standings, the game's reveal, the next game's seats. */
  children: ReactNode;
  className?: string;
  /**
   * A finale without art becomes a banner across the top, with the rest under it (default). Off
   * where the rest is a board that needs the full height beside the finale (Codenames).
   */
  banner?: boolean;
}) {
  const isWide = useWideScreen();
  const left = useRef<HTMLDivElement>(null);
  const right = useRef<HTMLDivElement>(null);
  useFitColumns([left, right], isWide);
  if (!isWide)
    return (
      <>
        {hero}
        {children}
      </>
    );
  return (
    <EndBanner.Provider value={banner}>
      <EndColumns.Provider value>
        <div
          data-ui="end-layout"
          className={cn(
            'group/end grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-start gap-4 xl:gap-6',
            className,
            // A finale with no art is a banner across the top (`EndHero`), with the rest under it.
            banner && 'has-[[data-bare]]:grid-cols-1',
          )}
        >
          <div className="relative min-w-0">
            <div ref={left} data-ui="end-layout-hero" className="peer min-w-0 space-y-4 p-px">
              {hero}
            </div>
            <MoreBelow column={left} />
          </div>
          <div className="relative min-w-0 group-has-[[data-bare]]/end:mx-auto group-has-[[data-bare]]/end:w-full group-has-[[data-bare]]/end:max-w-5xl">
            <div ref={right} data-ui="end-layout-rest" className="peer min-w-0 space-y-4 p-px">
              {children}
            </div>
            <MoreBelow column={right} />
          </div>
        </div>
      </EndColumns.Provider>
    </EndBanner.Provider>
  );
}
