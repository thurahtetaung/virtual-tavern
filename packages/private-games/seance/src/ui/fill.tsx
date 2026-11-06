import { cn, usePhone } from '@vt/ui';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';

/** Never shrink the panel below this: past it the page scrolls instead. */
const MIN_PX = 160;

/**
 * On a phone, the screen's one dense panel takes what the page has left and scrolls inside, so
 * the page itself never scrolls (the owner's G08 ruling: a bounded inner scroll for the dense
 * active panel only). It shrinks by exactly what the page overflows and grows back when there is
 * room, whatever else is on the screen (a tip, a refusal, the keyboard). Wider screens leave it
 * as it is.
 */
export function PhoneFill({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const phone = usePhone();
  const [max, setMax] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!phone || !el) {
      setMax(null);
      return;
    }
    const measure = () => {
      const page = document.scrollingElement ?? document.documentElement;
      const over = page.scrollHeight - page.clientHeight;
      const height = el.offsetHeight;
      const hidden = el.scrollHeight - el.clientHeight;
      if (over > 0) setMax((m) => Math.max(MIN_PX, (m ?? height) - over));
      else if (hidden > 0 && over < 0)
        setMax((m) => (m === null ? m : m + Math.min(-over, hidden)));
    };
    measure();
    const seen = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    seen?.observe(document.body);
    seen?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      seen?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [phone]);
  return (
    <div
      ref={ref}
      className={cn(phone && max !== null && 'overflow-y-auto overscroll-contain', className)}
      style={phone && max !== null ? { maxHeight: max } : undefined}
    >
      {children}
    </div>
  );
}
