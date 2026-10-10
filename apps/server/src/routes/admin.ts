import { adminLoginBody, wordListBody } from '@vt/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { clearAdminSession, isAdmin, passwordMatches, setAdminSession } from '../admin-auth.ts';
import type { WordListRepo } from '../word-lists.ts';

const error = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.code(status).send({ error: { code, message } });

export function adminRoutes(
  app: FastifyInstance,
  opts: { password: string | null; wordLists: WordListRepo; now: () => number },
) {
  const { password, wordLists, now } = opts;

  const requireAdmin = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!password) return error(reply, 503, 'admin-disabled', 'The admin area is not configured.');
    if (!isAdmin(req, now())) return error(reply, 401, 'unauthorized', 'Please sign in.');
  };

  app.post(
    '/api/admin/login',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    (req, reply) => {
      if (!password)
        return error(reply, 503, 'admin-disabled', 'The admin area is not configured.');
      const body = adminLoginBody.safeParse(req.body);
      if (!body.success || !passwordMatches(body.data.password, password)) {
        return error(reply, 401, 'bad-password', 'Wrong password.');
      }
      setAdminSession(reply, now());
      return { ok: true };
    },
  );

  app.post('/api/admin/logout', (_req, reply) => {
    clearAdminSession(reply);
    return { ok: true };
  });

  app.get('/api/admin/session', (req) => ({
    enabled: password !== null,
    signedIn: password !== null && isAdmin(req, now()),
  }));

  app.register((scope, _opts, done) => {
    scope.addHook('preHandler', requireAdmin);

    scope.get('/api/admin/word-lists', () => wordLists.list());

    scope.get<{ Params: { id: string } }>('/api/admin/word-lists/:id', (req, reply) => {
      return wordLists.get(req.params.id) ?? error(reply, 404, 'not-found', 'Word list not found.');
    });

    scope.post('/api/admin/word-lists', (req, reply) => {
      const body = wordListBody.safeParse(req.body);
      if (!body.success) return error(reply, 400, 'bad-request', body.error.issues[0]!.message);
      return reply.code(201).send(wordLists.create(body.data));
    });

    scope.put<{ Params: { id: string } }>('/api/admin/word-lists/:id', (req, reply) => {
      const body = wordListBody.safeParse(req.body);
      if (!body.success) return error(reply, 400, 'bad-request', body.error.issues[0]!.message);
      return (
        wordLists.update(req.params.id, body.data) ??
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
