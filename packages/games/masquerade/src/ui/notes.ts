import { useCallback, useEffect, useState } from 'react';

export type Mark = 'crossed' | 'starred';
export type Marks = Record<string, Mark>;

const PREFIX = 'vt.masquerade.board.';

function load(key: string): Marks {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object') return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        (e): e is [string, Mark] => e[1] === 'crossed' || e[1] === 'starred',
      ),
    );
  } catch {
    return {};
  }
}

function save(key: string, marks: Marks) {
  try {
    // Only the current deal's notes are worth keeping.
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX) && k !== PREFIX + key) localStorage.removeItem(k);
    }
    localStorage.setItem(PREFIX + key, JSON.stringify(marks));
  } catch {
    // Private mode or storage blocked: the marks just don't survive a reload.
  }
}

/** The viewer's own crossed-off and starred locations for one deal, kept in this browser. */
export function useMarks(key: string): [Marks, (id: string, mark: Mark) => void] {
  const [state, setState] = useState(() => ({ key, marks: load(key) }));
  const marks = state.key === key ? state.marks : load(key);
  useEffect(() => {
    if (state.key !== key) setState({ key, marks: load(key) });
  }, [key, state.key]);
  const toggle = useCallback(
    (id: string, mark: Mark) => {
      setState((s) => {
        const current = s.key === key ? s.marks : load(key);
        const next = { ...current };
        if (next[id] === mark) delete next[id];
        else next[id] = mark;
        save(key, next);
        return { key, marks: next };
      });
    },
    [key],
  );
  return [marks, toggle];
}
