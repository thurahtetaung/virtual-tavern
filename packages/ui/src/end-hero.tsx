import type { Superlative } from '@vt/game-sdk';
import { type ReactNode, useContext } from 'react';
import { cn } from './cn.ts';
import { EndBanner, EndColumns } from './end-tabs.tsx';
import { SuperlativesNote } from './superlatives.tsx';

export type EndTone = 'win' | 'success' | 'loss' | 'neutral';

/**
 * Widths for the game's art in `EndHero` (`art`), by how many pieces sit side by side: phones keep
 * them small enough for the end to fit; in `EndLayout`'s column on wide screens they grow to the
 * column (one piece up to 18 rem, as wide as 45 % of the window's height allows for a portrait
 * card), so a finale is never phone-sized art in an empty column. Put it on each piece's wrapper.
 */
export const END_ART: Record<1 | 2 | 3, string> = {
  1: 'w-32 sm:w-40 lg:w-[min(100%,18rem,calc(45vh*0.72))]',
  2: 'w-24 sm:w-32 lg:w-[min(46%,15rem,calc(45vh*0.72))]',
  3: 'w-20 sm:w-24 lg:w-[min(31%,11rem,calc(45vh*0.72))]',
};

/**
 * The top of every finished game: the finale. A lit card with "Game over" (or the game's own
 * eyebrow), the emblem, the result in the display face, one line under it, the game's own art at
 * the size the screen allows (the winning card, the culprits, the last drawing) and the night's
 * superlatives as award tiles. The game's own details (standings, rounds, hands) follow it, phones
 * through `EndTabs`. It lands once (a 400 ms rise, none under reduced motion) and never loops.
 *
 * Play again stays in the game's own `StickyBar`, passed as `actions` so it sits at the foot of the
 * card on wide screens and in the bar on phones.
 */
