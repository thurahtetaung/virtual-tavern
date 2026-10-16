import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { AnyGameDefinition } from '@vt/game-sdk';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { BACKROOM_COOKIE, BACKROOM_SESSION_MS, type Backroom } from '../backroom.ts';
import { type PrivateGameSettings, effectiveMusic } from '../private-games.ts';
import { type QuestionDeckRepo, publicDeck } from '../question-decks.ts';
import { type R2Assets, assetKey } from '../r2.ts';

const unlockBody = z.object({ password: z.string().min(1).max(200) });

const error = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.code(status).send({ error: { code, message } });

export function backroomRoutes(
  app: FastifyInstance,
  opts: {
    backroom: Backroom;
    games: ReadonlyMap<string, AnyGameDefinition>;
    assets: R2Assets | null;
    questionDecks: QuestionDeckRepo;
    privateGames?: PrivateGameSettings;
    /** Whether the request has the back room: a current unlock, or a current admin session. */
    hasBackroom: (req: FastifyRequest) => boolean;
    /** Whether the request carries a current admin session (it needs no password). */
    isAdmin?: (req: FastifyRequest) => boolean;
  },
) {
  const { backroom, games, assets, questionDecks, privateGames, hasBackroom } = opts;
  const isAdmin = opts.isAdmin ?? (() => false);

  app.get('/api/backroom/status', (req) => ({
    open: backroom.isOpen(),
    unlocked: hasBackroom(req),
    ...(isAdmin(req) && { admin: true }),
  }));

  app.post(
    '/api/backroom/unlock',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
          // In the door's own voice; the client counts down from the Retry-After header.
          errorResponseBuilder: (_req, context) =>
            Object.assign(
              new Error(
                `The bouncer's had enough knocking for now. Try again in ${context.after}.`,
              ),
              { statusCode: context.statusCode },
            ),
        },
      },
    },
    async (req, reply) => {
      if (!backroom.isOpen())
        return error(reply, 503, 'closed', 'The back room is closed for now.');
      const body = unlockBody.safeParse(req.body);
      if (!body.success || !(await backroom.verify(body.data.password))) {
        return error(
          reply,
          401,
          'wrong-word',
          "That's not the word. The bouncer shakes their head.",
        );
      }
      void reply.setCookie(BACKROOM_COOKIE, backroom.issue(), {
        signed: true,
        httpOnly: true,
        sameSite: 'lax',
        secure: 'auto',
        path: '/',
        maxAge: BACKROOM_SESSION_MS / 1000,
      });
      return { ok: true };
    },
  );

  app.post('/api/backroom/lock', (_req, reply) => {
    void reply.clearCookie(BACKROOM_COOKIE, { path: '/' });
    return { ok: true };
  });

  /** Only an unlocked player (or the admin) asking about a real private game gets past this. */
  const privateGame = (req: FastifyRequest, reply: FastifyReply, gameId: string) => {
    const game = games.get(gameId);
    if (!hasBackroom(req) || game?.access !== 'private') {
      void error(reply, 404, 'not-found', 'Not found.');
      return null;
    }
    if (!assets) {
      void error(reply, 503, 'no-assets', 'Private assets are not configured on this server.');
      return null;
    }
    return assets;
  };

  app.get<{ Params: { gameId: string; '*': string } }>(
    '/api/backroom/assets/:gameId/*',
    async (req, reply) => {
      const store = privateGame(req, reply, req.params.gameId);
      if (!store) return reply;
      const key = assetKey(req.params.gameId, req.params['*']);
      if (!key) return error(reply, 400, 'bad-path', 'Bad asset path.');
      const object = await store.object(key, req.headers);
      if (!object) return error(reply, 404, 'not-found', 'Not found.');
      // Art never changes once published, so each browser fetches it once and keeps it. `private`
      // keeps it out of the CDN: every fetch must pass the unlock check above.
      void reply.code(object.status).headers(object.headers);
      void reply.header('cache-control', 'private, max-age=31536000, immutable');
      void reply.header('accept-ranges', 'bytes');
      if (!object.body) return reply.send();
      return reply.send(Readable.fromWeb(object.body as NodeReadableStream));
    },
  );

  // The question decks a private trivia game offers: enabled decks tagged for it, as summaries
  // only (never questions, answers or decoys). Deck names are protected content too, so this
  // answers only unlocked players (and the admin) asking about a private game that uses decks.
  app.get<{ Params: { gameId: string } }>('/api/backroom/question-decks/:gameId', (req, reply) => {
    const game = games.get(req.params.gameId);
    if (!hasBackroom(req) || game?.access !== 'private' || !game.usesQuestionDecks)
      return error(reply, 404, 'not-found', 'Not found.');
    void reply.header('cache-control', 'private, no-store');
    return questionDecks.listEnabled(game.id).map(publicDeck);
  });

  app.get<{ Params: { gameId: string } }>('/api/backroom/manifest/:gameId', async (req, reply) => {
    const store = privateGame(req, reply, req.params.gameId);
    if (!store) return reply;
    const manifest = await store.json(`${req.params.gameId}/manifest.json`);
    if (manifest === null) return error(reply, 404, 'not-found', 'This game has no assets yet.');
    void reply.header('cache-control', 'private, no-store');
    // The admin's music choices replace the manifest's defaults, phase by phase.
    const override = privateGames?.music(req.params.gameId) ?? null;
    if (override && typeof manifest === 'object' && !Array.isArray(manifest)) {
      const m = manifest as { music?: unknown };
      return { ...m, music: effectiveMusic(m.music, override) };
    }
    return manifest;
  });
}
