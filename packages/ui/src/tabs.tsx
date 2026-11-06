import { type KeyboardEvent, type ReactNode, useRef } from 'react';
import { cn } from './cn.ts';
import { Icon, type IconName } from './icon.tsx';
import { useReservedHeight } from './reserve.ts';

export interface TabItem<T extends string = string> {
  id: T;
  label: ReactNode;
  /** A count after the label, as a pill ("Rounds 8"). */
  count?: number;
  disabled?: boolean;
}

/** The ids a tab and its panel share: give the panel `{...tabPanelProps(id, tab)}`. */
export const tabIds = (id: string, tab: string) => ({
  tab: `${id}-tab-${tab}`,
  panel: `${id}-panel-${tab}`,
});

/** The attributes of the panel a tab shows. */
export const tabPanelProps = (id: string, tab: string) => ({
  role: 'tabpanel' as const,
  id: tabIds(id, tab).panel,
  'aria-labelledby': tabIds(id, tab).tab,
});

/** Moves between the enabled tabs with the arrow keys, Home and End, and picks the one reached. */
function arrowKeys<T extends string>(
  e: KeyboardEvent<HTMLElement>,
  items: readonly { id: T; disabled?: boolean }[],
  value: T,
  onChange: (id: T) => void,
) {
  const live = items.filter((t) => !t.disabled);
  const at = live.findIndex((t) => t.id === value);
  const to =
    e.key === 'ArrowRight'
      ? live[(at + 1) % live.length]
      : e.key === 'ArrowLeft'
        ? live[(at - 1 + live.length) % live.length]
        : e.key === 'Home'
          ? live[0]
          : e.key === 'End'
            ? live.at(-1)
            : undefined;
  if (!to) return;
  e.preventDefault();
  onChange(to.id);
  const strip = e.currentTarget;
  requestAnimationFrame(() => {
    strip.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  });
}

/**
 * An underline tab strip: 44 px tabs, the chosen one in the accent with a 2 px underline, counts
 * as pills. Too many for the screen and it scrolls sideways rather than wrapping. `id` names the
 * strip; the shown panel takes `tabPanelProps(id, value)`.
 */
export function Tabs<T extends string>({
  id,
  label,
  tabs,
  value,
  onChange,
  testId,
  className,
}: {
  id: string;
  /** What the tabs switch between, for screen readers. */
  label: string;
  tabs: readonly TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Gives the strip this test id and each tab `${testId}-${tab id}`. */
  testId?: string;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      data-testid={testId}
      onKeyDown={(e) => arrowKeys(e, tabs, value, onChange)}
      className={cn(
        'flex gap-1 overflow-x-auto border-b border-line [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        className,
      )}
    >
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-ui="tab"
            id={tabIds(id, t.id).tab}
            aria-controls={tabIds(id, t.id).panel}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            disabled={t.disabled}
            data-testid={testId && `${testId}-${t.id}`}
            onClick={() => onChange(t.id)}
            className={cn(
              '-mb-px inline-flex min-h-11 min-w-11 shrink-0 grow items-center justify-center gap-1 rounded-t-lg border-b-2 px-3.5 text-small font-semibold whitespace-nowrap',
              'transition-colors duration-[180ms]',
              // Inside the strip, which scrolls and so would clip a ring drawn outside.
              'focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-focus',
              on
                ? 'border-accent text-accent-text'
                : 'border-transparent text-ink-2 hover:bg-sunk hover:text-ink',
              'disabled:cursor-not-allowed disabled:text-ink-muted disabled:hover:bg-transparent',
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className="rounded-full bg-sunk px-1.5 text-caption text-ink-2 tabular-nums">
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export interface TabBarItem<T extends string = string> {
  id: T;
  label: string;
  icon: IconName;
  /** A count (unread messages) or a dot (this tab needs you) on the icon; 0 shows nothing. */
  badge?: number | 'dot';
}

/** What a tab's badge says to a screen reader. */
const badgeLabel = (badge: number | 'dot') => (badge === 'dot' ? 'needs you' : `${badge} unread`);

/**
 * A phone game's bottom navigation: fixed to the bottom of the screen, 56 px plus the safe area,
 * each tab an icon over a 12 px label, the current one in the accent with a mark on top. Games
 * opt in; `fixed={false}` lays it out in place (the component sheet). While fixed and shown, the
 * room keeps its height free at the foot of the page, and the sticky bar sits on top of it.
 */
export function TabBar<T extends string>({
  id,
  label,
  items,
  value,
  onChange,
  fixed = true,
  className,
}: {
  id: string;
  label: string;
  items: readonly TabBarItem<T>[];
  value: T;
  onChange: (id: T) => void;
  fixed?: boolean;
  className?: string;
}) {
  const bar = useRef<HTMLDivElement>(null);
  useReservedHeight('--vt-tabbar-h', bar, fixed);
  return (
    <div
      ref={bar}
      role="tablist"
      aria-label={label}
      onKeyDown={(e) => arrowKeys(e, items, value, onChange)}
      className={cn(
        'flex border-t border-line bg-panel pb-[env(safe-area-inset-bottom)]',
        fixed && 'fixed inset-x-0 bottom-0 z-30 shadow-vt-2',
        className,
      )}
    >
      {items.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            data-ui="tab"
            id={tabIds(id, t.id).tab}
            aria-controls={tabIds(id, t.id).panel}
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              'relative flex min-h-14 min-w-11 flex-1 flex-col items-center justify-center gap-0.5 text-caption font-semibold',
              'transition-colors duration-[180ms]',
              'focus-visible:outline-3 focus-visible:-outline-offset-3 focus-visible:outline-focus',
              on
                ? 'text-accent-text before:absolute before:inset-x-[24%] before:top-0 before:h-0.5 before:rounded-b before:bg-accent'
                : 'text-ink-muted hover:text-ink',
            )}
          >
            <span className="relative">
              <Icon name={t.icon} size={24} />
              {t.badge !== undefined && t.badge !== 0 && (
                <span
                  data-testid={`${id}-badge-${t.id}`}
                  className={cn(
                    'absolute -top-1 left-full -ml-2 rounded-full bg-accent text-accent-fg ring-2 ring-panel',
                    t.badge === 'dot'
                      ? 'size-2.5'
                      : 'min-w-[1.125rem] px-1 text-center text-caption leading-[1.125rem] tabular-nums',
                  )}
                >
                  {t.badge === 'dot' ? null : <span aria-hidden>{t.badge}</span>}
                </span>
              )}
            </span>
            {t.label}
            {t.badge !== undefined && t.badge !== 0 && (
              <span className="sr-only">, {badgeLabel(t.badge)}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
