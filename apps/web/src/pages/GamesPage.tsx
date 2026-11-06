import { Slate, buttonClass } from '@vt/ui';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AdminFrame, AdminTitle } from '../components/AdminNav.tsx';
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
    <Layout admin>
      <AdminTitle
        signedIn={session?.signedIn}
        onSignOut={() => setSession((s) => s && { ...s, signedIn: false })}
      />
      {!session ? (
        <Slate kind="loading" title="Loading…" />
      ) : !session.enabled || !session.signedIn ? (
        <Slate
          icon="lock"
          className="mx-auto max-w-sm"
          title={<>The game settings are for the tavern keeper. Sign in first.</>}
        >
          <Link to="/tavern-keeper" className={buttonClass()}>
            Sign in
          </Link>
        </Slate>
      ) : (
        <AdminFrame current="games">
          <GamesAdmin />
        </AdminFrame>
      )}
    </Layout>
  );
}
