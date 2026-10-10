import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from './app.ts';

describe('GET /healthz', () => {
  const app = buildApp({ version: '1.2.3' });
  afterEach(() => app.close());

  it('reports ok with the running version', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', version: '1.2.3' });
  });
});
