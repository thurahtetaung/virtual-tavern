import { Button, Icon, Slate, TAP_BAND, cn } from '@vt/ui';
import { type ReactNode, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { type ResolvedTheme, type Theme, systemTheme, useTheme } from '../lib/theme.ts';

const NAV_LINK =
  'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg px-1 hover:text-accent-text focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-focus';

/**
 * Page chrome. `wide` is for the room: the game gets the full width (up to 1440 px, so a desktop's
 * play column grows to about 1,060 px beside a 320 px rail), and the header link and the footer
 * tagline make way so the table fits a phone screen.
 */
export function Layout({
  children,
  wide = false,
  room = false,
  admin = false,
  playtest = false,
}: {
  children: ReactNode;
  wide?: boolean;
  /**
   * A game room: on phones the site header makes way for the room's own (its 56 px go to the
   * table), and the page keeps the height of the fixed sticky bar and tab bar free at its foot.
   */
  room?: boolean;
  /** The tavern keeper's pages: a wider column for the side navigation and charts. */
  admin?: boolean;
  /**
   * An admin playtest room: on phones the frame's spacing is tighter, so the playtest bar's 44 px
   * come out of the gaps rather than the table.
   */
  playtest?: boolean;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className={`${room ? 'max-sm:hidden ' : ''}border-b border-line`}>
        <div
          className={`mx-auto flex h-14 items-center justify-between px-4 ${wide ? 'max-w-[90rem]' : admin ? 'max-w-[1104px] lg:px-6' : 'max-w-4xl'}`}
        >
          <Link
            to="/"
            className="flex min-h-11 items-center gap-2 font-display text-lg font-semibold whitespace-nowrap md:text-xl"
          >
            <Icon name="beer" size={24} className="text-accent-text" /> Virtual Tavern
          </Link>
          <nav className="flex items-center gap-2 text-small font-medium text-ink-2 sm:gap-4">
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
      <main
        className={`mx-auto w-full flex-1 px-4 ${room ? `vt-room-main ${playtest ? 'vt-room-playtest pt-1' : 'pt-4'} sm:pt-6` : 'py-6'} ${wide ? 'max-w-[90rem]' : admin ? 'max-w-[1104px] lg:px-6' : 'max-w-4xl'}`}
      >
        {children}
      </main>
      {!wide && (
        <footer className="py-6 text-center text-xs text-ink-muted">
          A cosy corner of the internet for game nights with friends.{' '}
          <Link
            to="/faq"
            className={cn('text-accent-text underline-offset-2 hover:underline', TAP_BAND)}
          >
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
export function ThemeSwitch({ inSheet = false }: { inSheet?: boolean }) {
  const { theme, resolved, setTheme } = useTheme();
  const device: ResolvedTheme = theme === 'system' ? resolved : systemTheme();
  const other: ResolvedTheme = resolved === 'dark' ? 'light' : 'dark';
  // Following the device, or holding the opposite of it: flip. Holding the device's own: follow.
  const next: Theme = theme !== 'system' && theme === device ? 'system' : other;
  const label = next === 'system' ? "Follow your device's theme" : `Switch to ${next} theme`;
  const state = THEME_STATE[theme];
  return (
    <Button
      variant={inSheet ? 'secondary' : 'ghost'}
      size={inSheet ? undefined : 'icon'}
      className={inSheet ? undefined : 'sm:w-auto sm:px-3'}
      aria-label={`Theme: ${state.text}. ${label}`}
      title={label}
      onClick={() => setTheme(next)}
    >
      <span aria-hidden>{state.icon}</span>
      <span className={inSheet ? undefined : 'hidden text-sm sm:inline'}>{state.text}</span>
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
    <Slate
      kind="loading"
      className="my-12"
      title={slow ? slowLabel : label}
      action={
        slow && (
          <Button variant="secondary" onClick={() => window.location.reload()}>
            Reload
          </Button>
        )
      }
    >
      {slow && 'Taking longer than usual.'}
    </Slate>
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
    <div className="fixed inset-0 z-50 overflow-y-auto bg-page">
      <PageLoading wide label="Setting up your room…" />
    </div>
  );
}
