import { type ReactNode, type RefObject, useLayoutEffect, useRef } from 'react';
import { cn } from './cn.ts';
import { MoreBelow, useMarkMore } from './more-below.tsx';
import { usePhone } from './phone.ts';

/** The least a part keeps when the page is short: it then scrolls inside. */
const MIN_PART_PX = 120;

export interface FitOptions {
  /** Fit only while this is true (a game's own phone layout, the open tab). Defaults to true. */
  on?: boolean;
  /** Fit only on a phone-width screen; wider screens leave the part as it is. */
  phone?: boolean;
  /** The least height the part keeps, in px; past it the page scrolls instead. Defaults to 120. */
  min?: number;
  /** Measures again from scratch when it changes (a new tab or stage). */
  resetKey?: string;
  /** The part's content, watched for growth. Defaults to the part's own children. */
  content?: RefObject<HTMLElement | null>;
}

/**
 * Sent (bubbling) from a part when it has just been capped: a part inside it that sizes itself
 * (`useFitSize`) re-fits at once, and the part measures again, all before the frame is painted.
 */
export const FIT_AREA_CAPPED = 'vt-fit-area-capped';

/**
 * Sent on the document when a part that fits itself (a `FitArea`, `useFitSize`) has changed size,
 * so what is placed from the layout (the sticky tray) checks again before the frame is painted.
 */
export const LAYOUT_FITTED = 'vt-layout-fitted';

/** Fits running inside React's commit (a layout effect), which announce nothing: React redraws. */
let inCommit = 0;

/** Sends `LAYOUT_FITTED`, unless inside React's commit. */
export function announceFitted() {
  if (inCommit === 0) document.dispatchEvent(new Event(LAYOUT_FITTED));
}

/** Runs a fit from a layout effect (see `announceFitted`). */
export function fitInCommit(fit: () => void) {
  inCommit++;
  try {
    fit();
  } finally {
    inCommit--;
  }
}

/** Caps `el` at `max` px, scrolling inside, or (`null`) gives it back its own height. */
function capPart(el: HTMLElement, max: number | null) {
  el.style.maxHeight = max === null ? '' : `${max}px`;
  el.style.overflowY = max === null ? '' : 'auto';
  el.style.overscrollBehavior = max === null ? '' : 'contain';
}

/**
 * Fits `el` to what the page has left (no less than `min`); a hidden part is left alone. Measuring
 * takes the cap off for a moment, which throws away the part's own scroll, so the reader's place
 * (`top`) is put back once it is capped again: a re-fit never moves what they are looking at.
 */
function fitPart(el: HTMLElement, min: number, top: number) {
  capPart(el, null);
  if (el.offsetParent === null) return;
  const page = document.scrollingElement ?? document.documentElement;
  const over = page.scrollHeight - page.clientHeight;
  if (over <= 0) return;
  // Fractional heights round up in the page's height, so a pixel more comes off.
  capPart(el, Math.max(min, Math.floor(el.getBoundingClientRect().height - over - 1)));
  el.scrollTop = top;
}

/**
 * Keeps the page within the screen: when it is taller, the part gets the height that fits (no
 * less than `min`) and scrolls inside, so a long list, a big table or a replay never pushes the
 * room's buttons away. A hidden part (a closed tab) is left alone. It measures again when the
 * screen, the part's content, anything around it, or the bars at the foot change.
 */
export function useFitToScreen(
  part: RefObject<HTMLElement | null>,
  { on = true, phone = false, min = MIN_PART_PX, resetKey = '', content }: FitOptions = {},
) {
  const isPhone = usePhone();
  const active = on && (!phone || isPhone);
  // Where the reader had scrolled the part to, kept across re-renders; a new `resetKey` (a new
  // stage or tab) starts again at the top.
  const place = useRef({ key: resetKey, top: 0 });
  useLayoutEffect(() => {
    const el = part.current;
    if (!active || !el) return;
    if (place.current.key !== resetKey) place.current = { key: resetKey, top: 0 };
    const fit = () => {
      // While capped, the part's own scroll is the reader's place; read it before re-fitting.
      const had = el.style.maxHeight;
      if (had) place.current.top = el.scrollTop;
      fitPart(el, min, place.current.top);
      capOnce();
      if (el.style.maxHeight !== had) announceFitted();
    };
    const capOnce = () => {
      // Capped: a drawing or a table inside that sizes itself shrinks now rather than next frame
      // (one frame of a capped, scrolling area on every step of a dragged window), and the part
      // measures again, often to no cap at all.
      if (!el.style.maxHeight) return;
      el.dispatchEvent(new Event(FIT_AREA_CAPPED, { bubbles: true }));
      fitPart(el, min, place.current.top);
    };
    // Observers measure on the next frame, so a change they cause never loops back the same frame.
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    fitInCommit(fit);
    const sizes = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(later);
    const watchContent = () => {
      for (const node of content?.current ? [content.current] : el.children) sizes?.observe(node);
    };
    watchContent();
    // Every box around the part: whatever grows or shrinks on the screen resizes one of them.
    for (let n = el.parentElement; n; n = n.parentElement) sizes?.observe(n);
    const added = new MutationObserver(watchContent);
    if (!content) added.observe(el, { childList: true });
    // The bars at the foot publish their heights on the root's style.
    const bars = new MutationObserver(later);
    bars.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    window.addEventListener('resize', later);
    return () => {
      cancelAnimationFrame(frame);
      sizes?.disconnect();
      added.disconnect();
      bars.disconnect();
      window.removeEventListener('resize', later);
      if (el.style.maxHeight) place.current.top = el.scrollTop;
      capPart(el, null);
    };
    // No dependencies: it measures afresh after every render, so a part that mounts later (a tab's
    // panel), a new `resetKey` or new content is always fitted.
  });
}

/**
 * A phone game's own area under its strip and status line: while `on`, when the page would be
 * taller than the screen, the area takes the height left and scrolls inside, never the page.
 * `resetKey` measures again from scratch (a new tab or stage). `plain` is one box with no inner
 * padding that scrolls only once it is capped: a dense panel inside a game's own layout.
 */
export function FitArea({
  on = true,
  phone = false,
  min,
  resetKey = '',
  plain = false,
  surface = 'panel',
  className,
  children,
}: {
  /** What the area sits on, which its More below fade runs into (a panel, the page, a sunk well). */
  surface?: 'page' | 'panel' | 'sunk';
  on?: boolean;
  phone?: boolean;
  min?: number;
  resetKey?: string;
  plain?: boolean;
  /** Classes for the content. */
  className?: string;
  children: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useFitToScreen(box, { on, phone, min, resetKey, content: plain ? undefined : inner });
  // Capped, the area shows a small "More below" at its foot until it is read to the end.
  useMarkMore(box, [plain]);
  return (
    <div className="relative min-w-0">
      {plain ? (
        <div ref={box} className={cn('peer', className)}>
          {children}
        </div>
      ) : (
        <div ref={box} className={cn('peer min-w-0', on && 'overflow-y-auto overscroll-contain')}>
          <div ref={inner} className={cn(on && 'p-px', className)}>
            {children}
          </div>
        </div>
      )}
      <MoreBelow column={box} surface={surface} compact />
    </div>
  );
}
