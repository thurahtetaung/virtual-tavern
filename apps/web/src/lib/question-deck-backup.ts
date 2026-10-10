import type { QuestionDeckDetail } from '@vt/protocol';
import { slugify, uniqueSlugs, zipTextFiles } from './word-list-backup.ts';

/** A deck as it goes into a backup. */
export type BackupDeck = Pick<
  QuestionDeckDetail,
  'name' | 'description' | 'games' | 'enabled' | 'questions'
>;

/** `manifest.json` in the zip; the same layout `scripts/import-question-decks.mjs` reads. */
export interface DeckBackupManifest {
  decks: Record<string, Pick<BackupDeck, 'name' | 'description' | 'games' | 'enabled'>>;
}

/** A deck file: `{ name, description, questions }`, pretty-printed with a final newline. */
export const deckJson = (deck: Pick<BackupDeck, 'name' | 'description' | 'questions'>) =>
  `${JSON.stringify(
    { name: deck.name, description: deck.description, questions: deck.questions },
    null,
    2,
  )}\n`;

/** The backup's files by path: `manifest.json` plus one `<slug>.json` per deck. */
export function deckBackupFiles(decks: readonly BackupDeck[]): Record<string, string> {
  const slugs = uniqueSlugs(decks.map((d) => d.name));
  const manifest: DeckBackupManifest = { decks: {} };
  const files: Record<string, string> = {};
  decks.forEach((d, i) => {
    const slug = slugs[i]!;
    manifest.decks[slug] = {
      name: d.name,
      description: d.description,
      games: d.games,
      enabled: d.enabled,
    };
    files[`${slug}.json`] = deckJson(d);
  });
  return { 'manifest.json': `${JSON.stringify(manifest, null, 2)}\n`, ...files };
}

/** Zips every deck. */
export const deckBackupZip = (decks: readonly BackupDeck[]): Promise<Blob> =>
  zipTextFiles(deckBackupFiles(decks));

/** A single deck as `<slug>.json`. */
export const deckFile = (deck: Pick<BackupDeck, 'name' | 'description' | 'questions'>) => ({
  name: `${slugify(deck.name)}.json`,
  blob: new Blob([deckJson(deck)], { type: 'application/json' }),
});
