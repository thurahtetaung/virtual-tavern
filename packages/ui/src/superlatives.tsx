import type { Superlative } from '@vt/game-sdk';
import { createContext, useContext } from 'react';
import { cn } from './cn.ts';

/**
 * A caption the room shell puts over every game's superlatives, e.g. "Playtest preview: not
 * saved" in an admin playtest. Null (the default) shows none.
 */
export const SuperlativesNote = createContext<string | null>(null);

/**
 * The finished game's superlatives: two or three award lines on every end screen, from the night
 * recap. Renders nothing without lines (recaps off, or the lines are still on their way).
 */
export function Superlatives({
  lines,
  className,
}: {
  lines: readonly Superlative[] | undefined;
  className?: string;
}) {
  const note = useContext(SuperlativesNote);
  if (!lines?.length) return null;
  return (
    <section
      aria-label="Superlatives"
      className={cn(
        'rounded-xl bg-amber-50 px-3 py-2 text-left ring-1 ring-amber-200 dark:bg-amber-500/10 dark:ring-amber-500/30',
        className,
      )}
    >
      {note && (
        <p className="pt-1 text-xs font-semibold tracking-wide text-amber-800 uppercase dark:text-amber-300/80">
          {note}
        </p>
      )}
      <dl className="divide-y divide-amber-200/70 dark:divide-amber-500/20">
        {lines.map((line) => (
          <div key={`${line.title}:${line.text}`} className="py-1.5">
            <dt className="text-sm font-bold text-amber-900 dark:text-amber-300">
              <span aria-hidden>{line.emoji} </span>
              {line.title}
            </dt>
            <dd className="text-sm text-stone-700 dark:text-stone-300">{line.text}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
