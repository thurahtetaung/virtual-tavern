import type { Superlative } from '@vt/game-sdk';
import { cn } from './cn.ts';

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
  if (!lines?.length) return null;
  return (
    <section
      aria-label="Superlatives"
      className={cn(
        'rounded-xl bg-amber-50 px-3 py-2 text-left ring-1 ring-amber-200 dark:bg-amber-500/10 dark:ring-amber-500/30',
        className,
      )}
    >
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
