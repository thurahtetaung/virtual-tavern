export type Tab = 'table' | 'log' | 'me';

/**
 * Classes for a panel that is one of the phone tabs and always shows on desktop (lg+), where the
 * panels sit side by side.
 */
export const tabPanel = (tab: Tab, panel: Tab) => (tab === panel ? '' : 'hidden lg:block');

/**
 * Classes for a phone-only panel: shown on its tab, never on desktop (where the sidebar has its
 * own copy). Written without a conflict to resolve, so no class merge can bring it back on desktop.
 */
export const phoneTabPanel = (tab: Tab, panel: Tab) => (tab === panel ? 'lg:hidden' : 'hidden');
