import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { openDb } from './db/index.ts';
import { MIGRATIONS } from './test/helpers.ts';
import { WordListRepo, normalizeWords } from './word-lists.ts';
import { MAX_PACK_WORD_LENGTH, type WordPack, loadWordPacks } from './word-packs.ts';

const REPO_PACKS = fileURLToPath(new URL('../word-packs', import.meta.url));
const words = (n: number, prefix = 'w') => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

describe('loadWordPacks', () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));
  const folder = (files: Record<string, unknown>) => {
    const dir = mkdtempSync(join(tmpdir(), 'vt-packs-'));
    dirs.push(dir);
    for (const [name, body] of Object.entries(files))
      writeFileSync(join(dir, name), JSON.stringify(body));
    return dir;
  };

  it('loads valid packs sorted by file name', () => {
    const dir = folder({
      'b-pack.json': { slug: 'b-pack', name: 'B', description: '', words: words(30) },
      'a-pack.json': { slug: 'a-pack', name: 'A', description: 'x', words: words(30) },
      'notes.txt': 'ignored',
    });
    expect(loadWordPacks(dir).map((p) => p.slug)).toEqual(['a-pack', 'b-pack']);
  });

  it.each([
    ['too few words', { slug: 'x', name: 'X', description: '', words: words(10) }],
    [
      'a long word',
      { slug: 'x', name: 'X', description: '', words: [...words(30), 'x'.repeat(21)] },
    ],
    ['a bad slug', { slug: 'X Y', name: 'X', description: '', words: words(30) }],
  ])('rejects %s', (_, body) => {
    expect(() => loadWordPacks(folder({ 'x.json': body }))).toThrow(/Invalid word pack/);
  });

  it('requires the file name to match the slug and names to be unique', () => {
    expect(() =>
      loadWordPacks(
        folder({ 'y.json': { slug: 'x', name: 'X', description: '', words: words(30) } }),
      ),
    ).toThrow(/named after its slug/);
    expect(() =>
      loadWordPacks(
        folder({
          'a.json': { slug: 'a', name: 'Same', description: '', words: words(30) },
          'b.json': { slug: 'b', name: 'Same', description: '', words: words(30) },
        }),
      ),
    ).toThrow(/Duplicate word pack name/);
  });
});

describe('WordListRepo.seedPacks', () => {
  const pack = (slug: string, name: string): WordPack => ({
    slug,
    name,
    description: '',
    words: words(30, slug),
  });

  function repo() {
    const r = new WordListRepo(openDb(':memory:', MIGRATIONS));
    r.seedIfEmpty();
    return r;
  }

  it('adds each pack once and keeps the starter list as the default', () => {
    const r = repo();
    expect(r.seedPacks([pack('after-dark', 'After Dark'), pack('movies', 'Movies')])).toEqual([
      'after-dark',
      'movies',
    ]);
    expect(r.seedPacks([pack('after-dark', 'After Dark'), pack('movies', 'Movies')])).toEqual([]);
    expect(r.list().map((l) => l.name)).toEqual(['After Dark', 'Movies', 'Starter']);
    expect(r.wordLists()[0]?.name).toBe('Starter');
  });

  it('never re-adds a pack an admin deleted, and leaves edits alone', () => {
    const r = repo();
    r.seedPacks([pack('movies', 'Movies'), pack('tv', 'TV')]);
    const [movies, tv] = ['Movies', 'TV'].map((n) => r.list().find((l) => l.name === n)!);
    r.delete(movies!.id);
    r.update(tv!.id, { name: 'Telly', description: '', words: words(25, 'edited') });
    expect(
      r.seedPacks([pack('movies', 'Movies'), pack('tv', 'TV'), pack('anime', 'Anime')]),
    ).toEqual(['anime']);
    expect(r.list().map((l) => l.name)).toEqual(['Anime', 'Starter', 'Telly']);
  });
});

describe('built-in word packs', () => {
  const packs = loadWordPacks(REPO_PACKS);

  it('ship at least one pack', () => {
    expect(packs.length).toBeGreaterThan(0);
  });

  it.each(packs.map((p) => [p.slug, p] as const))('%s is clean and big enough to play', (_, p) => {
    const unique = normalizeWords(p.words);
    expect(unique).toHaveLength(p.words.length); // no duplicates, even case-insensitively
    expect(unique.length).toBeGreaterThanOrEqual(100);
    for (const w of p.words) {
      expect(w).toBe(w.trim());
      expect(w.length).toBeLessThanOrEqual(MAX_PACK_WORD_LENGTH);
    }
    expect(p.description.length).toBeGreaterThan(0);
  });
});
