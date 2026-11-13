import { type ReactNode, useState } from 'react';
import { cn } from './cn.ts';
import { Button } from './components.tsx';
import { ProtectedImage } from './protected-image.tsx';

/** A game's cover for its card: 16:9, cropped to fill. */
export interface GameCover {
  src: string;
  /** Dims a very bright cover a little in dark mode only, so it doesn't glare on charcoal. */
  dimInDark?: boolean;
}

/**
 * A game in a list (home page, back-room lobby): its cover strip if it has one (with `strip`, the
 * strip is always there and shows the emblem until, or instead of, a cover), its own emoji
 * emblem on a 44 px tile, its name, a line of facts and its pitch, then "Create a room" (`tint`)
 * and the caller's "How to play" link (style it with `buttonClass({ variant: 'quiet' })`).
 */
export function GameCard({
  emblem,
  name,
  meta,
  tagline,
  cover,
  strip = false,
  createLabel = 'Create a room',
  createAriaLabel,
  creating = false,
  disabled = false,
  onCreate,
  howToPlay,
  className,
}: {
  /** The game's own emoji, from its definition. */
  emblem: string;
  name: string;
  /** Players and duration: "4+ players · best with 6–10 · 15–20 min". */
  meta?: ReactNode;
  tagline?: ReactNode;
  cover?: GameCover | null;
  /**
   * Always show the art strip, with the emblem in it while there is no cover (wider screens only:
   * phones show a cover's strip alone).
   */
  strip?: boolean;
  createLabel?: string;
  createAriaLabel?: string;
  /** This card's room is being opened. */
  creating?: boolean;
  /** Another room is being opened. */
  disabled?: boolean;
  onCreate: () => void;
  howToPlay?: ReactNode;
  className?: string;
}) {
  // A cover that fails to load (after its one retry) gives way to the emblem.
  const [failed, setFailed] = useState<string | null>(null);
  const art = cover && cover.src !== failed ? cover : null;
  return (
    <article
      data-ui="game-card"
      className={cn(
        'flex min-w-0 flex-col overflow-hidden rounded-xl bg-card shadow-vt-1-edge ring-1 ring-line transition-shadow duration-[180ms] hover:shadow-vt-2',
        className,
      )}
    >
      {(art || strip) && (
        // Phones drop an emblem-only strip (the emblem is beside the name already), so a long
        // list stays short; a real cover always shows.
        <div className={cn('bg-sunk p-2.5', !art && 'max-sm:hidden')}>
          {art ? (
            // Covers keep their full 16:9 on phones too: box art often carries the title near
            // its top or bottom edge, which a shallower crop would cut.
            <div className="aspect-video overflow-hidden rounded-lg shadow-vt-1 ring-1 ring-line">
              <ProtectedImage
                src={art.src}
                alt=""
                loading="lazy"
                onError={() => setFailed(art.src)}
                className={cn('size-full object-cover', art.dimInDark && 'dark:brightness-[0.87]')}
              />
            </div>
          ) : (
            <div
              aria-hidden
              data-ui="game-card-emblem-strip"
              className="grid aspect-video place-items-center rounded-lg max-sm:aspect-[21/9]"
            >
              <span className="grid size-24 place-items-center rounded-2xl bg-card text-6xl leading-none shadow-vt-1 ring-1 ring-line">
                {emblem}
              </span>
            </div>
          )}
        </div>
      )}
      <div className="flex flex-1 flex-col gap-2.5 p-4">
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className="grid size-11 shrink-0 place-items-center rounded-lg bg-sunk text-2xl leading-none"
          >
            {emblem}
          </span>
          <div className="min-w-0">
            <h3 className="text-sub leading-tight font-semibold text-ink">{name}</h3>
            {meta && <p className="text-caption text-ink-muted">{meta}</p>}
          </div>
        </div>
        {tagline && <p className="flex-1 text-small text-ink-2">{tagline}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="tint"
            aria-label={createAriaLabel}
            disabled={disabled || creating}
            sending={creating}
            onClick={onCreate}
          >
            {creating ? 'Opening room…' : createLabel}
          </Button>
          {howToPlay}
        </div>
      </div>
    </article>
  );
}
