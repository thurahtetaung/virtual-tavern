import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();

const app = buildApp({
  ...config,
  logger: { level: config.logLevel },
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ port: config.port, host: config.host });
if (!config.adminPassword) app.log.warn('ADMIN_PASSWORD is not set; the admin area is disabled.');
