import { ProtectedImage, cn } from '@vt/ui';
import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import type { Kind } from '../logic/cards.ts';
import type { PsychicColor } from '../logic/types.ts';
import { type Content, KIND_ICONS } from './assets.ts';

const PLACEHOLDER: Record<Kind, string> = {
  vision: 'from-indigo-800 via-violet-900 to-stone-950',
  suspect: 'from-rose-900 to-stone-900',
  place: 'from-emerald-900 to-stone-900',
  object: 'from-amber-800 to-stone-900',
  story: 'from-slate-800 to-stone-950',
};

interface Props {
  kind: Kind;
  n: number;
  content: Content;
  /** `thumb` uses the small file; `big` the full one with a larger placeholder. */
  size?: 'thumb' | 'big';
  selected?: boolean;
  dimmed?: boolean;
  onTap?: () => void;
  disabled?: boolean;
  /** Extra label for screen readers and tests ("your guess"). */
  note?: string;
  /** Fill the parent instead of sizing by width and aspect ratio. */
  fill?: boolean;
  className?: string;
  /** Overlays: tokens, guesses, stamps. */
  children?: ReactNode;
  /**
   * A larger copy on mouse hover (desktop), on by default for tappable cards; it only shows when
   * it would be much bigger than the card as drawn (`previewSpot`).
   */
  preview?: boolean;
  /** The tap only looks (picking is a separate button), so the card is no toggle. */
  look?: boolean;
}

/** The numbered stand-in for a card without art. */
export function CardPlaceholder({ kind, n, big }: { kind: Kind; n: number; big?: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        'absolute inset-0 flex flex-col items-center justify-center gap-1 bg-gradient-to-br font-serif font-bold text-white/90',
        PLACEHOLDER[kind],
        big ? 'text-5xl' : 'text-lg',
      )}
    >
      <span className={big ? 'text-6xl' : 'text-xl'}>{KIND_ICONS[kind]}</span>
      {n}
    </span>
  );
}

/** How long the mouse rests on a card before its larger preview shows. */
export const PREVIEW_DELAY_MS = 450;
/** A preview only shows when it is at least this much bigger than the card on screen. */
export const PREVIEW_MIN_GAIN = 1.6;
const PREVIEW_MAX_H = 0.7;
const PREVIEW_MAX_W = 0.6;
const GAP = 12;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const overlap = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));

/** A spot for a preview of this size beside, above or below `r`, clear of `avoid`, or null. */
function placeAt(
  r: Box,
  width: number,
  height: number,
  win: { w: number; h: number },
  avoid: readonly Box[],
) {
  const clamp = (v: number, size: number, max: number) =>
    Math.max(GAP, Math.min(max - size - GAP, v));
  const midTop = clamp(r.top + r.height / 2 - height / 2, height, win.h);
  const midLeft = clamp(r.left + r.width / 2 - width / 2, width, win.w);
  // Beside, above or below the card, or just past a card to keep clear of, in any mix.
  const lefts = [
    midLeft,
    r.left + r.width + GAP,
    r.left - GAP - width,
    ...avoid.flatMap((a) => [a.left + a.width + GAP, a.left - GAP - width]),
  ];
  const tops = [
    midTop,
    r.top - GAP - height,
    r.top + r.height + GAP,
    ...avoid.flatMap((a) => [a.top + a.height + GAP, a.top - GAP - height]),
  ];
  const spots: Box[] = [
    ...lefts.flatMap((left) => tops.map((top) => ({ left, top, width, height }))),
  ].filter(
    (s) =>
      s.left >= GAP &&
      s.top >= GAP &&
      s.left + s.width <= win.w - GAP &&
      s.top + s.height <= win.h - GAP &&
      overlap(s, r) === 0 &&
      avoid.every((a) => overlap(s, a) === 0),
  );
  const far = (s: Box) =>
    Math.hypot(
      s.left + s.width / 2 - (r.left + r.width / 2),
      s.top + s.height / 2 - (r.top + r.height / 2),
    );
  return spots.reduce<Box | null>((best, s) => (!best || far(s) < far(best) ? s : best), null);
}

/**
 * Where a hover preview of a card at `r` goes, or null when it wouldn't be worth it: sized from
 * the window (up to 70% of its height, the art's own shape), inside the window and never over
 * the card itself or the `avoid` boxes (the card being compared against), shrunk to fit if it
 * must, and shown only when it is at least 1.6 times the card as drawn.
 */
export function previewSpot(
  r: Box,
  portrait: boolean,
  win: { w: number; h: number },
  avoid: readonly Box[] = [],
): Box | null {
  const aspect = portrait ? 700 / 1024 : 1024 / 700;
  let height = win.h * PREVIEW_MAX_H;
  let width = height * aspect;
  if (width > win.w * PREVIEW_MAX_W) {
    width = win.w * PREVIEW_MAX_W;
    height = width / aspect;
  }
  const least = Math.max(r.width / width, r.height / height) * PREVIEW_MIN_GAIN;
  if (least > 1) return null;
  for (let scale = 1; scale > least; scale -= 0.05) {
    const spot = placeAt(r, width * scale, height * scale, win, avoid);
    if (spot) return spot;
  }
  return placeAt(r, width * least, height * least, win, avoid);
}

const canHover = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 1024px)').matches;

/** The on-screen cards a preview should keep clear of (Compare's pinned card). */
function avoidBoxes(el: HTMLElement) {
  const scope = el.closest('[role="dialog"]') ?? document;
  return [...scope.querySelectorAll<HTMLElement>('[data-preview-avoid]')]
    .map((a) => a.getBoundingClientRect())
    .filter(
      (b) =>
        b.width > 0 &&
        b.right > 0 &&
        b.left < window.innerWidth &&
        b.bottom > 0 &&
        b.top < window.innerHeight,
    );
}

