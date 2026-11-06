import { type ReactNode, useEffect, useRef, useState } from 'react';
import { cn } from './cn.ts';
import { usePhone } from './phone.ts';
import { RefusalSlot } from './refusal.tsx';
import { useReservedHeight } from './reserve.ts';

/** Phones only: wider screens show the whole lobby without much scrolling. */
const PHONE = '(max-width: 639px)';

/**
 * The bar at the foot of a phone screen: the `panel` surface with the second shadow, above the
 * tab bar when a game has one. It holds the one main action and, on phones, its refusal.
 */
const BAR =
  'fixed inset-x-0 bottom-[var(--vt-tabbar-h,0px)] z-40 m-0 border-t border-line bg-panel px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-vt-2';

/**
 * Keeps a screen's one main action reachable on phones.
 *
 * By default (a lobby's Start / Deal) it renders in place, and only while its spot is below the
 * bottom of a phone screen does the same control float in the bar instead (it is only ever rendered
 * once, so tests and screen readers see one button). A lobby may scroll under it.
 *
 * `fixed` (a game's move, such as a clue and Give clue) keeps it in the bar on phones all the time
 * and the room keeps the bar's height free at the foot of the page, so the bar never covers
 * anything; wider screens show it in place.
 *
 * `refusal` names the `RefusalSlot` anchor of the action: the server's refusal then shows with the
 * control, in the bar on phones, so the bar grows rather than covering the field above it.
 */
export function StickyBar({
  children,
  whole = false,
  off = false,
  fixed = false,
  refusal,
  refusalKey,
  className,
}: {
  children: ReactNode;
  /** Float unless the spot is wholly on screen (not just partly), for controls that must stay usable. */
  whole?: boolean;
  /** Stay in place for now (the control has nothing to do, and the page above it matters more). */
  off?: boolean;
  /** Always in the bar on phones, with its height kept free on the page. */
  fixed?: boolean;
  /** The anchor of the action's `RefusalSlot`, shown above the control. */
  refusal?: string;
  /** Clears the refusal when it changes (see `RefusalSlot`'s `resetKey`). */
  refusalKey?: string | number;
  /** Classes for the content, in place and in the bar. */
  className?: string;
}) {
  const slot = (where: 'bar' | 'place') =>
    refusal !== undefined && (
      <RefusalSlot
        anchor={refusal}
        className={where === 'bar' ? 'mt-0 mb-2' : undefined}
        resetKey={refusalKey}
      />
    );
  return fixed ? (
    <FixedBar off={off} refusal={slot} className={className}>
      {children}
    </FixedBar>
  ) : (
    <FloatingBar whole={whole} off={off}>
      <div className={className}>
        {children}
        {slot('place')}
      </div>
    </FloatingBar>
  );
}

function FixedBar({
  children,
  off,
  refusal,
  className,
}: {
  children: ReactNode;
  off: boolean;
  refusal: (where: 'bar' | 'place') => ReactNode;
  className?: string;
}) {
  const phone = usePhone();
  const bar = useRef<HTMLDivElement>(null);
  const on = phone && !off;
  useReservedHeight('--vt-sticky-h', bar, on);
  // In the bar the refusal sits above the control; in place, under it (under the field).
  return (
    <div ref={bar} data-ui="sticky-bar" className={cn(on && BAR, className)}>
      {on && refusal('bar')}
      {children}
      {!on && refusal('place')}
    </div>
  );
}

function FloatingBar({
  children,
  whole,
  off,
}: {
  children: ReactNode;
  whole: boolean;
  off: boolean;
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
        <div data-ui="sticky-bar" className={BAR}>
          {children}
        </div>
      )}
    </>
  );
}
