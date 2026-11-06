import { Button, Card, Field, Icon, Input, Notice, buttonClass } from '@vt/ui';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { GameGuideView, useGameGuide } from '../components/GuideView.tsx';
import { Layout, PageLoading, RoomOpening } from '../components/Layout.tsx';
import { CategoryChips, GuideRow, NoMatch, ShelfCard, useShelf } from '../components/Shelf.tsx';
import {
  type ClientGame,
  clientGames,
  findGame,
  loadPrivateGames,
  offeredPrivateGames,
} from '../games/registry.ts';
import { article } from '../lib/article.ts';
import { saveName, savedName } from '../lib/identity.ts';
import { usePageTitle } from '../lib/title.ts';
import { useCreateRoom } from '../lib/useCreateRoom.ts';
import { NotFoundPage } from './NotFoundPage.tsx';
import { fetchGames, useOffGames } from '../lib/games.ts';

/**
 * The back-room games this browser may see, under their admin-set titles: an empty list while
 * locked (the server lists none), `null` while loading.
 */
function useBackroomGames() {
  const [games, setGames] = useState<ClientGame[] | null>(null);
  useEffect(() => {
    void fetchGames()
      .then(async (offered) =>
        offered.some((g) => g.private)
          ? offeredPrivateGames(offered, await loadPrivateGames())
          : [],
      )
      .catch(() => [])
      .then(setGames);
  }, []);
  return games;
}

/** In place of "Create a room" while the admin has the game switched off. */
function NotAvailable({ name }: { name: string }) {
  return (
    <Notice tone="warn" icon className="mb-4">
      {name} isn’t available right now, so no new rooms can be opened. The rules are here to read.
    </Notice>
  );
}

/** "Ready to play?": the end of a rules page, or its rail on a desktop. */
function CreateRoom({ game }: { game: ClientGame }) {
  const [name, setName] = useState(savedName);
  const [needsName] = useState(() => !savedName());
  const { creating, create } = useCreateRoom(name, () =>
    document.getElementById('rules-name')?.focus(),
  );
  return (
    <Card id="create-room" className="grid scroll-mt-4 gap-3 text-center">
      {creating && <RoomOpening />}
      <p className="text-sub font-semibold">Ready to play?</p>
      {needsName && (
        <Field label="Your name" className="text-left">
          <Input
            id="rules-name"
            value={name}
            maxLength={24}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && saveName(name)}
            placeholder="What should we call you?"
            autoComplete="nickname"
          />
        </Field>
      )}
      <Button size="lg" disabled={creating !== null} onClick={() => void create(game.id)}>
        {creating ? 'Opening room…' : `Create ${article(game.name)} ${game.name} room`}
      </Button>
    </Card>
  );
}

/** Every public game's card (filtered by the chips), then the back room's guides when unlocked. */
function GameList({ backroom, off }: { backroom: ClientGame[] | null; off: ReadonlySet<string> }) {
  const { chips, filter, shown } = useShelf(clientGames, 'vt.categories.rules');
  const [name, setName] = useState(savedName);
  const [askName, setAskName] = useState(false);
  const { creating, create } = useCreateRoom(name, () => {
    setAskName(true);
    requestAnimationFrame(() => document.getElementById('rules-name')?.focus());
  });
  const games = shown.filter((g) => !off.has(g.id));
  const backroomGames = backroom?.filter((g) => !off.has(g.id)) ?? [];
  return (
    <>
      {creating && <RoomOpening />}
      <h1 className="text-title font-semibold">How to play</h1>
      <p className="mt-1 mb-4 text-ink-2">
        Every game here is played on phones, together in one room. Pick one to learn it, or open a
        table straight away.
      </p>
      {askName && (
        <Field label="What should we call you?" className="mb-4 max-w-sm">
          <Input
            id="rules-name"
            value={name}
            maxLength={24}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && saveName(name)}
            placeholder="Your name"
            autoComplete="nickname"
          />
        </Field>
      )}
      <CategoryChips
        chips={chips}
        chosen={filter.chosen}
        onToggle={filter.toggle}
        onClear={filter.clear}
        className="mb-3"
      />
      {filter.chosen.length > 0 && games.length > 0 && (
        <p className="mb-3 flex items-center justify-between gap-2 text-small text-ink-muted">
          {games.length === 1 ? '1 game matches' : `${games.length} games match`}
          <Button variant="quiet" size="sm" onClick={filter.clear}>
            Show all games
          </Button>
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {games.length === 0 && <NoMatch onClear={filter.clear} />}
        {games.map((g) => (
          <ShelfCard key={g.id} game={g} creating={creating} onCreate={(id) => void create(id)} />
        ))}
      </div>
      {backroomGames.length > 0 && (
        <section aria-labelledby="rules-back-room">
          <h2 id="rules-back-room" className="mt-10 mb-3 text-heading font-semibold">
            <span aria-hidden>🕯️</span> The back room
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {backroomGames.map((g) => (
              <GuideRow key={g.id} game={g} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

export function RulesPage() {
  const { gameId } = useParams();
  const backroom = useBackroomGames();
  const off = useOffGames();
  const publicGame = gameId ? findGame(gameId) : undefined;
  // Back-room games' rules are only loadable once unlocked; anyone else just gets "not found".
  const game = publicGame ?? backroom?.find((g) => g.id === gameId);
  const missing = gameId !== undefined && !game && backroom !== null;
  usePageTitle(
    !gameId
      ? 'How to play'
      : game
        ? `How to play ${game.name}`
        : missing
          ? 'Nobody here'
          : undefined,
  );

  if (!gameId) {
    return (
      <Layout>
        <GameList backroom={backroom} off={off} />
      </Layout>
    );
  }
  if (missing) return <NotFoundPage />;
  if (!game) return <PageLoading />;
  // A back-room game's rules lead back to the back room, where its rooms are made.
  const back = publicGame
    ? { to: '/rules', label: 'All games' }
    : { to: '/backroom', label: 'Back room' };
  const open = !off.has(game.id);
  return (
    <Layout>
      <Link
        to={back.to}
        className={buttonClass({ variant: 'quiet', size: 'sm', className: '-ml-3' })}
      >
        <Icon name="arrow-left" size={16} />
        {back.label}
      </Link>
      <h1 className="mt-2 text-title font-semibold">
        <span aria-hidden>{game.icon}</span> How to play {game.name}
      </h1>
      <Tagline game={game} />
      {!open && <NotAvailable name={game.name} />}
      <GameGuideView
        game={game}
        ready={open ? <CreateRoom game={game} /> : undefined}
        done={
          open ? (
            <Button
              size="sm"
              onClick={() =>
                document.getElementById('create-room')?.scrollIntoView({ behavior: 'smooth' })
              }
            >
              {`Create ${article(game.name)} ${game.name} room`}
            </Button>
          ) : undefined
        }
      />
    </Layout>
  );
}

function Tagline({ game }: { game: ClientGame }) {
  const { tagline } = useGameGuide(game);
  return <p className="mt-1 mb-4 text-ink-2 sm:text-sub">{tagline}</p>;
}
