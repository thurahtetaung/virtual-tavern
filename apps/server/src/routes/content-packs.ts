import { contentPackBody, contentPackEnabledBody, firstIssueMessage } from '@vt/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { ContentPackRepo } from '../content-packs.ts';

const error = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.code(status).send({ error: { code, message } });

/** A whole game's worth of title groups or lines fits easily; this leaves room. */
const PACK_BODY_LIMIT = 5 * 1024 * 1024;

/**
 * Content packs, for the admin only (the caller registers these behind `adminGuard`): private
 * content for back-room games. No other route returns pack data.
 */
export function contentPackRoutes(app: FastifyInstance, opts: { packs: ContentPackRepo }) {
  const { packs } = opts;

  app.get('/api/admin/content-packs', () => packs.list());

  app.get('/api/admin/content-packs/export', () => packs.exportAll());

  app.get<{ Params: { id: string } }>('/api/admin/content-packs/:id', (req, reply) => {
    return packs.get(req.params.id) ?? error(reply, 404, 'not-found', 'Content pack not found.');
  });

  app.post('/api/admin/content-packs', { bodyLimit: PACK_BODY_LIMIT }, (req, reply) => {
    const body = contentPackBody.safeParse(req.body);
    if (!body.success) return error(reply, 400, 'bad-request', firstIssueMessage(body.error));
    const checked = packs.check(body.data);
    if ('problem' in checked) return error(reply, 400, 'bad-request', checked.problem);
    return reply.code(201).send(packs.create({ ...body.data, data: checked.data }));
  });

  app.patch<{ Params: { id: string } }>('/api/admin/content-packs/:id', (req, reply) => {
    const body = contentPackEnabledBody.safeParse(req.body);
    if (!body.success) return error(reply, 400, 'bad-request', 'Send { "enabled": true|false }.');
    return (
      packs.setEnabled(req.params.id, body.data.enabled) ??
      error(reply, 404, 'not-found', 'Content pack not found.')
    );
  });

  app.delete<{ Params: { id: string } }>('/api/admin/content-packs/:id', (req, reply) => {
    if (!packs.delete(req.params.id))
      return error(reply, 404, 'not-found', 'Content pack not found.');
    return reply.code(204).send();
  });
}
