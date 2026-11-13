import { Button, Icon, cn, type IconName } from '@vt/ui';
import { type ReactNode } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api.ts';

/** The admin pages' title row: "Tavern keeper", and Sign out once signed in. */
export function AdminTitle({ signedIn, onSignOut }: { signedIn?: boolean; onSignOut: () => void }) {
  return (
    <div className="mb-6 flex items-center justify-between gap-2">
      <h1 className="font-display text-title font-semibold">Tavern keeper</h1>
      {signedIn && (
        <Button
          variant="quiet"
          onClick={() => void api('/api/admin/logout', { method: 'POST' }).then(onSignOut)}
        >
          <Icon name="log-out" />
          Sign out
        </Button>
      )}
    </div>
  );
}

/** An admin page's grid: the navigation (side column on desktop, tabs on phones), then its panels. */
export function AdminFrame({
  current,
  children,
}: {
  current: 'lists' | 'games' | 'stats' | 'playtest';
  children: ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-3 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-6">
      <AdminNav current={current} />
      <div className="min-w-0 space-y-3 lg:space-y-4">{children}</div>
    </div>
  );
}

/** Route links share the underline strip on phones and a sticky side navigation on desktop. */
export function AdminNav({
  current,
  className,
}: {
  current: 'lists' | 'games' | 'stats' | 'playtest';
  className?: string;
}) {
  const items: { id: string; to: string; label: string; short?: string; icon: IconName }[] = [
    {
      id: 'lists',
      to: '/tavern-keeper',
      label: 'Content & back room',
      short: 'Content',
      icon: 'list-ordered',
    },
    { id: 'games', to: '/tavern-keeper/games', label: 'Games', icon: 'gamepad-2' },
    { id: 'stats', to: '/tavern-keeper/stats', label: 'Stats', icon: 'chart-bar' },
    { id: 'playtest', to: '/tavern-keeper/playtest', label: 'Playtest', icon: 'dice-5' },
  ];
  return (
    <nav
      aria-label="Admin"
      className={cn(
        'flex min-w-0 self-start overflow-x-auto border-b border-line lg:sticky lg:top-4 lg:flex-col lg:border-0',
        className,
      )}
    >
      {items.map((item) => (
        <Link
          key={item.id}
          to={item.to}
          aria-current={current === item.id ? 'page' : undefined}
          className={cn(
            'flex min-h-11 min-w-11 flex-auto items-center justify-center gap-3 border-b-2 px-3 text-center text-small leading-tight font-semibold focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-focus lg:justify-start lg:rounded-lg lg:border-0',
            current === item.id
              ? 'border-accent text-accent-text lg:bg-sunk lg:text-ink'
              : 'border-transparent text-ink-2 hover:bg-panel',
          )}
        >
          <Icon name={item.icon} className="hidden lg:block" />
          {/* One line each in the phone strip (a short label where the full one is long); the side
              navigation on desktop has room for the full label. */}
          {item.short ? (
            <>
              <span className="whitespace-nowrap lg:hidden">{item.short}</span>
              <span className="hidden whitespace-nowrap lg:inline">{item.label}</span>
            </>
          ) : (
            <span className="whitespace-nowrap">{item.label}</span>
          )}
        </Link>
      ))}
    </nav>
  );
}
