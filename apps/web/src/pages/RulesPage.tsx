import { Panel } from '@vt/ui';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { GuideView } from '../components/GuideView.tsx';
import { Layout } from '../components/Layout.tsx';
import { type ClientGame, clientGames, findGame, loadPrivateGames } from '../games/registry.ts';
import { NotFoundPage } from './NotFoundPage.tsx';

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
  if (!gameId) {
    return (
      <Layout>
        <h1 className="mb-6 text-3xl font-bold">How to play</h1>
        <div className="grid gap-4 sm:grid-cols-2">
          {clientGames.map((g) => (
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
      </Layout>
    );
  }
  const game = findGame(gameId) ?? (privateGame === 'missing' ? undefined : privateGame);
  if (privateGame === 'missing') return <NotFoundPage />;
  if (!game) return <Layout>{null}</Layout>;
  return (
    <Layout>
      <Link to="/rules" className="text-sm text-amber-700 hover:underline dark:text-amber-400">
        ← All games
      </Link>
      <h1 className="mt-2 mb-1 text-3xl font-bold">
        {game.icon} How to play {game.name}
      </h1>
      <p className="mb-6 text-lg text-stone-600 dark:text-stone-400">{game.guide.tagline}</p>
      <GuideView guide={game.guide} />
    </Layout>
  );
}
