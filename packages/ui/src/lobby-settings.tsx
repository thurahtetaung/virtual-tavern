import type { ReactNode } from 'react';
import { cn } from './cn.ts';

/**
 * A lobby's settings, as each player needs them: the host, who changes them, always sees them
 * open; everyone else gets one summary line ("⚙️ Settings: 2 min turns · strict · narration on")
 * that opens to the full, read-only settings. Keeps guests' lobbies short on a phone.
 */
export function LobbySettings({
  editable,
  summary,
  title = 'Settings',
  children,
  className,
}: {
  /** The host: settings stay open. */
  editable: boolean;
  /** The guests' one line, the choices that matter most first. */
  summary: string;
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  if (editable) return <div className={className}>{children}</div>;
  return (
    <details
      className={cn(
        'group rounded-2xl bg-card/85 shadow-sm ring-1 ring-line dark:bg-stone-900/80 dark:ring-stone-800',
        className,
      )}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm [&::-webkit-details-marker]:hidden">
        <span className="shrink-0 font-semibold">
          <span aria-hidden>⚙️ </span>
          {title}
        </span>
        <span className="min-w-0 flex-1 truncate text-ink-muted">{summary}</span>
        <span
          aria-hidden
          className="shrink-0 text-ink-muted transition-transform group-open:rotate-180"
        >
          ▾
        </span>
      </summary>
      <div className="px-4 pb-4">{children}</div>
    </details>
  );
}
