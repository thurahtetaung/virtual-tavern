import { type ReactNode, useEffect, useRef, useState } from 'react';

/** Phones only: wider screens show the whole lobby without much scrolling. */
const PHONE = '(max-width: 639px)';

/**
 * Keeps a lobby's Start / Deal control reachable on phones. In place it renders as normal; while
 * its spot is below the bottom of a phone screen, the same control floats in a bar at the bottom
 * instead (it is only ever rendered once, so tests and screen readers see one button).
 */
export function StickyBar({
  children,
  whole = false,
  off = false,
}: {
  children: ReactNode;
  /** Float unless the spot is wholly on screen (not just partly), for controls that must stay usable. */
  whole?: boolean;
  /** Stay in place for now (the control has nothing to do, and the page above it matters more). */
  off?: boolean;
}) {
  const spot = useRef<HTMLDivElement>(null);
  const [floating, setFloating] = useState(false);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = spot.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const phone = window.matchMedia(PHONE);
    let below = false;
    const update = () => setFloating(phone.matches && below);
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        const visible = whole ? entry.intersectionRatio >= 0.99 : entry.isIntersecting;
        below = !visible && entry.boundingClientRect.bottom > window.innerHeight - 1;
        update();
      },
      whole ? { threshold: [0, 0.5, 0.99, 1] } : undefined,
    );
    observer.observe(el);
    phone.addEventListener('change', update);
    return () => {
      observer.disconnect();
      phone.removeEventListener('change', update);
    };
  }, [whole]);

  const float = floating && !off;
  // Keep the spot's height while the control floats, so the page doesn't jump.
  useEffect(() => {
    if (!float && spot.current) setHeight(spot.current.offsetHeight);
  }, [float, children]);

  return (
    <>
      <div ref={spot} style={float ? { minHeight: height } : undefined}>
        {!float && children}
      </div>
      {float && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(0,0,0,0.08)] backdrop-blur dark:border-stone-800 dark:bg-stone-950/95">
          {children}
        </div>
      )}
    </>
  );
}
