import { Button } from '@vt/ui';
import { type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { type ResolvedTheme, type Theme, systemTheme, useTheme } from '../lib/theme.ts';

const NAV_LINK =
  'inline-flex min-h-11 items-center px-1 hover:text-amber-700 dark:hover:text-amber-400';

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
                <Link to="/rules" className={NAV_LINK}>
                  How to play
                </Link>
                <Link to="/faq" className={NAV_LINK}>
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
        <footer className="py-6 text-center text-xs text-ink-muted">
          A cosy corner of the internet for game nights with friends.{' '}
          <Link to="/faq" className="underline hover:text-amber-700 dark:hover:text-amber-400">
            Questions?
          </Link>
        </footer>
      )}
    </div>
  );
}

const THEME_STATE: Record<Theme, { icon: string; text: string }> = {
  light: { icon: '☀️', text: 'Light' },
  dark: { icon: '🌙', text: 'Dark' },
  system: { icon: '🌗', text: 'Auto' },
};

/**
 * Theme switch. From the device's theme a tap flips to the other one; tapping again goes to the
 * device's own colours as an explicit choice, and once more back to following the device. So a
 * choice can always be undone, and every tap but that last one visibly changes the page. It shows
 * the current setting (the word only from `sm` up), and its label says what a tap does.
 */
function ThemeSwitch() {
  const { theme, resolved, setTheme } = useTheme();
  const device: ResolvedTheme = theme === 'system' ? resolved : systemTheme();
  const other: ResolvedTheme = resolved === 'dark' ? 'light' : 'dark';
  // Following the device, or holding the opposite of it: flip. Holding the device's own: follow.
  const next: Theme = theme !== 'system' && theme === device ? 'system' : other;
  const label = next === 'system' ? "Follow your device's theme" : `Switch to ${next} theme`;
  const state = THEME_STATE[theme];
  return (
    <Button
      variant="ghost"
      size="icon"
      className="sm:w-auto sm:px-3"
      aria-label={`Theme: ${state.text}. ${label}`}
      title={label}
      onClick={() => setTheme(next)}
    >
      <span aria-hidden>{state.icon}</span>
      <span className="hidden text-sm sm:inline">{state.text}</span>
    </Button>
  );
}

/** After this long on one loading step, the page says so and offers a reload. */
export const SLOW_STEP_MS = 15_000;

/**
 * One step of opening a page ("Finding your room…"). If it takes longer than `slowAfterMs`, it
 * shows `slowLabel` (or keeps its label), says it's taking longer than usual and offers a reload,
 * so nobody is left staring at a line that never changes.
 */
export function LoadingStep({
  label,
  slowLabel = label,
  slowAfterMs = SLOW_STEP_MS,
}: {
  label: string;
  slowLabel?: string;
  slowAfterMs?: number;
}) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), slowAfterMs);
    return () => {
      clearTimeout(timer);
    };
  }, [slowAfterMs]);
  return (
    <div role="status" className="space-y-3 py-16 text-center">
      <p className="text-ink-muted">{slow ? slowLabel : label}</p>
      {slow && (
        <>
          <p className="text-sm text-ink-muted">Taking longer than usual.</p>
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </>
      )}
    </div>
  );
}

/** What a page shows while its code or data is on the way, instead of a blank screen. */
export function PageLoading({
  wide = false,
  label = 'Opening the door…',
  slowLabel,
  slowAfterMs,
}: {
  wide?: boolean;
  label?: string;
  slowLabel?: string;
  slowAfterMs?: number;
}) {
  return (
    <Layout wide={wide}>
      <LoadingStep
        label={label}
        {...(slowLabel && { slowLabel })}
        {...(slowAfterMs && { slowAfterMs })}
      />
    </Layout>
  );
}

/**
 * The room page's loading screen, shown over the page the moment a room is being created, so
 * the tap leads straight into the room's own steps.
 */
export function RoomOpening() {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-page dark:bg-stone-950">
      <PageLoading wide label="Setting up your room…" />
    </div>
  );
}