export function EndHero({
  title,
  eyebrow = 'Game over',
  emblem = '🏆',
  tone = 'win',
  children,
  art,
  superlatives,
  actions,
  titleTestId,
  className,
}: {
  /** The result, e.g. "Ben wins!" or "The ghost wanders on". */
  title: ReactNode;
  eyebrow?: ReactNode;
  /** An emoji (or a small piece of the game's art); `null` for none. */
  emblem?: ReactNode;
  /**
   * Colours the card's light: ember for a win, success for a cooperative win, danger for a loss
   * everyone shares, quiet otherwise (a team win whose colours the title carries).
   */
  tone?: EndTone;
  /** One or two lines under the title. */
  children?: ReactNode;
  /** The game's own art for the result, shown large under the title. */
  art?: ReactNode;
  /** The night's superlatives (`room.superlatives`); shown as award tiles. */
  superlatives?: readonly Superlative[];
  /** Play again / Change setup (usually the game's `StickyBar`). */
  actions?: ReactNode;
  titleTestId?: string;
  className?: string;
}) {
  // Beside the rest of the end (`EndLayout` on wide screens): sized for a column, not the page.
  const inColumn = useContext(EndColumns);
  // With no art to show, a column the height of the window would be mostly empty: on wide screens
  // the finale is a lit banner across the top instead (the emblem beside the result, Play again
  // after them, the group centred under the light), and `EndLayout` puts the rest under it.
  const banner = useContext(EndBanner) && inColumn && !art;
  return (
    <section
      data-ui="end-hero"
      data-bare={banner || undefined}
      data-tone={tone}
      aria-label="Result"
      className={cn(
        'vt-end-hero relative overflow-hidden rounded-2xl border px-4 py-5 text-center shadow-vt-2 sm:px-6',
        // Beside the rest on wide screens, the finale stands the height of the window (as it fills
        // a phone), its content centred, instead of stopping at the top with empty space under it.
        banner
          ? 'lg:flex lg:flex-wrap lg:items-center lg:justify-center lg:gap-x-12 lg:gap-y-4 lg:px-10 lg:py-8 lg:text-left'
          : inColumn
            ? 'lg:flex lg:min-h-[min(calc(100dvh-10.5rem),48rem)] lg:flex-col lg:justify-center lg:px-6 lg:py-8'
            : 'lg:px-10 lg:py-8',
        tone === 'loss'
          ? 'border-danger-line'
          : tone === 'success'
            ? 'border-success-line'
            : tone === 'win'
              ? 'border-accent-line'
              : 'border-line',
        className,
      )}
    >
      <div
        className={cn(
          'vt-end-in relative space-y-2 lg:space-y-3',
          banner &&
            'lg:grid lg:min-w-0 lg:grid-cols-[auto_minmax(0,1fr)] lg:items-center lg:gap-x-8 lg:gap-y-1 lg:space-y-0',
        )}
      >
        {eyebrow && (
          <p
            className={cn(
              'text-caption font-semibold tracking-[0.08em] uppercase',
              banner && 'lg:col-start-2',
              tone === 'loss'
                ? 'text-danger-ink'
                : tone === 'success'
                  ? 'text-success-ink'
                  : 'text-accent-text',
            )}
          >
            {eyebrow}
          </p>
        )}
        {/* An emoji emblem sits on the sunk tile game emblems use everywhere, so it reads as the
            game's badge rather than a loose glyph; a piece of art stands on its own. */}
        {emblem &&
          (typeof emblem === 'string' ? (
            <div
              aria-hidden
              className={cn(
                'vt-end-pop mx-auto flex size-16 items-center justify-center rounded-2xl bg-sunk text-[2.5rem] leading-none shadow-vt-1 ring-1 ring-line',
                inColumn && art ? 'lg:size-20 lg:text-5xl' : 'lg:size-24 lg:text-6xl',
                banner && 'lg:col-start-1 lg:row-span-3 lg:row-start-1',
              )}
            >
              {emblem}
            </div>
          ) : (
            <div
              aria-hidden
              className={cn(
                'vt-end-pop text-5xl leading-none lg:text-6xl',
                banner && 'lg:col-start-1 lg:row-span-3 lg:row-start-1',
              )}
            >
              {emblem}
            </div>
          ))}
        <h2
          className={cn(
            'font-display text-display font-semibold text-balance text-ink',
            inColumn && 'xl:text-[3.25rem]',
            banner && 'lg:col-start-2',
          )}
          data-testid={titleTestId}
        >
          {title}
        </h2>
        {children && (
          <div
            className={cn(
              'mx-auto max-w-prose text-small text-balance text-ink-2 lg:text-body',
              banner && 'lg:col-start-2 lg:mx-0',
            )}
          >
            {children}
          </div>
        )}
      </div>
      {art && (
        <div
          data-ui="end-hero-art"
          className="vt-end-in relative mt-4 flex flex-wrap items-end justify-center gap-3 lg:mt-6 lg:gap-5"
        >
          {art}
        </div>
      )}
      {!!superlatives?.length && (
        <AwardTiles
          lines={superlatives}
          narrow={inColumn && !banner}
          className={banner ? 'lg:order-last lg:basis-full' : undefined}
        />
      )}
      {actions && (
        <div className={cn('relative mt-4 lg:mt-6', banner && 'lg:mt-0 lg:shrink-0')}>
          {actions}
        </div>
      )}
    </section>
  );
}

/** The night's superlatives as tiles: one row on wide screens, stacked on phones. */
function AwardTiles({
  lines,
  narrow,
  className,
}: {
  lines: readonly Superlative[];
  narrow: boolean;
  className?: string;
}) {
  const note = useContext(SuperlativesNote);
  return (
    <section aria-label="Superlatives" className={cn('relative mt-4 lg:mt-6', className)}>
      {note && (
        <p className="pb-1 text-caption font-semibold tracking-[0.08em] text-accent-text uppercase">
          {note}
        </p>
      )}
      <dl
        className={cn(
          'grid gap-2 text-left sm:gap-3',
          // In a column (`EndLayout`) the tiles stack; across the page they share a row.
          !narrow && lines.length > 1 && 'sm:grid-cols-2',
          !narrow && lines.length > 2 && 'lg:grid-cols-3',
        )}
      >
        {lines.map((line) => (
          <div
            key={`${line.title}:${line.text}`}
            className="flex items-start gap-3 rounded-xl border border-accent-line bg-accent-soft px-3 py-2.5"
          >
            <span aria-hidden className="text-2xl leading-none lg:text-3xl">
              {line.emoji}
            </span>
            <div className="min-w-0">
              <dt className="text-small font-bold text-accent-text">{line.title}</dt>
              <dd className="text-small text-ink-2">{line.text}</dd>
            </div>
          </div>
        ))}
      </dl>
    </section>
  );
}
