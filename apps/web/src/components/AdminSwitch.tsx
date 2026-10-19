import { cn } from '@vt/ui';

/**
 * An on/off switch with a 44 px tap target. Name it with `aria-label`, or with a `<label>`
 * pointing at `id`. While `busy`, taps are ignored (the switch stays focusable).
 */
export function AdminSwitch({
  checked,
  onChange,
  busy = false,
  ...aria
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  busy?: boolean;
  id?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={busy || undefined}
      onClick={() => {
        if (!busy) onChange(!checked);
      }}
      className={cn(
        'inline-flex h-11 min-w-14 shrink-0 items-center justify-center rounded-lg',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-amber-500',
        busy && 'cursor-wait',
      )}
      {...aria}
    >
      <span
        aria-hidden="true"
        className={cn(
          'relative h-6 w-11 rounded-full transition-colors',
          checked ? 'bg-accent dark:bg-amber-500' : 'bg-stone-300 dark:bg-stone-600',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 left-0.5 size-5 rounded-full bg-white shadow-sm transition-transform',
            checked && 'translate-x-5',
          )}
        />
      </span>
    </button>
  );
}
