import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import {
  type BackupDeck,
  deckBackupFiles,
  deckBackupZip,
  deckFile,
} from './question-deck-backup.ts';
import { backupFileName } from './word-list-backup.ts';

// Made-up questions only: real decks are private and never committed.
const deck = (name: string, extra: Partial<BackupDeck> = {}): BackupDeck => ({
  name,
  description: '',
  games: ['hoodwink'],
  enabled: true,
  questions: [
    { prompt: `${name} is ___.`, answer: 'x', alternates: [], sources: [], adult: false, tags: [] },
  ],
  ...extra,
});

describe('question-deck backup', () => {
  it('builds a manifest plus one JSON file per deck, disabled decks included', () => {
    const files = deckBackupFiles([
      deck('Odd Facts', { description: 'Strange' }),
      deck('odd facts', { enabled: false, games: ['hoodwink', 'quiz'] }),
    ]);
    expect(Object.keys(files)).toEqual(['manifest.json', 'odd-facts.json', 'odd-facts-2.json']);
    expect(JSON.parse(files['manifest.json']!)).toEqual({
      decks: {
        'odd-facts': {
          name: 'Odd Facts',
          description: 'Strange',
          games: ['hoodwink'],
          enabled: true,
        },
        'odd-facts-2': {
          name: 'odd facts',
          description: '',
          games: ['hoodwink', 'quiz'],
          enabled: false,
        },
      },
    });
    expect(JSON.parse(files['odd-facts.json']!)).toEqual({
      name: 'Odd Facts',
      description: 'Strange',
      questions: deck('Odd Facts').questions,
    });
    expect(files['odd-facts.json']!.endsWith('}\n')).toBe(true);
  });

  it('zips the files and names single decks after their slug', async () => {
    const zip = unzipSync(new Uint8Array(await (await deckBackupZip([deck('A b')])).arrayBuffer()));
    expect(Object.keys(zip).sort()).toEqual(['a-b.json', 'manifest.json']);
    expect(JSON.parse(strFromU8(zip['a-b.json']!))).toMatchObject({ name: 'A b' });
    const file = deckFile(deck('Late Night!'));
    expect(file.name).toBe('late-night.json');
    expect(JSON.parse(await file.blob.text())).toMatchObject({ name: 'Late Night!' });
    expect(backupFileName(new Date(2026, 0, 2), 'question-decks')).toBe(
      'virtual-tavern-question-decks-2026-01-02.zip',
    );
  });
});
