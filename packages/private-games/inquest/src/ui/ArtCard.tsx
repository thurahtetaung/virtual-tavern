import { ProtectedImage, cn } from '@vt/ui';
import { useRef, useState } from 'react';
import type { Content, Deck } from './assets.ts';
import type { Mark } from './marks.ts';

const LONG_PRESS_MS = 450;

/** Tap, and a long press that doesn't also count as a tap. */
export function usePress(onTap?: () => void, onLongPress?: () => void) {
  const timer = useRef<number | null>(null);
  const fired = useRef(false);
  const cancel = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: () => {
      fired.current = false;
      if (!onLongPress) return;
      cancel();
      timer.current = window.setTimeout(() => {
        fired.current = true;
        if ('vibrate' in navigator) navigator.vibrate(15);
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
    onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault(),
    onClick: () => {
      if (fired.current) {
        fired.current = false;
        return;
      }
      onTap?.();
    },
  };
}

export function MarkBadge({ mark, className }: { mark: Mark | undefined; className?: string }) {
  if (!mark) return null;
  return (
    <span
      aria-label={mark === 'star' ? 'marked suspicious' : 'marked ruled out'}
      className={cn(
        'flex size-6 items-center justify-center rounded-full text-sm font-black shadow ring-2 ring-white dark:ring-stone-900',
        mark === 'star'
          ? 'bg-accent-line dark:bg-amber-400 text-amber-950'
          : 'bg-stone-700 text-white',
        className,
      )}
    >
      {mark === 'star' ? '★' : '✕'}
    </span>
  );
}

interface Props {
  deck: Deck;
  n: number;
  content: Content;
  mark?: Mark;
  ruledOut?: boolean;
  selected?: boolean;
  /** The crime itself (shown to those who know it). */
  key_?: boolean;
  onTap?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  /** `thumb`: the overview grid (caption hidden); `big`: the full view. */
  size?: 'grid' | 'thumb' | 'big';
  className?: string;
}

/** One Clue or Means card: art first, its name over the art, with private marks and stamps. */
export function ArtCard({
  deck,
  n,
  content,
  mark,
  ruledOut,
  selected,
  key_,
  onTap,
  onLongPress,
  disabled,
  size = 'grid',
  className,
}: Props) {
  const [failed, setFailed] = useState(false);
  const art = content.cardArt(deck, n);
  const name = content.cardName(deck, n);
  const press = usePress(disabled ? undefined : onTap, disabled ? undefined : onLongPress);
  const label = `${deck === 'clue' ? 'Clue' : 'Means'}: ${name}${ruledOut ? ' (ruled out)' : ''}${
    mark === 'star' ? ', marked suspicious' : mark === 'cross' ? ', marked ruled out' : ''
  }`;
  const body = (
    <>
      {art && !failed ? (
        <ProtectedImage
          src={art}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <span
          aria-hidden
          className={cn(
            'absolute inset-0 flex items-center justify-center bg-gradient-to-br p-1 text-center font-bold text-white',
            deck === 'clue' ? 'from-rose-800 to-stone-900' : 'from-sky-800 to-stone-900',
            size === 'big' ? 'text-3xl' : 'text-[11px]',
          )}
        >
          {size === 'thumb' ? n : `${deck === 'clue' ? '🧾' : '🔪'} ${n}`}
        </span>
      )}
      {size !== 'thumb' && (
        <span
          className={cn(
            'absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/70 to-transparent px-1 pt-3 pb-1 text-center leading-tight font-semibold text-white',
            size === 'big' ? 'text-lg' : 'text-[11px]',
          )}
        >
          {/* The crime's tag sits with the caption: at the top it would cover the printed name. */}
          {key_ && (
            <span className="mb-0.5 block">
              <span className="rounded-full bg-danger dark:bg-rose-600 px-1.5 text-[10px] font-bold tracking-wide shadow">
                {deck === 'clue' ? 'KEY' : 'MEANS'}
              </span>
            </span>
          )}
          <span className={cn('block', size !== 'big' && 'line-clamp-2')}>{name}</span>
        </span>
      )}
      {ruledOut && (
        <span
          aria-hidden
          className="absolute inset-x-0 top-1/3 -rotate-12 bg-stone-900/85 py-0.5 text-center text-[10px] font-black tracking-widest text-rose-300 uppercase ring-1 ring-danger dark:ring-rose-400"
        >
          Ruled out
        </span>
      )}
      {key_ && size === 'thumb' && (
        <span className="absolute inset-x-0 bottom-0 bg-danger dark:bg-rose-600 text-center text-[8px] font-bold text-white">
          {deck === 'clue' ? 'KEY' : 'MEANS'}
        </span>
      )}
      {selected && !mark && (
        <span
          aria-hidden
          className="absolute top-1/2 left-1/2 flex size-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent dark:bg-amber-500 text-lg font-black text-accent-fg dark:text-stone-950 shadow-lg ring-2 ring-white"
        >
          ✓
        </span>
      )}
      <MarkBadge mark={mark} className="absolute top-1 right-1" />
    </>
  );
  // One ring at a time: ring utilities don't override each other by class order.
  const classes = cn(
    'relative block aspect-[315/510] w-full overflow-hidden rounded-lg bg-stone-800 shadow select-none [-webkit-touch-callout:none]',
    ruledOut && 'opacity-55 grayscale',
    mark === 'cross' && !ruledOut && 'opacity-60',
    selected
      ? 'ring-4 ring-accent ring-offset-2 ring-offset-white dark:ring-amber-400 dark:ring-offset-stone-900'
      : key_
        ? 'ring-2 ring-danger dark:ring-rose-500'
        : 'ring-1 ring-black/20',
    className,
  );
  if (!onTap && !onLongPress)
    return (
      <div aria-label={label} role="img" className={classes}>
        {body}
      </div>
    );
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      disabled={disabled}
      className={cn(classes, 'cursor-pointer touch-manipulation disabled:cursor-not-allowed')}
      {...press}
    >
      {body}
    </button>
  );
}
