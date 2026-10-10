import { MAX_NAME_LENGTH } from '@vt/protocol';
import { Button } from '@vt/ui';
import { type FormEvent, useState } from 'react';

export function NameForm({
  initial = '',
  submitLabel,
  onSubmit,
}: {
  initial?: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(initial);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) onSubmit(name.trim());
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
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
        className="h-12 flex-1 rounded-lg bg-white px-4 text-lg ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600"
      />
      <Button type="submit" size="lg" disabled={!name.trim()}>
        {submitLabel}
      </Button>
    </form>
  );
}
