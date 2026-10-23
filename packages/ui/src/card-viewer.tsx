import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useReducer,
  useRef,
  useState,
} from 'react';
import { cn } from './cn.ts';
import { ProtectedImage } from './protected-image.tsx';

/** One card in the viewer. */
export interface ViewerItem {
  /** Stable key (`vision-40`). */
  key: string;
  /** Read out and shown under the card ("Vision 40"). */
  label: string;
  /** A second line under the label ("from hour II"). */
  caption?: string;
  /** Width over height of the art (`700 / 1024`). */
  aspect: number;
  /** The full-size art; without it, or when it fails, `fallback` shows. */
  src?: string | null;
  fallback?: ReactNode;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
/** What a double tap (or the first +) zooms to. */
export const TAP_ZOOM = 2.5;
/** How far (px) a finger must travel sideways to move to the next card, or down to close. */
export const SWIPE_PX = 60;
/** Two taps this close in time (ms) and space (px) are a double tap. */
export const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 30;

export interface ViewerState {
  index: number;
  count: number;
  /** Zoom (1 = fit) and pan (px from centre, in screen space). */
  scale: number;
  x: number;
  y: number;
}

export type ViewerEvent =
  | { type: 'go'; to: number }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'count'; count: number }
  /** Zoom to `scale` keeping the point (px from the frame's centre) under the finger. */
  | { type: 'zoom'; scale: number; at?: { x: number; y: number }; frame?: Frame }
  /** A double tap: zoom in at the point, or back out when zoomed. */
  | { type: 'toggle'; at?: { x: number; y: number }; frame?: Frame }
  | { type: 'pan'; dx: number; dy: number; frame?: Frame }
  | { type: 'reset' };

/** The size of the card as laid out at zoom 1, to keep a pan inside it. */
export interface Frame {
  w: number;
  h: number;
}

const clampIndex = (i: number, count: number) => Math.max(0, Math.min(count - 1, i));

function clampPan(s: ViewerState, frame?: Frame): ViewerState {
  if (s.scale <= MIN_ZOOM) return { ...s, scale: MIN_ZOOM, x: 0, y: 0 };
  if (!frame) return s;
  const mx = ((s.scale - 1) * frame.w) / 2;
  const my = ((s.scale - 1) * frame.h) / 2;
  return { ...s, x: Math.max(-mx, Math.min(mx, s.x)), y: Math.max(-my, Math.min(my, s.y)) };
}

function zoomTo(s: ViewerState, scale: number, at = { x: 0, y: 0 }, frame?: Frame): ViewerState {
  const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
  const k = next / s.scale;
  return clampPan(
    { ...s, scale: next, x: at.x - (at.x - s.x) * k, y: at.y - (at.y - s.y) * k },
    frame,
  );
}

/** The viewer's state machine, pure so it can be tested without a browser. A new card starts unzoomed. */
export function viewerReducer(s: ViewerState, e: ViewerEvent): ViewerState {
  const move = (to: number): ViewerState => {
    const index = clampIndex(to, s.count);
    return index === s.index ? s : { ...s, index, scale: 1, x: 0, y: 0 };
  };
  switch (e.type) {
    case 'go':
      return move(e.to);
    case 'next':
      return move(s.index + 1);
    case 'prev':
      return move(s.index - 1);
    case 'count': {
      const count = Math.max(1, e.count);
      return { ...s, count, index: clampIndex(s.index, count) };
    }
    case 'zoom':
      return zoomTo(s, e.scale, e.at, e.frame);
    case 'toggle':
      return s.scale > MIN_ZOOM
        ? { ...s, scale: 1, x: 0, y: 0 }
        : zoomTo(s, TAP_ZOOM, e.at, e.frame);
    case 'pan':
      return s.scale > MIN_ZOOM ? clampPan({ ...s, x: s.x + e.dx, y: s.y + e.dy }, e.frame) : s;
    case 'reset':
      return { ...s, scale: 1, x: 0, y: 0 };
  }
}

export const viewerStart = (index: number, count: number): ViewerState => ({
  index: clampIndex(index, Math.max(1, count)),
  count: Math.max(1, count),
  scale: 1,
  x: 0,
  y: 0,
});

