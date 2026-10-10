import { timingSafeEqual, createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const ADMIN_COOKIE = 'vt_admin';
export const ADMIN_SESSION_MS = 7 * 24 * 60 * 60 * 1000;

/** Constant-time comparison that does not leak the password length. */
export function passwordMatches(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function setAdminSession(reply: FastifyReply, now: number) {
  void reply.setCookie(ADMIN_COOKIE, String(now), {
    signed: true,
    httpOnly: true,
    sameSite: 'strict',
    secure: 'auto',
    path: '/',
    maxAge: ADMIN_SESSION_MS / 1000,
  });
}

export function clearAdminSession(reply: FastifyReply) {
  void reply.clearCookie(ADMIN_COOKIE, { path: '/' });
}

export function isAdmin(request: FastifyRequest, now: number): boolean {
  const raw = request.cookies[ADMIN_COOKIE];
  if (!raw) return false;
  const { valid, value } = request.unsignCookie(raw);
  const issuedAt = Number(value);
  return valid && Number.isFinite(issuedAt) && now - issuedAt < ADMIN_SESSION_MS;
}
