import type { GameCategory, GameSummary } from '@vt/protocol';
import { Button, Chip, Chips, GameCard, Icon, Slate, Tag, buttonClass, cn } from '@vt/ui';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { ClientGame } from '../games/registry.ts';
import { article } from '../lib/article.ts';
import { chipsOf, shows, useCategoryFilter } from '../lib/categories.ts';
import { fetchGames } from '../lib/games.ts';
import { useGameGuide } from './GuideView.tsx';

/**
 * The given games as the server offers them (switched off ones dropped), filtered by the chips
 * remembered under `key`. Until the server answers every game shows, without categories.
 */
export function useShelf(games: readonly ClientGame[], key: string) {
  const [offered, setOffered] = useState<GameSummary[]>([]);
  useEffect(() => {
    void fetchGames()
      .then(setOffered)
      .catch(() => {});
  }, []);
  const listed = useMemo(
    () => offered.filter((s) => games.some((g) => g.id === s.id)),
    [offered, games],
  );
  const chips = useMemo(() => chipsOf(listed), [listed]);
  const filter = useCategoryFilter(key, chips);
  const shown = games.filter((g) => {
    const summary = listed.find((s) => s.id === g.id);
    return !summary?.off && shows(filter.chosen, summary?.categories ?? []);
  });
  const categoriesOf = (id: string) => listed.find((s) => s.id === id)?.categories ?? [];
  return { chips, filter, shown, categoriesOf };
}

/** "All" and one chip per category the list's games have; several may be on. */
export function CategoryChips({
  chips,
  chosen,
  onToggle,
  onClear,
  className,
}: {
  chips: readonly GameCategory[];
  chosen: readonly string[];
  onToggle: (id: string) => void;
  onClear: () => void;
  className?: string;
}) {
  if (!chips.length) return null;
  return (
    // Runs to the screen's edge on phones, where the strip scrolls sideways.
    <Chips label="Filter games by category" className={cn('-mx-4 px-5.5 sm:mx-0', className)}>
      <Chip pressed={chosen.length === 0} onClick={onClear}>
        All
      </Chip>
      {chips.map((c) => (
        <Chip key={c.id} pressed={chosen.includes(c.id)} onClick={() => onToggle(c.id)}>
          <span aria-hidden>{c.emoji}</span>
          {c.name}
        </Chip>
      ))}
    </Chips>
  );
}

/** Shown in place of the cards when no game has every chosen category. */
export function NoMatch({ onClear }: { onClear: () => void }) {
  return (
    <Slate
      className="col-span-full"
      icon="layout-grid"
      title="No game has all of those categories."
      action={
        <Button variant="secondary" onClick={onClear}>
          Show all games
        </Button>
      }
    />
  );
}

/** A public game on the shelf: its emblem, facts and pitch, "Create a room" and "How to play". */
export function ShelfCard({
  game,
  creating,
  onCreate,
}: {
  game: ClientGame;
  creating: string | null;
  onCreate: (id: string) => void;
}) {
  const guide = useGameGuide(game);
  return (
    <GameCard
      emblem={game.icon}
      name={game.name}
      meta={`${guide.players} · ${guide.duration}`}
      tagline={guide.tagline}
      // The emblem band the back room's cards open with, so both rooms share one card.
      strip
      createAriaLabel={`Create ${article(game.name)} ${game.name} room`}
      creating={creating === game.id}
      disabled={creating !== null}
      onCreate={() => onCreate(game.id)}
      howToPlay={
        <Link
          to={`/rules/${game.id}`}
          aria-label={`How to play ${game.name}`}
          className={buttonClass({ variant: 'quiet' })}
        >
          How to play
        </Link>
      }
    />
  );
}

/** A game's row in a list of guides: emblem, name, facts, its categories and a chevron; a link. */
export function GuideRow({
  game,
  categories = [],
}: {
  game: ClientGame;
  categories?: readonly GameCategory[];
}) {
  const guide = useGameGuide(game);
  return (
    <Link
      to={`/rules/${game.id}`}
      className={cn(
        'flex min-h-16 items-center gap-3 rounded-xl bg-card p-4 text-ink shadow-vt-1-edge ring-1 ring-line',
        'transition-shadow duration-[180ms] hover:shadow-vt-2',
        'focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus',
      )}
    >
      <span
        aria-hidden
        className="grid size-13 shrink-0 place-items-center rounded-lg bg-sunk text-[28px] leading-none"
      >
        {game.icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sub leading-tight font-semibold">{game.name}</span>
        <span className="block text-caption text-ink-muted">
          {guide.players} · {guide.duration}
        </span>
        {categories.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1.5">
            {categories.map((c) => (
              <Tag key={c.id}>{c.name}</Tag>
            ))}
          </span>
        )}
      </span>
      <Icon name="chevron-right" className="shrink-0 text-ink-faint" />
    </Link>
  );
}