/** What a finished one-finger drag at zoom 1 means. */
export function swipeOf(dx: number, dy: number): 'next' | 'prev' | 'close' | null {
  if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'next' : 'prev';
  if (dy > SWIPE_PX && dy > Math.abs(dx)) return 'close';
  return null;
}

/** Which key does what. */
export function keyOf(key: string): ViewerEvent | 'close' | null {
  switch (key) {
    case 'ArrowRight':
      return { type: 'next' };
    case 'ArrowLeft':
      return { type: 'prev' };
    case 'Escape':
      return 'close';
    case '0':
      return { type: 'reset' };
    default:
      return null;
  }
}

/** A history entry marker, so the back button or gesture closes the viewer instead of the room. */
const HISTORY_KEY = 'vtViewer';
/** The back() a closing viewer still owes, skipped when a viewer opens again straight away (React's dev double mount). */
let owedBack: ReturnType<typeof setTimeout> | undefined;

/** Closes on the back button or gesture: opening adds a history entry with the same URL. */
function useBackCloses(onClose: () => void) {
  const id = useId();
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const ours = () => (history.state as Record<string, unknown> | null)?.[HISTORY_KEY] === id;
    if (owedBack !== undefined && ours()) {
      clearTimeout(owedBack);
      owedBack = undefined;
    } else {
      history.pushState({ ...(history.state as object | null), [HISTORY_KEY]: id }, '');
    }
    let popped = false;
    const onPop = () => {
      if (ours()) return;
      popped = true;
      close.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (popped) return;
      owedBack = setTimeout(() => {
        owedBack = undefined;
        if (ours()) history.back();
      }, 0);
    };
  }, [id]);
}

/**
 * Cards full screen, one at a time: the full-size art, pinch, double-tap, wheel or +/− to zoom,
 * drag to pan while zoomed, swipe (or arrow keys) through the group it was opened from, and close
 * with ✕, a swipe down, Escape or the back button. Built on `<dialog>`, so focus stays inside and
 * the page behind is inert. `actions` renders under the card (a Pick toggle), for the card shown.
 * Mount it to open it; unmount it to close.
 */
