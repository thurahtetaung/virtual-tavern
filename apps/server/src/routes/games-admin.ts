import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import {
  type AdminGameMusic,
  type AdminGamesResponse,
  type MusicMap,
  categoryBody,
  categoryOrderBody,
  firstIssueMessage,
  gameSettingsBody,
  newCategoryBody,
} from '@vt/protocol';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  type GameSettingsStore,
  SettingsError,
  effectiveMusic,
  manifestTracks,
  musicPhasesOf,
  unknownTrack,
} from '../game-settings.ts';
import { type GameRegistry, isPrivate } from '../games/registry.ts';
import { type R2Assets, assetKey } from '../r2.ts';

const error = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.code(status).send({ error: { code, message } });

/**
 * The admin's Games page: every game's settings (on/off, categories, a back-room game's title,
 * music) and the category list. Registered inside the admin guard; every change answers with the
 * whole page. The page also reads a music game's manifest and assets here (to preview music), so
 * an admin needn't unlock the back room.
 */
export function gamesAdminRoutes(
  app: FastifyInstance,
  opts: { games: GameRegistry; assets: R2Assets | null; settings: GameSettingsStore },
) {
  const { games, assets, settings } = opts;
  const run = (reply: FastifyReply, change: () => void): AdminGamesResponse | FastifyReply => {
    try {
      change();
    } catch (err) {
      if (err instanceof SettingsError) return error(reply, err.status, err.code, err.message);
      throw err;
    }
    return settings.admin();
  };
  const manifestOf = async (gameId: string) =>
    assets ? await assets.json(`${gameId}/manifest.json`) : null;

  app.get('/api/admin/games', () => settings.admin());

  app.put<{ Params: { gameId: string } }>('/api/admin/games/:gameId', async (req, reply) => {
    const body = gameSettingsBody.safeParse(req.body);
    if (!body.success) return error(reply, 400, 'bad-request', firstIssueMessage(body.error));
    const { gameId } = req.params;
    const music = body.data.music;
    // Chosen tracks must be the manifest's own.
    if (music && musicPhasesOf(games.get(gameId)).length) {
      if (!assets) return error(reply, 503, 'no-assets', 'Upload the game’s assets first.');
      const bad = unknownTrack(music, manifestTracks(await manifestOf(gameId)));
      if (bad) return error(reply, 400, 'bad-request', `"${bad}" is not one of the game’s tracks.`);
    }
    return run(reply, () => settings.update(gameId, body.data));
  });

  // A music game's manifest defaults and tracks, for the music picker.
  app.get<{ Params: { gameId: string } }>(
    '/api/admin/games/:gameId/music',
    async (req, reply): Promise<AdminGameMusic | FastifyReply> => {
      const phases = musicPhasesOf(games.get(req.params.gameId));
      if (!phases.length) return error(reply, 404, 'not-found', 'This game has no music.');
      const manifest = (await manifestOf(req.params.gameId)) as {
        music?: unknown;
        musicTracks?: AdminGameMusic['tracks'];
      } | null;
      const override: MusicMap | null = settings.music(req.params.gameId);
      return {
        override,
        defaults: manifest ? effectiveMusic(manifest.music, null, phases) : null,
        effective: manifest ? effectiveMusic(manifest.music, override, phases) : null,
        tracks: manifest?.musicTracks ?? null,
      };
    },
  );

  app.post('/api/admin/games/categories', (req, reply) => {
    const body = newCategoryBody.safeParse(req.body);
    if (!body.success) return error(reply, 400, 'bad-request', firstIssueMessage(body.error));
    return run(reply, () => settings.addCategory(body.data));
  });

  app.put('/api/admin/games/categories/order', (req, reply) => {
    const body = categoryOrderBody.safeParse(req.body);
    if (!body.success) return error(reply, 400, 'bad-request', 'Send { "ids": ["…", …] }.');
    return run(reply, () => settings.reorderCategories(body.data.ids));
  });

  app.put<{ Params: { id: string } }>('/api/admin/games/categories/:id', (req, reply) => {
    const body = categoryBody.safeParse(req.body);
    if (!body.success) return error(reply, 400, 'bad-request', firstIssueMessage(body.error));
    return run(reply, () => settings.updateCategory(req.params.id, body.data));
  });

  app.delete<{ Params: { id: string } }>('/api/admin/games/categories/:id', (req, reply) =>
    run(reply, () => settings.removeCategory(req.params.id)),
  );

  // The same private objects the back room streams, for the admin's previews.
  app.get<{ Params: { gameId: string; '*': string } }>(
    '/api/admin/backroom-assets/:gameId/*',
    async (req, reply) => {
      if (!isPrivate(games.get(req.params.gameId)))
        return error(reply, 404, 'not-found', 'No such back-room game.');
      if (!assets) return error(reply, 503, 'no-assets', 'Private assets are not configured.');
      const key = assetKey(req.params.gameId, req.params['*']);
      if (!key) return error(reply, 400, 'bad-path', 'Bad asset path.');
      const object = await assets.object(key, req.headers);
      if (!object) return error(reply, 404, 'not-found', 'Not found.');
      void reply.code(object.status).headers(object.headers);
      void reply.header('cache-control', 'private, no-store');
      void reply.header('accept-ranges', 'bytes');
      if (!object.body) return reply.send();
      return reply.send(Readable.fromWeb(object.body as NodeReadableStream));
    },
  );
}
