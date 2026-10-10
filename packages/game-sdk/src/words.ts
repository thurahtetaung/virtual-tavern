/** Combined word pool: trimmed, blanks dropped, case-insensitive duplicates removed (first spelling wins). */
export function wordPool(words: readonly string[]): string[] {
  const seen = new Set<string>();
  const pool: string[] = [];
  for (const raw of words) {
    const word = raw.trim();
    const key = word.toLocaleLowerCase('en');
    if (word && !seen.has(key)) {
      seen.add(key);
      pool.push(word);
    }
  }
  return pool;
}
