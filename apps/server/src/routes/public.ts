import {
  type GameSummary,
  type NextTable,
  createRoomBody,
  playerToken,
  roomId,
} from '@vt/protocol';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type GameRegistry, isPrivate } from '../games/registry.ts';
import { playerIdFromToken } from '../rooms/ids.ts';
import type { RoomManager } from '../rooms/manager.ts';
import type { WordListRepo } from '../word-lists.ts';
import { z } from 'zod';

/** The browser's secret token; the server only ever keeps the id derived from it. */
const forgetBody = z.object({ token: playerToken });

export function publicRoutes(
  app: FastifyInstance,
  opts: {
    rooms: RoomManager;
    wordLists: WordListRepo;
    games: GameRegistry;
    /** Whether this request carries a current back-room unlock. */
    unlocked: (req: FastifyRequest) => boolean;
    /** Admin-set titles for private games, sent only to unlocked browsers. */
    titles?: { title(gameId: string): string | null };
    /** Deletes what stats keep about a player; returns how many rows changed. */
    forget?: (playerId: string) => number;
    /**
     * "Same crew, new game": the rooms of `nightKey` the player is in (they may continue it),
     * or null when they may not.
     */
    linkable?: (nightKey: string, playerId: string) => string[] | null;
    /** A linked room was opened: tell the rooms it continues. */
    linked?: (from: string[], next: NextTable) => void;
    /** Whether the request is test traffic (`x-vt-test`), whose rooms record no stats. */
    isTestTraffic?: (req: FastifyRequest) => boolean;
    /** Rooms one address may create a minute. */
    roomCreateLimit?: number;
    /** Whether this request carries a current admin session (playtest rooms are theirs only). */
    isAdmin?: (req: FastifyRequest) => boolean;
  },
) {
  const { rooms, wordLists, games, unlocked, titles, forget, linkable, linked } = opts;
  const isTestTraffic = opts.isTestTraffic ?? (() => false);
  // A private game's title from the database; it only goes where the game itself is visible.
  const titleOf = (gameId: string) => {
    if (!isPrivate(games.get(gameId))) return {};
    const title = titles?.title(gameId);
    return title ? { title } : {};
  };
  // Private games behave as if they don't exist for anyone who hasn't unlocked the back room.
  const visible = (req: FastifyRequest, gameId: string) => {
    const game = games.get(gameId);
    return !!game && (!isPrivate(game) || unlocked(req));
  };

  app.get('/api/games', (req): GameSummary[] =>
    [...games.values()]
      .filter((g) => visible(req, g.id))
      .map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        minPlayers: g.minPlayers,
        maxPlayers: g.maxPlayers,
        private: g.access === 'private',
        wordLists: g.usesWordLists === true,
        questionDecks: g.usesQuestionDecks === true,
        ...titleOf(g.id),
      })),
  );

  // Only enabled lists; `?game=<id>` keeps only the lists that game offers.
  app.get<{ Querystring: { game?: unknown } }>('/api/word-lists', (req) => {
    const { game } = req.query;
    return wordLists.listEnabled(typeof game === 'string' && game ? game : undefined);
  });

  app.post(
    '/api/rooms',
    { config: { rateLimit: { max: opts.roomCreateLimit ?? 20, timeWindow: '1 minute' } } },
    (req, reply) => {
      const body = createRoomBody.safeParse(req.body);
      if (!body.success || !visible(req, body.data.gameId)) {
        return reply.code(400).send({ error: { code: 'bad-request', message: 'Unknown game.' } });
      }
      const { gameId, token, nightKey } = body.data;
      const playerId = playerIdFromToken(token);
      // Only someone who was there may continue a night (it merges the two rooms' recaps).
      const from = nightKey ? (linkable?.(nightKey, playerId) ?? null) : [];
      if (!from) {
        return reply.code(400).send({
          error: { code: 'bad-night', message: "That night can't be continued from here." },
        });
      }
      const id = rooms.create(gameId, playerId, {
        ...(nightKey && { nightKey }),
        ...(isTestTraffic(req) && { test: true }),
      });
      if (from.length) linked?.(from, { roomId: id, gameId, by: playerId });
      return { roomId: id };
    },
  );

  // "Forget me": the browser proves who it is with its own token, so nobody can erase someone else.
  app.post(
    '/api/me/forget',
    { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
    (req, reply) => {
      const body = forgetBody.safeParse(req.body);
      if (!body.success || !forget) {
        return reply
          .code(400)
          .send({ error: { code: 'bad-request', message: 'Nothing to forget.' } });
      }
      return { ok: true, removed: forget(playerIdFromToken(body.data.token)) };
    },
  );

  app.get<{ Params: { id: string } }>('/api/rooms/:id', (req, reply) => {
    const room = roomId.safeParse(req.params.id).success ? rooms.exists(req.params.id) : null;
    const playtest = !!room && rooms.isPlaytest(req.params.id);
    // A playtest is the admin's alone: to anyone else it looks like a dead link.
    if (!room || !games.has(room.gameId) || (playtest && !opts.isAdmin?.(req))) {
      return reply
        .code(404)
        .send({ error: { code: 'no-room', message: 'This room does not exist or has expired.' } });
    }
    // The admin plays any game in a playtest, back-room ones too, with no unlock needed.
    if (playtest) {
      void reply.header('cache-control', 'no-store');
      return { id: req.params.id, gameId: room.gameId, ...titleOf(room.gameId), playtest: true };
    }
    // A locked player learns only that the room is private, never which game it is.
    if (!visible(req, room.gameId)) {
      return reply
        .code(403)
        .send({ error: { code: 'backroom-locked', message: 'This room is in the back room.' } });
    }
    return { id: req.params.id, gameId: room.gameId, ...titleOf(room.gameId) };
  });
}
