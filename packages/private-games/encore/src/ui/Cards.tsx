import { ProtectedImage, cn } from '@vt/ui';
import { type CSSProperties, memo } from 'react';
import { type HandCard, downOf, segments } from '../logic/rules.ts';
import type { Art } from './assets.ts';

/**
 * Each number's colour (the game's identity, as on the printed cards: cool blues for low numbers
 * through greens and yellows to red for 10), with a text colour that reads on it. The digit always
 * carries the meaning; the colour only helps the eye find sets and runs.
 */
const NUMBER_COLOR: Record<number, { bg: string; fg: string }> = {
  1: { bg: '#5b6c9a', fg: '#ffffff' },
  2: { bg: '#2f62c9', fg: '#ffffff' },
  3: { bg: '#4aa8dc', fg: '#0d1f2b' },
  4: { bg: '#1c9a90', fg: '#ffffff' },
  5: { bg: '#3d9446', fg: '#ffffff' },
  6: { bg: '#9cc63b', fg: '#18230a' },
  7: { bg: '#f1c84a', fg: '#2b2105' },
  8: { bg: '#f4a259', fg: '#2d1804' },
  9: { bg: '#e4772f', fg: '#250f02' },
  10: { bg: '#cf3f37', fg: '#ffffff' },
};

export const numberColor = (n: number) => NUMBER_COLOR[n] ?? NUMBER_COLOR[1]!;

export type CardSize = 'hand' | 'table' | 'float' | 'mini';

const SIZE: Record<CardSize, string> = {
  hand: 'aspect-[5/7] w-full',
  table: 'aspect-[5/7] w-12 sm:w-16',
  float: 'aspect-[5/7] w-16 sm:w-20',
  mini: 'aspect-[5/7] w-7',
};

const DIGIT: Record<CardSize, string> = {
  hand: 'text-[clamp(1rem,5.2vw,1.6rem)]',
  table: 'text-2xl sm:text-3xl',
  float: 'text-3xl sm:text-4xl',
  mini: 'text-sm',
};

/** "7, other end 3": a card as a screen reader hears it. */
export const cardLabel = (c: HandCard) => `${c.up} (other end ${downOf(c)})`;

/**
 * A card: its up number big at the top, the other end's number small in a pill under it, on the
 * up number's colour (the other end's colour in the bottom corner). With the private art, the
 * real face, turned round when the card is held the other way up.
 */
export const CardFace = memo(function CardFace({
  card,
  art,
  size = 'hand',
  className,
  style,
}: {
  card: HandCard;
  art: Art;
  size?: CardSize;
  className?: string;
  style?: CSSProperties;
}) {
  const down = downOf(card);
  const src = art.card(card.id, size !== 'float' && size !== 'table');
  const up = numberColor(card.up);
  const low = numberColor(down);
  if (src)
    return (
      <span
        className={cn('relative block overflow-hidden rounded-md shadow-sm', SIZE[size], className)}
        style={style}
        data-card={card.id}
        data-up={card.up}
      >
        <ProtectedImage
          src={src}
          alt={cardLabel(card)}
          className={cn('size-full object-cover', art.turned(card) && 'rotate-180')}
        />
        {(size === 'hand' || size === 'mini') && (
          // Small cards: the printed number is too small to read, so it is repeated over it.
          <span
            aria-hidden
            className={cn(
              'absolute top-0 left-0 rounded-br-md px-[10%] leading-tight font-black tabular-nums shadow-sm',
              DIGIT[size],
            )}
            style={{ background: up.bg, color: up.fg }}
          >
            {card.up}
          </span>
        )}
      </span>
    );
  return (
    <span
      role="img"
      aria-label={cardLabel(card)}
      className={cn(
        'relative flex flex-col items-start overflow-hidden rounded-md shadow-sm ring-1 ring-black/15 select-none',
        SIZE[size],
        className,
      )}
      style={{ background: up.bg, color: up.fg, ...style }}
      data-card={card.id}
      data-up={card.up}
    >
      <span className={cn('px-[12%] pt-[6%] leading-none font-black tabular-nums', DIGIT[size])}>
        {card.up}
      </span>
      <span
        className={cn(
          'mx-[10%] mt-[6%] rounded-full px-[14%] leading-tight font-bold tabular-nums',
          size === 'mini' ? 'text-[8px]' : 'text-[clamp(.55rem,2.4vw,.8rem)]',
        )}
        style={{ background: 'rgba(0,0,0,.28)', color: '#fff' }}
      >
        {down}
      </span>
      <span
        aria-hidden
        className="absolute right-0 bottom-0 left-0 h-[22%]"
        style={{
          background: low.bg,
          clipPath: 'polygon(0 55%, 50% 0, 100% 45%, 100% 100%, 0 100%)',
        }}
      />
    </span>
  );
});

/** A card back (the opponents' hands), or a plain one without art. */
export function CardBack({ art, className }: { art: Art; className?: string }) {
  const src = art.back(true);
  return src ? (
    <ProtectedImage src={src} alt="" className={cn('rounded-sm object-cover', className)} />
  ) : (
    <span
      aria-hidden
      className={cn(
        'block rounded-sm bg-panel ring-1 ring-line dark:bg-stone-800 dark:ring-stone-600',
        className,
      )}
    />
  );
}

export interface HandProps {
  cards: readonly HandCard[];
  art: Art;
  /** The selected range (inclusive). */
  selected?: readonly [number, number] | null;
  /** Cards that are part of some Show that beats the table. */
  legal?: ReadonlySet<number>;
  /** A card being placed: drawn lifted. */
  preview?: number | null;
  onCard?: (i: number) => void;
  /** Placing a recruited card: every gap is a target (0 before the first card). */
  onGap?: (at: number) => void;
  /** The card count per row (wraps beyond). */
  columns?: number;
  /** Each card plays its half-turn in place (the hand was just turned round). */
  turning?: boolean;
  label?: string;
  className?: string;
}

