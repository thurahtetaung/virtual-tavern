import { ProtectedImage, cn } from '@vt/ui';
import { useState } from 'react';
import { oursCard } from '../logic/types.ts';
import { type Art, cardLabel, cardUrl } from './assets.ts';

/** Width over height of every card. */
export const CARD_ASPECT = 366 / 512;

/**
 * One picture card. The art comes from private storage; while it loads the card is a plain
 * pulsing shape, and without storage (tests, dev) or for a card that can't load it shows its
 * number on a plain face, so play goes on.
 */
export function Card({
  card,
  art,
  onClick,
  selected,
  className,
  eager,
  big,
  label,
}: {
  card: number;
  art: Art;
  onClick?: () => void;
  selected?: boolean;
  className?: string;
  eager?: boolean;
  big?: boolean;
  /** Read out instead of the card's name (a button's purpose). */
  label?: string;
}) {
  const [state, setState] = useState<{ card: number; s: 'loading' | 'loaded' | 'failed' }>({
    card,
    s: 'loading',
  });
  const s = state.card === card ? state.s : 'loading';
  const numbered = s === 'failed' || (art.none && s === 'loading');
  const ours = oursCard(card);
  const body = (
    <>
      {numbered ? (
        <span
          aria-hidden={s !== 'failed'}
          className={cn(
            'absolute inset-0 flex flex-col items-center justify-center bg-card font-serif font-bold text-ink ring-1 ring-line ring-inset dark:bg-stone-800 dark:text-stone-100',
            big ? 'text-5xl' : 'text-lg',
          )}
        >
          {ours ?? card}
          {ours !== null && <span className="text-[0.6em] font-normal opacity-70">pic</span>}
        </span>
      ) : (
        s === 'loading' && (
          <span
            aria-hidden
            data-testid="card-loading"
            className="absolute inset-0 animate-pulse bg-stone-300 motion-reduce:animate-none dark:bg-stone-700"
          />
        )
      )}
      {s !== 'failed' && (
        <ProtectedImage
          src={cardUrl(card)}
          alt={cardLabel(card)}
          loading={eager ? 'eager' : 'lazy'}
          onLoad={() => setState({ card, s: 'loaded' })}
          onError={() => setState({ card, s: 'failed' })}
          className="absolute inset-0 size-full object-cover"
        />
      )}
    </>
  );
  const classes = cn(
    'relative block aspect-[366/512] w-full overflow-hidden rounded-lg bg-stone-200 shadow ring-1 ring-black/10 dark:bg-stone-800',
    selected && 'ring-4 ring-accent dark:ring-amber-400',
    onClick && 'cursor-pointer transition hover:-translate-y-0.5 motion-reduce:transition-none',
    className,
  );
  return onClick ? (
    <button
      type="button"
      aria-label={label ?? cardLabel(card)}
      onClick={onClick}
      className={classes}
      data-card={card}
    >
      {body}
    </button>
  ) : (
    <div className={classes} data-card={card} role="img" aria-label={label ?? cardLabel(card)}>
      {body}
    </div>
  );
}

/** A card's back (the game's own for every card), or a plain one without art. */
export function CardBack({ art, className }: { art: Art; className?: string }) {
  return (
    <div
      className={cn(
        'relative aspect-[366/512] w-full overflow-hidden rounded-lg bg-panel shadow-inner ring-1 ring-line dark:bg-stone-800 dark:ring-stone-700',
        className,
      )}
      aria-hidden
    >
      {art.back ? (
        <ProtectedImage src={art.back} alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-2xl opacity-60">
          ?
        </span>
      )}
    </div>
  );
}

/** An empty slot on the table: the card to come. */
export function EmptySlot({ lap, className }: { lap: 1 | 2; className?: string }) {
  return (
    <div
      className={cn(
        'flex aspect-[366/512] w-full items-center justify-center rounded-lg border-2 border-dashed border-line text-sm font-bold text-ink-muted dark:border-stone-700 dark:text-stone-500',
        className,
      )}
      aria-hidden
    >
      {lap === 1 ? 'I' : 'II'}
    </div>
  );
}
