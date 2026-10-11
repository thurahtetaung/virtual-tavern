import type { GameSummary } from '@vt/protocol';
import { Panel } from '@vt/ui';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { GuideView } from '../components/GuideView.tsx';
import { Layout } from '../components/Layout.tsx';
import {
  type ClientGame,
  clientGames,
  findGame,
  loadPrivateGames,
  offeredPrivateGames,
} from '../games/registry.ts';
import { api } from '../lib/api.ts';
import { NotFoundPage } from './NotFoundPage.tsx';

function GameLinks({ games }: { games: readonly ClientGame[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {games.map((g) => (
        <Link key={g.id} to={`/rules/${g.id}`}>
          <Panel className="h-full transition hover:ring-amber-400">
            <p className="text-xl font-bold">
              {g.icon} {g.name}
            </p>
            <p className="mt-1 text-stone-600 dark:text-stone-400">{g.guide.tagline}</p>
          </Panel>
        </Link>
      ))}
    </div>
  );
}

/**
 * Every game's rules. The back-room games are listed only when this browser has unlocked the
 * back room: their registry can't even be loaded otherwise, so nothing reaches anyone else.
 */
function RulesIndex() {
  const [privateGames, setPrivateGames] = useState<ClientGame[]>([]);
  useEffect(() => {
    let stale = false;
    // The server lists private games only to unlocked browsers; only then is the registry fetched.
    void api<GameSummary[]>('/api/games')
      .then(async (offered) => {
        if (!offered.some((g) => g.private)) return;
        const known = await loadPrivateGames();
        if (!stale) setPrivateGames(offeredPrivateGames(offered, known));
      })
      .catch(() => {});
    return () => {
      stale = true;
    };
  }, []);
  return (
    <Layout>
      <h1 className="mb-6 text-3xl font-bold">How to play</h1>
      <GameLinks games={clientGames} />
      {privateGames.length > 0 && (
        <section aria-labelledby="rules-back-room" className="mt-8">
          <h2 id="rules-back-room" className="mb-4 text-2xl font-bold">
            🕯️ Back room
          </h2>
          <GameLinks games={privateGames} />
        </section>
      )}
    </Layout>
  );
}

export function RulesPage() {
  const { gameId } = useParams();
  // Back-room games' rules are only loadable once unlocked; anyone else just gets "not found".
  const [privateGame, setPrivateGame] = useState<ClientGame | null | 'missing'>(null);
  useEffect(() => {
    if (!gameId || findGame(gameId)) return;
    void loadPrivateGames().then((games) =>
      setPrivateGame(games.find((g) => g.id === gameId) ?? 'missing'),
    );
  }, [gameId]);
  if (!gameId) return <RulesIndex />;
  const game = findGame(gameId) ?? (privateGame === 'missing' ? undefined : privateGame);
  if (privateGame === 'missing') return <NotFoundPage />;
  if (!game) return <Layout>{null}</Layout>;
  // A back-room game's rules lead back to the back room, where its rooms are made.
  const back = findGame(gameId)
    ? { to: '/rules', label: '← All games' }
    : { to: '/backroom', label: '← Back room' };
  return (
    <Layout>
      <Link to={back.to} className="text-sm text-amber-700 hover:underline dark:text-amber-400">
        {back.label}
      </Link>
      <h1 className="mt-2 mb-1 text-3xl font-bold">
        {game.icon} How to play {game.name}
      </h1>
      <p className="mb-6 text-lg text-stone-600 dark:text-stone-400">{game.guide.tagline}</p>
      <GuideView guide={game.guide} />
    </Layout>
  );
}
