import { ProtectedImage, cn } from '@vt/ui';
import { useState } from 'react';
import { cardUrl } from './assets.ts';

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
}

/**
 * One picture card. The image comes from private storage; when it can't load (no storage in
 * tests, or a missing file) the card still renders as a numbered placeholder so play goes on.
 */
export function Card({ card, label, selected, dimmed, onClick, className, big }: Props) {
  const [failed, setFailed] = useState(false);
  const body = (
    <>
      {!failed ? (
        <ProtectedImage
          src={cardUrl(card)}
          alt={`Card ${card}`}
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <span
          className={cn(
            'flex size-full items-center justify-center bg-gradient-to-br from-amber-200 to-orange-300 font-serif font-bold text-amber-950 dark:from-amber-900 dark:to-orange-950 dark:text-amber-100',
            big ? 'text-6xl' : 'text-2xl',
          )}
        >
          {card}
        </span>
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
    selected && 'ring-4 ring-amber-500 dark:ring-amber-400',
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