/**
 * The hand in its fixed order: number-coloured cards with a join line under each set and run
 * already in it, a ✦ on cards that can be part of a Show now, and, while placing a recruited card,
 * a target in every gap.
 */
export function Hand({
  cards,
  art,
  selected,
  legal,
  preview,
  onCard,
  onGap,
  columns,
  turning,
  label = 'Your hand',
  className,
}: HandProps) {
  const segs = segments(cards);
  const segOf = (i: number) => segs.find((s) => s.from <= i && i <= s.to);
  // One row up to 15 cards (a phone fits them all), then two even rows.
  const cols =
    columns ?? (cards.length <= 15 ? Math.max(4, cards.length) : Math.ceil(cards.length / 2));
  return (
    <ol
      aria-label={label}
      className={cn('grid gap-x-1 gap-y-2.5', className)}
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 3.6rem))` }}
    >
      {cards.map((c, i) => {
        const seg = segOf(i);
        const inSel = !!selected && selected[0] <= i && i <= selected[1];
        const joinsNext = !!seg && i < seg.to && (i + 1) % cols !== 0;
        const face = (
          <CardFace
            card={c}
            art={art}
            className={cn(
              'transition-transform duration-150',
              inSel && '-translate-y-2 ring-[3px] ring-accent dark:ring-amber-400',
              preview === i && 'en-lift -translate-y-2 ring-[3px] ring-info dark:ring-sky-400',
            )}
          />
        );
        return (
          <li
            key={`${c.id}`}
            className={cn('relative flex flex-col items-stretch gap-1', turning && 'en-turn')}
            style={turning ? { animationDelay: `${Math.min(i * 20, 240)}ms` } : undefined}
          >
            {onCard ? (
              <button
                type="button"
                onClick={() => onCard(i)}
                aria-pressed={inSel}
                aria-label={`${cardLabel(c)}${legal?.has(i) ? ', can be shown' : ''}`}
                className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                data-hand-index={i}
              >
                {face}
              </button>
            ) : (
              <span data-hand-index={i}>{face}</span>
            )}
            {legal?.has(i) && !inSel && (
              <span
                aria-hidden
                className="pointer-events-none absolute -top-1.5 left-1/2 -translate-x-1/2 text-[10px] leading-none text-accent dark:text-amber-300"
              >
                ✦
              </span>
            )}
            <span
              aria-hidden
              className={cn(
                'h-1 rounded-full',
                seg
                  ? seg.kind === 'set'
                    ? 'bg-ink/70 dark:bg-stone-200/80'
                    : 'bg-ink-muted/60 dark:bg-stone-400/70'
                  : 'bg-transparent',
              )}
              style={joinsNext ? { marginRight: '-0.25rem' } : undefined}
            />
            {onGap && (
              <button
                type="button"
                onClick={() => onGap(i)}
                aria-label={`Put it before card ${i + 1}`}
                className="en-gap absolute top-0 -left-[0.45rem] z-10 h-[calc(100%-0.5rem)] w-3.5 rounded-full"
                data-gap={i}
              />
            )}
            {onGap && i === cards.length - 1 && (
              <button
                type="button"
                onClick={() => onGap(i + 1)}
                aria-label="Put it after the last card"
                className="en-gap absolute top-0 -right-[0.45rem] z-10 h-[calc(100%-0.5rem)] w-3.5 rounded-full"
                data-gap={i + 1}
              />
            )}
          </li>
        );
      })}
      {onGap && cards.length === 0 && (
        <li>
          <button
            type="button"
            onClick={() => onGap(0)}
            className="en-gap h-16 w-8 rounded-md"
            aria-label="Put it in your hand"
            data-gap={0}
          />
        </li>
      )}
    </ol>
  );
}

export const CSS = `
@keyframes en-show { 0% { opacity: 0; transform: translateY(40px) scale(.8) } 60% { opacity: 1; transform: translateY(-6px) scale(1.06) } 100% { transform: none } }
@keyframes en-big { 0% { transform: scale(.6) rotate(-4deg); opacity: 0 } 50% { transform: scale(1.18) rotate(2deg); opacity: 1 } 100% { transform: none } }
@keyframes en-pop { 0% { transform: scale(.6); opacity: 0 } 60% { transform: scale(1.1); opacity: 1 } 100% { transform: none } }
@keyframes en-rise { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
@keyframes en-turn { from { transform: rotate(180deg) scale(.7) } to { transform: none } }
@keyframes en-glow { 0%, 100% { opacity: .45 } 50% { opacity: 1 } }
.en-show { animation: en-show .5s ease-out both }
.en-big { animation: en-big .7s ease-out both }
.en-pop { animation: en-pop .5s ease-out both }
.en-rise { animation: en-rise .3s ease-out both }
.en-turn { animation: en-turn .26s ease-in-out both }
.en-gap { background: rgba(59, 130, 246, .6); box-shadow: 0 0 6px rgba(59, 130, 246, .8); animation: en-glow 1.4s ease-in-out infinite }
.en-gap:hover, .en-gap:focus-visible { background: rgb(37, 99, 235); outline: none }
@media (prefers-reduced-motion: reduce) {
  .en-show, .en-big, .en-pop, .en-rise, .en-turn { animation: en-rise .01s both }
  .en-gap { animation: none }
}
`;

export function EncoreStyles() {
  return <style>{CSS}</style>;
}
