import { cn } from '@vt/ui';
import { memo } from 'react';
import type { Art, CardView, PileView } from '../logic/types.ts';
import type { Content } from './assets.ts';
import { CardBack, CardFace, type CardSize } from './Card.tsx';

/** Pixels per card edge in the side view. */
const EDGE_PX = 3;

/**
 * The stack's side: one edge per card (a tall pile is compressed to `edges` edges), with the
 * face-up Black Hole as a white-bordered stripe at its depth. While the pile shuffles the stripe
 * is hidden, as it would be at a real table.
 */
export const StackSide = memo(function StackSide({
  edges,
  voidEdge,
  shuffling,
  gap,
  className,
}: {
  edges: number;
  voidEdge: number | null;
  shuffling?: boolean;
  /** An open gap after this edge (where a hidden card slides in). */
  gap?: number | null;
  className?: string;
}) {
  return (
    <span aria-hidden className={cn('flex w-full flex-col', shuffling && 'sf-shuffle', className)}>
      {Array.from({ length: edges }, (_, i) => (
        <span key={i} className="contents">
          {gap === i && <span className="sf-gap block h-3 rounded-sm bg-accent/30" />}
          {voidEdge === i && !shuffling ? (
            <span
              className="block rounded-[1px] bg-ink ring-1 ring-white outline-1 outline-line-strong"
              style={{ height: EDGE_PX }}
              data-testid="void-stripe"
            />
          ) : (
            <span
              className="block border-b border-line-strong bg-card"
              style={{ height: EDGE_PX }}
            />
          )}
        </span>
      ))}
      {gap === edges && <span className="sf-gap block h-3 rounded-sm bg-accent/30" />}
    </span>
  );
});

/** The face-up Black Hole on top of the pile, as the details sheet shows it. */
export const VOID_TOP: CardView = { t: 'void', face: 0, id: 'pile-top' };

/** The draw pile: its top card, its side view and the public counts. */
export const Pile = memo(function Pile({
  pile,
  c,
  art,
  shuffling,
  size = 'md',
  onInspect,
}: {
  pile: PileView;
  c: Content;
  art: Art;
  shuffling: boolean;
  size?: CardSize;
  /** Opens the details of the face-up Black Hole when it is on top (a deeper stripe never). */
  onInspect?: (from: HTMLElement) => void;
}) {
  const voidOnTop = pile.voidTop;
  const sideEdges = Math.max(0, pile.edges - 1);
  // The side starts under the top card, so the stripe sits one edge up (a rough spot near the top
  // of a tall pile shows just under it).
  const stripe =
    pile.void === 'up' && pile.voidEdge !== null && !voidOnTop
      ? Math.max(0, pile.voidEdge - 1)
      : null;
  return (
    <figure className="flex flex-col items-center gap-1" data-testid="pile">
      <span className={cn('relative flex flex-col items-center', shuffling && 'sf-shuffle')}>
        {pile.count === 0 ? (
          <span
            className={cn(
              'block aspect-[5/7] rounded-[0.55rem] border-2 border-dashed border-line-strong',
              size === 'sm' ? 'w-14' : 'w-[4.75rem] sm:w-24',
            )}
          />
        ) : voidOnTop && !shuffling && onInspect ? (
          <button
            type="button"
            className="rounded-[0.55rem]"
            onClick={(e) => onInspect(e.currentTarget)}
            aria-label={`Top of the draw pile: ${c.name('void')}, face up. Details`}
            data-testid="pile-top"
          >
            <CardFace card={VOID_TOP} art={art} c={c} size={size} />
          </button>
        ) : voidOnTop && !shuffling ? (
          <CardFace card={VOID_TOP} art={art} c={c} size={size} />
        ) : (
          <CardBack c={c} size={size} />
        )}
        {pile.count > 1 && (
          <span className={cn('-mt-1 block', size === 'sm' ? 'w-14' : 'w-[4.75rem] sm:w-24')}>
            <StackSide edges={sideEdges} voidEdge={stripe} shuffling={shuffling} />
          </span>
        )}
      </span>
      <figcaption className="text-center text-xs leading-tight text-ink-muted">
        <b className="text-ink" data-testid="pile-count">
          {pile.count}
        </b>{' '}
        {pile.count === 1 ? 'card' : 'cards'}
        <br />
        <span data-testid="bombs-out">
          {pile.bombsOut} {pile.bombsOut === 1 ? c.t('{bomb}') : c.t('{bombs}')}
        </span>
        {pile.void === 'hidden' && <> + {c.name('void')}</>}
        {pile.knownTop > 0 && (
          <span className="block font-semibold text-danger-ink" data-testid="known-top">
            {c.glyph('bomb')} {pile.knownTop} on top!
          </span>
        )}
        {pile.void === 'up' && (
          <span className="block font-semibold text-special-ink">
            {c.glyph('void')} face up{voidOnTop ? ' on top!' : ' inside'}
          </span>
        )}
      </figcaption>
    </figure>
  );
});
