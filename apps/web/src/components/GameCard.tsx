import { Button, cn } from '@vt/ui';
import { Link } from 'react-router';
import type { ClientGame } from '../games/registry.ts';
import { article } from '../lib/article.ts';

/** A game's tile with its pitch and a "Create a room" button. `dark` suits the back room. */
export function GameCard({
  game,
  creating,
  onCreate,
  dark = false,
}: {
  game: ClientGame;
  creating: string | null;
  onCreate: (id: string) => void;
  dark?: boolean;
}) {
  return (
    // A plain container rather than <Panel>: overriding Panel's light background with a dark one
    // doesn't reliably win in Tailwind, so each tone sets its own surface.
    <div
      className={cn(
        'flex flex-col gap-3 rounded-2xl p-4 shadow-sm ring-1',
        dark
          ? 'bg-stone-900/90 text-amber-50 ring-amber-900/60'
          : 'bg-white/80 ring-stone-200 dark:bg-stone-900/80 dark:ring-stone-800',
      )}
    >
      <div className="flex items-center gap-3">
        <span className="text-4xl" aria-hidden>
          {game.icon}
        </span>
        <div>
          <h3 className="text-xl font-bold">{game.name}</h3>
          <p className={cn('text-sm', dark ? 'text-amber-200/60' : 'text-stone-500')}>
            {game.guide.players} · {game.guide.duration}
          </p>
        </div>
      </div>
      <p
        className={cn('flex-1', dark ? 'text-amber-100/80' : 'text-stone-700 dark:text-stone-300')}
      >
        {game.guide.tagline}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="lg"
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
            dark
              ? 'text-amber-300 hover:bg-amber-950'
              : 'text-amber-700 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-stone-800',
          )}
        >
          How to play
        </Link>
      </div>
    </div>
  );
}
