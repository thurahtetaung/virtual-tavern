import type { WordListSummary } from '@vt/game-sdk';
import { useMemo, useState } from 'react';
import { cn } from './cn.ts';
import { Badge, Button } from './components.tsx';
import { Modal } from './modal.tsx';

interface Props {
  selectedIds: string[];
  wordLists: WordListSummary[];
  editable: boolean;
  /** Persist the new selection; resolve true on success to close the picker. */
  onSave: (ids: string[]) => Promise<boolean>;
}

/** Compact summary of the chosen lists; the host changes them in a scrollable picker. */
export function WordListPicker({ selectedIds, wordLists, editable, onSave }: Props) {
  const [picking, setPicking] = useState(false);
  const chosen = wordLists.filter((l) => selectedIds.includes(l.id));
  const total = chosen.reduce((n, l) => n + l.wordCount, 0);

  return (
    <section aria-label="Word lists">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold">Word lists</h4>
          <p className="text-xs text-stone-500">
            The board draws 25 random words from {chosen.length === 1 ? 'this list' : 'these lists'}{' '}
            ({total} words).
          </p>
        </div>
        {editable && (
          <Button variant="secondary" size="sm" onClick={() => setPicking(true)}>
            Change word lists
          </Button>
        )}
      </div>
      <ul className="mt-2 flex flex-wrap gap-2">
        {chosen.map((l) => (
          <li
            key={l.id}
            title={l.description}
            className="rounded-lg bg-amber-50 px-3 py-1.5 text-sm ring-1 ring-amber-300 dark:bg-amber-500/10 dark:ring-amber-500/40"
          >
            <span className="font-medium">{l.name}</span>{' '}
            <span className="text-xs text-stone-500">· {l.wordCount}</span>
            {!editable && l.description && (
              <span className="block text-xs text-stone-500 dark:text-stone-400">
                {l.description}
              </span>
            )}
          </li>
        ))}
        {chosen.length === 0 && (
          <li className="text-sm text-stone-500 italic">No word lists chosen yet.</li>
        )}
      </ul>
      {editable && picking && (
        <Picker
          wordLists={wordLists}
          initial={selectedIds}
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
  wordLists,
  initial,
  onClose,
  onSave,
}: {
  wordLists: WordListSummary[];
  initial: string[];
  onClose: () => void;
  onSave: (ids: string[]) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => new Set(initial));
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Lists that were already chosen come first, so the current picks are easy to find.
    const ordered = [
      ...wordLists.filter((l) => initial.includes(l.id)),
      ...wordLists.filter((l) => !initial.includes(l.id)),
    ];
    return q
      ? ordered.filter((l) => `${l.name} ${l.description ?? ''}`.toLowerCase().includes(q))
      : ordered;
  }, [query, wordLists, initial]);
  const total = wordLists.filter((l) => draft.has(l.id)).reduce((n, l) => n + l.wordCount, 0);

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
      ...wordLists.map((l) => l.id).filter((id) => draft.has(id) && !initial.includes(id)),
    ];
    await onSave(ids);
    setSaving(false);
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Choose word lists"
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm text-stone-600 dark:text-stone-400">
            {draft.size === 0 ? (
              <span className="text-rose-600">Pick at least one list</span>
            ) : (
              <>
                <b>{draft.size}</b> {draft.size === 1 ? 'list' : 'lists'} · <b>{total}</b> words
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
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search lists…"
        aria-label="Search word lists"
        className="mb-3 h-10 w-full rounded-lg bg-white px-3 ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600"
      />
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {shown.map((l) => {
          const on = draft.has(l.id);
          return (
            <li key={l.id}>
              <label
                className={cn(
                  'flex h-full cursor-pointer items-start gap-2 rounded-lg px-3 py-2 ring-1 transition',
                  on
                    ? 'bg-amber-50 ring-amber-300 dark:bg-amber-500/10 dark:ring-amber-500/40'
                    : 'ring-stone-200 hover:bg-stone-100 dark:ring-stone-700 dark:hover:bg-stone-800',
                )}
              >
                <input
                  type="checkbox"
                  className="mt-1 size-4 shrink-0 accent-amber-600"
                  checked={on}
                  onChange={() => toggle(l.id)}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{l.name}</span>
                    <Badge className="shrink-0">{l.wordCount}</Badge>
                  </span>
                  {l.description && (
                    <span className="block text-xs text-stone-500 dark:text-stone-400">
                      {l.description}
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
        {shown.length === 0 && (
          <li className="text-sm text-stone-500 italic">No lists match “{query}”.</li>
        )}
      </ul>
    </Modal>
  );
}
