import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();

const app = buildApp({
  ...config,
  logger: { level: config.logLevel },
});

// Stop listening, drain sockets and close the database; if that hangs, exit anyway.
const SHUTDOWN_DEADLINE_MS = 8_000;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    app.log.info({ signal }, 'shutting down');
    setTimeout(() => {
      app.log.error('shutdown timed out; exiting');
      process.exit(1);
    }, SHUTDOWN_DEADLINE_MS).unref();
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.port, host: config.host });
if (!config.adminPassword) app.log.warn('ADMIN_PASSWORD is not set; the admin area is disabled.');
