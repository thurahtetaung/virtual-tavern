import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { cn } from './cn.ts';
import { LAYOUT_FITTED } from './fit-area.tsx';
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
 * The same bar on wider screens, while the control's spot is below the window: a tray at the foot
 * of the window over the control's own column (its left and width are set from the spot).
 */
const TRAY =
  'fixed bottom-0 z-40 m-0 rounded-t-2xl border border-b-0 border-line bg-panel px-3 pt-3 pb-3 shadow-vt-2';

/** How far the tray reaches past the control's column on each side, for its padding. */
const TRAY_EDGE = 12;

/**
 * Keeps a screen's one main action reachable, on every width.
 *
 * By default (a lobby's Start / Deal) it renders in place, and only while its spot is below the
 * bottom of a phone screen does the same control float in the bar instead (it is only ever rendered
 * once, so tests and screen readers see one button). A lobby may scroll under it.
 *
 * `fixed` (a game's move, such as a clue and Give clue) keeps it in the bar on phones all the time
 * and the room keeps the bar's height free at the foot of the page, so the bar never covers
 * anything.
 *
 * On wider screens both kinds render in place, and while the spot is not wholly in the window
 * (below its foot) the same element lifts into a tray at the foot of the window, over its own
 * column, until the page is scrolled down to it. Nothing is re-mounted, so a half-typed clue keeps
 * its text and focus. `off` keeps it in place.
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
    <FloatingBar whole={whole} off={off} className={className}>
      {children}
      {slot('place')}
    </FloatingBar>
  );
}

/** Where a lifted tray sits: over the spot's column, at the foot of the window. */
/** `fill`: the control filled its column, so its holder does too (and follows a resized column). */
type Lift = { left: number; width: number; height: number; fill: boolean };

/**
 * Wider screens: lifts `el` into the tray while it is not wholly in the window and below its foot.
 * While lifted, a holder of the same size keeps its spot (the lifted element leaves the flow), and
 * the holder is what is watched until it is wholly back in view. Resizing the window moves the
 * tray with the holder while the spot is still below the foot, and drops it otherwise. A control taller than a third of the
 * window stays in place.
 */
function useLift(
  el: RefObject<HTMLElement | null>,
  holder: RefObject<HTMLElement | null>,
  active: boolean,
) {
  const [lift, setLift] = useState<Lift | null>(null);
  // Turning off drops the lift, so turning on again starts from the page, not an old place.
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) setLift(null);
  }
  const lifted = active && lift !== null;

  useEffect(() => {
    if (!active) return;
    const target = lifted ? holder.current : el.current;
    if (!target || typeof IntersectionObserver === 'undefined') return;
    // The control's place in the tray, or null when it stays in the page: a control taller than a
    // third of the window would cover too much of the page above.
    const liftOf = (node: HTMLElement): Lift | null => {
      const r = node.getBoundingClientRect();
      if (r.height === 0 || r.height > window.innerHeight / 3) return null;
      const column = node.parentElement?.clientWidth ?? 0;
      return {
        left: r.left,
        width: r.width,
        height: r.height,
        fill: Math.abs(column - r.width) < 1,
      };
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        const below =
          entry.intersectionRatio < 0.99 &&
          entry.boundingClientRect.bottom > window.innerHeight - 1;
        if (lifted && !below) setLift(null);
        if (!lifted && below && el.current) {
          const next = liftOf(el.current);
          if (next) setLift(next);
        }
      },
      { threshold: [0, 0.25, 0.5, 0.75, 0.99, 1] },
    );
    observer.observe(target);
    // A resized window decides at once, before the frame is painted (the watch above only reports
    // after it, a frame late on every step of a drag): the tray moves with the spot (the holder)
    // while the spot is below the window's foot, and lifts or lands the moment that changes.
    const check = () => {
      const node = lifted ? holder.current : el.current;
      if (!node) return;
      const r = node.getBoundingClientRect();
      const shown = Math.min(r.bottom, window.innerHeight) - Math.max(r.top, 0);
      const below = r.height > 0 && shown / r.height < 0.99 && r.bottom > window.innerHeight - 1;
      const next = below ? liftOf(node) : null;
      flushSync(() => {
        setLift((l) => {
          if (!next) return null;
          if (!lifted) return next;
          // Lifted, the holder's own height and fill stand for the control's.
          const moved = { ...next, height: l?.height ?? next.height, fill: !!l?.fill };
          return l && l.left === moved.left && l.width === moved.width ? l : moved;
        });
      });
    };
    // Checked again in this frame's callbacks, after the layout the resize brought (a wider layout
    // that moves the control) and still before the paint.
    let frame = 0;
    const resized = () => {
      check();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(check);
    };
    window.addEventListener('resize', resized);
    // The page's own box changes in the frame itself, even where the resize event comes a frame
    // after the first one painted at the new size.
    const page = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(check);
    page?.observe(document.documentElement);
    // A part that fits itself (the drawing beside or above the control) moved it: check now.
    document.addEventListener(LAYOUT_FITTED, check);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      page?.disconnect();
      window.removeEventListener('resize', resized);
      document.removeEventListener(LAYOUT_FITTED, check);
    };
  }, [active, lifted, el, holder]);

  if (!lifted) return null;
  const left = Math.max(0, lift.left - TRAY_EDGE);
  const right = Math.min(window.innerWidth, lift.left + lift.width + TRAY_EDGE);
  const style: CSSProperties = { left, width: right - left };
  return { style, height: lift.height, width: lift.fill ? null : lift.width };
}

