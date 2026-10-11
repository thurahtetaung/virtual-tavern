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

export async function api<T>(
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<T> {
  const res = await fetch(path, {
    method: init.method ?? 'GET',
    headers: init.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    credentials: 'same-origin',
  });
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as T | ApiError | null;
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
