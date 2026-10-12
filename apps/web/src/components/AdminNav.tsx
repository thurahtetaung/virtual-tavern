import { cn } from '@vt/ui';
import { Link } from 'react-router';

/** Switches between the admin pages. */
export function AdminNav({
  current,
  className,
}: {
  current: 'lists' | 'stats' | 'playtest';
  className?: string;
}) {
  const items = [
    { id: 'lists', to: '/tavern-keeper', label: 'Lists & back room' },
    { id: 'stats', to: '/tavern-keeper/stats', label: 'Stats' },
    { id: 'playtest', to: '/tavern-keeper/playtest', label: '🧪 Playtest' },
  ] as const;
  return (
    <nav
      aria-label="Admin"
      className={cn('flex gap-1 rounded-xl bg-stone-200/70 p-1 dark:bg-stone-800/70', className)}
    >
      {items.map((item) => (
        <Link
          key={item.id}
          to={item.to}
          aria-current={current === item.id ? 'page' : undefined}
          className={cn(
            'flex min-h-11 flex-1 items-center justify-center rounded-lg px-2 text-center text-sm font-semibold whitespace-nowrap transition-colors sm:flex-none sm:px-3',
            current === item.id
              ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-900 dark:text-stone-100'
              : 'text-stone-600 hover:text-stone-900 dark:text-stone-400 dark:hover:text-stone-100',
          )}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
