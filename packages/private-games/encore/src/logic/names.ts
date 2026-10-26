import type { Manifest } from './manifest.ts';

/**
 * The action's word in every form. The code and the plain text say "recruit"; a private manifest
 * may give another word (`names.recruit`, with its other forms derived or given), and every
 * player-facing line is reworded with it when shown.
 */
export interface Words {
  recruit: string;
  recruits: string;
  recruited: string;
  recruiting: string;
}

export const PLAIN_WORDS: Words = {
  recruit: 'recruit',
  recruits: 'recruits',
  recruited: 'recruited',
  recruiting: 'recruiting',
};

const word = (v: unknown) =>
  typeof v === 'string' && /^[\p{L} '-]{2,24}$/u.test(v.trim()) ? v.trim().toLowerCase() : null;

export function wordsOf(m: Manifest | null | undefined): Words {
  const names = m?.names;
  const base = word(names?.recruit);
  if (!base) return PLAIN_WORDS;
  const stem = base.endsWith('e') ? base.slice(0, -1) : base;
  return {
    recruit: base,
    recruits: word(names?.recruits) ?? `${base}s`,
    recruited: word(names?.recruited) ?? `${stem}ed`,
    recruiting: word(names?.recruiting) ?? `${stem}ing`,
  };
}

const FORMS = /\b(recruit)(s|ed|ing)?\b/gi;

const cased = (like: string, w: string) =>
  like === like.toUpperCase() && like.length > 1
    ? w.toUpperCase()
    : like[0] === like[0]!.toUpperCase()
      ? w[0]!.toUpperCase() + w.slice(1)
      : w;

/** A line with the action's word in the manifest's words. */
export function reword(text: string, w: Words): string {
  if (w === PLAIN_WORDS || w.recruit === 'recruit') return text;
  return text.replace(FORMS, (all, _stem: string, end: string | undefined) => {
    const form = end?.toLowerCase();
    const to =
      form === 's'
        ? w.recruits
        : form === 'ed'
          ? w.recruited
          : form === 'ing'
            ? w.recruiting
            : w.recruit;
    return cased(all, to);
  });
}

/** Every string in a value reworded (functions and other values kept as they are). */
export function rewordAll<T>(value: T, w: Words): T {
  if (w === PLAIN_WORDS) return value;
  const walk = (v: unknown): unknown =>
    typeof v === 'string'
      ? reword(v, w)
      : Array.isArray(v)
        ? v.map(walk)
        : v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
          : v;
  return walk(value) as T;
}
