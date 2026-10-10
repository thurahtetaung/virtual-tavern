import { Panel } from '@vt/ui';
import { Link, useParams } from 'react-router';
import { GuideView } from '../components/GuideView.tsx';
import { Layout } from '../components/Layout.tsx';
import { clientGames, findGame } from '../games/registry.ts';
import { NotFoundPage } from './NotFoundPage.tsx';

export function RulesPage() {
  const { gameId } = useParams();
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
  const game = findGame(gameId);
  if (!game) return <NotFoundPage />;
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
