/** A logbook text's paragraphs (split at blank lines), each keeping its single line breaks. */
export const paragraphsOf = (text: string): string[] =>
  text
    .replace(/\r\n?/g, '\n')
    .split(/\n[^\S\n]*\n\s*/)
    .map((p) => p.trim())
    .filter(Boolean);
