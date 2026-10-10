import Fastify, { type FastifyServerOptions } from 'fastify';

export interface AppOptions {
  version: string;
  logger?: FastifyServerOptions['logger'];
}

export function buildApp({ version, logger = false }: AppOptions) {
  const app = Fastify({ logger });

  app.get('/healthz', () => ({ status: 'ok', version }));

  return app;
}
