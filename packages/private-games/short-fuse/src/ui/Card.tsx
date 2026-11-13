import { ProtectedImage, cn } from '@vt/ui';
import { memo } from 'react';
import type { CardType } from '../logic/cards.ts';
import type { Art, Card } from '../logic/types.ts';
import type { Content } from './assets.ts';

export type CardSize = 'xxs' | 'xs' | 'sm' | 'md' | 'table' | 'lg' | 'xl';

export const WIDTH: Record<CardSize, string> = {
  xxs: 'w-6',
  xs: 'w-9',
  sm: 'w-14',
  md: 'w-16 sm:w-24',
  // The draw and discard piles: a little bigger on phones; on a desktop's table they size by the
  // window's height, 80 px on a 720 px laptop up to 128 px from about 950 px, so the hand and its
  // bar under them stay in view.
  table: 'w-[4.5rem] sm:w-24 lg:w-[clamp(5rem,calc(24dvh-6rem),8rem)]',
  lg: 'w-28 sm:w-32',
  xl: 'w-44 sm:w-56',
};

/** Placeholder tints by kind, so cards read apart without art. */
function tint(t: CardType): string {
  if (t === 'bomb') return 'bg-danger-soft text-danger-ink ring-danger-line';
  if (t === 'void') return 'bg-special-soft text-special-ink ring-special-line';
  if (t === 'defuse' || t === 'revive') return 'bg-success-soft text-success-ink ring-success-line';
  if (t === 'nope') return 'bg-warn-soft text-warn-ink ring-warn-line';
  if (/^cat|wild/.test(t)) return 'bg-info-soft text-info-ink ring-info-line';
  return 'bg-card text-ink ring-line-strong';
}

/**
 * A card face: the manifest's art with our name chip over it (so the name is always readable
 * text), or a placeholder with a glyph and the name when there's no art.
 */
export const CardFace = memo(function CardFace({
  card,
  art,
  c,
  size = 'md',
  selected = false,
  label = true,
  thumb = false,
  eager = false,
  className,
}: {
  card: Card;
  art: Art;
  c: Content;
  size?: CardSize;
  selected?: boolean;
  /** Show the name chip (small cards in a row may leave it to their tooltip). */
  label?: boolean;
  /** Use the small copy of the art. */
  thumb?: boolean;
  /** Load the art at once, even off screen (a hand scrolled sideways). */
  eager?: boolean;
  className?: string;
}) {
  const tiny = size === 'xxs' || size === 'xs';
  const src = thumb || tiny || size === 'sm' ? c.thumb(card, art) : c.face(card, art);
  const name = c.name(card.t);
  return (
    <span
      className={cn(
        'relative block aspect-[5/7] shrink-0 overflow-hidden rounded-[0.55rem] shadow-sm ring-1 transition-transform select-none',
        WIDTH[size],
        src ? 'bg-card ring-line-strong' : tint(card.t),
        selected && '-translate-y-2 ring-[3px] ring-accent shadow-lg',
        className,
      )}
      title={name}
    >
      {src ? (
        <ProtectedImage
          src={src}
          alt={name}
          className="absolute inset-0 size-full object-cover"
          loading={eager ? 'eager' : 'lazy'}
        />
      ) : (
        <span
          aria-hidden
          className={cn(
            'absolute inset-0 flex items-center justify-center pb-4',
            size === 'xxs'
              ? 'text-xs'
              : size === 'xs'
                ? 'text-base'
                : size === 'sm'
                  ? 'text-xl'
                  : 'text-3xl sm:text-4xl',
          )}
        >
          {c.glyph(card.t)}
        </span>
      )}
      {label && !tiny && (
        <span
          // A name too long for one line takes two, never cut; a long word breaks with a hyphen.
          className="absolute inset-x-0.5 bottom-0.5 line-clamp-2 rounded-md bg-card/90 px-1 text-center text-xs leading-tight font-bold break-words hyphens-auto text-ink shadow-sm ring-1 ring-line"
        >
          {name}
        </span>
      )}
      {!src && tiny && <span className="sr-only">{name}</span>}
    </span>
  );
});

/** The shared card back (the manifest's, or a drawn one). */
export const CardBack = memo(function CardBack({
  c,
  size = 'md',
  className,
}: {
  c: Content;
  size?: CardSize;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'relative block aspect-[5/7] shrink-0 overflow-hidden rounded-[0.55rem] bg-danger shadow-sm ring-1 ring-line-strong',
        WIDTH[size],
        className,
      )}
      aria-hidden
    >
      {c.back ? (
        <ProtectedImage src={c.back} alt="" className="absolute inset-0 size-full object-cover" />
      ) : (
        <span className="absolute inset-1 flex items-center justify-center rounded-[0.4rem] border-2 border-white/60 text-2xl text-white">
          💣
        </span>
      )}
    </span>
  );
});
