import { cn } from './cn.ts';
import { Badge, FOCUS_RING } from './components.tsx';

/**
 * A setting's on/off switch, with its title and a line of help: a 44 × 24 track, and the whole row
 * (at least 44 px) is what you tap. Read-only (`editable` false: a guest, or an option that doesn't
 * apply yet) it stays readable by screen readers and shows its state, but muted: no accent, no
 * hover, `aria-disabled`.
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
  tagTone?: 'danger' | 'special';
  testId?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      data-ui="switch"
      aria-checked={on}
      aria-disabled={!editable || undefined}
      onClick={() => {
        if (editable) onChange(!on);
      }}
      data-testid={testId}
      className={cn(
        'flex min-h-11 w-full items-start gap-3 rounded-xl p-3 text-left ring-1 transition-colors duration-[180ms]',
        FOCUS_RING,
        !editable
          ? 'cursor-default bg-panel ring-line'
          : on
            ? 'bg-accent-soft ring-accent-line'
            : 'bg-card ring-line hover:bg-panel',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-[180ms]',
          !editable ? (on ? 'bg-ink-faint' : 'bg-line') : on ? 'bg-accent' : 'bg-line-strong',
        )}
      >
        <span
          className={cn(
            'size-5 rounded-full bg-card transition-transform duration-[180ms] ease-out',
            editable && 'shadow-vt-1',
            on && 'translate-x-5',
          )}
        />
      </span>
      <span className="min-w-0">
        <span className={cn('block font-semibold', editable ? 'text-ink' : 'text-ink-muted')}>
          {title}
          {tag && (
            <Badge tone={tagTone} className="ml-1.5 align-middle">
              {tag}
            </Badge>
          )}
        </span>
        <span className="block text-caption text-ink-muted">{help}</span>
      </span>
    </button>
  );
}

/** The line at the top of settings a guest can see but not change. */
export function HostOnlyNote({ className }: { className?: string }) {
  return (
    <p className={cn('text-caption text-ink-muted', className)}>Only the host can change these.</p>
  );
}
