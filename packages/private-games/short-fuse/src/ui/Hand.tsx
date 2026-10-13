import { cn } from '@vt/ui';
import { useRef } from 'react';
import { CARD_TYPES } from '../logic/cards.ts';
import type { Art, CardView } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { CardFace } from './Card.tsx';

const LONG_PRESS_MS = 450;

/** The hand in a fixed order (same names together), so pairs are easy to spot. */
export const sortHand = (cards: CardView[]) =>
  [...cards].sort(
    (a, b) => CARD_TYPES.indexOf(a.t) - CARD_TYPES.indexOf(b.t) || a.id.localeCompare(b.id),
  );

/**
 * Your hand: tap to select (several for a combo), press and hold for the card's details at any
 * time. When `pick` is set, a tap picks that card instead (giving a card away).
 */
export function Hand({
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
    <section aria-label={label}>
      <ul
        className="-mx-1 flex snap-x gap-1.5 overflow-x-auto px-1 pt-3 pb-1 [scrollbar-width:thin] sm:gap-2 lg:flex-wrap lg:overflow-visible"
        data-testid="hand"
      >
        {sortHand(cards).map((card) => (
          <li key={card.id} className="shrink-0 snap-start">
            <button
              type="button"
              className={cn(
                'block rounded-[0.6rem] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
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
              <CardFace card={card} art={art} c={c} size="md" selected={selected.has(card.id)} />
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-0.5 text-[0.7rem] text-ink-muted">
        Tap to pick cards · press and hold (or right-click) for what a card does
      </p>
    </section>
  );
}
