import { Button, Panel } from '@vt/ui';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { GameGuideView, useGameGuide } from '../components/GuideView.tsx';
import { Layout, PageLoading, RoomOpening } from '../components/Layout.tsx';
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
import { fetchGames } from '../lib/games.ts';

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

function GameLink({ game }: { game: ClientGame }) {
  const { tagline } = useGameGuide(game);
  return (
    <Link to={`/rules/${game.id}`}>
      <Panel className="h-full transition hover:ring-accent dark:hover:ring-amber-400">
        <p className="text-xl font-bold">
          {game.icon} {game.name}
        </p>
        <p className="mt-1 text-stone-600 dark:text-stone-400">{tagline}</p>
      </Panel>
    </Link>
  );
}

function Tagline({ game }: { game: ClientGame }) {
  const { tagline } = useGameGuide(game);
  return <p className="mb-6 text-lg text-stone-600 dark:text-stone-400">{tagline}</p>;
}

/** The end of a rules page: read enough, now play. */
function CreateRoom({ game }: { game: ClientGame }) {
  const [name, setName] = useState(savedName);
  const [needsName] = useState(() => !savedName());
  const { creating, create } = useCreateRoom(name, () =>
    document.getElementById('rules-name')?.focus(),
  );
  return (
    <Panel id="create-room" className="mt-8 scroll-mt-4 space-y-3 text-center">
      {creating && <RoomOpening />}
      <p className="text-lg font-bold">Ready to play?</p>
      {needsName && (
        <label className="mx-auto block max-w-sm text-left">
          <span className="text-sm font-semibold">Your name</span>
          <input
            id="rules-name"
            value={name}
            maxLength={24}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && saveName(name)}
            placeholder="What should we call you?"
            autoComplete="nickname"
            className="mt-1 h-12 w-full rounded-lg bg-white px-4 text-lg ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600"
          />
        </label>
      )}
      <Button size="lg" disabled={creating !== null} onClick={() => void create(game.id)}>
        {creating ? 'Opening room…' : `Create ${article(game.name)} ${game.name} room`}
      </Button>
    </Panel>
  );
}

export function RulesPage() {
  const { gameId } = useParams();
  const backroom = useBackroomGames();
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
        <h1 className="mb-6 text-3xl font-bold">How to play</h1>
        <div className="grid gap-4 sm:grid-cols-2">
          {clientGames.map((g) => (
            <GameLink key={g.id} game={g} />
          ))}
        </div>
        {backroom && backroom.length > 0 && (
          <section aria-labelledby="rules-back-room">
            <h2 id="rules-back-room" className="mt-10 mb-4 text-2xl font-bold">
              <span aria-hidden>🕯️</span> The back room
            </h2>
            <div className="grid gap-4 sm:grid-cols-2">
              {backroom.map((g) => (
                <GameLink key={g.id} game={g} />
              ))}
            </div>
          </section>
        )}
      </Layout>
    );
  }
  if (missing) return <NotFoundPage />;
  if (!game) return <PageLoading />;
  // A back-room game's rules lead back to the back room, where its rooms are made.
  const back = publicGame
    ? { to: '/rules', label: '← All games' }
    : { to: '/backroom', label: '← Back room' };
  return (
    <Layout>
      <Link
        to={back.to}
        className="inline-flex min-h-11 items-center text-sm text-amber-700 hover:underline dark:text-amber-400"
      >
        {back.label}
      </Link>
      <h1 className="mt-2 mb-1 text-3xl font-bold">
        {game.icon} How to play {game.name}
      </h1>
      <Tagline game={game} />
      <GameGuideView
        game={game}
        done={
          <Button
            size="sm"
            className="min-h-11"
            onClick={() =>
              document.getElementById('create-room')?.scrollIntoView({ behavior: 'smooth' })
            }
          >
            {`Create ${article(game.name)} ${game.name} room`}
          </Button>
        }
      />
      <CreateRoom game={game} />
    </Layout>
  );
}
