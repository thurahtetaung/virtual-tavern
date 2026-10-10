import { type GameSummary, createRoomBody, roomId } from '@vt/protocol';
import type { FastifyInstance } from 'fastify';
import { games } from '../games/registry.ts';
import { playerIdFromToken } from '../rooms/ids.ts';
import type { RoomManager } from '../rooms/manager.ts';
import type { WordListRepo } from '../word-lists.ts';

export function publicRoutes(app: FastifyInstance, rooms: RoomManager, wordLists: WordListRepo) {
  app.get('/api/games', (): GameSummary[] =>
    [...games.values()].map(({ id, name, description, minPlayers, maxPlayers }) => ({
      id,
      name,
      description,
      minPlayers,
      maxPlayers,
    })),
  );

  app.get('/api/word-lists', () => wordLists.list());

  app.post(
    '/api/rooms',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    (req, reply) => {
      const body = createRoomBody.safeParse(req.body);
      if (!body.success || !games.has(body.data.gameId)) {
        return reply.code(400).send({ error: { code: 'bad-request', message: 'Unknown game.' } });
      }
      return { roomId: rooms.create(body.data.gameId, playerIdFromToken(body.data.token)) };
    },
  );

  app.get<{ Params: { id: string } }>('/api/rooms/:id', (req, reply) => {
    const room = roomId.safeParse(req.params.id).success ? rooms.exists(req.params.id) : null;
    if (!room) {
      return reply
        .code(404)
        .send({ error: { code: 'no-room', message: 'This room does not exist or has expired.' } });
    }
    return { id: req.params.id, gameId: room.gameId };
  });
}
