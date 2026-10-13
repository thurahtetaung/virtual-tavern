import { useMemo, useState } from 'react';
import { cn } from './cn.ts';
import { Badge, Button } from './components.tsx';
import { Modal } from './modal.tsx';

export interface Choice {
  id: string;
  name: string;
  description?: string;
  /** Items in this choice (words, cards…); shown as a badge and summed in the footer. */
  count: number;
}

export interface ChoicePickerLabels {
  /** Section heading and modal title, e.g. "Word lists". */
  title: string;
  /** What the counts are, e.g. "words" or "cards". */
  unit: string;
  /** One choice, e.g. "list"; pluralised by adding "s". */
  noun: string;
  /** Button that opens the picker. */
  change: string;
  /** Line under the heading, given the chosen items and their total. */
  summary: (chosen: Choice[], total: number) => string;
}

interface Props {
  selectedIds: string[];
  choices: Choice[];
  editable: boolean;
  labels: ChoicePickerLabels;
  /** Persist the new selection; resolve true on success to close the picker. */
  onSave: (ids: string[]) => Promise<boolean>;
}

/**
 * Compact summary of the chosen entries (as chips) with a searchable, scrollable modal for the
 * host to change them. Used for word lists and card sets.
 */
export function ChoicePicker({ selectedIds, choices, editable, labels, onSave }: Props) {
  const [picking, setPicking] = useState(false);
  // Saved ids missing from `choices` (a list since deleted or switched off) are ignored
  // everywhere: no chip, no count, and the picker starts without them.
  const chosen = choices.filter((c) => selectedIds.includes(c.id));
  const total = chosen.reduce((n, c) => n + c.count, 0);

  return (
    <section aria-label={labels.title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold">{labels.title}</h4>
          <p className="text-xs text-stone-500 dark:text-stone-400">
            {labels.summary(chosen, total)}
          </p>
        </div>
        {editable && (
          <Button
            variant="secondary"
            size="sm"
            className="min-h-11 sm:min-h-0"
            onClick={() => setPicking(true)}
          >
            {labels.change}
          </Button>
        )}
      </div>
      <ul className="mt-2 flex flex-wrap gap-2">
        {chosen.map((c) => (
          <li
            key={c.id}
            title={c.description}
            className="rounded-lg bg-accent-soft px-3 py-1.5 text-sm ring-1 ring-accent-line dark:bg-amber-500/10 dark:ring-amber-500/40"
          >
            <span className="font-medium">{c.name}</span>{' '}
            <span className="text-xs text-stone-500 dark:text-stone-400">· {c.count}</span>
            {c.description && (
              <span className="block text-xs text-stone-500 dark:text-stone-400">
                {c.description}
              </span>
            )}
          </li>
        ))}
        {chosen.length === 0 && (
          <li className="text-sm text-stone-500 italic dark:text-stone-400">Nothing chosen yet.</li>
        )}
      </ul>
      {editable && picking && (
        <Picker
          choices={choices}
          initial={selectedIds.filter((id) => chosen.some((c) => c.id === id))}
          labels={labels}
          onClose={() => setPicking(false)}
          onSave={async (ids) => {
            if (await onSave(ids)) setPicking(false);
          }}
        />
      )}
    </section>
  );
}

function Picker({
  choices,
  initial,
  labels,
  onClose,
  onSave,
}: {
  choices: Choice[];
  initial: string[];
  labels: ChoicePickerLabels;
  onClose: () => void;
  onSave: (ids: string[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => new Set(initial));
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Already-chosen entries come first, so the current picks are easy to find.
    const ordered = [
      ...choices.filter((c) => initial.includes(c.id)),
      ...choices.filter((c) => !initial.includes(c.id)),
    ];
    return q
      ? ordered.filter((c) => `${c.name} ${c.description ?? ''}`.toLowerCase().includes(q))
      : ordered;
  }, [query, choices, initial]);
  const total = choices.filter((c) => draft.has(c.id)).reduce((n, c) => n + c.count, 0);

  const toggle = (id: string) =>
    setDraft((d) => {
      const next = new Set(d);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Keep the host's original ordering for unchanged picks; append new ones in list order.
  const save = async () => {
    setSaving(true);
    const ids = [
      ...initial.filter((id) => draft.has(id)),
      ...choices.map((c) => c.id).filter((id) => draft.has(id) && !initial.includes(id)),
    ];
    await onSave(ids);
    setSaving(false);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Choose ${labels.title.toLowerCase()}`}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-stone-600 dark:text-stone-400">
            {draft.size === 0 ? (
              <span className="text-rose-600">Pick at least one {labels.noun}</span>
            ) : (
              <>
                <b>{draft.size}</b> {labels.noun}
                {draft.size === 1 ? '' : 's'} · <b>{total}</b> {labels.unit}
              </>
            )}
          </span>
          <span className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={draft.size === 0 || saving}>
              Save
            </Button>
          </span>
        </div>
      }
    >
      <input
        type="search"
        data-autofocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search…"
        aria-label={`Search ${labels.title.toLowerCase()}`}
        className="mb-3 h-10 w-full rounded-lg bg-card px-3 ring-1 ring-line-strong dark:bg-stone-800 dark:ring-stone-600"
      />
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {shown.map((c) => {
          const on = draft.has(c.id);
          return (
            <li key={c.id}>
              <label
                className={cn(
                  'flex h-full cursor-pointer items-start gap-2 rounded-lg px-3 py-2 ring-1 transition',
                  on
                    ? 'bg-accent-soft ring-accent-line dark:bg-amber-500/10 dark:ring-amber-500/40'
                    : 'ring-line hover:bg-panel dark:ring-stone-700 dark:hover:bg-stone-800',
                )}
              >
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-amber-600"
                  checked={on}
                  onChange={() => toggle(c.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{c.name}</span>
                    <Badge className="shrink-0">{c.count}</Badge>
                  </span>
                  {c.description && (
                    <span className="block text-xs text-stone-500 dark:text-stone-400">
                      {c.description}
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="text-sm text-stone-500 italic dark:text-stone-400">
            Nothing matches “{query}”.
          </li>
        )}
      </ul>
    </Modal>
  );
}
