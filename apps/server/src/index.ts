import type { Server } from 'node:http';
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { serveMetrics } from './metrics/server.ts';
import { TavernMetrics } from './metrics/tavern.ts';

const config = loadConfig();

// A metric that fails to read is left out of that scrape and logged.
const metrics =
  config.metricsPort === null
    ? null
    : new TavernMetrics((metric, err) => app.log.warn({ err, metric }, 'metric failed'));
const app = buildApp({
  ...config,
  logger: { level: config.logLevel },
  metrics,
});
let metricsServer: Server | null = null;

// Stop listening, drain sockets and close the database; if that hangs, exit anyway.
const SHUTDOWN_DEADLINE_MS = 8_000;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    setTimeout(() => {
      app.log.error('shutdown timed out; exiting');
      process.exit(1);
    }, SHUTDOWN_DEADLINE_MS).unref();
    metricsServer?.close();
    metrics?.close();
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.port, host: config.host });
if (metrics && config.metricsPort !== null) {
  metricsServer = await serveMetrics(metrics, config.metricsPort, config.metricsHost);
  app.log.info({ port: config.metricsPort }, 'serving metrics');
}
if (!config.adminPassword) app.log.warn('ADMIN_PASSWORD is not set; the admin area is disabled.');
