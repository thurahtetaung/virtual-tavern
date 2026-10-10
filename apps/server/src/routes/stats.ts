import { Readable } from 'node:stream';
import {
  type StatsQuery,
  statsExportQuery,
  statsQuery,
  statsResetBody,
  statsTimeseriesQuery,
  statsWordsQuery,
} from '@vt/protocol';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { dayOf, resolveWindow } from '../stats/days.ts';
import type { LiveTracker } from '../stats/live.ts';
import type { StatsQueries, StatsStore } from '../stats/types.ts';

const error = (reply: FastifyReply, status: number, code: string, message: string) =>
  reply.code(status).send({ error: { code, message } });

/** Per client (admin), across every stats route. */
const RATE_LIMIT = { rateLimit: { max: 120, timeWindow: '1 minute' } };

export interface StatsRouteOptions {
  queries: StatsQueries;
  store: Pick<StatsStore, 'exportNdjson' | 'reset'>;
  live: LiveTracker;
  gameIds: readonly string[];
  /** Writes buffered events first, so reads include the last few seconds. */
  flush: () => void;
  /** Called after a reset, to drop anything in progress. */
  onReset: () => void;
  now: () => number;
}

/** `/api/admin/stats/*`. Register inside a scope that already requires an admin. */
export function statsRoutes(app: FastifyInstance, opts: StatsRouteOptions) {
  const { queries, gameIds, now } = opts;

  app.addHook('onSend', (_req, reply, payload, done) => {
    void reply.header('cache-control', 'private, no-store');
    done(null, payload);
  });

  const parse = <S extends z.ZodType>(schema: S, value: unknown, reply: FastifyReply) => {
    const parsed = schema.safeParse(value);
    if (!parsed.success) {
      void error(reply, 400, 'bad-request', parsed.error.issues[0]?.message ?? 'Bad request.');
      return null;
    }
    return parsed.data;
  };

  /** The window for a query, or null once a 400 has been sent. */
  const windowFor = (
    q: Pick<StatsQuery, 'range' | 'from' | 'to' | 'bucket'>,
    reply: FastifyReply,
  ) => {
    opts.flush();
    const w = resolveWindow(q, dayOf(now()), queries.firstDay());
    if (typeof w === 'string') {
      void error(reply, 400, 'bad-request', w);
      return null;
    }
    return w;
  };

  /** Parses `statsQuery` and resolves its window; also checks `game` names a real game. */
  const historical = (req: FastifyRequest, reply: FastifyReply) => {
    const q = parse(statsQuery, req.query, reply);
    if (!q) return null;
    if (q.game !== undefined && !gameIds.includes(q.game)) {
      void error(reply, 400, 'bad-request', `"${q.game}" is not a game.`);
      return null;
    }
    const w = windowFor(q, reply);
    return w ? { q, w } : null;
  };

  const route = (path: string, handler: (req: FastifyRequest, reply: FastifyReply) => unknown) =>
    app.get(`/api/admin/stats/${path}`, { config: RATE_LIMIT }, handler);

  route('live', () => opts.live.snapshot());

  route('overview', (req, reply) => {
    const h = historical(req, reply);
    return h ? queries.overview(h.w) : reply;
  });

  route('timeseries', (req, reply) => {
    const extra = parse(
      statsTimeseriesQuery,
      { metric: (req.query as { metric?: unknown }).metric },
      reply,
    );
    if (!extra) return reply;
    const h = historical(req, reply);
    return h ? queries.timeseries(extra.metric, h.w, h.q.game) : reply;
  });

  route('games', (req, reply) => {
    const h = historical(req, reply);
    return h ? queries.games(h.w) : reply;
  });

  app.get<{ Params: { id: string } }>(
    '/api/admin/stats/games/:id',
    { config: RATE_LIMIT },
    (req, reply) => {
      if (!gameIds.includes(req.params.id)) return error(reply, 404, 'not-found', 'No such game.');
      const h = historical(req, reply);
      return h ? queries.game(req.params.id, h.w) : reply;
    },
  );

  route('players', (req, reply) => {
    const h = historical(req, reply);
    return h ? queries.players(h.w) : reply;
  });

  app.get<{ Params: { id: string } }>(
    '/api/admin/stats/players/:id',
    { config: RATE_LIMIT },
    (req, reply) => {
      const h = historical(req, reply);
      if (!h) return reply;
      return (
        queries.player(req.params.id, h.w) ?? error(reply, 404, 'not-found', 'No such player.')
      );
    },
  );

  route('words', (req, reply) => {
    const q = parse(statsWordsQuery, req.query, reply);
    if (!q) return reply;
    if (!gameIds.includes(q.game))
      return error(reply, 400, 'bad-request', `"${q.game}" is not a game.`);
    const w = windowFor(q, reply);
    return w ? queries.words(q.game, q.kind, w, q.limit) : reply;
  });

  route('settings', (req, reply) => {
    const h = historical(req, reply);
    if (!h) return reply;
    if (!h.q.game) return error(reply, 400, 'bad-request', 'Name a game.');
    return queries.settings(h.q.game, h.w);
  });

  route('heatmap', (req, reply) => {
    const h = historical(req, reply);
    return h ? queries.heatmap(h.w, h.q.game) : reply;
  });

  route('fun', (req, reply) => {
    const h = historical(req, reply);
    return h ? queries.fun(h.w) : reply;
  });

  // Raw events as NDJSON, for backups and a later move to a column store.
  route('export', (req, reply) => {
    const q = parse(statsExportQuery, req.query, reply);
    if (!q) return reply;
    opts.flush();
    const from = q.from ?? '0000-01-01';
    const to = q.to ?? '9999-12-31';
    if (from > to) return error(reply, 400, 'bad-request', 'from must not be after to.');
    const name = `stats-${q.from ?? 'start'}-to-${q.to ?? dayOf(now())}.ndjson`;
    return reply
      .header('content-type', 'application/x-ndjson; charset=utf-8')
      .header('content-disposition', `attachment; filename="${name}"`)
      .send(Readable.from(opts.store.exportNdjson(from, to)));
  });

  app.post('/api/admin/stats/reset', { config: RATE_LIMIT }, (req, reply) => {
    const body = parse(statsResetBody, req.body, reply);
    if (!body) return reply;
    opts.flush();
    opts.store.reset();
    opts.onReset();
    return { ok: true };
  });
}
