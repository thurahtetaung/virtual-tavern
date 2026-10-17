import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiTimeout, api } from './api.ts';

describe('api', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /** A server that never answers, until the request is aborted. */
  const silent = () =>
    vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );

  it('gives up on a request with a timeout that gets no answer', async () => {
    vi.stubGlobal('fetch', silent());
    const call = api('/api/rooms/x', { timeoutMs: 10_000 });
    const failed = expect(call).rejects.toBeInstanceOf(ApiTimeout);
    await vi.advanceTimersByTimeAsync(10_000);
    await failed;
  });

  it('answers as before when the server is quick, and never aborts without a timeout', async () => {
    const fetch = vi.fn(() => Promise.resolve(Response.json({ id: 'x' })));
    vi.stubGlobal('fetch', fetch);
    expect(await api('/api/rooms/x', { timeoutMs: 10_000 })).toEqual({ id: 'x' });
    expect(await api('/api/rooms/x')).toEqual({ id: 'x' });
    expect((fetch.mock.calls[1] as unknown[])[1]).not.toHaveProperty('signal');
  });
});
