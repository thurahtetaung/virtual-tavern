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
        'rounded-xl bg-accent-soft px-3 py-2 text-left ring-1 ring-accent-line',
        className,
      )}
    >
      {note && (
        <p className="pt-1 text-xs font-semibold tracking-wide text-accent-text uppercase">
          {note}
        </p>
      )}
      <dl className="divide-y divide-accent-line">
        {lines.map((line) => (
          <div key={`${line.title}:${line.text}`} className="py-1.5">
            <dt className="text-sm font-bold text-accent-text">
              <span aria-hidden>{line.emoji} </span>
              {line.title}
            </dt>
            <dd className="text-sm text-ink-2">{line.text}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
