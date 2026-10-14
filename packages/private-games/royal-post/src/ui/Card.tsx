import { ProtectedImage, cn } from '@vt/ui';
import { useState } from 'react';
import type { Role } from '../logic/types.ts';
import type { Deck } from './assets.ts';
import { ROLE_EMOJI } from './text.ts';

type Size = 'xs' | 'sm' | 'md' | 'lg';

interface Props {
  role: Role;
  rank: number;
  deck: Deck;
  size?: Size;
  selected?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
  className?: string;
  /** Extra words for screen readers, e.g. "keep". */
  hint?: string;
  /** The click opens the card to read: labelled "Read Guard (1)". */
  reads?: boolean;
}

/** Names longer than this ("Chancellor") are set smaller so they fit the card. */
const LONG_NAME = 8;

const TEXT: Record<Size, { rank: string; emoji: string; name: string }> = {
  xs: { rank: 'text-[0.6rem] top-0.5 left-1', emoji: 'text-sm', name: 'hidden' },
  sm: { rank: 'text-xs top-1 left-1.5', emoji: 'mt-2 text-xl', name: 'text-[0.65rem]' },
  md: { rank: 'text-base top-1.5 left-2', emoji: 'mt-3 text-3xl', name: 'text-sm' },
  lg: { rank: 'text-3xl top-2 left-3', emoji: 'mt-6 text-6xl', name: 'text-xl' },
};

/**
 * One card face. The art comes from private storage when the manifest names it; otherwise (tests,
 * dev, or a missing file) a styled placeholder shows the rank, an emblem and the name.
 */
export function Card({
  role,
  rank,
  deck,
  size = 'md',
  selected,
  dimmed,
  onClick,
  className,
  hint,
  reads,
}: Props) {
  const art = deck.art(role);
  const [failed, setFailed] = useState(false);
  const name = deck.name(role);
  const t = TEXT[size];
  const body =
    art && !failed ? (
      <ProtectedImage
        src={art}
        alt={name}
        loading="lazy"
        onError={() => setFailed(true)}
        className="size-full object-cover"
      />
    ) : (
      <span className="flex size-full flex-col items-center justify-center bg-gradient-to-b from-rose-50 via-amber-50 to-amber-100 p-1 text-rose-950 dark:from-rose-950 dark:via-stone-900 dark:to-amber-950 dark:text-amber-100">
        <span
          aria-hidden
          className="absolute inset-1 rounded-[0.4rem] border border-danger-line/70 dark:border-amber-400/30"
        />
        <span className={cn('absolute font-serif font-bold', t.rank)}>{rank}</span>
        <span aria-hidden className={t.emoji}>
          {ROLE_EMOJI[role]}
        </span>
        {/* Long names shrink to fit; `truncate` only catches a manifest name too long even then. */}
        <span className={cn('mt-1 max-w-full truncate px-1 font-serif font-semibold', t.name)}>
          <span className={cn(name.length > LONG_NAME && 'text-[0.8em]')}>{name}</span>
        </span>
      </span>
    );
  // Card art carries its own rank, too small to read on the little cards: add a plain badge.
  const rankBadge = art && !failed && size !== 'lg' && (
    <span
      aria-hidden
      className={cn(
        'absolute top-0 left-0 rounded-br bg-stone-950/80 px-1 font-bold text-white tabular-nums',
        size === 'md' ? 'text-sm' : 'text-[0.65rem] leading-tight',
      )}
    >
      {rank}
    </span>
  );
  const classes = cn(
    'relative block aspect-[5/7] w-full overflow-hidden rounded-lg bg-stone-200 shadow ring-1 ring-black/10 transition dark:bg-stone-800',
    size === 'xs' && 'rounded',
    selected && 'ring-4 ring-accent dark:ring-amber-400',
    dimmed && 'opacity-50',
    onClick &&
      'cursor-pointer hover:-translate-y-0.5 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-none',
    className,
  );
  const label = `${reads ? 'Read ' : ''}${name} (${rank})${hint ? `, ${hint}` : ''}`;
  return onClick ? (
    <button
      type="button"
      aria-label={label}
      aria-pressed={selected}
      onClick={onClick}
      className={classes}
    >
      {body}
      {rankBadge}
    </button>
  ) : (
    <span role="img" aria-label={label} className={classes}>
      {body}
      {rankBadge}
    </span>
  );
}

/** The back of a card: a face-down card in someone's hand or the deck. */
export function CardBack({
  deck,
  className,
  label,
}: {
  deck: Deck;
  className?: string;
  label?: string;
}) {
  const [failed, setFailed] = useState(false);
  return (
    <span
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn(
        'relative block aspect-[5/7] overflow-hidden rounded-md shadow ring-1 ring-black/10',
        className,
      )}
    >
      {deck.back && !failed ? (
        <ProtectedImage
          src={deck.back}
          alt=""
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      ) : (
        <span className="flex size-full items-center justify-center bg-gradient-to-br from-rose-700 to-rose-900 text-sm text-amber-200">
          ✉️
        </span>
      )}
    </span>
  );
}
