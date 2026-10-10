import { type StoredQuestion, questionBody } from '@vt/protocol';
import { describe, expect, it } from 'vitest';
import { openDb } from './db/index.ts';
import { questionDecks } from './db/schema.ts';
import { QuestionDeckRepo, roomContent } from './question-decks.ts';
import { MIGRATIONS } from './test/helpers.ts';
import { WordListRepo } from './word-lists.ts';

// Made-up questions only: real decks are private and never committed.
const q = (prompt: string, answer: string, extra: Partial<StoredQuestion> = {}): StoredQuestion =>
  questionBody.parse({ prompt, answer, ...extra });

function setup() {
  const db = openDb(':memory:', MIGRATIONS);
  let now = 1000;
  const repo = new QuestionDeckRepo(db, () => (now += 1));
  const make = (name: string, opts: { games?: string[]; enabled?: boolean } = {}) =>
    repo.create({
      name,
      description: `${name} deck`,
      questions: [q(`${name} one is ___.`, `${name}-a`), q(`What is ${name} two?`, `${name}-b`)],
      ...opts,
    });
  return { db, repo, make };
}

describe('QuestionDeckRepo', () => {
  it('tags decks for hoodwink by default, including rows inserted without the column', () => {
    const { db, repo, make } = setup();
    expect(make('Alpha').games).toEqual(['hoodwink']);
    db.$client
      .prepare(
        `INSERT INTO question_decks (id, name, questions, created_at, updated_at)
         VALUES ('old', 'Old', '[]', 1, 1)`,
      )
      .run();
    expect(db.select({ games: questionDecks.games }).from(questionDecks).all()).toEqual([
      { games: ['hoodwink'] },
      { games: ['hoodwink'] },
    ]);
    expect(repo.get('old')).toMatchObject({ enabled: true, questionCount: 0, adult: false });
  });

  it('lists summaries with question counts and an adult flag, without questions', () => {
    const { repo, make } = setup();
    make('Beta');
    repo.create({
      name: 'Alpha',
      description: '',
      questions: [q('Tame ___.', 'x'), q('Spicy ___.', 'y', { adult: true })],
    });
    const list = repo.list();
    expect(list.map((d) => [d.name, d.questionCount, d.adult])).toEqual([
      ['Alpha', 2, true],
      ['Beta', 2, false],
    ]);
    expect(list[0]).not.toHaveProperty('questions');
  });

  it('updates fields, keeps games and enabled when omitted, and switches decks off', () => {
    const { repo, make } = setup();
    const deck = make('Alpha', { games: ['hoodwink', 'quiz'] });
    const updated = repo.update(deck.id, {
      name: 'Alpha 2',
      description: '',
      questions: [q('Only ___.', 'one')],
    });
    expect(updated).toMatchObject({ name: 'Alpha 2', games: ['hoodwink', 'quiz'], enabled: true });
    expect(updated?.questions).toHaveLength(1);
    expect(updated!.updatedAt).toBeGreaterThan(deck.updatedAt);

    const off = repo.setEnabled(deck.id, false);
    expect(off).toMatchObject({ enabled: false, updatedAt: updated!.updatedAt, questionCount: 1 });
    expect(repo.setEnabled('missing', true)).toBeNull();
    expect(repo.update('missing', { name: 'x', description: '', questions: [] })).toBeNull();
    expect(repo.listEnabled()).toEqual([]);
    expect(repo.list()).toHaveLength(1);
    expect(repo.exportAll()[0]?.questions).toHaveLength(1);
    expect(repo.delete(deck.id)).toBe(true);
    expect(repo.delete(deck.id)).toBe(false);
  });

  it('forGame offers only enabled decks tagged for the game, with stable question ids', () => {
    const { repo, make } = setup();
    const own = make('Own');
    const other = make('Other', { games: ['quiz'] });
    const off = make('Off', { enabled: false });
    const both = make('Both', { games: ['quiz', 'hoodwink'] });
    const content = repo.forGame('hoodwink');

    expect(content.questionDecks().map((d) => d.name)).toEqual(['Both', 'Own']);
    expect(content.questionDecks()[1]).toEqual({
      id: own.id,
      name: 'Own',
      description: 'Own deck',
      questionCount: 2,
    });

    const questions = content.questions([own.id, other.id, off.id, 'missing', own.id]);
    expect(questions).toEqual([
      {
        id: `${own.id}:0`,
        deckId: own.id,
        prompt: 'Own one is ___.',
        answer: 'Own-a',
        alternates: [],
      },
      {
        id: `${own.id}:1`,
        deckId: own.id,
        prompt: 'What is Own two?',
        answer: 'Own-b',
        alternates: [],
      },
    ]);
    expect(content.questions([both.id]).map((x) => x.id)).toEqual([`${both.id}:0`, `${both.id}:1`]);
    expect(content.questions([])).toEqual([]);
    expect(repo.forGame('quiz').questions([other.id])).toHaveLength(2);

    repo.setEnabled(own.id, true);
    repo.setEnabled(both.id, false);
    expect(content.questionDecks().map((d) => d.name)).toEqual(['Own']);
  });

  it('marks a deck adult in forGame when any question is adult', () => {
    const { repo } = setup();
    repo.create({
      name: 'Late',
      description: '',
      questions: [q('Night ___.', 'owl', { adult: true, alternates: ['owls'], decoys: ['bat'] })],
    });
    const [deck] = repo.forGame('hoodwink').questionDecks();
    expect(deck).toMatchObject({ name: 'Late', adult: true });
    const [question] = repo.forGame('hoodwink').questions([deck!.id]);
    expect(question?.alternates).toEqual(['owls']);
    // Games get the decoys (as house lies); HTTP responses never do, except to admins.
    expect(question?.decoys).toEqual(['bat']);
    expect(repo.get(deck!.id)?.questions[0]?.decoys).toEqual(['bat']);
  });
});

describe('roomContent', () => {
  it('adds question decks only for games that use them', () => {
    const db = openDb(':memory:', MIGRATIONS);
    const decks = new QuestionDeckRepo(db);
    decks.create({ name: 'D', description: '', questions: [q('A ___.', 'b')] });
    const games = new Map([
      ['hoodwink', { usesQuestionDecks: true }],
      ['codenames', {}],
    ]);
    const content = roomContent(new WordListRepo(db, Date.now, ['codenames']), decks, games);
    expect(content.forGame('hoodwink').questionDecks?.()).toHaveLength(1);
    expect(content.forGame('hoodwink').wordLists()).toEqual([]);
    expect('questionDecks' in content.forGame('codenames')).toBe(false);
    expect('questions' in content.forGame('codenames')).toBe(false);
  });
});
