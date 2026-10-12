import { storageKey } from '@vt/game-sdk';
import { useCallback, useEffect, useState } from 'react';

// Per-browser conveniences only: private suspicion marks and dismissed tips. Storage can be
// missing or blocked (private windows), so every access is guarded and the game works without it.

export type Suspicion = 'trust' | 'doubt';
export type Suspicions = Record<string, Suspicion>;

// Per seat in a playtest, so each seat tab keeps its own marks and tips.
const marksPrefix = () => `${storageKey('vt.round-table.marks')}.`;
const tipsKey = () => storageKey('vt.round-table.tips');

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked: the marks just don't survive a reload.
  }
}

function loadMarks(key: string): Suspicions {
  const raw = read<unknown>(marksPrefix() + key, {});
  if (!raw || typeof raw !== 'object') return {};
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      (e): e is [string, Suspicion] => e[1] === 'trust' || e[1] === 'doubt',
    ),
  );
}

function saveMarks(key: string, marks: Suspicions) {
  const MARKS = marksPrefix();
  try {
    // Only this game's marks are worth keeping.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(MARKS) && k !== MARKS + key) localStorage.removeItem(k);
    }
  } catch {
    // Ignore: nothing to tidy.
  }
  write(MARKS + key, marks);
}

/** The viewer's own ⭐ / ✕ marks on players for one game: none → ⭐ → ✕ → none. */
export function useSuspicions(key: string): [Suspicions, (id: string) => void] {
  const [state, setState] = useState(() => ({ key, marks: loadMarks(key) }));
  const marks = state.key === key ? state.marks : loadMarks(key);
  useEffect(() => {
    if (state.key !== key) setState({ key, marks: loadMarks(key) });
  }, [key, state.key]);
  const cycle = useCallback(
    (id: string) => {
      setState((s) => {
        const next = { ...(s.key === key ? s.marks : loadMarks(key)) };
        const now = next[id];
        if (!now) next[id] = 'trust';
        else if (now === 'trust') next[id] = 'doubt';
        else delete next[id];
        saveMarks(key, next);
        return { key, marks: next };
      });
    },
    [key],
  );
  return [marks, cycle];
}

/** First-time tips: shown until the viewer dismisses them, once per browser. */
export function useTips(): [(id: string) => boolean, (id: string) => void] {
  const [seen, setSeen] = useState<string[]>(() => {
    const list = read<unknown>(tipsKey(), []);
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  });
  const dismiss = useCallback((id: string) => {
    setSeen((s) => {
      const next = s.includes(id) ? s : [...s, id];
      write(tipsKey(), next);
      return next;
    });
  }, []);
  return [(id) => !seen.includes(id), dismiss];
}