/**
 * A larger copy of a card after the mouse rests on it (desktop only), in the top layer so it
 * never moves the layout. Gone on leave, click, wheel or any scroll.
 */
function useHoverPreview(on: boolean, portrait: boolean) {
  const [spot, setSpot] = useState<Box | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    return () => {
      clearTimeout(timer.current);
    };
  }, []);
  useEffect(() => {
    if (!spot) return;
    const off = () => setSpot(null);
    window.addEventListener('scroll', off, true);
    window.addEventListener('resize', off);
    return () => {
      window.removeEventListener('scroll', off, true);
      window.removeEventListener('resize', off);
    };
  }, [spot]);
  const hide = () => {
    clearTimeout(timer.current);
    setSpot(null);
  };
  const handlers = on
    ? {
        onPointerEnter: (e: PointerEvent<HTMLElement>) => {
          if (e.pointerType !== 'mouse' || !canHover()) return;
          const el = e.currentTarget;
          clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            if (!el.isConnected) return;
            setSpot(
              previewSpot(
                el.getBoundingClientRect(),
                portrait,
                { w: window.innerWidth, h: window.innerHeight },
                avoidBoxes(el),
              ),
            );
          }, PREVIEW_DELAY_MS);
        },
        onPointerLeave: hide,
        onPointerDown: hide,
        onWheel: hide,
      }
    : {};
  return [spot, handlers] as const;
}

/**
 * One card, art first. Visions are portrait, suspects, places, objects and stories landscape. When the art
 * can't load (no asset storage in tests or dev, or a missing file) it shows a numbered placeholder.
 */
export function Card({
  kind,
  n,
  content,
  size = 'thumb',
  selected,
  dimmed,
  onTap,
  disabled,
  note,
  fill,
  className,
  children,
  preview,
  look,
}: Props) {
  const [failed, setFailed] = useState(false);
  const [spot, hoverHandlers] = useHoverPreview(
    (preview ?? !!onTap) && !disabled,
    kind === 'vision',
  );
  const art = content.cardArt(kind, n, size === 'thumb');
  const label = `${content.cardLabel(kind, n)}${note ? ` (${note})` : ''}`;
  const body = (
    <>
      {art && !failed ? (
        <ProtectedImage
          src={art}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          className={cn(
            'absolute inset-0 size-full',
            size === 'big' ? 'object-contain' : 'object-cover',
          )}
        />
      ) : (
        <CardPlaceholder kind={kind} n={n} big={size === 'big'} />
      )}
      {children}
    </>
  );
  const classes = cn(
    'relative block overflow-hidden rounded-lg bg-stone-900 shadow ring-1 ring-black/20 select-none [-webkit-touch-callout:none]',
    fill
      ? 'size-full'
      : kind === 'vision'
        ? 'aspect-[700/1024] w-full'
        : 'aspect-[1024/700] w-full',
    selected && 'ring-4 ring-accent dark:ring-amber-400',
    dimmed && 'opacity-45 grayscale',
    className,
  );
  if (!onTap)
    return (
      <div role="img" aria-label={label} data-card={`${kind}-${n}`} className={classes}>
        {body}
      </div>
    );
  const big = content.cardArt(kind, n, false);
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-pressed={look ? undefined : selected}
        disabled={disabled}
        data-card={`${kind}-${n}`}
        onClick={onTap}
        {...hoverHandlers}
        className={cn(classes, 'cursor-pointer touch-manipulation disabled:cursor-not-allowed')}
      >
        {body}
      </button>
      {spot && (
        <div
          ref={(el) => {
            el?.showPopover?.();
          }}
          popover="manual"
          aria-hidden
          style={spot}
          className="pointer-events-none fixed inset-auto m-0 overflow-hidden rounded-xl border-0 bg-stone-900 p-0 shadow-2xl ring-1 ring-black/30"
        >
          {big && !failed ? (
            <ProtectedImage
              src={big}
              alt=""
              className="absolute inset-0 size-full object-contain"
            />
          ) : (
            <CardPlaceholder kind={kind} n={n} big />
          )}
        </div>
      )}
    </>
  );
}

/** A face-down vision (the shared vision before it turns over). */
export function CardBack({ content, className }: { content: Content; className?: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div
      role="img"
      aria-label="Face-down vision"
      className={cn(
        'relative aspect-[700/1024] w-full overflow-hidden rounded-lg bg-gradient-to-br from-sky-900 to-indigo-950 shadow ring-1 ring-black/20',
        className,
      )}
    >
      {content.back && !failed ? (
        <ProtectedImage
          src={content.back}
          alt=""
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <span aria-hidden className="absolute inset-0 flex items-center justify-center text-3xl">
          🌀
        </span>
      )}
    </div>
  );
}

/** A psychic's portrait in their sleeve colour (initial on a coloured disc without art). */
export function Avatar({
  color,
  content,
  name,
  size = 'md',
  className,
}: {
  color: PsychicColor;
  content: Content;
  name?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const art = content.psychicArt(color);
  const swatch = content.swatch(color);
  const dim = size === 'sm' ? 'size-7' : size === 'lg' ? 'size-16' : 'size-10';
  return (
    <span
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold text-white ring-2',
        dim,
        className,
      )}
      style={{ backgroundColor: swatch, ['--tw-ring-color' as string]: swatch }}
      aria-hidden
    >
      {art && !failed ? (
        <ProtectedImage
          src={art}
          alt=""
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <span className={cn(color === 'white' && 'text-stone-800', size === 'lg' && 'text-2xl')}>
          {(name ?? color)[0]!.toUpperCase()}
        </span>
      )}
    </span>
  );
}