/** Holds a lifted element's spot in the page (it is out of the flow while it is in the tray). */
function Holder({
  holder,
  lift,
}: {
  holder: RefObject<HTMLDivElement | null>;
  lift: { height: number; width: number | null } | null;
}) {
  return lift ? (
    <div
      ref={holder}
      aria-hidden="true"
      data-ui="sticky-holder"
      className="max-w-full shrink-0"
      style={{ height: lift.height, width: lift.width ?? '100%' }}
    />
  ) : null;
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
  const holder = useRef<HTMLDivElement>(null);
  const on = phone && !off;
  useReservedHeight('--vt-sticky-h', bar, on);
  const lift = useLift(bar, holder, !phone && !off);
  // In the bar the refusal sits above the control; in place, under it (under the field).
  return (
    <>
      <Holder holder={holder} lift={lift} />
      <div
        ref={bar}
        data-ui="sticky-bar"
        data-lifted={lift ? '' : undefined}
        className={cn(on && BAR, lift && TRAY, className)}
        style={lift?.style}
      >
        {on && refusal('bar')}
        {children}
        {!on && refusal('place')}
      </div>
    </>
  );
}

function FloatingBar({
  children,
  whole,
  off,
  className,
}: {
  children: ReactNode;
  whole: boolean;
  off: boolean;
  className?: string;
}) {
  const phone = usePhone();
  const spot = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const holder = useRef<HTMLDivElement>(null);
  const [floating, setFloating] = useState(false);
  const [height, setHeight] = useState(0);
  const lift = useLift(inner, holder, !phone && !off);

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

  const float = phone && floating && !off;
  // Keep the spot's height while the control floats, so the page doesn't jump.
  useEffect(() => {
    if (!float && spot.current) setHeight(spot.current.offsetHeight);
  }, [float, children]);

  const content = <div className={className}>{children}</div>;
  return (
    <>
      <div ref={spot} style={float ? { minHeight: height } : undefined}>
        {!float && !phone ? (
          <>
            <Holder holder={holder} lift={lift} />
            <div
              ref={inner}
              data-ui={lift ? 'sticky-bar' : undefined}
              data-lifted={lift ? '' : undefined}
              className={cn(lift && TRAY)}
              style={lift?.style}
            >
              {content}
            </div>
          </>
        ) : (
          !float && content
        )}
      </div>
      {float && (
        <div data-ui="sticky-bar" className={BAR}>
          {content}
        </div>
      )}
    </>
  );
}
