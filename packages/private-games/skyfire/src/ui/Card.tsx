import { ProtectedImage, cn } from '@vt/ui';
import { type CSSProperties, memo } from 'react';
import { type Card, SUIT_NAME, SUIT_SYMBOL, type Suit } from '../logic/cards.ts';
import type { Knowledge, Possibility } from '../logic/clues.ts';
import type { Art } from './assets.ts';

/**
 * Each suit's colour (the game's identity, as on the printed cards), with a text colour that reads
 * on it. Cards look the same in light and dark mode, like real cards on a table; the symbol and
 * the number always carry the meaning, so colour is never the only clue.
 */
export const SUIT_STYLE: Record<Suit, { bg: string; fg: string }> = {
  red: { bg: '#cf3b36', fg: '#ffffff' },
  yellow: { bg: '#efc23a', fg: '#2b2105' },
  green: { bg: '#3c9248', fg: '#ffffff' },
  blue: { bg: '#2d6cc9', fg: '#ffffff' },
  white: { bg: '#f3efe6', fg: '#2a2620' },
  multi: {
    bg: 'linear-gradient(135deg, #cf3b36 0%, #efc23a 30%, #3c9248 55%, #2d6cc9 80%, #f3efe6 100%)',
    fg: '#ffffff',
  },
  black: { bg: '#23211e', fg: '#f3efe6' },
};

export type CardSize = 'hand' | 'row' | 'stack' | 'mini';

const SIZE: Record<CardSize, string> = {
  hand: 'aspect-[5/7] w-full',
  row: 'aspect-[5/7] w-full',
  stack: 'aspect-[5/7] w-9 sm:w-14',
  mini: 'aspect-[5/7] w-6',
};

const DIGIT: Record<CardSize, string> = {
  hand: 'text-[clamp(1.25rem,7vw,2.25rem)]',
  row: 'text-[clamp(1rem,5.5vw,1.9rem)]',
  stack: 'text-xl sm:text-2xl',
  mini: 'text-[11px]',
};

const SYMBOL: Record<CardSize, string> = {
  hand: 'text-[clamp(.7rem,3.4vw,1.05rem)]',
  row: 'text-[clamp(.6rem,2.8vw,.9rem)]',
  stack: 'text-[10px] sm:text-xs',
  mini: 'text-[7px]',
};

export const suitLabel = (suit: Suit) => `${SUIT_NAME[suit]} ${SUIT_SYMBOL[suit]}`;
export const cardLabel = (c: Card) => `${SUIT_NAME[c.suit]} ${c.rank}`;

const textShadow = (suit: Suit) =>
  suit === 'multi' ? { textShadow: '0 1px 2px rgba(0,0,0,.7)' } : undefined;

/**
 * A card face: its number big, the suit's symbol in the corners, on the suit's colour. With the
 * private art, the real face, with the number repeated in a corner where it would be too small.
 */
export const CardFace = memo(function CardFace({
  card,
  art,
  size = 'hand',
  className,
  style,
  label,
}: {
  card: Card;
  art: Art;
  size?: CardSize;
  className?: string;
  style?: CSSProperties;
  label?: string;
}) {
  const s = SUIT_STYLE[card.suit];
  // Thumbs everywhere: cards never show larger than a hand's (the art is soft when big).
  const src = art.card(card.suit, card.rank, true);
  const alt = label ?? cardLabel(card);
  if (src)
    return (
      <span
        className={cn('relative block overflow-hidden rounded-md shadow-sm', SIZE[size], className)}
        style={style}
        data-suit={card.suit}
        data-rank={card.rank}
      >
        <ProtectedImage src={src} alt={alt} className="size-full object-cover object-top" />
        {size !== 'stack' && (
          <span
            aria-hidden
            className={cn(
              'absolute top-0 left-0 rounded-br-md px-[12%] leading-tight font-black tabular-nums shadow-sm',
              size === 'mini' ? 'text-[9px]' : 'text-sm sm:text-base',
            )}
            style={{ background: s.bg, color: s.fg, ...textShadow(card.suit) }}
          >
            {card.rank}
            <span className="ml-0.5 text-[.7em]">{SUIT_SYMBOL[card.suit]}</span>
          </span>
        )}
      </span>
    );
  return (
    <span
      role="img"
      aria-label={alt}
      className={cn(
        'relative flex items-center justify-center overflow-hidden rounded-md shadow-sm ring-1 ring-black/20 select-none',
        SIZE[size],
        className,
      )}
      style={{ background: s.bg, color: s.fg, ...textShadow(card.suit), ...style }}
      data-suit={card.suit}
      data-rank={card.rank}
    >
      {size !== 'mini' && (
        <>
          <span
            aria-hidden
            className={cn('absolute top-[4%] left-[8%] leading-none', SYMBOL[size])}
          >
            {SUIT_SYMBOL[card.suit]}
          </span>
          <span
            aria-hidden
            className={cn('absolute right-[8%] bottom-[4%] rotate-180 leading-none', SYMBOL[size])}
          >
            {SUIT_SYMBOL[card.suit]}
          </span>
        </>
      )}
      <span aria-hidden className={cn('leading-none font-black tabular-nums', DIGIT[size])}>
        {card.rank}
      </span>
    </span>
  );
});

