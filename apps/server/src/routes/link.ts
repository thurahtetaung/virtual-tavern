import {
  type LinkCheck,
  type LinkPreview,
  type LinkRedeemed,
  type PlayerColor,
  linkBody,
} from '@vt/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { BACKROOM_COOKIE, BACKROOM_SESSION_MS, type Backroom } from '../backroom.ts';
import type { EdgePass } from '../edge.ts';
import type { LinkCodes, LinkedKeys, OpenLinkCode } from '../links.ts';
import { playerIdFromToken } from '../rooms/ids.ts';
import type { RoomManager } from '../rooms/manager.ts';

/** Code checks and redeems one address may make a minute (a code is 21^4 guesses, open 2 minutes). */
export const LINK_LIMIT = 10;

type Checked =
  { status: 'ok'; code: OpenLinkCode; preview: LinkPreview } | Exclude<LinkCheck, { status: 'ok' }>;

/**
 * Linking a phone: the PC shows a code (`room:link-code`), the phone checks it (who it will play
 * as) and redeems it for its own key to that player's seat. The key goes to the redeeming phone
 * only, and the back room comes with it only while the PC's unlock is still current.
 */
export function linkRoutes(
  app: FastifyInstance,
  opts: {
    codes: LinkCodes;
    keys: LinkedKeys;
    rooms: RoomManager;
    backroom: Backroom;
    edge: EdgePass | null;
    now: () => number;
    gameName: (gameId: string) => string;
    isPrivateRoom: (roomId: string) => boolean;
    hasBackroom: (req: FastifyRequest) => boolean;
    /** A phone was linked (replacing `replaced`, whose phone is sent away). */
    linked: (roomId: string, replaced: string | null) => void;
  },
) {
  const { codes, keys, rooms, backroom } = opts;

  /** Whether the code brings the back room along: the PC had it, at the word's current version. */
  const carries = (code: OpenLinkCode) =>
    code.backroom !== null && backroom.isOpen() && code.backroom === backroom.version();

  const check = (req: FastifyRequest, found: OpenLinkCode | 'expired' | null): Checked => {
    if (found === null) return { status: 'wrong' };
    if (found === 'expired') return { status: 'expired' };
    const body = linkBody.parse(req.body);
    const room = rooms.members(found.roomId);
    const player = room?.players.find((p) => p.id === found.playerId);
    // The player left, or the room is gone: the code is as good as spent.
    if (!room || !player) return { status: 'expired' };
    const unlocked = opts.hasBackroom(req);
    // A back-room table the phone couldn't enter: the word changed since the code was made.
    if (opts.isPrivateRoom(found.roomId) && !unlocked && !carries(found))
      return { status: 'expired' };
    const host = room.players.find((p) => p.id === room.hostId)?.name ?? '';
    // This phone already plays someone else here, as itself or on another link.
    const own = playerIdFromToken(body.token);
    const otherId =
      own !== found.playerId && room.players.some((p) => p.id === own)
        ? own
        : keys.otherSeat(found.roomId, found.playerId, body.links);
    const other = otherId ? room.players.find((p) => p.id === otherId) : undefined;
    if (other)
      return {
        status: 'other-seat',
        roomId: found.roomId,
        seat: other.name,
        host,
        name: player.name,
      };
    return {
      status: 'ok',
      code: found,
      preview: {
        game: opts.gameName(room.gameId),
        gameId: room.gameId,
        host,
        players: room.players.length,
        name: player.name,
        color: (player as { color?: PlayerColor }).color ?? 'red',
        opensBackroom: carries(found) && !unlocked,
      },
    };
  };

  const bad = (reply: FastifyReply, message: string) =>
    reply.code(400).send({ error: { code: 'bad-code', message } });

  app.post(
    '/api/link/check',
    { config: { rateLimit: { max: LINK_LIMIT, timeWindow: '1 minute' } } },
    (req, reply) => {
      void reply.header('cache-control', 'no-store');
      const body = linkBody.safeParse(req.body);
      if (!body.success) return bad(reply, body.error.issues[0]!.message);
      const res = check(req, codes.peek(body.data.code));
      if (res.status !== 'ok') return res satisfies LinkCheck;
      return { status: 'ok', preview: res.preview } satisfies LinkCheck;
    },
  );

  app.post(
    '/api/link',
    { config: { rateLimit: { max: LINK_LIMIT, timeWindow: '1 minute' } } },
    (req, reply) => {
      void reply.header('cache-control', 'no-store');
      const body = linkBody.safeParse(req.body);
      if (!body.success) return bad(reply, body.error.issues[0]!.message);
      const res = check(req, codes.peek(body.data.code));
      if (res.status !== 'ok') {
        const message =
          res.status === 'other-seat'
            ? `This phone already plays ${res.seat} in this room.`
            : res.status === 'expired'
              ? 'That code has run out. Ask your PC for a new one.'
              : 'No PC is showing that code.';
        return reply.code(409).send({ error: { code: res.status, message } });
      }
      codes.redeem(body.data.code);
      const { roomId, playerId } = res.code;
      const { key, replaced } = keys.create(roomId, playerId);
      if (res.preview.opensBackroom) {
        const unlock = backroom.issue();
        void reply.setCookie(BACKROOM_COOKIE, unlock, {
          signed: true,
          httpOnly: true,
          sameSite: 'lax',
          secure: 'auto',
          path: '/',
          maxAge: BACKROOM_SESSION_MS / 1000,
        });
        opts.edge?.set(reply, unlock, opts.now());
      }
      opts.linked(roomId, replaced);
      return { roomId, key } satisfies LinkRedeemed;
    },
  );
}
