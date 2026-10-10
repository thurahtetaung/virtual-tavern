import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  type BackupList,
  backupFileName,
  backupFiles,
  backupZip,
  listFile,
  listText,
  slugify,
  uniqueSlugs,
} from './word-list-backup.ts';

const list = (name: string, words: string[], extra: Partial<BackupList> = {}): BackupList => ({
  name,
  description: '',
  games: ['codenames'],
  enabled: true,
  words,
  ...extra,
});

describe('word-list backup', () => {
  it('slugs names: lowercase, non-alphanumerics to "-", trimmed', () => {
    expect(slugify('Science & Space')).toBe('science-space');
    expect(slugify('  --Pets!! ')).toBe('pets');
    expect(slugify('Café 2.0')).toBe('caf-2-0');
    expect(slugify('***')).toBe('list');
  });

  it('de-duplicates slugs with -2, -3, skipping ones already taken', () => {
    expect(uniqueSlugs(['Pets', 'pets!', 'PETS', 'Other'])).toEqual([
      'pets',
      'pets-2',
      'pets-3',
      'other',
    ]);
    expect(uniqueSlugs(['A 2', 'A', 'a'])).toEqual(['a-2', 'a', 'a-3']);
  });

  it('writes one word per line with a trailing newline', () => {
    expect(listText(['Dog', 'Cat'])).toBe('Dog\nCat\n');
    expect(listText([])).toBe('');
  });

  it('builds a manifest plus one text file per list, disabled lists included', () => {
    const files = backupFiles([
      list('Pets', ['Dog', 'Cat'], { description: 'Furry', games: ['enigma', 'codenames'] }),
      list('pets', ['Fish'], { enabled: false }),
    ]);
    expect(Object.keys(files)).toEqual(['manifest.json', 'pets.txt', 'pets-2.txt']);
    expect(JSON.parse(files['manifest.json']!)).toEqual({
      lists: {
        pets: { name: 'Pets', description: 'Furry', games: ['enigma', 'codenames'], enabled: true },
        'pets-2': { name: 'pets', description: '', games: ['codenames'], enabled: false },
      },
    });
    expect(files['pets.txt']).toBe('Dog\nCat\n');
    expect(files['pets-2.txt']).toBe('Fish\n');
  });

  it('names the zip by local date and zips every file', async () => {
    expect(backupFileName(new Date(2026, 0, 5, 23, 59))).toBe(
      'virtual-tavern-word-lists-2026-01-05.zip',
    );
    const zip = await backupZip([list('Pets', ['Dog'])]);
    const files = unzipSync(new Uint8Array(await zip.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['manifest.json', 'pets.txt']);
    expect(strFromU8(files['pets.txt']!)).toBe('Dog\n');
  });

  it('saves a single list as <slug>.txt', async () => {
    const file = listFile({ name: 'Science & Space', words: ['Moon', 'Mars'] });
    expect(file.name).toBe('science-space.txt');
    expect(await file.blob.text()).toBe('Moon\nMars\n');
  });
});
