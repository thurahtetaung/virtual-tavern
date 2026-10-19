import { ProtectedImage, cn } from '@vt/ui';
import { useState } from 'react';
import { cardUrl, useManifest } from './assets.ts';

interface Props {
  card: number;
  /** Number badge shown on table cards. */
  label?: string | number;
  selected?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
  className?: string;
  /** Larger text for the full-size view. */
  big?: boolean;
  /** Load the art at once instead of when it scrolls into view (the hand). */
  eager?: boolean;
}

/**
 * One picture card. The image comes from private storage. While the manifest or the image is
 * still loading the card is a plain pulsing shape (no number to flash first); without asset
 * storage (tests, dev), or for a card that can't load, it shows its number as a placeholder, so
 * play goes on.
 */
export function Card({ card, label, selected, dimmed, onClick, className, big, eager }: Props) {
  const [art, setArt] = useState<{ card: number; state: 'loading' | 'loaded' | 'failed' }>({
    card,
    state: 'loading',
  });
  const state = art.card === card ? art.state : 'loading';
  const failed = state === 'failed';
  const noStorage = useManifest() === 'unavailable';
  const numbered = failed || (noStorage && state === 'loading');
  const body = (
    <>
      {numbered ? (
        <span
          aria-hidden={!failed}
          className={cn(
            'absolute inset-0 flex items-center justify-center bg-gradient-to-br from-amber-200 to-orange-300 font-serif font-bold text-amber-950 dark:from-amber-900 dark:to-orange-950 dark:text-amber-100',
            big ? 'text-6xl' : 'text-2xl',
          )}
        >
          {card}
        </span>
      ) : (
        state === 'loading' && (
          <span
            aria-hidden
            data-testid="card-loading"
            className="absolute inset-0 animate-pulse bg-stone-300 motion-reduce:animate-none dark:bg-stone-700"
          />
        )
      )}
      {!failed && (
        <ProtectedImage
          src={cardUrl(card)}
          alt={`Card ${card}`}
          loading={eager ? 'eager' : 'lazy'}
          onLoad={() => setArt({ card, state: 'loaded' })}
          onError={() => setArt({ card, state: 'failed' })}
          className="absolute inset-0 size-full object-cover"
        />
      )}
      {label !== undefined && (
        <span className="absolute top-1 left-1 rounded-full bg-stone-950/80 px-2 py-0.5 text-xs font-bold text-white shadow">
          {label}
        </span>
      )}
    </>
  );
  const classes = cn(
    'relative block aspect-[366/512] w-full overflow-hidden rounded-xl bg-stone-200 shadow-md ring-1 ring-black/10 transition dark:bg-stone-800',
    selected && 'ring-4 ring-accent dark:ring-amber-400',
    dimmed && 'opacity-50',
    onClick &&
      'cursor-pointer hover:-translate-y-0.5 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-none',
    className,
  );
  return onClick ? (
    <button
      type="button"
      aria-label={`Card ${card}${label !== undefined ? ` (#${label})` : ''}`}
      aria-pressed={selected}
      onClick={onClick}
      className={classes}
    >
      {body}
    </button>
  ) : (
    <div className={classes}>{body}</div>
  );
}
