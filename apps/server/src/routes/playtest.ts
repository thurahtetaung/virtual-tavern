import { randomBytes } from 'node:crypto';
import {
  MAX_PLAYTEST_SEATS,
  type PlaytestCreated,
  type PlaytestGame,
  createPlaytestBody,
  firstIssueMessage,
} from '@vt/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { type GameRegistry, isPrivate } from '../games/registry.ts';
import { playerIdFromToken } from '../rooms/ids.ts';
import type { RoomManager } from '../rooms/manager.ts';
import { nameTaken } from '../rooms/names.ts';

const error = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.code(status).send({ error: { code, message } });

/** A fresh seat secret, in the same format as a browser's `playerToken`. */
export const seatToken = () => randomBytes(32).toString('base64url');

/** Most seats a playtest of `maxPlayers` may have. */
export const maxSeats = (maxPlayers: number) => Math.min(maxPlayers, MAX_PLAYTEST_SEATS);

/**
 * The admin's playtests: rooms that record nothing, whose seats are all played from the admin's
 * own browser, one tab per seat. Register behind `adminGuard`.
 */
export function playtestRoutes(
  app: FastifyInstance,
  opts: {
    rooms: RoomManager;
    games: GameRegistry;
    /** Admin-set titles for private games. */
    titles?: { title(gameId: string): string | null };
    now: () => number;
  },
) {
  const { rooms, games, titles, now } = opts;

  app.get('/api/admin/playtest/games', (): PlaytestGame[] =>
    [...games.values()].map((g) => ({
      id: g.id,
      name: (isPrivate(g) && titles?.title(g.id)) || g.name,
      private: isPrivate(g),
      minPlayers: g.minPlayers,
      maxSeats: maxSeats(g.maxPlayers),
    })),
  );

  app.post(
    '/api/admin/playtests',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    (req, reply) => {
      const body = createPlaytestBody.safeParse(req.body);
      if (!body.success) return error(reply, 400, 'bad-request', firstIssueMessage(body.error));
      const { gameId, seats } = body.data;
      const game = games.get(gameId);
      if (!game) return error(reply, 400, 'bad-request', 'Unknown game.');
      const most = maxSeats(game.maxPlayers);
      if (seats.length < game.minPlayers || seats.length > most) {
        return error(
          reply,
          400,
          'bad-seats',
          `${game.name} takes ${game.minPlayers} to ${most} seats in a playtest.`,
        );
      }
      const names: string[] = [];
      for (const seat of seats) {
        if (nameTaken(seat.name, names))
          return error(reply, 400, 'bad-seats', `Two seats are called ${seat.name}.`);
        names.push(seat.name);
      }
      const made = seats.map((s) => {
        const token = seatToken();
        return { name: s.name, token, playerId: playerIdFromToken(token) };
      });
      const host = made[0]!;
      const roomId = rooms.create(gameId, host.playerId, {
        playtest: { bots: [], speed: 'normal', paused: false, createdAt: now() },
      });
      // Seated now, in order, so names, join order and the host are fixed before any tab opens.
      for (const seat of made) {
        const res = rooms.join(roomId, seat.playerId, seat.name, { admin: true });
        if (!res.ok) {
          rooms.removePlaytest(roomId);
          return error(reply, 400, res.error.code, res.error.message);
        }
      }
      void reply.header('cache-control', 'no-store');
      return { roomId, gameId, seats: made } satisfies PlaytestCreated;
    },
  );

  app.get<{ Params: { roomId: string } }>('/api/admin/playtests/:roomId', (req, reply) => {
    const status = rooms.playtestStatus(req.params.roomId);
    return status ?? error(reply, 404, 'no-room', 'This playtest has ended.');
  });

  app.delete<{ Params: { roomId: string } }>('/api/admin/playtests/:roomId', (req, reply) =>
    rooms.removePlaytest(req.params.roomId)
      ? { ok: true }
      : error(reply, 404, 'no-room', 'This playtest has ended.'),
  );
}
