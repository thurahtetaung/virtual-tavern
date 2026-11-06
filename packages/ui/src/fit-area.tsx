import { type ReactNode, useLayoutEffect, useRef } from 'react';
import { cn } from './cn.ts';

/** The least a part keeps when the page is short: it then scrolls inside. */
const MIN_PART_PX = 120;

/**
 * Keeps the page within the screen: when it is taller, the part gets the height that fits (no
 * less than `MIN_PART_PX`) and scrolls inside, so a long replay or log never pushes Play again
 * and the room's buttons away. Measured again whenever the part or the page changes size.
 */
export function useFitToScreen(on: boolean, key: string) {
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

/**
 * A phone game's own area under its strip and status line: while `on`, when the page would be
 * taller than the screen, the area takes the height left and scrolls inside, never the page.
 * `resetKey` measures again from scratch (a new tab or stage).
 */
export function FitArea({
  on,
  resetKey = '',
  className,
  children,
}: {
  on: boolean;
  resetKey?: string;
  /** Classes for the content. */
  className?: string;
  children: ReactNode;
}) {
  const { box, inner } = useFitToScreen(on, resetKey);
  return (
    <div ref={box} className={cn('min-w-0', on && 'overflow-y-auto overscroll-contain')}>
      <div ref={inner} className={cn(on && 'p-px', className)}>
        {children}
      </div>
    </div>
  );
}
