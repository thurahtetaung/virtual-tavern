import type { Superlative } from '@vt/game-sdk';
import { type ReactNode, useContext } from 'react';
import { cn } from './cn.ts';
import { EndColumns } from './end-tabs.tsx';
import { SuperlativesNote } from './superlatives.tsx';

export type EndTone = 'win' | 'success' | 'loss' | 'neutral';

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
  return (
    <section
      data-ui="end-hero"
      data-tone={tone}
      aria-label="Result"
      className={cn(
        'vt-end-hero relative overflow-hidden rounded-2xl border px-4 py-5 text-center shadow-vt-2 sm:px-6',
        inColumn ? 'lg:px-6 lg:py-6' : 'lg:px-10 lg:py-8',
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
      <div className="vt-end-in relative space-y-2 lg:space-y-3">
        {eyebrow && (
          <p
            className={cn(
              'text-caption font-semibold tracking-[0.08em] uppercase',
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
        {emblem && (
          <div
            aria-hidden
            className={cn(
              'vt-end-pop text-5xl leading-none',
              inColumn && art ? 'lg:text-5xl' : 'lg:text-6xl',
            )}
          >
            {emblem}
          </div>
        )}
        <h2
          className="font-display text-display font-semibold text-balance text-ink"
          data-testid={titleTestId}
        >
          {title}
        </h2>
        {children && (
          <div className="mx-auto max-w-prose text-small text-balance text-ink-2 lg:text-body">
            {children}
          </div>
        )}
      </div>
      {art && (
        <div className="vt-end-in relative mt-4 flex flex-wrap items-end justify-center gap-3 lg:mt-6 lg:gap-5">
          {art}
        </div>
      )}
      {!!superlatives?.length && <AwardTiles lines={superlatives} narrow={inColumn} />}
      {actions && <div className="relative mt-4 lg:mt-6">{actions}</div>}
    </section>
  );
}

/** The night's superlatives as tiles: one row on wide screens, stacked on phones. */
function AwardTiles({ lines, narrow }: { lines: readonly Superlative[]; narrow: boolean }) {
  const note = useContext(SuperlativesNote);
  return (
    <section aria-label="Superlatives" className="relative mt-4 lg:mt-6">
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
