/**
 * A deep copy of plain JSON-like data: objects, arrays and primitives (`undefined` values kept).
 * Game state is plain data, and this copies it about five times faster than `structuredClone`,
 * which matters because `reduce` copies the state on every move and `view` copies parts of it for
 * every viewer.
 */
export function clone<T>(value: T): T {
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) {
    const out = new Array<unknown>(value.length);
    for (let i = 0; i < value.length; i++) out[i] = clone(value[i] as unknown);
    return out as T;
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    const v = clone((value as Record<string, unknown>)[key]);
    // Assigning `__proto__` would set the copy's prototype instead of copying the key.
    if (key === '__proto__')
      Object.defineProperty(out, key, {
        value: v,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    else out[key] = v;
  }
  return out as T;
}
