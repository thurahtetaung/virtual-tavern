import { useMemo, useSyncExternalStore } from 'react';
import { type ChartTheme, type ChartTokens, tokensFor } from './palette.ts';

// Charts are drawn in JS, so they can't use the `dark:` variant: they follow the `data-theme`
// attribute the header switch (and the boot script) sets on <html>, and redraw when it changes.

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => observer.disconnect();
}

const snapshot = (): ChartTheme =>
  document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';

export function useChartTokens(): ChartTokens {
  const theme = useSyncExternalStore(subscribe, snapshot, () => 'light' as const);
  return useMemo(() => {
    const base = tokensFor(theme);
    const css = getComputedStyle(document.documentElement);
    const token = (name: string, fallback: string) =>
      css.getPropertyValue(`--vt-${name}`).trim() || fallback;
    return {
      ...base,
      surface: token('card', base.surface),
      ink: token('ink', base.ink),
      inkSecondary: token('ink-2', base.inkSecondary),
      muted: token('ink-muted', base.muted),
      grid: token('line', base.grid),
      axis: token('line', base.axis),
      empty: token('sunk', base.empty),
    };
  }, [theme]);
}
