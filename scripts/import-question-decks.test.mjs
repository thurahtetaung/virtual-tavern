import { describe, expect, it } from 'vitest';
import { questionDeckBody, triviaProblem } from '../packages/protocol/src/questions.ts';
import { globRegex, validateDeck } from './import-question-decks.mjs';

// Made-up questions only: real decks are private and never committed.
const question = (q = {}) => ({ prompt: 'The pretend river is ___.', answer: 'Glimmer', ...q });
const deckFile = (questions = [question()]) => ({ questions });

describe('import-question-decks validateDeck', () => {
  it('accepts a good deck and builds the request body', () => {
    const { deck, errors } = validateDeck(
      { name: ' Pretend Places ', description: 'Not real.', games: ['hoodwink'], enabled: false },
      deckFile([
        question({ alternates: [' glimmer river '], sources: ['https://example.com/a'], extra: 1 }),
        question({ prompt: 'Which pretend bird hums?', adult: true, tags: ['birds'] }),
      ]),
    );
    expect(errors).toEqual([]);
    expect(deck).toEqual({
      name: 'Pretend Places',
      description: 'Not real.',
      games: ['hoodwink'],
      enabled: false,
      questions: [
        {
          prompt: 'The pretend river is ___.',
          answer: 'Glimmer',
          alternates: ['glimmer river'],
          sources: ['https://example.com/a'],
          adult: false,
          tags: [],
        },
        {
          prompt: 'Which pretend bird hums?',
          answer: 'Glimmer',
          alternates: [],
          sources: [],
          adult: true,
          tags: ['birds'],
        },
      ],
    });
  });

  it('falls back to the deck file for the name and description', () => {
    const { deck, errors } = validateDeck({}, { name: 'From file', ...deckFile() });
    expect(errors).toEqual([]);
    expect(deck).toMatchObject({ name: 'From file', description: '' });
  });

  it('reports every problem with its path', () => {
    const { errors } = validateDeck(
      { name: '', games: ['Bad Id'], enabled: 'yes' },
      deckFile([
        question({ prompt: 'No blank here.' }),
        question({ prompt: 'Two ___ and ___.' }),
        question({ answer: 'a'.repeat(161), sources: ['ftp://example.com'] }),
        question({ alternates: Array(11).fill('x'), tags: [''], adult: 'no', decoys: [''] }),
      ]),
    );
    expect(errors).toEqual([
      'name: 1-60 characters',
      'games: 1-10 game ids (lowercase letters, digits and dashes)',
      'enabled: true or false',
      'questions.0.prompt: needs exactly one "___", or no blank and a final "?"',
      'questions.1.prompt: needs exactly one "___", or no blank and a final "?"',
      'questions.2.answer: 1-160 characters',
      'questions.2.sources: at most 5 http(s) URLs',
      'questions.3.alternates: at most 10, each 1-160 characters',
      'questions.3.decoys: at most 30, each 1-160 characters',
      'questions.3.adult: true or false',
      'questions.3.tags: at most 10, each 1-40 characters',
    ]);
    expect(validateDeck({ name: 'Empty' }, { questions: [] }).errors).toEqual([
      'questions: 1-5000 questions',
    ]);
  });

  it('agrees with the server schema', () => {
    const cases = [
      question(),
      question({ prompt: 'Ends with a question?' }),
      question({ prompt: 'No blank.' }),
      question({ prompt: '___ twice ___?' }),
      question({ prompt: '  ___ ' }),
      question({ prompt: `${'x'.repeat(297)}___` }),
      question({ prompt: `${'x'.repeat(298)}___` }),
      question({ answer: '   ' }),
      question({ answer: 'a'.repeat(160) }),
      question({ answer: 'a'.repeat(161) }),
      question({ answer: 'a stitch in time saves nine' }),
      question({ alternates: ['b'.repeat(160)] }),
      question({ alternates: ['b'.repeat(161)] }),
      question({ decoys: Array(30).fill('fake') }),
      question({ decoys: Array(31).fill('fake') }),
      question({ decoys: ['c'.repeat(161)] }),
      question({ sources: [] }),
      question({ alternates: Array(10).fill('alt') }),
      question({ alternates: Array(11).fill('alt') }),
      question({ sources: Array(5).fill('http://example.com') }),
      question({ sources: Array(6).fill('http://example.com') }),
      question({ sources: ['mailto:a@example.com'] }),
      question({ sources: ['https://'] }),
      question({ sources: ['https://example.com/a b'] }),
      question({ tags: ['t'.repeat(41)] }),
      question({ adult: 1 }),
    ];
    for (const q of cases) {
      const body = { name: 'Deck', questions: [q] };
      const local = validateDeck({ name: 'Deck' }, { questions: [q] }).errors.length === 0;
      // The server parses the body, then applies the trivia rules (the deck isn't for an open game).
      const parsed = questionDeckBody.safeParse(body);
      const server = parsed.success && triviaProblem(parsed.data.questions) === null;
      expect(local, JSON.stringify(q)).toBe(server);
    }
  });

  it('matches slugs against globs', () => {
    expect(globRegex('odd-*').test('odd-history')).toBe(true);
    expect(globRegex('odd-*').test('very-odd')).toBe(false);
    expect(globRegex('a.b').test('axb')).toBe(false);
    expect(globRegex(null)).toBeNull();
  });

  it('checks open-question decks (no answers) for open games', () => {
    const open = { prompt: 'Name a pretend snack.', hints: [' Crisps '], tags: ['food'] };
    const ok = validateDeck({ name: 'Snacks', games: ['stampede'] }, deckFile([open]));
    expect(ok.errors).toEqual([]);
    expect(ok.deck.questions).toEqual([
      {
        prompt: 'Name a pretend snack.',
        sources: [],
        adult: false,
        tags: ['food'],
        hints: ['Crisps'],
      },
    ]);
    expect(validateDeck({ name: 'S', games: ['stampede'] }, deckFile([question()])).errors).toEqual(
      ['questions.0: open questions have no answer, alternates or decoys'],
    );
    expect(
      validateDeck({ name: 'S', games: ['stampede', 'hoodwink'] }, deckFile([open])).errors,
    ).toContain('games: a deck is either for trivia games or for open-question games, not both');
    // Without open games in its tags, a deck is trivia and needs answers, as before.
    expect(validateDeck({ name: 'S' }, deckFile([open])).errors).toContain(
      'questions.0.answer: 1-160 characters',
    );
    // The server accepts what the script sends.
    expect(questionDeckBody.safeParse(ok.deck).success).toBe(true);
  });
});
