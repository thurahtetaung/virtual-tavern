import {
  DEFAULT_DRAWING_LIMITS,
  DRAW_H,
  DRAW_W,
  DRAWING_COLORS,
  DRAWING_WIDTHS,
  type Drawing,
  type DrawingLimits,
  type Stroke,
  decodeDrawing,
  drawingPoints,
  encodeDrawing,
  storageKey,
  validateDrawing,
} from '@vt/game-sdk';
import { type ReactNode, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from './cn.ts';
import { Button } from './components.tsx';
import { useConfirm } from './confirm.tsx';

// The drawing canvas: `DrawingPad` to draw (touch, pen or mouse) and `DrawingView` to show a
// drawing read-only at any size. Strokes and their encoding live in `@vt/game-sdk` (`drawing.ts`),
// so a game's logic checks exactly what the pad sends.

/** The paper: the same in both themes, since it is part of the picture. */
export const PAPER = '#fbf8f1';

/** An SVG path through the points, smoothed with midpoints (a dot for a single point). */
export function strokePath(points: readonly number[]): string {
  const n = Math.floor(points.length / 2);
  if (n === 0) return '';
  const x = (i: number) => points[i * 2]!;
  const y = (i: number) => points[i * 2 + 1]!;
  if (n === 1) return `M${x(0)} ${y(0)}l0 0`;
  if (n === 2) return `M${x(0)} ${y(0)}L${x(1)} ${y(1)}`;
  let d = `M${x(0)} ${y(0)}`;
  for (let i = 1; i < n - 1; i++) {
    const mx = (x(i) + x(i + 1)) / 2;
    const my = (y(i) + y(i + 1)) / 2;
    d += `Q${x(i)} ${y(i)} ${mx} ${my}`;
  }
  return `${d}L${x(n - 1)} ${y(n - 1)}`;
}

/** When a stroke starts drawing itself in, and for how long (ms). */
interface DrawIn {
  delay: number;
  duration: number;
}

function StrokePath({ stroke, drawIn }: { stroke: Stroke; drawIn?: DrawIn }) {
  return (
    <path
      d={strokePath(stroke.points)}
      {...(drawIn && {
        pathLength: 1,
        className: 'vt-draw-in',
        style: { animationDelay: `${drawIn.delay}ms`, animationDuration: `${drawIn.duration}ms` },
      })}
      fill="none"
      stroke={DRAWING_COLORS[stroke.c]?.hex ?? DRAWING_COLORS[0].hex}
      strokeWidth={DRAWING_WIDTHS[stroke.w]?.size ?? DRAWING_WIDTHS[0].size}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}

/**
 * Each stroke's share of `ms`, by its points, one after another, so the drawing draws itself in
 * the order it was drawn.
 */
function drawInTimes(strokes: readonly Stroke[], ms: number): DrawIn[] {
  const total = strokes.reduce((n, s) => n + Math.max(1, s.points.length / 2), 0);
  let at = 0;
  return strokes.map((s) => {
    const duration = (ms * Math.max(1, s.points.length / 2)) / total;
    const t = { delay: at, duration };
    at += duration;
    return t;
  });
}

/** Dashes that shrink to nothing: a stroke traces itself. Reduced motion shows it whole. */
const DRAW_IN_CSS =
  '.vt-draw-in{stroke-dasharray:1;stroke-dashoffset:1;animation-name:vt-draw-in;animation-timing-function:linear;animation-fill-mode:forwards}' +
  '@keyframes vt-draw-in{to{stroke-dashoffset:0}}' +
  '@media (prefers-reduced-motion:reduce){.vt-draw-in{animation:none;stroke-dashoffset:0}}';

const Strokes = memo(function Strokes({
  strokes,
  drawInMs,
}: {
  strokes: readonly Stroke[];
  drawInMs?: number;
}) {
  const times = drawInMs ? drawInTimes(strokes, drawInMs) : null;
  return (
    <>
      {times && <style>{DRAW_IN_CSS}</style>}
      {strokes.map((s, i) => (
        <StrokePath key={i} stroke={s} drawIn={times?.[i]} />
      ))}
    </>
  );
});

/**
 * A drawing, read-only, scaled to its box (4:5). `label` names it for screen readers ("Lot 3's
 * drawing"). An empty or undecodable drawing shows blank paper.
 */
export function DrawingView({
  drawing,
  label,
  className,
  drawInMs,
  children,
}: {
  drawing: Drawing | readonly Stroke[] | null;
  label: string;
  className?: string;
  /** The drawing draws itself in, stroke by stroke, over this long (on the compositor's clock). */
  drawInMs?: number;
  /** Laid over the paper (a "Hidden" veil, a stamp). */
  children?: ReactNode;
}) {
  const strokes = useMemo<readonly Stroke[]>(() => {
    if (!drawing?.length) return [];
    return 'points' in drawing[0]! ? (drawing as Stroke[]) : decodeDrawing(drawing as Drawing);
  }, [drawing]);
  return (
    <div className={cn('relative aspect-[4/5] overflow-hidden rounded-lg', className)}>
      <svg
        viewBox={`0 0 ${DRAW_W} ${DRAW_H}`}
        className="block size-full"
        role="img"
        aria-label={label}
      >
        <rect width={DRAW_W} height={DRAW_H} fill={PAPER} />
        <Strokes strokes={strokes} drawInMs={drawInMs} />
      </svg>
      {children}
    </div>
  );
}

// ---- Drafts ----

interface Draft {
  at: number;
  strokes: Stroke[];
}

/** Drafts older than this are dropped when read. */
const DRAFT_TTL_MS = 6 * 60 * 60_000;

function readDraft(key: string): Stroke[] {
  try {
    const raw = localStorage.getItem(storageKey(key));
    if (!raw) return [];
    const d = JSON.parse(raw) as Draft;
    if (!Array.isArray(d.strokes) || Date.now() - d.at > DRAFT_TTL_MS) return [];
    return d.strokes.filter(
      (s) =>
        Number.isInteger(s.c) &&
        Number.isInteger(s.w) &&
        Array.isArray(s.points) &&
        s.points.every((v) => typeof v === 'number'),
    );
  } catch {
    return [];
  }
}

function writeDraft(key: string, strokes: Stroke[]) {
  try {
    if (strokes.length === 0) localStorage.removeItem(storageKey(key));
    else
      localStorage.setItem(
        storageKey(key),
        JSON.stringify({ at: Date.now(), strokes } satisfies Draft),
      );
  } catch {
    // Storage full or blocked: the draft just won't survive a reload.
  }
}

/** Forgets a pad's saved draft (once the server has the drawing). */
export function clearDrawingDraft(draftKey: string): void {
  try {
    localStorage.removeItem(storageKey(draftKey));
  } catch {
    // Nothing to clear.
  }
}

/**
 * The strokes as a drawing within the limits: simplified harder until it fits (a long scribble
 * loses detail rather than being refused), or null if it never does.
 */
export function packDrawing(
  strokes: readonly Stroke[],
  limits: DrawingLimits = DEFAULT_DRAWING_LIMITS,
): Drawing | null {
  for (const tolerance of [2.5, 4, 6, 9, 14]) {
    const check = validateDrawing(encodeDrawing(strokes, tolerance), limits);
    if (check.ok) return check.drawing;
    if (check.code !== 'drawing-too-big') return null;
  }
  return null;
}

// ---- The pad ----

/** A contact this big (CSS px) is a palm or a resting hand, not a fingertip. */
const PALM_PX = 60;
/** Points closer than this (page units) to the last one are skipped. */
const MIN_STEP = 3;
/** Two fingers down and up within this long, without drawing, is an undo. */
const TWO_FINGER_TAP_MS = 350;

export interface DrawingPadProps {
  /**
   * Where the draft is kept (through `storageKey`), so a reload keeps the drawing. Make it unique
   * per drawing: room, game and prompt.
   */
  draftKey: string;
  /** Sends the drawing; resolves true once accepted (the pad then forgets its draft). */
  onSubmit: (drawing: Drawing) => Promise<boolean> | boolean;
  submitLabel?: string;
  /** Local epoch ms at which whatever is drawn is sent by itself (before a strict deadline). */
  sendBy?: number | null;
  disabled?: boolean;
  limits?: DrawingLimits;
  /** Shown beside the Send button (a timer). */
  footer?: ReactNode;
  className?: string;
}

/**
 * The drawing pad: a 4:5 sheet with four pens, three widths, undo and clear. One finger, a pen or
 * the mouse draws; a second finger cancels the line in progress, and a quick two-finger tap undoes.
 * The page never scrolls or zooms while a finger is on the sheet. The draft is saved locally after
 * every line, so a reload or a dropped connection keeps it.
 */
export function DrawingPad({
  draftKey,
  onSubmit,
  submitLabel = 'Send',
  sendBy = null,
  disabled = false,
  limits = DEFAULT_DRAWING_LIMITS,
  footer,
  className,
}: DrawingPadProps) {
  const [strokes, setStrokes] = useState<Stroke[]>(() => readDraft(draftKey));
  const [loadedKey, setLoadedKey] = useState(draftKey);
  if (loadedKey !== draftKey) {
    setLoadedKey(draftKey);
    setStrokes(readDraft(draftKey));
  }
  const [live, setLive] = useState<Stroke | null>(null);
  const [color, setColor] = useState(0);
  const [width, setWidth] = useState(1);
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirm, dialog] = useConfirm();

  const sheet = useRef<HTMLDivElement>(null);
  const current = useRef<{ id: number; stroke: Stroke } | null>(null);
  const pointers = useRef(new Map<number, { type: string; moved: boolean }>());
  const twoFinger = useRef<{ at: number; moved: boolean } | null>(null);
  const frame = useRef<number | null>(null);
  const strokesRef = useRef(strokes);
  useEffect(() => {
    strokesRef.current = strokes;
  }, [strokes]);

  const full = strokes.length >= limits.strokes || drawingPoints(strokes) >= limits.points * 1.5;

  const commit = useCallback(
    (next: Stroke[]) => {
      setStrokes(next);
      writeDraft(draftKey, next);
    },
    [draftKey],
  );

  const toPage = (e: { clientX: number; clientY: number }) => {
    const box = sheet.current!.getBoundingClientRect();
    return [
      ((e.clientX - box.left) / box.width) * DRAW_W,
      ((e.clientY - box.top) / box.height) * DRAW_H,
    ] as const;
  };

  const paint = () => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      const c = current.current;
      setLive(c ? { ...c.stroke, points: [...c.stroke.points] } : null);
    });
  };

  const cancelLive = () => {
    current.current = null;
    paint();
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || sending) return;
    const isTouch = e.pointerType === 'touch';
    if (isTouch && (e.width > PALM_PX || e.height > PALM_PX)) return;
    // A pen on the sheet: resting fingers and palms are ignored.
    if (isTouch && [...pointers.current.values()].some((p) => p.type === 'pen')) return;
    e.preventDefault();
    pointers.current.set(e.pointerId, { type: e.pointerType, moved: false });
    if (pointers.current.size >= 2) {
      // A second finger: this is a gesture, not a line.
      const drawing = current.current;
      twoFinger.current = {
        at: e.timeStamp,
        moved: Boolean(drawing && drawing.stroke.points.length > 4),
      };
      cancelLive();
      return;
    }
    if (full) {
      setProblem('The page is full: undo a line to keep drawing.');
      return;
    }
    sheet.current?.setPointerCapture(e.pointerId);
    const [x, y] = toPage(e);
    current.current = { id: e.pointerId, stroke: { c: color, w: width, points: [x, y] } };
    setProblem(null);
    paint();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const c = current.current;
    const p = pointers.current.get(e.pointerId);
    if (p) p.moved = true;
    if (!c || c.id !== e.pointerId) return;
    e.preventDefault();
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const [x, y] = toPage(ev);
      const pts = c.stroke.points;
      const dx = x - pts[pts.length - 2]!;
      const dy = y - pts[pts.length - 1]!;
      if (dx * dx + dy * dy >= MIN_STEP * MIN_STEP) pts.push(x, y);
    }
    paint();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const had = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (twoFinger.current) {
      if (pointers.current.size === 0) {
        const tap = twoFinger.current;
        twoFinger.current = null;
        if (!tap.moved && e.timeStamp - tap.at < TWO_FINGER_TAP_MS && !had?.moved) undo();
      }
      return;
    }
    const c = current.current;
    if (!c || c.id !== e.pointerId) return;
    current.current = null;
    setLive(null);
    if (e.type === 'pointercancel') return;
    commit([...strokesRef.current, c.stroke]);
  };

  // iOS Safari: block the page's pinch-zoom and scroll while touching the sheet, whatever
  // `touch-action` says. These have to be non-passive native listeners.
  useEffect(() => {
    const el = sheet.current;
    if (!el) return;
    const stop = (ev: Event) => ev.preventDefault();
    el.addEventListener('touchstart', stop, { passive: false });
    el.addEventListener('touchmove', stop, { passive: false });
    el.addEventListener('gesturestart', stop);
    el.addEventListener('contextmenu', stop);
    return () => {
      el.removeEventListener('touchstart', stop);
      el.removeEventListener('touchmove', stop);
      el.removeEventListener('gesturestart', stop);
      el.removeEventListener('contextmenu', stop);
    };
  }, []);

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [],
  );

  const undo = () => {
    const now = strokesRef.current;
    if (now.length) commit(now.slice(0, -1));
  };

  const clear = async () => {
    if (!strokes.length) return;
    if (!(await confirm({ title: 'Clear the page?', confirmLabel: 'Clear', danger: true }))) return;
    commit([]);
  };

  const submit = useCallback(
    async (auto = false) => {
      const now = strokesRef.current;
      if (!now.length) {
        if (!auto) setProblem('You have to draw something!');
        return;
      }
      const drawing = packDrawing(now, limits);
      if (!drawing) {
        setProblem('That drawing is too detailed to send: undo a few lines.');
        return;
      }
      setSending(true);
      try {
        if (await onSubmit(drawing)) clearDrawingDraft(draftKey);
      } finally {
        setSending(false);
      }
    },
    [draftKey, limits, onSubmit],
  );

  // Before a strict deadline, whatever is on the page goes by itself.
  useEffect(() => {
    if (sendBy === null || disabled) return;
    const id = setTimeout(() => void submit(true), Math.max(0, sendBy - Date.now()));
    return () => clearTimeout(id);
  }, [sendBy, disabled, submit]);

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <div
        ref={sheet}
        className={cn(
          'relative mx-auto aspect-[4/5] w-full touch-none select-none overflow-hidden rounded-lg shadow-sm ring-1 ring-line [-webkit-touch-callout:none] [-webkit-user-select:none] dark:ring-stone-600',
          disabled ? 'cursor-not-allowed opacity-70' : 'cursor-crosshair',
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        data-testid="drawing-pad"
      >
        <svg
          viewBox={`0 0 ${DRAW_W} ${DRAW_H}`}
          className="pointer-events-none block size-full"
          role="img"
          aria-label={`Drawing area, ${strokes.length} line${strokes.length === 1 ? '' : 's'}`}
        >
          <rect width={DRAW_W} height={DRAW_H} fill={PAPER} />
          <Strokes strokes={strokes} />
          {live && <StrokePath stroke={live} />}
        </svg>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Pen colour">
          {DRAWING_COLORS.map((c, i) => (
            <button
              key={c.id}
              type="button"
              role="radio"
              aria-checked={color === i}
              aria-label={c.name}
              title={c.name}
              onClick={() => setColor(i)}
              className={cn(
                'size-9 rounded-full ring-offset-2 ring-offset-page transition-shadow dark:ring-offset-stone-900',
                color === i
                  ? 'ring-3 ring-stone-700 dark:ring-stone-200'
                  : 'ring-1 ring-line-strong',
              )}
              style={{ background: c.hex }}
            />
          ))}
        </div>
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Line width">
          {DRAWING_WIDTHS.map((w, i) => (
            <button
              key={w.id}
              type="button"
              role="radio"
              aria-checked={width === i}
              aria-label={w.name}
              title={w.name}
              onClick={() => setWidth(i)}
              className={cn(
                'flex size-9 items-center justify-center rounded-lg',
                width === i
                  ? 'bg-card ring-2 ring-stone-700 dark:bg-stone-800 dark:ring-stone-200'
                  : 'hover:bg-line/60 dark:hover:bg-stone-800',
              )}
            >
              <span
                className="block rounded-full"
                style={{
                  width: 4 + i * 6,
                  height: 4 + i * 6,
                  background: DRAWING_COLORS[color]!.hex,
                }}
              />
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Undo"
            title="Undo (or tap with two fingers)"
            onClick={undo}
            disabled={!strokes.length || disabled}
          >
            ↶
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Clear the page"
            title="Clear"
            onClick={() => void clear()}
            disabled={!strokes.length || disabled}
          >
            🗑
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">{footer}</div>
        <Button
          onClick={() => void submit()}
          disabled={disabled || sending || !strokes.length}
          data-testid="drawing-send"
        >
          {submitLabel} ▸
        </Button>
      </div>
      {problem && (
        <p role="alert" className="text-sm text-danger-ink dark:text-rose-300">
          {problem}
        </p>
      )}
      {dialog}
    </div>
  );
}
