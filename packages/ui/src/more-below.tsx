import type { RefObject } from 'react';
import { cn } from './cn.ts';
import { Icon } from './icon.tsx';

/** Marks a capped column that still has more below its fold, which shows its `MoreBelow` cue. */
export function markMore(el: HTMLElement) {
  const more = !!el.style.maxHeight && el.scrollTop + el.clientHeight < el.scrollHeight - 8;
  if (more) el.dataset.more = '';
  else delete el.dataset.more;
}

/** The foot of a column that scrolls inside: a fade and a "More below" chip that scrolls it on. */
export function MoreBelow({
  column,
  surface = 'page',
}: {
  column: RefObject<HTMLElement | null>;
  /** What the column sits on, which the fade runs into: the page, or a panel (phone end tabs). */
  surface?: 'page' | 'panel';
}) {
  return (
    <div
      data-ui="end-layout-more"
      className={cn(
        'pointer-events-none invisible absolute inset-x-px bottom-0 flex h-16 items-end justify-center bg-linear-to-t to-transparent pb-2 opacity-0 transition-opacity peer-data-more:visible peer-data-more:opacity-100',
        surface === 'panel' ? 'from-panel' : 'from-page',
      )}
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
