import { cn } from '@vt/ui';
import { describe, expect, it } from 'vitest';
import { phoneTabPanel, tabPanel, type Tab } from './panels.ts';

type Viewport = 'phone' | 'desktop';

/** Whether an element with these classes displays at the viewport (lg+ is desktop). */
const displays = (classes: string, viewport: Viewport) => {
  const list = classes.split(/\s+/);
  const base = !list.includes('hidden');
  if (viewport === 'phone') return base;
  if (list.includes('lg:hidden')) return false;
  if (list.some((c) => /^lg:(block|flex|grid)$/.test(c))) return true;
  return base;
};
const shows = (chain: string[], viewport: Viewport) => chain.every((c) => displays(c, viewport));

const TABS: Tab[] = ['table', 'me', 'log'];

// The wrappers around the Me content in HydraGame, outermost first, built as it builds them.
const meCopies = (tab: Tab, reveal: boolean) =>
  reveal
    ? [[cn('space-y-3', tabPanel(tab, 'me'))]]
    : [
        [cn(phoneTabPanel(tab, 'me'))],
        [cn('min-w-0 space-y-3', tabPanel(tab, 'log')), 'hidden lg:block'],
      ];
const count = (tab: Tab, reveal: boolean, viewport: Viewport) =>
  meCopies(tab, reveal).filter((chain) => shows(chain, viewport)).length;

describe('Hydra panels', () => {
  it('shows a tab panel only on its phone tab, and always on desktop', () => {
    for (const tab of TABS) {
      expect(displays(cn('space-y-2', tabPanel(tab, 'table')), 'phone')).toBe(tab === 'table');
      expect(displays(cn('space-y-2', tabPanel(tab, 'table')), 'desktop')).toBe(true);
    }
  });

  it('shows a phone-only panel on its tab and never on desktop', () => {
    for (const tab of TABS) {
      expect(displays(cn(phoneTabPanel(tab, 'me')), 'phone')).toBe(tab === 'me');
      expect(displays(cn(phoneTabPanel(tab, 'me')), 'desktop')).toBe(false);
    }
  });

  it('shows the Me content exactly once on desktop and once on the phone Me tab', () => {
    for (const reveal of [false, true]) {
      for (const tab of TABS) {
        expect(count(tab, reveal, 'desktop'), `${tab} desktop`).toBe(1);
        expect(count(tab, reveal, 'phone'), `${tab} phone`).toBe(tab === 'me' ? 1 : 0);
      }
    }
  });
});
