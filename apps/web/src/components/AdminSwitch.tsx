import { Switch } from '@vt/ui';

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
    <Switch
      compact
      on={checked}
      editable
      busy={busy}
      title={aria['aria-label'] ?? 'Enabled'}
      help=""
      id={aria.id}
      describedBy={aria['aria-describedby']}
      onChange={(on) => {
        if (!busy) onChange(on);
      }}
    />
  );
}
