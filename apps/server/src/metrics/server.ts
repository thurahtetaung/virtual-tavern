import { type Server, createServer } from 'node:http';
import type { TavernMetrics } from './tavern.ts';

/**
 * Serves `GET /metrics` on its own port, apart from the app: the app's port is what the public
 * reaches, so the metrics are never on it. Bind it where only the host (or its containers) can
 * connect.
 */
export function serveMetrics(metrics: TavernMetrics, port: number, host: string): Promise<Server> {
  const server = createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (req.method !== 'GET' || path !== '/metrics') {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found\n');
      return;
    }
    res
      .writeHead(200, { 'content-type': 'text/plain; version=0.0.4; charset=utf-8' })
      .end(metrics.render());
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}
