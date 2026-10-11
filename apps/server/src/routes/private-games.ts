import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { type GameRegistry, isPrivate } from '../games/registry.ts';
import {
  type MusicMap,
  type PrivateGameSettings,
  effectiveMusic,
  gameTitleBody,
  manifestTracks,
  musicBody,
  unknownTrack,
} from '../private-games.ts';
import { type R2Assets, assetKey } from '../r2.ts';

const error = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.code(status).send({ error: { code, message } });

/**
 * Admin-only settings for back-room games: their titles and music. Registered inside the admin
 * guard. The admin page also reads a game's manifest and assets here (to preview music), so an
 * admin needn't unlock the back room.
 */
export function privateGameAdminRoutes(
  app: FastifyInstance,
  opts: { games: GameRegistry; assets: R2Assets | null; settings: PrivateGameSettings },
) {
  const { games, assets, settings } = opts;
  const privateGame = (reply: FastifyReply, gameId: string) => {
    if (isPrivate(games.get(gameId))) return true;
    void error(reply, 404, 'not-found', 'No such back-room game.');
    return false;
  };
  const manifestOf = async (gameId: string) =>
    assets ? await assets.json(`${gameId}/manifest.json`) : null;

  app.get('/api/admin/game-titles', () =>
    [...games.values()]
      .filter((g) => isPrivate(g))
      .map((g) => ({ gameId: g.id, name: g.name, title: settings.title(g.id) })),
  );

  app.put<{ Params: { gameId: string } }>('/api/admin/game-titles/:gameId', (req, reply) => {
    if (!privateGame(reply, req.params.gameId)) return reply;
    const body = gameTitleBody.safeParse(req.body);
    if (!body.success)
      return error(reply, 400, 'bad-request', 'Send { "title": "…" } (80 characters at most).');
    settings.setTitle(req.params.gameId, body.data.title || null);
    return { gameId: req.params.gameId, title: settings.title(req.params.gameId) };
  });

  app.get<{ Params: { gameId: string } }>('/api/admin/game-music/:gameId', async (req, reply) => {
    if (!privateGame(reply, req.params.gameId)) return reply;
    const manifest = (await manifestOf(req.params.gameId)) as {
      music?: unknown;
      musicTracks?: unknown;
    } | null;
    const override = settings.music(req.params.gameId);
    return {
      override,
      defaults: manifest ? effectiveMusic(manifest.music, null) : null,
      effective: manifest ? effectiveMusic(manifest.music, override) : null,
      tracks: manifest?.musicTracks ?? null,
    };
  });

  app.put<{ Params: { gameId: string } }>('/api/admin/game-music/:gameId', async (req, reply) => {
    if (!privateGame(reply, req.params.gameId)) return reply;
    const body = musicBody.safeParse(req.body);
    if (!body.success)
      return error(reply, 400, 'bad-request', 'Send { "music": { "night": ["music/…"] } }.');
    const music = body.data.music as MusicMap | null;
    if (music) {
      if (!assets) return error(reply, 503, 'no-assets', 'Upload the game’s assets first.');
      const tracks = manifestTracks(await manifestOf(req.params.gameId));
      const bad = unknownTrack(music, tracks);
      if (bad) return error(reply, 400, 'bad-request', `"${bad}" is not one of the game’s tracks.`);
    }
    settings.setMusic(req.params.gameId, music);
    return { override: settings.music(req.params.gameId) };
  });

  // The same private objects the back room streams, for the admin's previews.
  app.get<{ Params: { gameId: string; '*': string } }>(
    '/api/admin/backroom-assets/:gameId/*',
    async (req, reply) => {
      if (!privateGame(reply, req.params.gameId)) return reply;
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
