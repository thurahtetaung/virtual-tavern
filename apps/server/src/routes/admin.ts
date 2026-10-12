import {
  adminLoginBody,
  firstIssueMessage,
  questionDeckBody,
  questionDeckEnabledBody,
  wordListBody,
  wordListEnabledBody,
} from '@vt/protocol';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type AdminAuth, clearAdminSession } from '../admin-auth.ts';
import type { Backroom } from '../backroom.ts';
import type { QuestionDeckRepo } from '../question-decks.ts';
import type { RecapSettings } from '../recap/settings.ts';
import type { WordListRepo } from '../word-lists.ts';

const error = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.code(status).send({ error: { code, message } });

/** A full deck (up to 5,000 questions with sources) can outgrow Fastify's default 1 MB body. */
const DECK_BODY_LIMIT = 10 * 1024 * 1024;

/** preHandler that lets only a signed-in admin through. */
export function adminGuard(auth: AdminAuth | null, now: () => number) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!auth) return error(reply, 503, 'admin-disabled', 'The admin area is not configured.');
    if (!auth.isAdmin(req, now())) return error(reply, 401, 'unauthorized', 'Please sign in.');
  };
}

export function adminRoutes(
  app: FastifyInstance,
  opts: {
    auth: AdminAuth | null;
    wordLists: WordListRepo;
    questionDecks: QuestionDeckRepo;
    backroom: Backroom;
    /** Night recaps' on/off switch (optional so older tests need not build one). */
    recapSettings?: RecapSettings;
    now: () => number;
  },
) {
  const { auth, wordLists, questionDecks, backroom, recapSettings, now } = opts;

  /** A message naming the first id that is not a registered word-list game, or null. */
  const unknownGame = (games: readonly string[] | undefined) => {
    const bad = games?.find((id) => !wordLists.gameIds.includes(id));
    return bad === undefined ? null : `"${bad}" is not a game that uses word lists.`;
  };

  /** A message naming the first id that is not a registered question-deck game, or null. */
  const unknownDeckGame = (games: readonly string[] | undefined) => {
    const bad = games?.find((id) => !questionDecks.gameIds.includes(id));
    return bad === undefined ? null : `games: "${bad}" is not a game that uses question decks.`;
  };

  const requireAdmin = adminGuard(auth, now);

  app.post(
    '/api/admin/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (req, reply) => {
      if (!auth) return error(reply, 503, 'admin-disabled', 'The admin area is not configured.');
      const body = adminLoginBody.safeParse(req.body);
      if (!body.success || !(await auth.verify(body.data.password))) {
        return error(reply, 401, 'bad-password', 'Wrong password.');
      }
      auth.setSession(reply, now());
      return { ok: true };
    },
  );

  app.post('/api/admin/logout', (req, reply) => {
    // Revoked as well as cleared, so seat tabs of a playtest lose the room at the next change.
    auth?.revoke(req, now());
    clearAdminSession(reply);
    return { ok: true };
  });

  app.get('/api/admin/session', (req) => ({
    enabled: auth !== null,
    signedIn: auth !== null && auth.isAdmin(req, now()),
  }));

  app.register((scope, _opts, done) => {
    scope.addHook('preHandler', requireAdmin);

    scope.get('/api/admin/word-lists', () => wordLists.list());

    // Every list with its words, for "Download all"; the zip is built in the browser.
    scope.get('/api/admin/word-lists/export', () => wordLists.exportAll());

    scope.get('/api/admin/backroom', () => ({ open: backroom.isOpen() }));

    scope.put('/api/admin/backroom/password', (req, reply) => {
      const body = z.object({ password: z.string().min(4).max(200) }).safeParse(req.body);
      if (!body.success) return error(reply, 400, 'bad-request', 'Use at least 4 characters.');
      backroom.setPassword(body.data.password);
      return { ok: true };
    });

    // Night recaps: the kill switch. Off hides the chip, the strips and the wrap-up everywhere.
    scope.get('/api/admin/recap', () => ({ enabled: recapSettings?.enabled() ?? false }));

    scope.put('/api/admin/recap', (req, reply) => {
      const body = z.object({ enabled: z.boolean() }).safeParse(req.body);
      if (!body.success || !recapSettings)
        return error(reply, 400, 'bad-request', 'Send { enabled: true | false }.');
      recapSettings.setEnabled(body.data.enabled);
      return { enabled: body.data.enabled };
    });

    scope.post('/api/admin/backroom/sign-out-all', () => {
      backroom.signOutEveryone();
      return { ok: true };
    });

    scope.get<{ Params: { id: string } }>('/api/admin/word-lists/:id', (req, reply) => {
      return wordLists.get(req.params.id) ?? error(reply, 404, 'not-found', 'Word list not found.');
    });

    scope.post('/api/admin/word-lists', (req, reply) => {
      const body = wordListBody.safeParse(req.body);
      if (!body.success) return error(reply, 400, 'bad-request', body.error.issues[0]!.message);
      const bad = unknownGame(body.data.games);
      if (bad) return error(reply, 400, 'bad-request', bad);
      return reply.code(201).send(wordLists.create(body.data));
    });

    scope.put<{ Params: { id: string } }>('/api/admin/word-lists/:id', (req, reply) => {
      const body = wordListBody.safeParse(req.body);
      if (!body.success) return error(reply, 400, 'bad-request', body.error.issues[0]!.message);
      const bad = unknownGame(body.data.games);
      if (bad) return error(reply, 400, 'bad-request', bad);
      return (
        wordLists.update(req.params.id, body.data) ??
        error(reply, 404, 'not-found', 'Word list not found.')
      );
    });

    scope.patch<{ Params: { id: string } }>('/api/admin/word-lists/:id', (req, reply) => {
      const body = wordListEnabledBody.safeParse(req.body);
      if (!body.success) return error(reply, 400, 'bad-request', 'Send { "enabled": true|false }.');
      return (
        wordLists.setEnabled(req.params.id, body.data.enabled) ??
        error(reply, 404, 'not-found', 'Word list not found.')
      );
    });

    scope.delete<{ Params: { id: string } }>('/api/admin/word-lists/:id', (req, reply) => {
      if (!wordLists.delete(req.params.id))
        return error(reply, 404, 'not-found', 'Word list not found.');
      return reply.code(204).send();
    });

    // ---- Question decks (private content: questions never reach players' browsers) ----

    scope.get('/api/admin/question-decks', () => questionDecks.list());

    // Every deck with its questions, for "Download all"; the zip is built in the browser.
    scope.get('/api/admin/question-decks/export', () => questionDecks.exportAll());

    scope.get<{ Params: { id: string } }>('/api/admin/question-decks/:id', (req, reply) => {
      return (
        questionDecks.get(req.params.id) ??
        error(reply, 404, 'not-found', 'Question deck not found.')
      );
    });

    scope.post('/api/admin/question-decks', { bodyLimit: DECK_BODY_LIMIT }, (req, reply) => {
      const body = questionDeckBody.safeParse(req.body);
      if (!body.success) return error(reply, 400, 'bad-request', firstIssueMessage(body.error));
      const badGame = unknownDeckGame(body.data.games);
      if (badGame) return error(reply, 400, 'bad-request', badGame);
      return reply.code(201).send(questionDecks.create(body.data));
    });

    scope.put<{ Params: { id: string } }>(
      '/api/admin/question-decks/:id',
      { bodyLimit: DECK_BODY_LIMIT },
      (req, reply) => {
        const body = questionDeckBody.safeParse(req.body);
        if (!body.success) return error(reply, 400, 'bad-request', firstIssueMessage(body.error));
        const badGame = unknownDeckGame(body.data.games);
        if (badGame) return error(reply, 400, 'bad-request', badGame);
        return (
          questionDecks.update(req.params.id, body.data) ??
          error(reply, 404, 'not-found', 'Question deck not found.')
        );
      },
    );

    scope.patch<{ Params: { id: string } }>('/api/admin/question-decks/:id', (req, reply) => {
      const body = questionDeckEnabledBody.safeParse(req.body);
      if (!body.success) return error(reply, 400, 'bad-request', 'Send { "enabled": true|false }.');
      return (
        questionDecks.setEnabled(req.params.id, body.data.enabled) ??
        error(reply, 404, 'not-found', 'Question deck not found.')
      );
    });

    scope.delete<{ Params: { id: string } }>('/api/admin/question-decks/:id', (req, reply) => {
      if (!questionDecks.delete(req.params.id))
        return error(reply, 404, 'not-found', 'Question deck not found.');
      return reply.code(204).send();
    });

    done();
  });
}
