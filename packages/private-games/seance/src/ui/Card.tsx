import { ProtectedImage, cn } from '@vt/ui';
import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import type { Kind } from '../logic/cards.ts';
import type { PsychicColor } from '../logic/types.ts';
import { type Content, PILLAR_ICONS } from './assets.ts';

const PLACEHOLDER: Record<Kind, string> = {
  vision: 'from-indigo-800 via-violet-900 to-stone-950',
  suspect: 'from-rose-900 to-stone-900',
  place: 'from-emerald-900 to-stone-900',
  object: 'from-amber-800 to-stone-900',
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
  /** A larger copy on mouse hover (desktop); on by default for small tappable cards. */
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
      <span className={big ? 'text-6xl' : 'text-xl'}>
        {kind === 'vision' ? '👁️' : PILLAR_ICONS[kind]}
      </span>
      {n}
    </span>
  );
}

/** How long the mouse rests on a card before its larger preview shows. */
export const PREVIEW_DELAY_MS = 450;
const PREVIEW_W = { portrait: 300, landscape: 420 };

/** Where a hover preview of a card at `r` goes: beside it, inside the window. */
export function previewSpot(
  r: { left: number; right: number; top: number; height: number },
  portrait: boolean,
  win: { w: number; h: number },
) {
  const w = portrait ? PREVIEW_W.portrait : PREVIEW_W.landscape;
  const h = portrait ? (w * 1024) / 700 : (w * 700) / 1024;
  const gap = 12;
  const left = r.right + gap + w <= win.w ? r.right + gap : Math.max(gap, r.left - gap - w);
  const top = Math.max(gap, Math.min(win.h - h - gap, r.top + r.height / 2 - h / 2));
  return { left, top, width: w, height: h };
}

const canHover = () =>
  typeof window !== 'undefined' &&
  window.matchMedia('(hover: hover) and (pointer: fine) and (min-width: 1024px)').matches;

/**
 * A larger copy of a card after the mouse rests on it (desktop only), in the top layer so it
 * never moves the layout.
 */
function useHoverPreview(on: boolean) {
  const [spot, setSpot] = useState<ReturnType<typeof previewSpot> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    return () => {
      clearTimeout(timer.current);
    };
  }, []);
  const hide = () => {
    clearTimeout(timer.current);
    setSpot(null);
  };
  const handlers = on
    ? {
        onPointerEnter: (e: PointerEvent<HTMLElement>) => {
          if (e.pointerType !== 'mouse' || !canHover()) return;
          const el = e.currentTarget;
          const portrait = el.offsetHeight > el.offsetWidth;
          clearTimeout(timer.current);
          timer.current = setTimeout(() => {
            if (!el.isConnected) return;
            setSpot(
              previewSpot(el.getBoundingClientRect(), portrait, {
                w: window.innerWidth,
                h: window.innerHeight,
              }),
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
 * One card, art first. Visions are portrait, suspects, places and objects landscape. When the art
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
    (preview ?? (!!onTap && size === 'thumb')) && !disabled,
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
