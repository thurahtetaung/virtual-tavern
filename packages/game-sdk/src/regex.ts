/**
 * Escapes every character that has a meaning in a regular expression, so the
 * string matches itself literally. The one place the repo escapes for RegExp:
 * ESLint refuses hand-rolled `.replace(/[…]/g, '\\$&')` copies elsewhere.
 */
export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
