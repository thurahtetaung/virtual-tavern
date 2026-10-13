import { storageKey } from '@vt/game-sdk';
import { useCallback, useEffect, useState } from 'react';

// Per-browser conveniences only: private suspicion marks, notes, dismissed tips and the sound
// switch. Storage can be missing or blocked (private windows), so every access is guarded and the
// game works without it.

export type Suspicion = 'trust' | 'doubt';
export type Suspicions = Record<string, Suspicion>;
export type Notes = Record<string, string>;

/** `vt.hydra.<name>`, per seat in a playtest (`storageKey`). */
const keyOf = (name: string) => storageKey(`vt.hydra.${name}`);

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
    // Storage blocked: it just doesn't survive a reload.
  }
}

/** Keeps only this game's entries under `prefix` (marks and notes are per game). */
function tidy(prefix: string, keep: string) {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k?.startsWith(prefix) && k !== keep) localStorage.removeItem(k);
    }
  } catch {
    // Nothing to tidy.
  }
}

function usePerGame<T extends Record<string, unknown>>(kind: string, key: string) {
  const prefix = `${keyOf(kind)}.`;
  const full = prefix + key;
  const load = useCallback(() => {
    const raw = read<unknown>(full, {});
    return (raw && typeof raw === 'object' ? raw : {}) as T;
  }, [full]);
  const [state, setState] = useState(() => ({ key, value: load() }));
  const value = state.key === key ? state.value : load();
  useEffect(() => {
    if (state.key !== key) setState({ key, value: load() });
  }, [key, state.key, load]);
  const update = useCallback(
    (fn: (v: T) => T) => {
      setState((s) => {
        const next = fn(s.key === key ? s.value : load());
        tidy(prefix, full);
        write(full, next);
        return { key, value: next };
      });
    },
    [prefix, full, key, load],
  );
  return [value, update] as const;
}

/** The viewer's own ⭐ / ✕ marks for one game: none → ⭐ → ✕ → none. */
export function useSuspicions(key: string): [Suspicions, (id: string) => void] {
  const [marks, update] = usePerGame<Suspicions>('marks', key);
  const cycle = useCallback(
    (id: string) =>
      update((m) => {
        const next = { ...m };
        if (!next[id]) next[id] = 'trust';
        else if (next[id] === 'trust') next[id] = 'doubt';
        else delete next[id];
        return next;
      }),
    [update],
  );
  return [marks, cycle];
}

/** The viewer's own notes on players for one game. */
export function useNotes(key: string): [Notes, (id: string, text: string) => void] {
  const [notes, update] = usePerGame<Notes>('notes', key);
  const set = useCallback(
    (id: string, text: string) => update((n) => ({ ...n, [id]: text.slice(0, 280) })),
    [update],
  );
  return [notes, set];
}

/** First-time tips: shown until the viewer dismisses them, once per browser. */
export function useTips(): [(id: string) => boolean, (id: string) => void] {
  const [seen, setSeen] = useState<string[]>(() => {
    const list = read<unknown>(keyOf('tips'), []);
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  });
  const dismiss = useCallback((id: string) => {
    setSeen((s) => {
      const next = s.includes(id) ? s : [...s, id];
      write(keyOf('tips'), next);
      return next;
    });
  }, []);
  return [(id) => !seen.includes(id), dismiss];
}

/** Sound effects: off unless the viewer turns them on. */
export function useSoundSetting(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => read<boolean>(keyOf('sound'), false) === true);
  const set = useCallback((v: boolean) => {
    setOn(v);
    write(keyOf('sound'), v);
  }, []);
  return [on, set];
}

/** The big moments (vote reveals, enactments): on unless the viewer turns them off. */
export function useMomentsSetting(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => read<boolean>(keyOf('moments'), true) !== false);
  const set = useCallback((v: boolean) => {
    setOn(v);
    write(keyOf('moments'), v);
  }, []);
  return [on, set];
}

/** "Plain headings": the edition's display font off, for this viewer. Off unless they switch it on. */
export function usePlainHeadings(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => read<boolean>(keyOf('plain-headings'), false) === true);
  const set = useCallback((v: boolean) => {
    setOn(v);
    write(keyOf('plain-headings'), v);
  }, []);
  return [on, set];
}
