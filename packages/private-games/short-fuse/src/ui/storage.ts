import { storageKey } from '@vt/game-sdk';
import { useCallback, useState } from 'react';

// Per-browser conveniences only: dismissed tips and the sound switch. Storage can be missing or
// blocked (private windows), so every access is guarded and the game works without it.

const keyOf = (name: string) => storageKey(`vt.short-fuse.${name}`);

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

/** First-time tips: whether one is still fresh, and a way to dismiss it for good. */
export function useTips(): [(id: string) => boolean, (id: string) => void] {
  const key = keyOf('tips');
  const [seen, setSeen] = useState<string[]>(() => read<string[]>(key, []));
  const fresh = useCallback((id: string) => !seen.includes(id), [seen]);
  const dismiss = useCallback(
    (id: string) =>
      setSeen((s) => {
        const next = [...new Set([...s, id])];
        write(key, next);
        return next;
      }),
    [key],
  );
  return [fresh, dismiss];
}
