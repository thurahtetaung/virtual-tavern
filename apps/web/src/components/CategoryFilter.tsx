import type { GameCategory } from '@vt/protocol';
import { cn } from '@vt/ui';

const CHIP =
  'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full px-4 text-sm font-semibold whitespace-nowrap ring-1 transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-amber-500';

/**
 * The category chips above a game list: "All" and one per category its games have. Several may be
 * chosen; a game shows only when it has all of them. `backroom` gives them the candlelit dark theme.
 */
export function CategoryFilter({
  chips,
  chosen,
  onToggle,
  onClear,
  backroom = false,
}: {
  chips: readonly GameCategory[];
  chosen: readonly string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  backroom?: boolean;
}) {
  if (!chips.length) return null;
  const chip = (on: boolean) =>
    cn(
      CHIP,
      on
        ? 'bg-accent text-accent-fg ring-accent'
        : cn(
            'bg-card text-ink ring-line-strong hover:bg-accent-soft',
            backroom
              ? 'dark:bg-stone-900 dark:text-amber-100 dark:ring-amber-900/60 dark:hover:bg-amber-950'
              : 'dark:hover:bg-stone-800',
          ),
    );
  return (
    <div
      role="group"
      aria-label="Filter games by category"
      // Scrolls sideways on phones; the negative margin lets chips run to the screen's edge.
      className="-mx-4 flex gap-2 overflow-x-auto px-4 py-1 [scrollbar-width:thin] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0"
    >
      <button
        type="button"
        aria-pressed={chosen.length === 0}
        onClick={onClear}
        className={chip(chosen.length === 0)}
      >
        All
      </button>
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          aria-pressed={chosen.includes(c.id)}
          onClick={() => onToggle(c.id)}
          className={chip(chosen.includes(c.id))}
        >
          <span aria-hidden>{c.emoji}</span>
          {c.name}
        </button>
      ))}
    </div>
  );
}

/** Shown in place of the cards when no game has every chosen category. */
export function NoGamesMatch({
  onClear,
  backroom = false,
}: {
  onClear: () => void;
  backroom?: boolean;
}) {
  return (
    <p
      role="status"
      className={cn(
        'col-span-full rounded-2xl border border-dashed border-line-strong p-8 text-center text-ink-muted',
        backroom ? 'dark:border-amber-900/60 dark:text-amber-200/60' : 'dark:border-stone-700',
      )}
    >
      No game has all of those categories.{' '}
      <button
        type="button"
        onClick={onClear}
        className="min-h-11 rounded-lg px-2 font-semibold text-accent-text underline-offset-2 hover:underline dark:text-amber-400"
      >
        Show all games
      </button>
    </p>
  );
}
