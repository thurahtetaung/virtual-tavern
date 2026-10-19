import type { GameCategory } from '@vt/protocol';
import { useCallback, useMemo, useState } from 'react';

/** The chips a list offers: every category at least one of its games has, in the admin's order. */
export function chipsOf(
  games: readonly { categories?: readonly GameCategory[] }[],
): GameCategory[] {
  const seen = new Map<string, GameCategory>();
  for (const g of games) for (const c of g.categories ?? []) if (!seen.has(c.id)) seen.set(c.id, c);
  return [...seen.values()].sort((a, b) => a.order - b.order);
}

/** Whether a game shows under the chosen chips: none chosen shows all, else it needs every one. */
export function shows(chosen: readonly string[], categories: readonly { id: string }[]): boolean {
  return chosen.every((id) => categories.some((c) => c.id === id));
}

function remembered(key: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The chosen category chips of one game list, remembered in this browser under `key`. Chips the
 * list no longer has are ignored.
 */
export function useCategoryFilter(key: string, chips: readonly GameCategory[]) {
  const [stored, setStored] = useState(() => remembered(key));
  const chosen = useMemo(
    () => stored.filter((id) => chips.some((c) => c.id === id)),
    [stored, chips],
  );
  const save = useCallback(
    (next: string[]) => {
      setStored(next);
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Private windows may refuse storage; the filter still works for this visit.
      }
    },
    [key],
  );
  const toggle = useCallback(
    (id: string) => save(chosen.includes(id) ? chosen.filter((c) => c !== id) : [...chosen, id]),
    [chosen, save],
  );
  const clear = useCallback(() => save([]), [save]);
  return { chosen, toggle, clear };
}
