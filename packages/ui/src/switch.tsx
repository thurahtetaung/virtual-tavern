import { cn } from './cn.ts';

const TAG = {
  danger: 'bg-danger-soft text-danger-ink ring-danger-line',
  special: 'bg-special-soft text-special-ink ring-special-line',
} as const;

/**
 * A setting's on/off switch, with its title and a line of help. Read-only (`editable` false: a
 * guest, or an option that doesn't apply yet) it stays readable by screen readers and shows its
 * state, but muted: no accent, no hover, `aria-disabled`.
 */
export function Switch({
  on,
  editable,
  title,
  help,
  onChange,
  tag,
  tagTone = 'danger',
  testId,
}: {
  on: boolean;
  editable: boolean;
  title: string;
  help: string;
  onChange: (v: boolean) => void;
  /** A small badge after the title ("legacy", "community"). */
  tag?: string;
  tagTone?: keyof typeof TAG;
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-disabled={!editable || undefined}
      onClick={() => {
        if (editable) onChange(!on);
      }}
      data-testid={testId}
      className={cn(
        'flex w-full items-start gap-3 rounded-xl px-3 py-2 text-left ring-1 transition',
        !editable
          ? 'cursor-default bg-panel ring-line'
          : on
            ? 'bg-accent-soft ring-2 ring-accent'
            : 'bg-card ring-line hover:bg-panel',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition',
          on ? 'justify-end' : 'justify-start',
          !editable ? (on ? 'bg-ink-muted/60' : 'bg-line') : on ? 'bg-accent' : 'bg-line-strong',
        )}
      >
        <span className={cn('size-4 rounded-full bg-card', editable && 'shadow')} />
      </span>
      <span className="min-w-0">
        <span className={cn('block font-semibold', editable ? 'text-ink' : 'text-ink-muted')}>
          {title}
          {tag && (
            <span
              className={cn(
                'ml-1.5 rounded px-1.5 py-0.5 text-[0.6rem] font-bold tracking-wide uppercase ring-1',
                TAG[tagTone],
              )}
            >
              {tag}
            </span>
          )}
        </span>
        <span className="block text-xs text-ink-muted">{help}</span>
      </span>
    </button>
  );
}

/** The line at the top of settings a guest can see but not change. */
export function HostOnlyNote({ className }: { className?: string }) {
  return <p className={cn('text-xs text-ink-muted', className)}>Only the host can change these.</p>;
}
