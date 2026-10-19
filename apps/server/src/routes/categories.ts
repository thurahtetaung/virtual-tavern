import {
  type AdminCategoriesResponse,
  categoryBody,
  categoryOrderBody,
  firstIssueMessage,
  gameCategoriesBody,
  newCategoryBody,
} from '@vt/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { CategoryError, type GameCategories } from '../categories.ts';

const error = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.code(status).send({ error: { code, message } });

/**
 * Game categories on the admin page: add, rename, order and delete them, and tick each game's.
 * Registered inside the admin guard; every change answers with the whole list.
 */
export function categoryAdminRoutes(app: FastifyInstance, opts: { categories: GameCategories }) {
  const { categories } = opts;
  const run = (reply: FastifyReply, change: () => void): AdminCategoriesResponse | FastifyReply => {
    try {
      change();
    } catch (err) {
      if (err instanceof CategoryError) return error(reply, err.status, err.code, err.message);
      throw err;
    }
    return categories.admin();
  };

  app.get('/api/admin/categories', () => categories.admin());

  app.post('/api/admin/categories', (req, reply) => {
    const body = newCategoryBody.safeParse(req.body);
    if (!body.success) return error(reply, 400, 'bad-request', firstIssueMessage(body.error));
    return run(reply, () => categories.add(body.data));
  });

  app.put('/api/admin/categories/order', (req, reply) => {
    const body = categoryOrderBody.safeParse(req.body);
    if (!body.success) return error(reply, 400, 'bad-request', 'Send { "ids": ["…", …] }.');
    return run(reply, () => categories.reorder(body.data.ids));
  });

  app.put<{ Params: { id: string } }>('/api/admin/categories/:id', (req, reply) => {
    const body = categoryBody.safeParse(req.body);
    if (!body.success) return error(reply, 400, 'bad-request', firstIssueMessage(body.error));
    return run(reply, () => categories.update(req.params.id, body.data));
  });

  app.delete<{ Params: { id: string } }>('/api/admin/categories/:id', (req, reply) =>
    run(reply, () => categories.remove(req.params.id)),
  );

  app.put<{ Params: { gameId: string } }>('/api/admin/game-categories/:gameId', (req, reply) => {
    const body = gameCategoriesBody.safeParse(req.body);
    if (!body.success)
      return error(reply, 400, 'bad-request', 'Send { "categories": ["party", …] }.');
    return run(reply, () => categories.setGame(req.params.gameId, body.data.categories));
  });
}
