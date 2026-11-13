import { cn, useFreeHeight, usePhone } from '@vt/ui';
import { memo, useLayoutEffect, useRef, useState } from 'react';
import { CARD_TYPES } from '../logic/cards.ts';
import type { Art, CardView } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { CardFace } from './Card.tsx';

const LONG_PRESS_MS = 450;
const GAP = 6;

/**
 * A phone hand's card width: one row or two, whichever gives the bigger cards in the band above
 * the bar (cards are 5:7), from 64 px (the scrolling strip) up to 96 px. `null` keeps the strip.
 */
function phoneLayout(n: number, room: number, free: number | null) {
  if (free === null || n < 2) return null;
  // The hint line under the hand and the strip's top padding for a picked card's lift.
  const height = free - 36;
  let best: { w: number; cols: number } | null = null;
  for (const rows of [1, 2]) {
    const cols = Math.ceil(n / rows);
    const byWidth = Math.floor((room - GAP * (cols - 1)) / cols);
    const byHeight = Math.floor(((height - GAP * (rows - 1)) / rows) * (5 / 7));
    const w = Math.min(96, byWidth, byHeight);
    if (w >= 64 && (!best || w > best.w)) best = { w, cols };
  }
  return best;
}

/** The hand in a fixed order (same names together), so pairs are easy to spot. */
export const sortHand = (cards: CardView[]) =>
  [...cards].sort(
    (a, b) => CARD_TYPES.indexOf(a.t) - CARD_TYPES.indexOf(b.t) || a.id.localeCompare(b.id),
  );

/**
 * Your hand: tap to select (several for a combo), press and hold for the card's details at any
 * time. When `pick` is set, a tap picks that card instead (giving a card away).
 */
export const Hand = memo(function Hand({
  cards,
  art,
  c,
  selected,
  onTap,
  onInspect,
  label,
}: {
  cards: CardView[];
  art: Art;
  c: Content;
  selected: ReadonlySet<string>;
  onTap: (card: CardView) => void;
  onInspect: (card: CardView) => void;
  label: string;
}) {
  const timer = useRef<number | null>(null);
  const box = useRef<HTMLElement>(null);
  const phone = usePhone();
  const free = useFreeHeight(box, phone);
  const [room, setRoom] = useState(358);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || !phone) return;
    const ro = new ResizeObserver(() => setRoom(el.clientWidth));
    ro.observe(el);
    setRoom(el.clientWidth);
    return () => ro.disconnect();
  }, [phone]);
  const fit = phone ? phoneLayout(cards.length, room, free) : null;
  const held = useRef(false);
  const start = (card: CardView) => {
    held.current = false;
    timer.current = window.setTimeout(() => {
      held.current = true;
      onInspect(card);
    }, LONG_PRESS_MS);
  };
  const stop = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };
  if (!cards.length)
    return (
      <p className="rounded-xl bg-panel px-3 py-4 text-center text-sm text-ink-muted ring-1 ring-line">
        Your hand is empty.
      </p>
    );
  return (
    <section ref={box} aria-label={label}>
      <ul
        className={cn(
          '-mx-1 flex gap-1.5 px-1 pt-3 pb-1 sm:gap-2',
          // A phone hand that fits (one or two rows) uses the band above the bar; else it scrolls.
          fit
            ? 'mx-auto flex-wrap justify-center'
            : 'snap-x overflow-x-auto [scrollbar-width:thin]',
        )}
        style={fit ? { maxWidth: fit.cols * fit.w + GAP * (fit.cols - 1) + 8 } : undefined}
        data-testid="hand"
      >
        {sortHand(cards).map((card) => (
          <li
            key={card.id}
            className="shrink-0 snap-start"
            style={fit ? { width: fit.w } : undefined}
          >
            <button
              type="button"
              className={cn(
                'block rounded-[0.6rem] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                // A button doesn't stretch to its box by itself: a sized card fills it.
                fit && 'w-full',
              )}
              aria-pressed={selected.has(card.id)}
              aria-label={c.name(card.t)}
              data-card={card.t}
              onPointerDown={() => start(card)}
              onPointerUp={stop}
              onPointerLeave={stop}
              onPointerCancel={stop}
              onContextMenu={(e) => {
                e.preventDefault();
                stop();
                held.current = true;
                onInspect(card);
              }}
              onClick={() => {
                if (held.current) {
                  held.current = false;
                  return;
                }
                onTap(card);
              }}
            >
              <CardFace
                card={card}
                art={art}
                c={c}
                size="md"
                eager
                selected={selected.has(card.id)}
                // Desktops: one row (as on phones, scrolling past eight or so), cards large
                // enough to read their art, so the whole hand stays above the fold.
                className={fit ? 'w-full sm:w-full' : 'lg:w-32'}
              />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-0.5 text-xs text-ink-muted">
        Tap to pick cards · press and hold (or right-click) for what a card does
      </p>
    </section>
  );
});
