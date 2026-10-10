import type { WordListDetail } from '@vt/protocol';

/** A list as it goes into a backup. */
export type BackupList = Pick<
  WordListDetail,
  'name' | 'description' | 'games' | 'enabled' | 'words'
>;

/** `manifest.json` in the zip; the same layout `scripts/import-word-lists.mjs` reads. */
export interface BackupManifest {
  lists: Record<string, Pick<BackupList, 'name' | 'description' | 'games' | 'enabled'>>;
}

/** Lowercase, every run of non-alphanumerics becomes "-", trimmed of dashes ("list" if empty). */
export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'list'
  );
}

/** One slug per name, in order; repeats get "-2", "-3"… (skipping any already taken). */
export function uniqueSlugs(names: readonly string[]): string[] {
  const taken = new Set<string>();
  return names.map((name) => {
    const base = slugify(name);
    let slug = base;
    for (let n = 2; taken.has(slug); n++) slug = `${base}-${n}`;
    taken.add(slug);
    return slug;
  });
}

/** One word per line, each line ending in a newline. */
export const listText = (words: readonly string[]) => words.map((w) => `${w}\n`).join('');

/** The backup's files by path: `manifest.json` plus one `<slug>.txt` per list. */
export function backupFiles(lists: readonly BackupList[]): Record<string, string> {
  const slugs = uniqueSlugs(lists.map((l) => l.name));
  const manifest: BackupManifest = { lists: {} };
  const files: Record<string, string> = {};
  lists.forEach((l, i) => {
    const slug = slugs[i]!;
    manifest.lists[slug] = {
      name: l.name,
      description: l.description,
      games: l.games,
      enabled: l.enabled,
    };
    files[`${slug}.txt`] = listText(l.words);
  });
  return { 'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`, ...files };
}

/** `virtual-tavern-word-lists-YYYY-MM-DD.zip`, in local time. */
export function backupFileName(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `virtual-tavern-word-lists-${day}.zip`;
}

/** Zips the backup. fflate is loaded on first use, so it stays out of the main bundle. */
export async function backupZip(lists: readonly BackupList[]): Promise<Blob> {
  const { strToU8, zipSync } = await import('fflate');
  const entries = Object.fromEntries(
    Object.entries(backupFiles(lists)).map(([path, text]) => [path, strToU8(text)]),
  );
  return new Blob([zipSync(entries)], { type: 'application/zip' });
}

/** A single list as `<slug>.txt`. */
export const listFile = (list: Pick<BackupList, 'name' | 'words'>) => ({
  name: `${slugify(list.name)}.txt`,
  blob: new Blob([listText(list.words)], { type: 'text/plain' }),
});

/** Hands `blob` to the browser as a download named `name`. */
export function saveFile(blob: Blob, name: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  // Revoke after the click has been handled, so the download has started.
  setTimeout(() => URL.revokeObjectURL(a.href), 0);
}
