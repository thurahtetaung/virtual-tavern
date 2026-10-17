import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Sends `body` as JSON the browser keeps and revalidates (`private`): every load by default
 * (`no-cache`), or after `maxAge` seconds. The strong ETag is a hash of the exact JSON sent, so
 * a revalidation sees any change, and a matching `If-None-Match` gets an empty 304. Call it only
 * once the request may see `body`, and pass `vary` when the answer depends on the request (the
 * back-room cookies).
 */
export function sendRevalidated(
  req: FastifyRequest,
  reply: FastifyReply,
  body: unknown,
  opts: { maxAge?: number; vary?: string } = {},
): FastifyReply {
  const json = JSON.stringify(body);
  const etag = `"${createHash('sha256').update(json).digest('base64url')}"`;
  void reply
    .header('cache-control', opts.maxAge ? `private, max-age=${opts.maxAge}` : 'private, no-cache')
    .header('etag', etag);
  if (opts.vary) void reply.header('vary', opts.vary);
  if (matchesEtag(req.headers['if-none-match'], etag)) return reply.code(304).send();
  return reply.type('application/json; charset=utf-8').send(json);
}

/** Whether an `If-None-Match` header names `etag` (weak comparison, as for GET). */
function matchesEtag(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  return header
    .split(',')
    .map((t) => t.trim().replace(/^W\//, ''))
    .some((t) => t === etag || t === '*');
}
