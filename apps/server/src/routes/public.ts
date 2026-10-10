import { type GameSummary, createRoomBody, roomId } from '@vt/protocol';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type GameRegistry, isPrivate } from '../games/registry.ts';
import { playerIdFromToken } from '../rooms/ids.ts';
import type { RoomManager } from '../rooms/manager.ts';
import type { WordListRepo } from '../word-lists.ts';

export function publicRoutes(
  app: FastifyInstance,
  opts: {
    rooms: RoomManager;
    wordLists: WordListRepo;
    games: GameRegistry;
    /** Whether this request carries a current back-room unlock. */
    unlocked: (req: FastifyRequest) => boolean;
  },
) {
  const { rooms, wordLists, games, unlocked } = opts;
  // Private games behave as if they don't exist for anyone who hasn't unlocked the back room.
  const visible = (req: FastifyRequest, gameId: string) => {
    const game = games.get(gameId);
    return !!game && (!isPrivate(game) || unlocked(req));
  };

  app.get('/api/games', (req): GameSummary[] =>
    [...games.values()]
      .filter((g) => visible(req, g.id))
      .map(({ id, name, description, minPlayers, maxPlayers, access }) => ({
        id,
        name,
        description,
        minPlayers,
        maxPlayers,
        private: access === 'private',
      })),
  );

  app.get('/api/word-lists', () => wordLists.list());

  app.post(
    '/api/rooms',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    (req, reply) => {
      const body = createRoomBody.safeParse(req.body);
      if (!body.success || !visible(req, body.data.gameId)) {
        return reply.code(400).send({ error: { code: 'bad-request', message: 'Unknown game.' } });
      }
      return { roomId: rooms.create(body.data.gameId, playerIdFromToken(body.data.token)) };
    },
  );

  app.get<{ Params: { id: string } }>('/api/rooms/:id', (req, reply) => {
    const room = roomId.safeParse(req.params.id).success ? rooms.exists(req.params.id) : null;
    if (!room || !games.has(room.gameId)) {
      return reply
        .code(404)
        .send({ error: { code: 'no-room', message: 'This room does not exist or has expired.' } });
    }
    // A locked player learns only that the room is private, never which game it is.
    if (!visible(req, room.gameId)) {
      return reply
        .code(403)
        .send({ error: { code: 'backroom-locked', message: 'This room is in the back room.' } });
    }
    return { id: req.params.id, gameId: room.gameId };
  });
}
