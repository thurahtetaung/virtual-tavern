import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

export type Theme = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const THEME_KEY = 'vt.theme';
/** Browser-chrome colours per theme; the same values are in index.html's boot script. */
const THEME_COLORS: Record<ResolvedTheme, string> = { light: '#f2ece2', dark: '#0c0a09' };

const systemQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

function readTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : 'system';
  } catch {
    return 'system';
  }
}

function writeTheme(theme: Theme) {
  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
}

/** Sets `data-theme` (what the `dark:` variant keys off) and the browser-chrome colour. */
function applyTheme(theme: Theme, resolved: ResolvedTheme) {
  document.documentElement.dataset.theme = resolved;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    // With an explicit choice both metas carry that theme's colour; otherwise each follows its
    // own `media` query again.
    const own: ResolvedTheme = meta.media.includes('dark') ? 'dark' : 'light';
    meta.content = THEME_COLORS[theme === 'system' ? own : resolved];
  }
}

const subscribeToSystem = (onChange: () => void) => {
  const query = systemQuery();
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};
const systemPrefersDark = () => systemQuery().matches;

/** The device's own theme right now. */
export const systemTheme = (): ResolvedTheme => (systemPrefersDark() ? 'dark' : 'light');

/**
 * The colour theme: a saved light/dark choice, or the system preference. The choice is shared by
 * every tab, and the page re-themes live when the OS setting changes while on `system`.
 */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(readTheme);
  const systemDark = useSyncExternalStore(subscribeToSystem, systemPrefersDark, () => false);
  const resolved: ResolvedTheme = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme;

  useEffect(() => {
    applyTheme(theme, resolved);
  }, [theme, resolved]);

  useEffect(() => {
    const sync = (e: StorageEvent) => {
      if (e.key === null || e.key === THEME_KEY) setThemeState(readTheme());
    };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    writeTheme(next);
    setThemeState(next);
  }, []);

  return { theme, resolved, setTheme };
}
