import { Button } from '@vt/ui';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { useTheme } from '../lib/theme.ts';

/**
 * Page chrome. `wide` is for the room: the game gets the full width, and the header link and the
 * footer tagline make way so the table fits a phone screen.
 */
export function Layout({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-stone-200/80 bg-white/60 backdrop-blur dark:border-stone-800 dark:bg-stone-950/60">
        <div
          className={`mx-auto flex h-14 items-center justify-between px-4 ${wide ? 'max-w-7xl' : 'max-w-4xl'}`}
        >
          <Link to="/" className="flex items-center gap-2 font-serif text-xl font-bold">
            <span aria-hidden>🍺</span> Virtual Tavern
          </Link>
          <nav className="flex items-center gap-2 text-sm font-medium text-stone-600 sm:gap-4 dark:text-stone-400">
            {!wide && (
              <Link to="/rules" className="hover:text-amber-700 dark:hover:text-amber-400">
                How to play
              </Link>
            )}
            <ThemeSwitch />
          </nav>
        </div>
      </header>
      <main className={`mx-auto w-full flex-1 px-4 py-6 ${wide ? 'max-w-7xl' : 'max-w-4xl'}`}>
        {children}
      </main>
      {!wide && (
        <footer className="py-6 text-center text-xs text-stone-500">
          A cosy corner of the internet for game nights with friends.
        </footer>
      )}
    </div>
  );
}

/** Light/dark toggle. Tapping it saves an explicit choice, which then overrides the OS setting. */
function ThemeSwitch() {
  const { resolved, setTheme } = useTheme();
  const dark = resolved === 'dark';
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
      aria-pressed={dark}
      title={dark ? 'Light theme' : 'Dark theme'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      <span aria-hidden>{dark ? '☀️' : '🌙'}</span>
    </Button>
  );
}
