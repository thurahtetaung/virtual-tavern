/**
 * Structural patches over JSON values: what changed between two room snapshots, so a room update
 * carries only that. Both sides share this file: the server builds patches with `diff`, the
 * browser rebuilds the snapshot with `applyPatch`.
 *
 * A patch is a list of operations, each on a path of object keys and array indexes:
 * - `[0, path, value]` sets the value at `path` (adding a key, or replacing whatever was there);
 * - `[1, path]` deletes the object key at `path`;
 * - `[2, path, start, count, items]` splices the array at `path`: removes `count` items at
 *   `start` and inserts `items` there (an append is a splice at the end).
 * Values are JSON: `diff` expects both sides to come straight from `JSON.parse`.
 */

export type JsonPath = (string | number)[];
export type PatchOp =
  | [op: 0, path: JsonPath, value: unknown]
  | [op: 1, path: JsonPath]
  | [op: 2, path: JsonPath, start: number, count: number, items: unknown[]];
export type Patch = PatchOp[];

/** A patch that doesn't fit the value it is applied to. */
export class PatchError extends Error {}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A key `applyPatch` never writes (it would reach the prototype); objects holding one are replaced whole. */
const unsafeKey = (k: string) => k === '__proto__';

/** Whether two JSON values are equal. */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!jsonEqual(a[i], b[i])) return false;
    return true;
  }
  if (Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) {
    if (!Object.hasOwn(b, k) || !jsonEqual((a as Obj)[k], (b as Obj)[k])) return false;
  }
  return true;
}

const size = (v: unknown) => JSON.stringify(v).length;

/** The operations that turn `a` into `b` (empty when they are equal). */
export function diff(a: unknown, b: unknown): Patch {
  const ops: Patch = [];
  walk(a, b, [], ops);
  return ops;
}

function walk(a: unknown, b: unknown, path: JsonPath, ops: Patch): void {
  if (a === b) return;
  if (Array.isArray(a) && Array.isArray(b)) return smaller(arrayOps(a, b, path), b, path, ops);
  if (isObj(a) && isObj(b)) return smaller(objectOps(a, b, path), b, path, ops);
  if (!jsonEqual(a, b)) ops.push([0, path, b]);
}

/** `found`, or setting the whole value when that is no longer. */
function smaller(found: Patch | null, b: unknown, path: JsonPath, ops: Patch): void {
  if (found === null || (found.length > 1 && size(found) >= size(b) + path.length * 4 + 8)) {
    ops.push([0, path, b]);
    return;
  }
  for (const op of found) ops.push(op);
}

function objectOps(a: Obj, b: Obj, path: JsonPath): Patch | null {
  const ops: Patch = [];
  for (const k of Object.keys(a)) {
    if (unsafeKey(k)) return null;
    if (!Object.hasOwn(b, k)) ops.push([1, [...path, k]]);
  }
  for (const k of Object.keys(b)) {
    if (unsafeKey(k)) return null;
    if (Object.hasOwn(a, k)) walk(a[k], b[k], [...path, k], ops);
    else ops.push([0, [...path, k], b[k]]);
  }
  return ops;
}

/**
 * Arrays: the unchanged ends are kept, and the middle is edited item by item when it kept its
 * length, else spliced. A list that dropped items at the front and grew at the back (a capped
 * log) becomes two splices.
 */
function arrayOps(a: unknown[], b: unknown[], path: JsonPath): Patch {
  let start = 0;
  const min = Math.min(a.length, b.length);
  while (start < min && jsonEqual(a[start], b[start])) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && jsonEqual(a[endA - 1], b[endB - 1])) {
    endA--;
    endB--;
  }
  const ops: Patch = [];
  if (endA === start && endB === start) return ops;
  if (endA - start === endB - start) {
    for (let i = start; i < endA; i++) walk(a[i], b[i], [...path, i], ops);
  } else ops.push([2, path, start, endA - start, b.slice(start, endB)]);
  const shifted = shift(a, b, start)?.(path);
  return shifted && size(shifted) < size(ops) ? shifted : ops;
}

/** `b` is `a` with its first `k` items dropped and new ones added at the end. */
function shift(a: unknown[], b: unknown[], start: number) {
  if (start !== 0 || !b.length) return null;
  for (let k = 1; k < a.length; k++) {
    const kept = a.length - k;
    if (kept > b.length || !jsonEqual(a[k], b[0])) continue;
    let same = true;
    for (let i = 1; i < kept && same; i++) same = jsonEqual(a[k + i], b[i]);
    if (!same) continue;
    return (path: JsonPath): Patch => {
      const ops: Patch = [[2, path, 0, k, []]];
      if (b.length > kept) ops.push([2, path, kept, 0, b.slice(kept)]);
      return ops;
    };
  }
  return null;
}

/**
 * `base` with the patch applied. `base` is never changed: the result shares every part the patch
 * didn't touch with it, so whatever was unchanged keeps its identity. Throws a `PatchError` when
 * the patch doesn't fit `base`.
 */
export function applyPatch<T>(base: T, patch: Patch): T {
  if (!Array.isArray(patch)) throw new PatchError('not a patch');
  // Containers copied by this patch, which later operations may change in place.
  const fresh = new WeakSet<object>();
  const own = (v: unknown): Obj | unknown[] => {
    if (typeof v !== 'object' || v === null) throw new PatchError('no such path');
    if (fresh.has(v)) return v as Obj | unknown[];
    const copy = Array.isArray(v) ? v.slice() : { ...(v as Obj) };
    fresh.add(copy);
    return copy;
  };
  const keyOf = (node: Obj | unknown[], k: unknown): string | number => {
    if (Array.isArray(node)) {
      if (typeof k !== 'number' || !Number.isInteger(k) || k < 0 || k >= node.length)
        throw new PatchError('bad index');
      return k;
    }
    if (typeof k !== 'string' || unsafeKey(k)) throw new PatchError('bad key');
    return k;
  };
  let root: unknown = base;
  for (const op of patch) {
    if (!Array.isArray(op) || !Array.isArray(op[1])) throw new PatchError('bad operation');
    const path = op[1] as unknown[];
    const kind = op[0];
    // The container the operation works in: the target itself for a splice, else its parent.
    const depth = kind === 2 ? path.length : path.length - 1;
    if (depth < 0) {
      if (kind !== 0) throw new PatchError('bad operation');
      root = op[2];
      continue;
    }
    root = own(root);
    let node = root as Obj | unknown[];
    for (let i = 0; i < depth; i++) {
      const k = keyOf(node, path[i]);
      const child = own((node as Obj)[k]);
      (node as Obj)[k] = child;
      node = child;
    }
    if (kind === 2) {
      const [, , start, count, items] = op as [2, JsonPath, unknown, unknown, unknown];
      if (
        !Array.isArray(node) ||
        !Array.isArray(items) ||
        typeof start !== 'number' ||
        typeof count !== 'number' ||
        !Number.isInteger(start) ||
        !Number.isInteger(count) ||
        start < 0 ||
        count < 0 ||
        start + count > node.length
      )
        throw new PatchError('bad splice');
      node.splice(start, count, ...(items as unknown[]));
      continue;
    }
    const last = path[path.length - 1];
    if (kind === 0) {
      if (Array.isArray(node)) node[keyOf(node, last) as number] = op[2];
      else node[keyOf(node, last)] = op[2];
    } else if (kind === 1) {
      const k = keyOf(node, last);
      if (Array.isArray(node) || !Object.hasOwn(node, k)) throw new PatchError('bad delete');
      delete node[k];
    } else throw new PatchError('bad operation');
  }
  return root as T;
}
