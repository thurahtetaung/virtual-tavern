import type { ApiError } from '@vt/protocol';

export class ApiFailure extends Error {
  readonly status: number;
  readonly code: string;
  /** Seconds to wait before retrying, when the server said (a rate limit's Retry-After). */
  readonly retryAfter: number | null;
  constructor(status: number, code: string, message: string, retryAfter: number | null = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/** A request that got no answer in time (see `api`'s `timeoutMs`). */
export class ApiTimeout extends Error {
  constructor(path: string) {
    super(`No answer from ${path} in time`);
    this.name = 'ApiTimeout';
  }
}

/**
 * Calls the server. With `timeoutMs`, gives up (throwing `ApiTimeout`) when the answer, body
 * included, takes longer: a phone on a bad network can otherwise wait forever.
 */
export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown; timeoutMs?: number; cache?: RequestCache } = {},
): Promise<T> {
  const controller = init.timeoutMs ? new AbortController() : null;
  const timer = controller && setTimeout(() => controller.abort(), init.timeoutMs);
  let res: Response;
  let data: T | ApiError | null;
  try {
    res = await fetch(path, {
      method: init.method ?? 'GET',
      headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: 'same-origin',
      ...(init.cache && { cache: init.cache }),
      ...(controller && { signal: controller.signal }),
    });
    if (res.status === 204) return undefined as T;
    data = (await res.json().catch(() => null)) as T | ApiError | null;
    if (controller?.signal.aborted) throw new ApiTimeout(path);
  } catch (err) {
    throw controller?.signal.aborted ? new ApiTimeout(path) : err;
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (!res.ok) {
    const err = (data as ApiError | null)?.error;
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new ApiFailure(
      res.status,
      err?.code ?? 'error',
      err?.message ?? `Request failed (${res.status})`,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    );
  }
  return data as T;
}
