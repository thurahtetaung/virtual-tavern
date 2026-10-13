import { type ReactNode, useEffect, useRef, useState } from 'react';

/** Phones only: wider screens show the whole lobby without much scrolling. */
const PHONE = '(max-width: 639px)';

/**
 * Keeps a lobby's Start / Deal control reachable on phones. In place it renders as normal; while
 * its spot is below the bottom of a phone screen, the same control floats in a bar at the bottom
 * instead (it is only ever rendered once, so tests and screen readers see one button).
 */
export function StickyBar({ children }: { children: ReactNode }) {
  const spot = useRef<HTMLDivElement>(null);
  const [floating, setFloating] = useState(false);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const el = spot.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const phone = window.matchMedia(PHONE);
    let below = false;
    const update = () => setFloating(phone.matches && below);
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry) return;
      below = !entry.isIntersecting && entry.boundingClientRect.top > 0;
      update();
    });
    observer.observe(el);
    phone.addEventListener('change', update);
    return () => {
      observer.disconnect();
      phone.removeEventListener('change', update);
    };
  }, []);

  // Keep the spot's height while the control floats, so the page doesn't jump.
  useEffect(() => {
    if (!floating && spot.current) setHeight(spot.current.offsetHeight);
  }, [floating, children]);

  return (
    <>
      <div ref={spot} style={floating ? { minHeight: height } : undefined}>
        {!floating && children}
      </div>
      {floating && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel/95 px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-4px_12px_rgba(0,0,0,0.08)] backdrop-blur dark:border-stone-800 dark:bg-stone-950/95">
          {children}
        </div>
      )}
    </>
  );
}
