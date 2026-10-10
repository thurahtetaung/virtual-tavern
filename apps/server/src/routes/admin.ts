import { adminLoginBody, wordListBody, wordListEnabledBody } from '@vt/protocol';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type AdminAuth, clearAdminSession } from '../admin-auth.ts';
import type { Backroom } from '../backroom.ts';
import type { WordListRepo } from '../word-lists.ts';

const error = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.code(status).send({ error: { code, message } });

export function adminRoutes(
  app: FastifyInstance,
  opts: { auth: AdminAuth | null; wordLists: WordListRepo; backroom: Backroom; now: () => number },
) {
  const { auth, wordLists, backroom, now } = opts;

  /** A message naming the first id that is not a registered word-list game, or null. */
  const unknownGame = (games: readonly string[] | undefined) => {
    const bad = games?.find((id) => !wordLists.gameIds.includes(id));
    return bad === undefined ? null : `"${bad}" is not a game that uses word lists.`;
  };

  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!auth) return error(reply, 503, 'admin-disabled', 'The admin area is not configured.');
    if (!auth.isAdmin(req, now())) return error(reply, 401, 'unauthorized', 'Please sign in.');
  };

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

  app.post('/api/admin/logout', (_req, reply) => {
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

    scope.get('/api/admin/backroom', () => ({ open: backroom.isOpen() }));

    scope.put('/api/admin/backroom/password', (req, reply) => {
      const body = z.object({ password: z.string().min(4).max(200) }).safeParse(req.body);
      if (!body.success) return error(reply, 400, 'bad-request', 'Use at least 4 characters.');
      backroom.setPassword(body.data.password);
      return { ok: true };
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

    done();
  });
}
