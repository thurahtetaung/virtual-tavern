import type { GameSummary, QuestionDeckDetail, QuestionDeckSummary } from '@vt/protocol';
import { afterEach, describe, expect, it } from 'vitest';
import { reverie } from '@vt/private-reverie/logic';
import { buildGames } from '../games/registry.ts';
import { testApp } from '../test/helpers.ts';

// Made-up questions only: real decks are private and never committed.
const SECRET = 'zebracorn';
const deck = (overrides: Record<string, unknown> = {}) => ({
  name: 'Odd Facts',
  description: 'Strange but true.',
  questions: [
    {
      prompt: 'The made-up capital of Testland is ___.',
      answer: SECRET,
      alternates: ['zebra corn'],
      sources: ['https://example.com/testland'],
      tags: ['places'],
      decoys: ['fakeburgh'],
    },
    { prompt: 'Which colour is the imaginary sky?', answer: 'plaid', adult: true },
  ],
  ...overrides,
});

describe('question decks api', () => {
  let app = testApp();
  afterEach(async () => {
    await app.close();
    app = testApp();
  });

  async function admin() {
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { password: 'hunter2' },
    });
    const cookie = res.cookies.find((c) => c.name === 'vt_admin')!;
    return { cookie: `vt_admin=${cookie.value}` };
  }

  it('requires an admin for every admin route', async () => {
    const routes: [string, string][] = [
      ['GET', '/api/admin/question-decks'],
      ['GET', '/api/admin/question-decks/export'],
      ['POST', '/api/admin/question-decks'],
      ['GET', '/api/admin/question-decks/x'],
      ['PUT', '/api/admin/question-decks/x'],
      ['PATCH', '/api/admin/question-decks/x'],
      ['DELETE', '/api/admin/question-decks/x'],
    ];
    for (const [method, url] of routes) {
      const res = await app.inject({ method: method as 'GET', url, payload: deck() });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
      expect(res.json()).toEqual({ error: { code: 'unauthorized', message: 'Please sign in.' } });
    }
  });

  it('validates decks', async () => {
    const headers = await admin();
    const post = (payload: object) =>
      app.inject({ method: 'POST', url: '/api/admin/question-decks', headers, payload });
    const bad = async (payload: object, message: RegExp) => {
      const res = await post(payload);
      expect(res.statusCode).toBe(400);
      const body = res.json<{ error: { code: string; message: string } }>();
      expect(body.error.code).toBe('bad-request');
      expect(body.error.message).toMatch(message);
    };
    const question = (q: Record<string, unknown>) => deck({ questions: [{ answer: 'a', ...q }] });

    await bad(question({ prompt: 'No blank and no question mark.' }), /questions\.0\.prompt/);
    await bad(question({ prompt: 'Two ___ blanks ___.' }), /exactly one "___"/);
    await bad(question({ prompt: 'Two ___ blanks ___?' }), /exactly one "___"/);
    await bad(question({ prompt: '___?' }), /questions\.0\.prompt/);
    await bad(question({ prompt: 'x'.repeat(298) + '___' }), /questions\.0\.prompt/);
    await bad(question({ prompt: 'A ___.', answer: '' }), /questions\.0\.answer/);
    await bad(question({ prompt: 'A ___.', answer: 'a'.repeat(161) }), /questions\.0\.answer/);
    await bad(question({ prompt: 'A ___.', decoys: Array(31).fill('d') }), /decoys/);
    await bad(question({ prompt: 'A ___.', decoys: ['d'.repeat(161)] }), /decoys/);
    await bad(
      question({ prompt: 'A ___.', alternates: Array.from({ length: 11 }, (_, i) => `a${i}`) }),
      /alternates/,
    );
    await bad(question({ prompt: 'A ___.', sources: ['ftp://example.com'] }), /http\(s\) URLs/);
    await bad(question({ prompt: 'A ___.', sources: ['not a url'] }), /sources/);
    await bad(question({ prompt: 'A ___.', tags: Array(11).fill('t') }), /tags/);
    await bad(deck({ questions: [] }), /questions/);
    await bad(deck({ name: '' }), /name/);
    await bad(deck({ name: 'n'.repeat(61) }), /name/);
    await bad(deck({ description: 'd'.repeat(201) }), /description/);
    await bad(deck({ games: ['Not A Game'] }), /games/);

    expect((await post(question({ prompt: 'Ends with a question?' }))).statusCode).toBe(201);
    expect((await post(question({ prompt: 'One ___ blank.' }))).statusCode).toBe(201);
    // Long, lower-case answers (proverbs, first lines) are kept exactly as sent.
    const long = 'a stitch in time '.repeat(9).trim().slice(0, 160);
    const ok = await post(
      question({ prompt: 'The proverb ends: ___.', answer: long, alternates: [long], sources: [] }),
    );
    expect(ok.statusCode).toBe(201);
    expect(ok.json<QuestionDeckDetail>().questions[0]).toMatchObject({ answer: long });
  });

  it('creates, reads, updates, toggles, exports and deletes decks', async () => {
    const headers = await admin();
    const created = await app.inject({
      method: 'POST',
      url: '/api/admin/question-decks',
      headers,
      payload: deck(),
    });
    expect(created.statusCode).toBe(201);
    const { id, ...rest } = created.json<QuestionDeckDetail>();
    expect(rest).toMatchObject({
      name: 'Odd Facts',
      questionCount: 2,
      adult: true,
      games: ['hoodwink'],
      enabled: true,
    });
    expect(rest.questions[0]?.decoys).toEqual(['fakeburgh']);
    expect(rest.questions[1]).toEqual({
      prompt: 'Which colour is the imaginary sky?',
      answer: 'plaid',
      alternates: [],
      sources: [],
      adult: true,
      tags: [],
    });

    const list = await app.inject({ method: 'GET', url: '/api/admin/question-decks', headers });
    expect(list.json<QuestionDeckSummary[]>().map((d) => [d.name, d.questionCount])).toEqual([
      ['Odd Facts', 2],
    ]);
    expect(list.body).not.toContain(SECRET);

    const url = `/api/admin/question-decks/${id}`;
    expect(
      (await app.inject({ method: 'GET', url, headers })).json<QuestionDeckDetail>().questions,
    ).toHaveLength(2);

    const put = await app.inject({
      method: 'PUT',
      url,
      headers,
      payload: deck({ name: 'Renamed', questions: [{ prompt: 'Only ___.', answer: 'one' }] }),
    });
    expect(put.json()).toMatchObject({ name: 'Renamed', questionCount: 1, adult: false });

    const patch = await app.inject({ method: 'PATCH', url, headers, payload: { enabled: false } });
    expect(patch.json()).toMatchObject({ enabled: false });
    expect(
      (await app.inject({ method: 'PATCH', url, headers, payload: { enabled: 'no' } })).statusCode,
    ).toBe(400);
    const missing = '/api/admin/question-decks/missing';
    expect((await app.inject({ method: 'GET', url: missing, headers })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'PATCH', url: missing, headers, payload: { enabled: true } }))
        .statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'PUT', url: missing, headers, payload: deck() })).statusCode,
    ).toBe(404);

    const exported = await app.inject({
      method: 'GET',
      url: '/api/admin/question-decks/export',
      headers,
    });
    expect(exported.json<QuestionDeckDetail[]>()).toMatchObject([
      { name: 'Renamed', enabled: false, questions: [{ answer: 'one' }] },
    ]);

    expect((await app.inject({ method: 'DELETE', url, headers })).statusCode).toBe(204);
    expect((await app.inject({ method: 'DELETE', url, headers })).statusCode).toBe(404);
  });

  it('accepts a full-size deck beyond the default body limit', async () => {
    const headers = await admin();
    const questions = Array.from({ length: 5000 }, (_, i) => ({
      prompt: `Made-up question number ${i} has the answer ___.`,
      answer: `answer ${i}`,
      sources: [`https://example.com/questions/${i}/${'x'.repeat(150)}`],
    }));
    const res = await app.inject({
      method: 'POST',
      url: '/api/admin/question-decks',
      headers,
      payload: deck({ questions }),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json<QuestionDeckDetail>().questionCount).toBe(5000);
  });

  it('serves deck summaries only to unlocked players of a private question game', async () => {
    // A stand-in private trivia game (the real one lives in its own package).
    const games = buildGames();
    const trivia = { ...reverie, id: 'trivia', usesQuestionDecks: true };
    await app.close();
    app = testApp({ games: new Map([...games, [trivia.id, trivia]]) });
    const headers = await admin();
    const make = async (payload: object) =>
      (
        await app.inject({ method: 'POST', url: '/api/admin/question-decks', headers, payload })
      ).json<QuestionDeckDetail>();
    const shown = await make(deck({ games: ['trivia'] }));
    await make(deck({ name: 'Off', games: ['trivia'], enabled: false }));
    await make(deck({ name: 'Elsewhere' }));

    await app.inject({
      method: 'PUT',
      url: '/api/admin/backroom/password',
      headers,
      payload: { password: 'speakeasy' },
    });
    const unlocked = await app.inject({
      method: 'POST',
      url: '/api/backroom/unlock',
      payload: { password: 'speakeasy' },
    });
    const cookie = `vt_backroom=${unlocked.cookies.find((c) => c.name === 'vt_backroom')!.value}`;
    const get = (url: string, withCookie = true) =>
      app.inject({ method: 'GET', url, headers: withCookie ? { cookie } : {} });

    // Locked browsers, public games and private games without decks all get a plain 404.
    for (const [url, withCookie] of [
      ['/api/backroom/question-decks/trivia', false],
      ['/api/backroom/question-decks/codenames', true],
      ['/api/backroom/question-decks/reverie', true],
      ['/api/backroom/question-decks/missing', true],
    ] as const) {
      const res = await get(url, withCookie);
      expect(res.statusCode, url).toBe(404);
      expect(res.json()).toEqual({ error: { code: 'not-found', message: 'Not found.' } });
      expect(res.body).not.toContain('Odd Facts');
    }

    const res = await get('/api/backroom/question-decks/trivia');
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.json()).toEqual([
      {
        id: shown.id,
        name: 'Odd Facts',
        description: 'Strange but true.',
        questionCount: 2,
        adult: true,
      },
    ]);
    for (const leak of [
      SECRET,
      'zebra corn',
      'fakeburgh',
      'plaid',
      'Testland',
      'example.com',
      'questions',
    ])
      expect(res.body).not.toContain(leak);

    // No public endpoint mentions decks at all, and the old public path does not exist.
    for (const url of ['/api/games', '/api/word-lists', '/api/word-lists?game=trivia']) {
      const body = (await get(url, false)).body;
      expect(body, url).not.toContain('Odd Facts');
      expect(body, url).not.toContain('Strange but true');
    }
    expect((await get('/api/question-decks?game=trivia', false)).statusCode).toBe(404);
  });

  it('reports which games use question decks', async () => {
    const games = (await app.inject({ method: 'GET', url: '/api/games' })).json<GameSummary[]>();
    expect(games.length).toBeGreaterThan(0);
    for (const g of games) expect(typeof g.questionDecks).toBe('boolean');
    expect(games.find((g) => g.id === 'codenames')?.questionDecks).toBe(false);
  });
});
