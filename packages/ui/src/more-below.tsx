import { type DependencyList, type RefObject, useLayoutEffect } from 'react';
import { cn } from './cn.ts';
import { Icon } from './icon.tsx';

/** Marks a capped column that still has more below its fold, which shows its `MoreBelow` cue. */
export function markMore(el: HTMLElement) {
  const more = !!el.style.maxHeight && el.scrollTop + el.clientHeight < el.scrollHeight - 8;
  if (more) el.dataset.more = '';
  else delete el.dataset.more;
}

/**
 * Keeps `column`'s More below mark current: on its own scroll, when a fit caps or frees it (its
 * style), and when what is inside it grows or shrinks.
 */
export function useMarkMore(column: RefObject<HTMLElement | null>, deps: DependencyList) {
  useLayoutEffect(() => {
    const el = column.current;
    if (!el) return;
    const mark = () => markMore(el);
    mark();
    el.addEventListener('scroll', mark, { passive: true });
    const capped = new MutationObserver(mark);
    capped.observe(el, { attributes: true, attributeFilter: ['style'] });
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(mark);
    const watch = () => {
      for (const child of el.children) sizes?.observe(child);
    };
    watch();
    const added = new MutationObserver(watch);
    added.observe(el, { childList: true });
    return () => {
      el.removeEventListener('scroll', mark);
      capped.disconnect();
      added.disconnect();
      sizes?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller names what re-mounts the column
  }, deps);
}

/** The foot of a column that scrolls inside: a fade and a "More below" chip that scrolls it on. */
export function MoreBelow({
  column,
  surface = 'page',
  compact = false,
}: {
  column: RefObject<HTMLElement | null>;
  /** What the column sits on, which the fade runs into: the page, a panel, or a sunk well. */
  surface?: 'page' | 'panel' | 'sunk';
  /** A small area (a game's own fitted part): a shorter fade and a smaller chip. */
  compact?: boolean;
}) {
  return (
    <div
      data-ui="end-layout-more"
      className={cn(
        'pointer-events-none invisible absolute inset-x-px bottom-0 flex items-end justify-center bg-linear-to-t to-transparent opacity-0 transition-opacity peer-data-more:visible peer-data-more:opacity-100',
        compact ? 'h-10 pb-1' : 'h-12 pb-2',
        surface === 'panel' ? 'from-panel' : surface === 'sunk' ? 'from-sunk' : 'from-page',
      )}
    >
      <button
        type="button"
        onClick={() => {
          const el = column.current;
          el?.scrollBy({ top: el.clientHeight * 0.75, behavior: 'smooth' });
        }}
        className={cn(
          'pointer-events-auto inline-flex items-center rounded-full border border-line-strong bg-card font-semibold text-ink shadow-vt-2 hover:bg-sunk focus-visible:outline-2 focus-visible:outline-focus',
          compact ? 'gap-1 px-2.5 py-0.5 text-xs' : 'gap-1.5 px-3.5 py-1.5 text-sm',
        )}
      >
        More below
        <Icon name="arrow-down" size={compact ? 14 : 16} />
      </button>
    </div>
  );
}
