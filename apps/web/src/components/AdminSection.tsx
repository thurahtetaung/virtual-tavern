import { FoldSummary, Panel } from '@vt/ui';
import { type ReactNode, useId, useState } from 'react';

const STORE = 'vt.adminSections';

function remembered(): Record<string, boolean> {
  try {
    return (JSON.parse(localStorage.getItem(STORE) ?? '{}') as Record<string, boolean>) ?? {};
  } catch {
    return {};
  }
}

/**
 * One admin section that folds away: its heading and a one-line summary stay visible, and the
 * open or closed choice is remembered in this browser.
 */
export function AdminSection({
  id,
  title,
  summary,
  label,
  aside,
  defaultOpen = false,
  children,
}: {
  /** Key for the remembered open state. */
  id: string;
  title: ReactNode;
  summary?: ReactNode;
  /** The section's accessible name, when the title has an emoji or more. */
  label?: string;
  /** A tag at the end of the header ("Open"), before the chevron. */
  aside?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const headingId = useId();
  const [open, setOpen] = useState(() => remembered()[id] ?? defaultOpen);
  const toggle = (next: boolean) => {
    setOpen(next);
    try {
      localStorage.setItem(STORE, JSON.stringify({ ...remembered(), [id]: next }));
    } catch {
      // Private windows may refuse storage; the section still opens and closes.
    }
  };
  return (
    <section aria-label={label} aria-labelledby={label ? undefined : headingId}>
      <Panel className="p-0">
        <details
          open={open}
          onToggle={(e) => {
            if (e.currentTarget.open !== open) toggle(e.currentTarget.open);
          }}
          className="group"
        >
          <FoldSummary className="gap-3 py-3 lg:px-5">
            <span className="min-w-0 flex-1">
              <h2 id={headingId} className="flex items-center gap-2 text-sub font-semibold">
                {title}
              </h2>
              {summary && <span className="block text-small text-ink-muted">{summary}</span>}
            </span>
            {aside}
          </FoldSummary>
          <div className="space-y-3 px-4 pb-4 lg:px-5 lg:pb-5">{children}</div>
        </details>
      </Panel>
    </section>
  );
}
