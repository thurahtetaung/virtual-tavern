import { Panel } from '@vt/ui';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AdminNav } from '../components/AdminNav.tsx';
import { Layout } from '../components/Layout.tsx';
import { GamesAdmin } from '../components/GamesAdmin.tsx';
import { api } from '../lib/api.ts';
import { usePageTitle } from '../lib/title.ts';

interface Session {
  enabled: boolean;
  signedIn: boolean;
}

/** `/tavern-keeper/games`: every game's settings (on/off, categories, titles, music) in one place. */
export function GamesPage() {
  usePageTitle('Games');
  const [session, setSession] = useState<Session | null>(null);
  useEffect(() => {
    void api<Session>('/api/admin/session').then(setSession);
  }, []);

  return (
    <Layout>
      <h1 className="mb-4 text-3xl font-bold">Tavern keeper</h1>
      {!session ? (
        <p className="text-ink-muted">Loading…</p>
      ) : !session.enabled || !session.signedIn ? (
        <Panel className="mx-auto max-w-sm space-y-3 text-center">
          <p>The game settings are for the tavern keeper. Sign in first.</p>
          <Link
            to="/tavern-keeper"
            className="inline-flex h-11 items-center justify-center rounded-lg bg-accent px-4 font-semibold text-white hover:bg-accent-hover dark:hover:bg-amber-500 dark:bg-amber-500 dark:text-stone-950"
          >
            Sign in
          </Link>
        </Panel>
      ) : (
        <>
          <AdminNav current="games" className="mb-4" />
          <GamesAdmin />
        </>
      )}
    </Layout>
  );
}
