import { type NextTable, createRoomBody, playerToken, roomId } from '@vt/protocol';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type GameRegistry, isPrivate } from '../games/registry.ts';
import { playerIdFromToken } from '../rooms/ids.ts';
import type { RoomManager } from '../rooms/manager.ts';
import type { Lists } from './lists.ts';
import type { Manifests } from './manifests.ts';
import { sendRevalidated } from './revalidate.ts';
import { z } from 'zod';

/** Seconds a browser keeps a versioned game or word list (a change is a new URL). */
export const LIST_MAX_AGE = 86_400;

/** The browser's secret token; the server only ever keeps the id derived from it. */
const forgetBody = z.object({ token: playerToken });

export function publicRoutes(
  app: FastifyInstance,
  opts: {
    rooms: RoomManager;
    games: GameRegistry;
    /** The game and word lists, with their versions. */
    lists: Lists;
    /** Back-room manifests' versions, for a private game's room. */
    manifests?: Manifests;
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
  const { rooms, games, lists, forget, linkable, linked } = opts;
  const isTestTraffic = opts.isTestTraffic ?? (() => false);
  const titleOf = (gameId: string) => lists.titleOf(gameId);
  const visible = (req: FastifyRequest, gameId: string) => lists.visible(req, gameId);

  // A versioned list (`?v=`, the version the page was given) is kept for a day: any change is a
  // new version, so a new URL. A stale or missing version is revalidated on every load. The game
  // list depends on the back-room cookies, so its tag is of this request's own answer.
  const maxAge = (v: unknown, current: string) => (v === current ? LIST_MAX_AGE : undefined);

  app.get<{ Querystring: { v?: unknown } }>('/api/games', (req, reply) => {
    const list = lists.games(req);
    return sendRevalidated(req, reply, list, {
      maxAge: maxAge(req.query.v, lists.version(list)),
      vary: 'Cookie',
    });
  });

  // Only enabled lists; `?game=<id>` keeps only the lists that game offers.
  app.get<{ Querystring: { game?: unknown; v?: unknown } }>('/api/word-lists', (req, reply) => {
    const { game } = req.query;
    const enabled = lists.wordLists(typeof game === 'string' && game ? game : undefined);
    return sendRevalidated(req, reply, enabled, {
      maxAge: maxAge(req.query.v, lists.version(enabled)),
    });
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

  // A back-room room's manifest version, when the server has it in memory; otherwise the server
  // reads it now, without waiting, so the page's own request a moment later finds it ready.
  const manifestVersions = (gameId: string): Record<string, string> => {
    const v = opts.manifests?.cachedVersion(gameId);
    if (!v) opts.manifests?.warm(gameId);
    return v ? { [gameId]: v } : {};
  };

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
    // The lists' versions, so the room asks for URLs its browser may keep.
    const versions = {
      games: lists.gamesVersion(req),
      ...(games.get(room.gameId)?.usesWordLists && {
        wordLists: lists.wordListsVersion(room.gameId),
      }),
      ...(isPrivate(games.get(room.gameId)) && { manifests: manifestVersions(room.gameId) }),
    };
    return { id: req.params.id, gameId: room.gameId, ...titleOf(room.gameId), versions };
  });
}
