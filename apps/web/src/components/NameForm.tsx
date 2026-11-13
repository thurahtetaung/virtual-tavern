import { MAX_NAME_LENGTH } from '@vt/protocol';
import { Button } from '@vt/ui';
import { type FormEvent, useState } from 'react';

export function NameForm({
  initial = '',
  submitLabel,
  onSubmit,
  id,
}: {
  initial?: string;
  /** The form's own button; without one, a button elsewhere submits it through `id`. */
  submitLabel?: string;
  onSubmit: (name: string) => void;
  id?: string;
}) {
  const [name, setName] = useState(initial);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) onSubmit(name.trim());
  };
  return (
    <form id={id} onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
      <label className="sr-only" htmlFor="player-name">
        Your name
      </label>
      <input
        id="player-name"
        autoFocus
        value={name}
        maxLength={MAX_NAME_LENGTH}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your name"
        autoComplete="nickname"
        className="h-12 min-w-0 rounded-lg sm:flex-1 bg-card px-4 text-lg ring-1 ring-line-strong"
      />
      {submitLabel && (
        <Button type="submit" size="lg" disabled={!name.trim()}>
          {submitLabel}
        </Button>
      )}
    </form>
  );
}
