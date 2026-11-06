import { Slate, buttonClass } from '@vt/ui';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AdminFrame, AdminTitle } from '../components/AdminNav.tsx';
import { Layout } from '../components/Layout.tsx';
import { PlaytestAdmin } from '../components/PlaytestAdmin.tsx';
import { api } from '../lib/api.ts';
import { usePageTitle } from '../lib/title.ts';

interface Session {
  enabled: boolean;
  signedIn: boolean;
}

/** `/tavern-keeper/playtest`: the admin plays any game alone, one browser tab per seat. */
export function PlaytestPage() {
  usePageTitle('Playtest');
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
          title={<>Playtests are for the tavern keeper. Sign in first.</>}
        >
          <Link to="/tavern-keeper" className={buttonClass()}>
            Sign in
          </Link>
        </Slate>
      ) : (
        <AdminFrame current="playtest">
          <PlaytestAdmin />
        </AdminFrame>
      )}
    </Layout>
  );
}
