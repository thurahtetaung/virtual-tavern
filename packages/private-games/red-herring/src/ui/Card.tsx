import { ProtectedImage, cn } from '@vt/ui';
import { type ReactNode, useState } from 'react';
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

/**
 * A card's back: the game's own for every deck (our picture cards included), or a plain one
 * without art. `children` sit on top of it (a slot's lap).
 */
export function CardBack({
  art,
  className,
  children,
}: {
  art: Art;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        'relative aspect-[366/512] w-full overflow-hidden rounded-lg bg-panel shadow-inner ring-1 ring-line dark:bg-stone-800 dark:ring-stone-700',
        className,
      )}
      aria-hidden
      data-testid="rh-back"
    >
      {art.back ? (
        <ProtectedImage src={art.back} alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        !children && (
          <span className="absolute inset-0 flex items-center justify-center text-2xl opacity-60">
            ?
          </span>
        )
      )}
      {children}
    </div>
  );
}

/** An empty slot on the table: the card to come, face down until it lands. */
export function EmptySlot({ lap, art }: { lap: 1 | 2; art: Art }) {
  return (
    <CardBack art={art} className="opacity-55 shadow-none dark:opacity-45">
      <span
        className="absolute inset-0 flex items-center justify-center"
        data-testid="rh-empty-slot"
      >
        <span className="rounded-full bg-card/90 px-2 py-0.5 text-sm font-bold text-ink dark:bg-stone-900/90 dark:text-stone-200">
          {lap === 1 ? 'I' : 'II'}
        </span>
      </span>
    </CardBack>
  );
}

/** The draw pile: a small face-down stack with how many cards are left in it. */
export function DrawPile({
  art,
  count,
  className,
}: {
  art: Art;
  count: number;
  className?: string;
}) {
  const label = `${count} ${count === 1 ? 'card' : 'cards'} in the deck`;
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1.5', className)}
      title={label}
      data-testid="rh-pile"
    >
      <span className="relative w-6 shrink-0" aria-hidden>
        {count > 1 && (
          <span className="absolute inset-0 translate-x-0.5 translate-y-0.5 rounded-md bg-line ring-1 ring-line dark:bg-stone-700 dark:ring-stone-600" />
        )}
        {count > 0 ? (
          <CardBack art={art} className="rounded-md" />
        ) : (
          <span className="block aspect-[366/512] w-full rounded-md border border-dashed border-line dark:border-stone-700" />
        )}
      </span>
      <span className="text-sm tabular-nums">
        <span aria-hidden>{count}</span>
        <span className="sr-only">{label}</span>
      </span>
    </span>
  );
}
