import { type StagePaired, stagePairBody } from '@vt/protocol';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { STAGE_COOKIE, STAGE_SESSION_MS, type StageDoor } from '../stage.ts';

/** Pairing attempts one address may make a minute (a code is 29^6 guesses, open 10 minutes). */
export const STAGE_PAIR_LIMIT = 10;

/** The table screen's pairing: a code from the host's phone buys a pass for that one room. */
export function stageRoutes(
  app: FastifyInstance,
  opts: {
    door: StageDoor;
    /** The room this request's table-screen pass opens right now, or null. */
    stageRoom: (req: FastifyRequest) => string | null;
  },
) {
  const { door, stageRoom } = opts;

  app.post(
    '/api/stage/pair',
    { config: { rateLimit: { max: STAGE_PAIR_LIMIT, timeWindow: '1 minute' } } },
    (req, reply) => {
      const body = stagePairBody.safeParse(req.body);
      if (!body.success)
        return reply
          .code(400)
          .send({ error: { code: 'bad-code', message: body.error.issues[0]!.message } });
      const paired = door.pair(body.data.code);
      if (!paired)
        return reply.code(404).send({
          error: {
            code: 'bad-code',
            message:
              'That code didn’t work. Codes work once, for 10 minutes: ask the host for a new one.',
          },
        });
      void reply.setCookie(STAGE_COOKIE, paired.pass, {
        signed: true,
        httpOnly: true,
        sameSite: 'lax',
        secure: 'auto',
        path: '/',
        maxAge: STAGE_SESSION_MS / 1000,
      });
      return { roomId: paired.roomId } satisfies StagePaired;
    },
  );

  // A table screen that reloads finds its room again.
  app.get('/api/stage', (req, reply) => {
    void reply.header('cache-control', 'no-store');
    const roomId = stageRoom(req);
    if (!roomId)
      return reply
        .code(404)
        .send({ error: { code: 'stage-unpaired', message: 'This screen is not paired.' } });
    return { roomId } satisfies StagePaired;
  });

  app.post('/api/stage/forget', (_req, reply) => {
    void reply.clearCookie(STAGE_COOKIE, { path: '/' });
    return { ok: true };
  });
}
