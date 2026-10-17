import { useState } from 'react';

/**
 * `next`, but every part that is deep-equal to the same part of `prev` is `prev`'s object. Each
 * room:state is freshly parsed JSON, so without this nothing a game memoises would ever match.
 */
export function keepUnchanged<T>(prev: unknown, next: T): T {
  if (prev === next) return next;
  if (typeof prev !== 'object' || typeof next !== 'object' || prev === null || next === null)
    return next;
  if (Array.isArray(prev) !== Array.isArray(next)) return next;
  const a = prev as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  const keys = Object.keys(b);
  let same = keys.length === Object.keys(a).length;
  let reused = false;
  const out = (Array.isArray(next) ? [] : {}) as Record<string, unknown>;
  for (const k of keys) {
    const v = keepUnchanged(Object.hasOwn(a, k) ? a[k] : undefined, b[k]);
    out[k] = v;
    if (v !== a[k] || !Object.hasOwn(a, k)) same = false;
    else if (typeof v === 'object' && v !== null) reused = true;
  }
  if (same) return prev as T;
  return (reused ? out : next) as T;
}

/** `value`, keeping the unchanged parts of the last value this hook returned. */
export function useUnchanged<T>(value: T): T {
  const [last, setLast] = useState({ raw: value, kept: value });
  if (last.raw === value) return last.kept;
  const next = { raw: value, kept: keepUnchanged(last.kept, value) };
  setLast(next);
  return next.kept;
}