/** What a clue mark says, for the card's label: "red, 3, not 5". */
export function marksText(k: Knowledge | null): string {
  if (!k) return '';
  const yes = [...k.colours.map((c) => SUIT_NAME[c].toLowerCase()), ...k.ranks.map(String)];
  const no = [...k.notColours.map((c) => SUIT_NAME[c].toLowerCase()), ...k.notRanks.map(String)];
  return [...yes, ...(no.length ? [`not ${no.join(', ')}`] : [])].join(', ');
}

/**
 * The back of a card in your own hand, filled in as clues add up: a known colour tints it and
 * shows its symbol, a known number shows big (what is "known" is the caller's: the clues alone,
 * or full help's counting).
 */
export const CardBack = memo(function CardBack({
  art,
  suit,
  rank,
  size = 'hand',
  className,
  label,
}: {
  art: Art;
  suit?: Suit | null;
  rank?: number | null;
  size?: CardSize;
  className?: string;
  label?: string;
}) {
  const src = art.back(true);
  const tint = suit ? SUIT_STYLE[suit] : null;
  return (
    <span
      role="img"
      aria-label={label ?? 'Your card'}
      className={cn(
        'relative flex items-center justify-center overflow-hidden rounded-md shadow-sm ring-1 select-none',
        tint ? 'ring-2 ring-black/30' : 'ring-black/20',
        SIZE[size],
        className,
      )}
      style={
        tint
          ? { background: tint.bg, color: tint.fg, ...textShadow(suit!) }
          : src
            ? undefined
            : { background: 'linear-gradient(160deg, #2b2a4a, #12121f)', color: '#f3efe6' }
      }
    >
      {src && !tint && (
        <ProtectedImage src={src} alt="" className="absolute inset-0 size-full object-cover" />
      )}
      {!src && !tint && rank == null && (
        <span aria-hidden className="text-[clamp(.9rem,4vw,1.4rem)] opacity-60">
          🎆
        </span>
      )}
      {suit && (
        <span aria-hidden className={cn('absolute top-[4%] left-[8%] leading-none', SYMBOL[size])}>
          {SUIT_SYMBOL[suit]}
        </span>
      )}
      {rank != null && (
        <span
          aria-hidden
          className={cn(
            'relative leading-none font-black tabular-nums',
            DIGIT[size],
            !tint && 'rounded bg-black/55 px-[10%] text-white',
          )}
        >
          {rank}
        </span>
      )}
    </span>
  );
});

/**
 * The marks under a card: the clues that touched it (colour chips and numbers) and, smaller, what
 * it is known not to be. Full help adds what it can still be.
 */
export function Marks({
  know,
  poss,
  compact = false,
  className,
}: {
  know: Knowledge | null;
  poss?: Possibility[] | null;
  compact?: boolean;
  className?: string;
}) {
  if (!know) return null;
  const yes = know.colours.length + know.ranks.length > 0;
  // A compact row with nothing to say takes no room (teammates' rows stay short on phones).
  if (compact && !yes) return null;
  const suits = poss ? [...new Set(poss.map((p) => p.suit))] : null;
  const ranks = poss ? [...new Set(poss.map((p) => p.rank))].sort() : null;
  return (
    <span
      className={cn(
        'flex min-h-4 flex-col items-center gap-px text-[10px] leading-tight sm:text-xs',
        className,
      )}
      aria-hidden
    >
      {yes && (
        <span className="flex flex-wrap justify-center gap-0.5">
          {know.colours.map((c) => (
            <span
              key={c}
              className="rounded px-1 font-bold"
              style={{ background: SUIT_STYLE[c].bg, color: SUIT_STYLE[c].fg, ...textShadow(c) }}
            >
              {SUIT_SYMBOL[c]}
            </span>
          ))}
          {know.ranks.map((r) => (
            <span
              key={r}
              className="rounded bg-ink px-1 font-bold text-page tabular-nums dark:bg-stone-100 dark:text-stone-900"
            >
              {r}
            </span>
          ))}
        </span>
      )}
      {!compact && (know.notColours.length > 0 || know.notRanks.length > 0) && (
        <span className="text-ink-muted tabular-nums dark:text-stone-400">
          ✕{know.notColours.map((c) => SUIT_SYMBOL[c]).join('')}
          {know.notRanks.join('')}
        </span>
      )}
      {suits && ranks && (suits.length > 1 || ranks.length > 1) && (
        <span className="text-info-ink tabular-nums dark:text-sky-300">
          {suits.map((s) => SUIT_SYMBOL[s]).join('')} {ranks.join('')}
        </span>
      )}
    </span>
  );
}
