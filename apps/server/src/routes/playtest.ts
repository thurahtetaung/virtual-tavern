import { randomBytes } from 'node:crypto';
import {
  MAX_PLAYTEST_SEATS,
  type PlaytestCreated,
  type PlaytestGame,
  type PlaytestSeatInfo,
  createPlaytestBody,
  firstIssueMessage,
  updatePlaytestBody,
} from '@vt/protocol';
import { type AnyGameDefinition, seatLimit } from '@vt/game-sdk';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { type GameRegistry, isPrivate } from '../games/registry.ts';
import { playerIdFromToken } from '../rooms/ids.ts';
import type { RoomManager } from '../rooms/manager.ts';
import { nameTaken } from '../rooms/names.ts';

const error = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.code(status).send({ error: { code, message } });

/** A fresh seat secret, in the same format as a browser's `playerToken`. */
export const seatToken = () => randomBytes(32).toString('base64url');

/** Most seats a playtest of `game` may have: as many as can play it, capped. */
export const maxSeats = (game: AnyGameDefinition) => Math.min(seatLimit(game), MAX_PLAYTEST_SEATS);

/**
 * The admin's playtests: rooms that record nothing, whose seats are all played from the admin's
 * own browser, one tab per seat. Register behind `adminGuard`.
 */
export function playtestRoutes(
  app: FastifyInstance,
  opts: {
    rooms: RoomManager;
    games: GameRegistry;
    /** Admin-set titles for private games, and which games are off (playtests still allowed). */
    settings?: { title(gameId: string): string | null; enabled(gameId: string): boolean };
    now: () => number;
    /** The seed a test browser asks for its new room (test builds only). */
    testSeedOf?: (req: FastifyRequest) => string | undefined;
  },
) {
  const { rooms, games, settings, now } = opts;

  app.get('/api/admin/playtest/games', (): PlaytestGame[] =>
    [...games.values()].map((g) => ({
      id: g.id,
      name: (isPrivate(g) && settings?.title(g.id)) || g.name,
      private: isPrivate(g),
      minPlayers: g.minPlayers,
      maxSeats: maxSeats(g),
      bots: !g.bot ? 'none' : g.botInfo?.note ? 'some' : 'all',
      ...(g.bot && g.botInfo?.note && { botNote: g.botInfo.note }),
      ...(settings?.enabled(g.id) === false && { off: true as const }),
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
      const most = maxSeats(game);
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
      if (seats.some((s) => s.bot) && !game.bot)
        return error(reply, 400, 'no-bots', `${game.name} has no bots yet: every seat is a tab.`);
      // The host is a person: the first human seat.
      const firstHuman = seats.findIndex((s) => !s.bot);
      if (firstHuman < 0)
        return error(reply, 400, 'bad-seats', 'At least one seat must be you, in a tab.');
      // Bots get ids from tokens thrown away at once, so nobody can ever join as one.
      const made: PlaytestSeatInfo[] = seats.map((s) => {
        const token = seatToken();
        return {
          name: s.name,
          playerId: playerIdFromToken(token),
          ...(s.bot ? { bot: true as const } : { token }),
        };
      });
      const host = made[firstHuman]!;
      const testSeed = opts.testSeedOf?.(req);
      const roomId = rooms.create(gameId, host.playerId, {
        ...(testSeed && { testSeed }),
        playtest: {
          bots: made.filter((s) => s.bot).map((s) => ({ id: s.playerId, name: s.name })),
          speed: 'normal',
          paused: false,
          createdAt: now(),
        },
      });
      // Seated now, host first, so names, join order and the host are fixed before any tab opens.
      for (const seat of [host, ...made.filter((s) => s !== host)]) {
        const res = rooms.join(roomId, seat.playerId, seat.name, { admin: true });
        if (!res.ok) {
          rooms.removePlaytest(roomId);
          return error(reply, 400, res.error.code, res.error.message);
        }
      }
      // The game's own playtest setup (a human-only role goes to the host), as the host.
      if (made.some((s) => s.bot))
        for (const action of game.botInfo?.setup?.(host.playerId) ?? [])
          rooms.act(roomId, host.playerId, action);
      void reply.header('cache-control', 'no-store');
      return { roomId, gameId, seats: made } satisfies PlaytestCreated;
    },
  );

  app.get<{ Params: { roomId: string } }>('/api/admin/playtests/:roomId', (req, reply) => {
    const status = rooms.playtestStatus(req.params.roomId);
    return status ?? error(reply, 404, 'no-room', 'This playtest has ended.');
  });

  // Bot speed and pause, and bot seats in the lobby.
  app.patch<{ Params: { roomId: string } }>('/api/admin/playtests/:roomId', (req, reply) => {
    const body = updatePlaytestBody.safeParse(req.body);
    if (!body.success) return error(reply, 400, 'bad-request', firstIssueMessage(body.error));
    const { roomId } = req.params;
    const status = rooms.playtestStatus(roomId);
    if (!status) return error(reply, 404, 'no-room', 'This playtest has ended.');
    const { paused, speed, addBot, removeBot } = body.data;
    // No more seats than can play: a bot past that would only watch.
    const game = games.get(status.gameId);
    if (addBot !== undefined && game && status.players.length >= maxSeats(game))
      return error(reply, 400, 'full', `${game.name} takes at most ${maxSeats(game)} seats.`);
    if (paused !== undefined || speed !== undefined)
      rooms.setPlaytest(roomId, {
        ...(paused !== undefined && { paused }),
        ...(speed !== undefined && { speed }),
      });
    for (const res of [
      addBot !== undefined ? rooms.addBot(roomId, addBot) : null,
      removeBot !== undefined ? rooms.removeBot(roomId, removeBot) : null,
    ]) {
      if (res && !res.ok) return error(reply, 400, res.error.code, res.error.message);
    }
    return rooms.playtestStatus(roomId);
  });

  app.delete<{ Params: { roomId: string } }>('/api/admin/playtests/:roomId', (req, reply) =>
    rooms.removePlaytest(req.params.roomId)
      ? { ok: true }
      : error(reply, 404, 'no-room', 'This playtest has ended.'),
  );
}