export function CardViewer({
  items,
  start = 0,
  title,
  onClose,
  actions,
  onIndexChange,
}: {
  items: readonly ViewerItem[];
  start?: number;
  /** What the group is ("Your hand"), for screen readers and the header. */
  title: string;
  onClose: () => void;
  actions?: (index: number) => ReactNode;
  onIndexChange?: (index: number) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [s, dispatch] = useReducer(viewerReducer, viewerStart(start, items.length));
  const [drag, setDrag] = useState({ x: 0, y: 0 });
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{
    startX: number;
    startY: number;
    pinch?: { dist: number; scale: number };
    moved: boolean;
  } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  const [held, setHeld] = useState(false);
  const scaleRef = useRef(s.scale);
  useEffect(() => {
    scaleRef.current = s.scale;
  });
  const titleId = useId();
  useBackCloses(onClose);

  useEffect(() => {
    dispatch({ type: 'count', count: items.length });
  }, [items.length]);
  useEffect(() => {
    onIndexChange?.(s.index);
  }, [s.index, onIndexChange]);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  useEffect(() => {
    // Pointer events drive every gesture here. Left to itself, the browser also reads a swipe as
    // a drag or fling of its own and, once the viewer has closed under the finger, swallows the
    // next tap on the page; cancelling its touch handling on the card stops that.
    const el = stage.current;
    if (!el) return;
    const cancel = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
    };
    el.addEventListener('touchstart', cancel, { passive: false });
    el.addEventListener('touchmove', cancel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', cancel);
      el.removeEventListener('touchmove', cancel);
    };
  }, []);

  const frame = (): Frame | undefined => {
    const el = frameRef.current;
    return el ? { w: el.offsetWidth, h: el.offsetHeight } : undefined;
  };
  /** A point in px from the card's centre. */
  const fromCentre = (x: number, y: number) => {
    const r = stage.current?.getBoundingClientRect();
    return r ? { x: x - (r.left + r.width / 2), y: y - (r.top + r.height / 2) } : { x: 0, y: 0 };
  };

  // Wheel zoom needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const at = { x: e.clientX - (r.left + r.width / 2), y: e.clientY - (r.top + r.height / 2) };
      const f = frameRef.current;
      dispatch({
        type: 'zoom',
        scale: scaleRef.current * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)),
        at,
        frame: f ? { w: f.offsetWidth, h: f.offsetHeight } : undefined,
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, []);
  const item = items[s.index];
  const zoomed = s.scale > MIN_ZOOM;

  const onKeyDown = (e: KeyboardEvent) => {
    const k = e.key === '+' || e.key === '=' ? 'in' : e.key === '-' ? 'out' : keyOf(e.key);
    if (!k) return;
    e.preventDefault();
    e.stopPropagation();
    if (k === 'close') onClose();
    else if (k === 'in') dispatch({ type: 'zoom', scale: s.scale * 1.5, frame: frame() });
    else if (k === 'out') dispatch({ type: 'zoom', scale: s.scale / 1.5, frame: frame() });
    else dispatch(k);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setHeld(true);
    const pts = [...pointers.current.values()];
    if (pts.length === 2) {
      const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
      gesture.current = {
        startX: 0,
        startY: 0,
        moved: true,
        pinch: { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, scale: s.scale },
      };
      setDrag({ x: 0, y: 0 });
    } else if (pts.length === 1) {
      gesture.current = { startX: e.clientX, startY: e.clientY, moved: false };
    }
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const prev = pointers.current.get(e.pointerId);
    const g = gesture.current;
    if (!prev || !g) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const pts = [...pointers.current.values()];
    if (g.pinch && pts.length >= 2) {
      const [a, b] = pts as [{ x: number; y: number }, { x: number; y: number }];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      dispatch({
        type: 'zoom',
        scale: (g.pinch.scale * dist) / g.pinch.dist,
        at: fromCentre((a.x + b.x) / 2, (a.y + b.y) / 2),
        frame: frame(),
      });
      return;
    }
    if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > 8) g.moved = true;
    if (zoomed)
      dispatch({ type: 'pan', dx: e.clientX - prev.x, dy: e.clientY - prev.y, frame: frame() });
    else if (!g.pinch) setDrag({ x: e.clientX - g.startX, y: Math.max(0, e.clientY - g.startY) });
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    pointers.current.delete(e.pointerId);
    if (pointers.current.size > 0) return;
    gesture.current = null;
    setHeld(false);
    setDrag({ x: 0, y: 0 });
    if (!g) return;
    if (g.moved) {
      if (!g.pinch && !zoomed) {
        const swipe = swipeOf(e.clientX - g.startX, e.clientY - g.startY);
        if (swipe === 'close') onClose();
        else if (swipe) dispatch({ type: swipe });
      }
      lastTap.current = null;
      return;
    }
    const now = e.timeStamp;
    const last = lastTap.current;
    if (
      last &&
      now - last.t < DOUBLE_TAP_MS &&
      Math.hypot(e.clientX - last.x, e.clientY - last.y) < DOUBLE_TAP_PX
    ) {
      lastTap.current = null;
      dispatch({ type: 'toggle', at: fromCentre(e.clientX, e.clientY), frame: frame() });
    } else lastTap.current = { t: now, x: e.clientX, y: e.clientY };
  };
  const onPointerCancel = (e: PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(e.pointerId);
    gesture.current = null;
    setHeld(false);
    setDrag({ x: 0, y: 0 });
  };

  const portrait = (item?.aspect ?? 1) < 1;
  const transform = zoomed
    ? `translate(${s.x}px, ${s.y}px) scale(${s.scale})`
    : drag.x || drag.y
      ? `translate(${drag.x}px, ${drag.y}px)`
      : undefined;

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      data-zoom={s.scale.toFixed(2)}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onKeyDown={onKeyDown}
      className="m-0 h-dvh max-h-none w-screen max-w-none flex-col overflow-hidden bg-stone-950 p-0 text-stone-100 backdrop:bg-black/80 open:flex"
    >
      <div className="flex h-12 shrink-0 items-center gap-2 px-2">
        <h2 id={titleId} className="min-w-0 flex-1 truncate pl-2 text-sm font-semibold">
          {title}
          {items.length > 1 && (
            // vt-contrast: the viewer is dark in both themes
            <span className="ml-2 rounded-full bg-white/10 px-2 py-0.5 text-xs text-stone-300">
              {s.index + 1} / {items.length}
            </span>
          )}
        </h2>
        <div className="hidden items-center gap-1 sm:flex" role="group" aria-label="Zoom">
          {(
            [
              ['−', 'Zoom out', s.scale / 1.5, !zoomed],
              ['+', 'Zoom in', s.scale * 1.5, s.scale >= MAX_ZOOM],
            ] as const
          ).map(([sign, label, scale, off]) => (
            <button
              key={sign}
              type="button"
              aria-label={label}
              disabled={off}
              onClick={() => dispatch({ type: 'zoom', scale, frame: frame() })}
              className="size-11 rounded-full text-xl hover:bg-white/10 disabled:opacity-30"
            >
              {sign}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="size-11 shrink-0 rounded-full text-lg hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-accent dark:focus-visible:outline-amber-500"
        >
          ✕
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={stage}
          role="group"
          aria-roledescription="card"
          aria-label={item ? `${item.label}${item.caption ? `, ${item.caption}` : ''}` : title}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          onContextMenu={(e) => e.preventDefault()}
          className={cn(
            'flex size-full touch-none items-center justify-center overflow-hidden p-2 select-none',
            zoomed ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in',
          )}
        >
          {item && (
            <div
              key={item.key}
              ref={frameRef}
              data-viewer-card={item.key}
              style={{
                aspectRatio: String(item.aspect),
                transform,
                opacity: drag.y ? Math.max(0.4, 1 - drag.y / 400) : undefined,
              }}
              className={cn(
                'relative max-h-full max-w-full overflow-hidden rounded-xl shadow-2xl will-change-transform',
                portrait ? 'h-full' : 'w-full max-w-5xl',
                !held && 'motion-safe:transition-transform motion-safe:duration-150',
              )}
            >
              <ViewerArt item={item} />
            </div>
          )}
        </div>
        {items.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Previous card"
              disabled={s.index <= 0}
              onClick={() => dispatch({ type: 'prev' })}
              className="absolute top-1/2 left-2 hidden size-12 -translate-y-1/2 rounded-full bg-black/50 text-2xl hover:bg-black/70 disabled:opacity-20 sm:block"
            >
              ‹
            </button>
            <button
              type="button"
              aria-label="Next card"
              disabled={s.index >= items.length - 1}
              onClick={() => dispatch({ type: 'next' })}
              className="absolute top-1/2 right-2 hidden size-12 -translate-y-1/2 rounded-full bg-black/50 text-2xl hover:bg-black/70 disabled:opacity-20 sm:block"
            >
              ›
            </button>
          </>
        )}
      </div>
      <div className="shrink-0 space-y-2 px-3 pt-1 pb-[max(0.75rem,env(safe-area-inset-bottom))] text-center">
        <p aria-live="polite" className="text-sm font-semibold">
          {item?.label}
          {item?.caption && (
            // vt-contrast: the viewer is dark in both themes
            <span className="block text-xs font-normal text-stone-400">{item.caption}</span>
          )}
        </p>
        {actions && (
          <div className="mx-auto flex max-w-md justify-center gap-2">{actions(s.index)}</div>
        )}
        {/* vt-contrast: the viewer is dark in both themes */}
        <p className="text-[11px] text-stone-400">
          {items.length > 1 ? 'Swipe for the next card · ' : ''}Double-tap or pinch to zoom · Swipe
          down to close
        </p>
      </div>
    </dialog>
  );
}

function ViewerArt({ item }: { item: ViewerItem }) {
  const [failed, setFailed] = useState(false);
  if (!item.src || failed) return <>{item.fallback}</>;
  return (
    <ProtectedImage
      src={item.src}
      alt=""
      decoding="async"
      onError={() => setFailed(true)}
      className="absolute inset-0 size-full object-contain"
    />
  );
}
