import { Button } from '@vt/ui';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { type ResolvedTheme, type Theme, systemTheme, useTheme } from '../lib/theme.ts';

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
              <>
                <Link to="/rules" className="hover:text-amber-700 dark:hover:text-amber-400">
                  How to play
                </Link>
                <Link to="/faq" className="hover:text-amber-700 dark:hover:text-amber-400">
                  FAQ
                </Link>
              </>
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
          A cosy corner of the internet for game nights with friends.{' '}
          <Link to="/faq" className="underline hover:text-amber-700 dark:hover:text-amber-400">
            Questions?
          </Link>
        </footer>
      )}
    </div>
  );
}

/**
 * Theme switch. From the device's theme a tap flips to the other one; tapping again goes to the
 * device's own colours as an explicit choice, and once more back to following the device. So a
 * choice can always be undone, and every tap but that last one visibly changes the page.
 */
function ThemeSwitch() {
  const { theme, resolved, setTheme } = useTheme();
  const device: ResolvedTheme = theme === 'system' ? resolved : systemTheme();
  const other: ResolvedTheme = resolved === 'dark' ? 'light' : 'dark';
  // Following the device, or holding the opposite of it: flip. Holding the device's own: follow.
  const next: Theme = theme !== 'system' && theme === device ? 'system' : other;
  const label = next === 'system' ? "Follow your device's theme" : `Switch to ${next} theme`;
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      aria-pressed={resolved === 'dark'}
      title={label}
      onClick={() => setTheme(next)}
    >
      <span aria-hidden>{next === 'system' ? '🌗' : next === 'dark' ? '🌙' : '☀️'}</span>
    </Button>
  );
}

/** What a page shows while its code or data is on the way, instead of a blank screen. */
export function PageLoading({ wide = false }: { wide?: boolean }) {
  return (
    <Layout wide={wide}>
      <p role="status" className="py-16 text-center text-stone-500 dark:text-stone-400">
        Opening the door…
      </p>
    </Layout>
  );
}
