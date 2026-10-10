import type { AnyGameDefinition } from '@vt/game-sdk';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { BACKROOM_COOKIE, BACKROOM_SESSION_MS, type Backroom } from '../backroom.ts';
import { type R2Assets, assetKey } from '../r2.ts';

const unlockBody = z.object({ password: z.string().min(1).max(200) });

const error = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.code(status).send({ error: { code, message } });

/** Unsigns the unlock cookie and checks it against the current password version. */
export function requestUnlocked(req: FastifyRequest, backroom: Backroom): boolean {
  const raw = req.cookies[BACKROOM_COOKIE];
  if (!raw) return false;
  const { valid, value } = req.unsignCookie(raw);
  return valid && backroom.isUnlocked(value);
}

export function backroomRoutes(
  app: FastifyInstance,
  opts: {
    backroom: Backroom;
    games: ReadonlyMap<string, AnyGameDefinition>;
    assets: R2Assets | null;
  },
) {
  const { backroom, games, assets } = opts;

  app.get('/api/backroom/status', (req) => ({
    open: backroom.isOpen(),
    unlocked: requestUnlocked(req, backroom),
  }));

  app.post(
    '/api/backroom/unlock',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    (req, reply) => {
      if (!backroom.isOpen())
        return error(reply, 503, 'closed', 'The back room is closed for now.');
      const body = unlockBody.safeParse(req.body);
      if (!body.success || !backroom.verify(body.data.password)) {
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

  /** Only an unlocked player asking about a real private game gets past this. */
  const privateGame = (req: FastifyRequest, reply: FastifyReply, gameId: string) => {
    const game = games.get(gameId);
    if (!requestUnlocked(req, backroom) || game?.access !== 'private') {
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
      void reply.header('cache-control', 'private, max-age=300');
      return reply.redirect(await store.signedUrl(key), 302);
    },
  );

  app.get<{ Params: { gameId: string } }>('/api/backroom/manifest/:gameId', async (req, reply) => {
    const store = privateGame(req, reply, req.params.gameId);
    if (!store) return reply;
    const manifest = await store.json(`${req.params.gameId}/manifest.json`);
    if (manifest === null) return error(reply, 404, 'not-found', 'This game has no assets yet.');
    void reply.header('cache-control', 'private, no-store');
    return manifest;
  });
}
