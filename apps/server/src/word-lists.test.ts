import { describe, expect, it } from 'vitest';
import { openDb } from './db/index.ts';
import { wordLists } from './db/schema.ts';
import { MIGRATIONS } from './test/helpers.ts';
import { WordListRepo } from './word-lists.ts';

const GAMES = ['codenames', 'enigma', 'echo'];

function setup() {
  const db = openDb(':memory:', MIGRATIONS);
  let now = 1000;
  // Each write gets a later timestamp, so "oldest first" is the order lists are made in.
  const repo = new WordListRepo(db, () => (now += 1), GAMES);
  const make = (name: string, games?: string[]) =>
    repo.create({ name, description: '', words: [`${name}-word`], games });
  return { db, repo, make };
}

describe('WordListRepo game tags', () => {
  it('tags rows that predate the column with every word-list game, Echo included', () => {
    const { db, repo } = setup();
    // Insert the way an older server would have, without naming the new column.
    db.$client
      .prepare(
        `INSERT INTO word_lists (id, name, description, words, created_at, updated_at)
         VALUES ('old', 'Old', '', '["x"]', 1, 1)`,
      )
      .run();
    expect(db.select({ games: wordLists.games }).from(wordLists).get()?.games).toEqual([
      'codenames',
      'enigma',
      'echo',
    ]);
    expect(repo.get('old')?.games).toEqual(['codenames', 'enigma', 'echo']);
  });

  it('tags new and seeded lists with every registered word-list game by default', () => {
    const { repo, make } = setup();
    repo.seedIfEmpty();
    expect(repo.list().map((l) => l.games)).toEqual([GAMES]);
    expect(make('Plain').games).toEqual(GAMES);
    expect(make('Dupes', ['enigma', 'enigma']).games).toEqual(['enigma']);
    // Without an explicit list, the repo uses the server's registered word-list games.
    expect(new WordListRepo(openDb(':memory:', MIGRATIONS)).gameIds).toEqual(GAMES);
  });

  it('offers a game only its tagged lists, its own lists first, each group oldest first', () => {
    const { repo, make } = setup();
    make('Shared A');
    make('Enigma only B', ['enigma']);
    const codenamesOnly = make('Codenames only');
    make('Shared C');
    make('Enigma only D', ['enigma']);
    repo.update(codenamesOnly.id, {
      name: 'Codenames only',
      description: '',
      words: ['x'],
      games: ['codenames'],
    });
    const names = (game: string) =>
      repo
        .forGame(game)
        .wordLists()
        .map((l) => l.name);
    expect(names('enigma')).toEqual(['Enigma only B', 'Enigma only D', 'Shared A', 'Shared C']);
    expect(names('codenames')).toEqual(['Codenames only', 'Shared A', 'Shared C']);
    expect(names('chess')).toEqual([]);
    // A list made only for Echo is where an Echo lobby opens; the others still open on shared lists.
    make('Echo classic', ['echo']);
    expect(names('echo')).toEqual(['Echo classic', 'Shared A', 'Shared C']);
    expect(names('enigma')[0]).toBe('Enigma only B');
    expect(repo.list('enigma').map((l) => l.name)).toEqual([
      'Enigma only B',
      'Enigma only D',
      'Shared A',
      'Shared C',
    ]);
  });

  it('never hands a game the words of a list it is not tagged for', () => {
    const { repo, make } = setup();
    const shared = make('Shared');
    const other = make('Enigma only', ['enigma']);
    expect(repo.forGame('codenames').words([shared.id, other.id, 'missing'])).toEqual([
      'Shared-word',
    ]);
    expect(repo.forGame('enigma').words([other.id])).toEqual(['Enigma only-word']);
  });

  it('keeps tags on update unless given, and keeps tags of games it does not run', () => {
    const { repo, make } = setup();
    const list = make('List', ['codenames', 'retired']);
    const body = { name: 'List', description: '', words: ['y'] };
    expect(repo.update(list.id, body)?.games).toEqual(['codenames', 'retired']);
    expect(repo.update(list.id, { ...body, games: ['enigma'] })?.games).toEqual([
      'enigma',
      'retired',
    ]);
    expect(repo.update('missing', body)).toBeNull();
  });
});
