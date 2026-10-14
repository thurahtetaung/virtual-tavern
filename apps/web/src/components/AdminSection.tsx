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
  defaultOpen = false,
  children,
}: {
  /** Key for the remembered open state. */
  id: string;
  title: ReactNode;
  summary?: ReactNode;
  /** The section's accessible name, when the title has an emoji or more. */
  label?: string;
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
    <section
      aria-label={label}
      aria-labelledby={label ? undefined : headingId}
      className="rounded-2xl bg-card/85 shadow-sm ring-1 ring-line dark:bg-stone-900/80 dark:ring-stone-800"
    >
      <details
        open={open}
        onToggle={(e) => {
          if (e.currentTarget.open !== open) toggle(e.currentTarget.open);
        }}
        className="group"
      >
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-2xl p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-amber-500 [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1">
            <h2 id={headingId} className="text-xl font-bold">
              {title}
            </h2>
            {summary && <span className="block text-sm text-ink-muted">{summary}</span>}
          </span>
          <svg
            aria-hidden
            viewBox="0 0 20 20"
            className="size-5 shrink-0 text-ink-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
          >
            <path
              d="m5 7.5 5 5 5-5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </summary>
        <div className="space-y-3 px-4 pb-4">{children}</div>
      </details>
    </section>
  );
}
