import { Panel, buttonClass } from '@vt/ui';
import { ComponentSheet } from '@vt/ui/sheet';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Layout } from '../components/Layout.tsx';
import { api } from '../lib/api.ts';
import { usePageTitle } from '../lib/title.ts';

interface Session {
  enabled: boolean;
  signedIn: boolean;
}

/**
 * `/tavern-keeper/components`: every shared part in every state, for the tavern keeper and the
 * component-sheet screenshot spec. `?cover=1` adds a game card with a cover from
 * `/sheet-cover.webp`, which only the spec serves.
 */
export function ComponentsPage() {
  usePageTitle('Components');
  const [session, setSession] = useState<Session | null>(null);
  const [params] = useSearchParams();
  useEffect(() => {
    void api<Session>('/api/admin/session').then(setSession);
  }, []);

  return (
    <Layout>
      <h1 className="mb-4 text-title font-semibold">Components</h1>
      {!session ? (
        <p className="text-ink-muted">Loading…</p>
      ) : !session.enabled || !session.signedIn ? (
        <Panel className="mx-auto max-w-sm space-y-3 text-center">
          <p>The component sheet is for the tavern keeper. Sign in first.</p>
          <Link to="/tavern-keeper" className={buttonClass()}>
            Sign in
          </Link>
        </Panel>
      ) : (
        <ComponentSheet cover={params.get('cover') ? '/sheet-cover.webp' : undefined} />
      )}
    </Layout>
  );
}
