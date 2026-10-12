import { useCallback, useEffect, useState } from 'react';

/** A private deduction mark on a card: ⭐ suspicious or ✕ ruled out in your own head. */
export type Mark = 'star' | 'cross';
export type Marks = Record<string, Mark>;

const PREFIX = 'vt.inquest.marks.';

/** `clue-17` / `means-4`, per suspect so the same card number never collides across decks. */
export const markKey = (deck: 'clue' | 'means', n: number) => `${deck}-${n}`;

function load(key: string): Marks {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (e): e is [string, Mark] => e[1] === 'star' || e[1] === 'cross',
      ),
    );
  } catch {
    return {};
  }
}

function save(key: string, marks: Marks) {
  try {
    // Only this game's marks are worth keeping: a new game starts clean.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX) && k !== PREFIX + key) localStorage.removeItem(k);
    }
    localStorage.setItem(PREFIX + key, JSON.stringify(marks));
  } catch {
    // Storage blocked: marks still work until the page reloads.
  }
}

/** The viewer's own marks for one game (`table.gameNo`), kept in this browser only. */
export function useMarks(key: string): [Marks, (id: string, mark: Mark | null) => void] {
  const [state, setState] = useState(() => ({ key, marks: load(key) }));
  const marks = state.key === key ? state.marks : load(key);
  useEffect(() => {
    if (state.key !== key) setState({ key, marks: load(key) });
  }, [key, state.key]);
  const set = useCallback(
    (id: string, mark: Mark | null) => {
      setState((s) => {
        const next = { ...(s.key === key ? s.marks : load(key)) };
        if (mark === null) delete next[id];
        else next[id] = mark;
        save(key, next);
        return { key, marks: next };
      });
    },
    [key],
  );
  return [marks, set];
}

/** none → ⭐ → ✕ → none: what a long press does. */
export const nextMark = (m: Mark | undefined): Mark | null =>
  m === undefined ? 'star' : m === 'star' ? 'cross' : null;
