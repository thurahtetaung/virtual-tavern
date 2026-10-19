import type { AdminCategoriesResponse, GameCategoryDef } from '@vt/protocol';
import { MAX_CATEGORY_NAME } from '@vt/protocol';
import { Button, cn } from '@vt/ui';
import { type FormEvent, useEffect, useState } from 'react';
import { api } from '../lib/api.ts';
import { useToast } from '../lib/toast.tsx';
import { AdminSection } from './AdminSection.tsx';

const FIELD =
  'h-11 rounded-lg bg-white px-3 ring-1 ring-stone-300 dark:bg-stone-800 dark:ring-stone-600';

const plural = (n: number, noun: string, many = `${noun}s`) => `${n} ${n === 1 ? noun : many}`;

/**
 * The game categories behind the filter chips: add, rename, re-emoji, order and delete them, and
 * tick each game's. Every change saves at once and answers with the whole list.
 */
export function CategoriesAdmin() {
  const toast = useToast();
  const [data, setData] = useState<AdminCategoriesResponse | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void api<AdminCategoriesResponse>('/api/admin/categories')
      .then(setData)
      .catch((e: Error) => toast(e.message));
  }, [toast]);

  const change = async (method: 'POST' | 'PUT' | 'DELETE', url: string, body?: object) => {
    setBusy(true);
    try {
      setData(await api<AdminCategoriesResponse>(url, { method, body }));
      return true;
    } catch (err) {
      toast((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!data) return null;
  const { categories, games } = data;
  const tagged = games.filter((g) => g.categories.length).length;
  const move = (index: number, by: number) => {
    const ids = categories.map((c) => c.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + by, 0, id!);
    void change('PUT', '/api/admin/categories/order', { ids });
  };
  const tick = (gameId: string, current: readonly string[], id: string) =>
    void change('PUT', `/api/admin/game-categories/${encodeURIComponent(gameId)}`, {
      categories: current.includes(id) ? current.filter((c) => c !== id) : [...current, id],
    });

  return (
    <AdminSection
      id="categories"
      title="🗂️ Game categories"
      label="Game categories"
      summary={
        categories.length
          ? `${plural(categories.length, 'category', 'categories')}, ${plural(tagged, 'game')} tagged`
          : 'No categories yet'
      }
    >
      <p className="text-sm text-stone-600 dark:text-stone-400">
        The filter chips above the game lists. A list only shows the chips its games have, and the
        front room never shows a category only back-room games use.
      </p>

      <h3 className="pt-2 font-bold">Categories</h3>
      {categories.length === 0 ? (
        <p className="text-sm text-ink-muted" data-testid="no-categories">
          No categories yet. Add one below.
        </p>
      ) : (
        <ul className="space-y-2" aria-label="Categories">
          {categories.map((c, i) => (
            <CategoryRow
              key={`${c.id}:${c.name}:${c.emoji}`}
              category={c}
              busy={busy}
              first={i === 0}
              last={i === categories.length - 1}
              onSave={(body) =>
                change('PUT', `/api/admin/categories/${encodeURIComponent(c.id)}`, body)
              }
              onMove={(by) => move(i, by)}
              onDelete={() => {
                const used = games.filter((g) => g.categories.includes(c.id)).length;
                if (
                  window.confirm(
                    `Delete "${c.name}"?${used ? ` It comes off ${plural(used, 'game')}.` : ''}`,
                  )
                )
                  void change('DELETE', `/api/admin/categories/${encodeURIComponent(c.id)}`);
              }}
            />
          ))}
        </ul>
      )}
      <AddCategory busy={busy} onAdd={(body) => change('POST', '/api/admin/categories', body)} />

      {categories.length > 0 && (
        <>
          <h3 className="pt-4 font-bold">Games</h3>
          <ul className="space-y-3">
            {games.map((g) => (
              <li key={g.gameId}>
                <p className="text-sm font-semibold">
                  <span id={`cat-game-${g.gameId}`}>{g.name}</span>
                  {g.private && (
                    <span className="ml-2 text-xs font-normal text-ink-muted">back room</span>
                  )}
                </p>
                <div
                  role="group"
                  aria-labelledby={`cat-game-${g.gameId}`}
                  className="mt-1 flex flex-wrap gap-1.5"
                >
                  {categories.map((c) => {
                    const on = g.categories.includes(c.id);
                    return (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={on}
                        aria-busy={busy || undefined}
                        onClick={() => {
                          if (!busy) tick(g.gameId, g.categories, c.id);
                        }}
                        className={cn(
                          'inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm ring-1 transition',
                          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent dark:focus-visible:outline-amber-500',
                          on
                            ? 'bg-accent font-semibold text-accent-fg ring-accent'
                            : 'bg-card text-ink-muted ring-line-strong hover:bg-accent-soft dark:hover:bg-stone-800',
                        )}
                      >
                        <span aria-hidden>{on ? '✓' : c.emoji}</span>
                        {c.name}
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </AdminSection>
  );
}

function CategoryRow({
  category,
  busy,
  first,
  last,
  onSave,
  onMove,
  onDelete,
}: {
  category: GameCategoryDef;
  busy: boolean;
  first: boolean;
  last: boolean;
  onSave: (body: { name: string; emoji: string }) => Promise<boolean>;
  onMove: (by: number) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(category.name);
  const [emoji, setEmoji] = useState(category.emoji);
  const changed = name.trim() !== category.name || emoji.trim() !== category.emoji;
  const save = (e: FormEvent) => {
    e.preventDefault();
    if (changed) void onSave({ name, emoji });
  };
  return (
    <li>
      <form onSubmit={save} className="flex flex-wrap items-center gap-2">
        <input
          aria-label={`${category.name} emoji`}
          value={emoji}
          maxLength={16}
          onChange={(e) => setEmoji(e.target.value)}
          className={cn(FIELD, 'w-14 text-center text-lg')}
        />
        <input
          aria-label={`${category.name} name`}
          value={name}
          maxLength={MAX_CATEGORY_NAME}
          onChange={(e) => setName(e.target.value)}
          className={cn(FIELD, 'min-w-0 flex-1 basis-24')}
        />
        <span className="flex gap-1">
          {changed && (
            <Button
              type="submit"
              size="sm"
              className="min-h-11"
              aria-label={`Save ${category.name}`}
              disabled={busy}
            >
              Save
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 min-w-11 px-0"
            aria-label={`Move ${category.name} up`}
            disabled={first || busy}
            onClick={() => onMove(-1)}
          >
            ↑
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 min-w-11 px-0"
            aria-label={`Move ${category.name} down`}
            disabled={last || busy}
            onClick={() => onMove(1)}
          >
            ↓
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="min-h-11 min-w-11 px-0"
            aria-label={`Delete ${category.name}`}
            disabled={busy}
            onClick={onDelete}
          >
            ✕
          </Button>
        </span>
      </form>
    </li>
  );
}

function AddCategory({
  busy,
  onAdd,
}: {
  busy: boolean;
  onAdd: (body: { name: string; emoji: string }) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const add = async (e: FormEvent) => {
    e.preventDefault();
    if (await onAdd({ name, emoji })) {
      setName('');
      setEmoji('');
    }
  };
  return (
    <form onSubmit={(e) => void add(e)} className="flex flex-wrap items-center gap-2 pt-1">
      <input
        aria-label="New category emoji"
        placeholder="🎲"
        value={emoji}
        maxLength={16}
        onChange={(e) => setEmoji(e.target.value)}
        className={cn(FIELD, 'w-14 text-center text-lg')}
      />
      <input
        aria-label="New category name"
        placeholder="New category"
        value={name}
        maxLength={MAX_CATEGORY_NAME}
        onChange={(e) => setName(e.target.value)}
        className={cn(FIELD, 'min-w-0 flex-1 basis-32')}
      />
      <Button
        type="submit"
        size="sm"
        className="min-h-11"
        disabled={!name.trim() || !emoji.trim() || busy}
      >
        Add
      </Button>
    </form>
  );
}
