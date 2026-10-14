import { Button, cn } from '@vt/ui';
import { Link } from 'react-router';
import type { ClientGame } from '../games/registry.ts';
import { article } from '../lib/article.ts';
import { useGameGuide } from './GuideView.tsx';

/**
 * A game's tile with its pitch and a "Create a room" button. `backroom` gives it the back room's
 * candlelit look in the dark theme.
 */
export function GameCard({
  game,
  creating,
  onCreate,
  backroom = false,
}: {
  game: ClientGame;
  creating: string | null;
  onCreate: (id: string) => void;
  backroom?: boolean;
}) {
  const guide = useGameGuide(game);
  return (
    // A plain container rather than <Panel>: overriding Panel's light background with a dark one
    // doesn't reliably win in Tailwind, so each tone sets its own surface.
    <div
      className={cn(
        'flex flex-col gap-3 rounded-2xl p-4 shadow-sm ring-1',
        'bg-card/85 ring-line',
        backroom
          ? 'dark:bg-stone-900/90 dark:text-amber-50 dark:ring-amber-900/60'
          : 'dark:bg-stone-900/80 dark:ring-stone-800',
      )}
    >
      <div className="flex items-center gap-3">
        <span className="text-4xl" aria-hidden>
          {game.icon}
        </span>
        <div>
          <h3 className="text-xl font-bold">{game.name}</h3>
          <p className={cn('text-sm text-stone-500', backroom && 'dark:text-amber-200/60')}>
            {guide.players} · {guide.duration}
          </p>
        </div>
      </div>
      <p
        className={cn(
          'flex-1 text-stone-700',
          backroom ? 'dark:text-amber-100/80' : 'dark:text-stone-300',
        )}
      >
        {guide.tagline}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="lg"
          variant={backroom ? 'primary' : 'soft'}
          aria-label={`Create ${article(game.name)} ${game.name} room`}
          disabled={creating !== null}
          onClick={() => onCreate(game.id)}
        >
          {creating === game.id ? 'Opening room…' : 'Create a room'}
        </Button>
        <Link
          to={`/rules/${game.id}`}
          className={cn(
            'inline-flex h-12 items-center rounded-lg px-4 font-semibold',
            'text-amber-700 hover:bg-accent-soft',
            backroom
              ? 'dark:text-amber-300 dark:hover:bg-amber-950'
              : 'dark:text-amber-400 dark:hover:bg-stone-800',
          )}
        >
          How to play
        </Link>
      </div>
    </div>
  );
}
