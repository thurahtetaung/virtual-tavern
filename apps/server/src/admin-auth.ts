import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const ADMIN_COOKIE = 'vt_admin';
export const ADMIN_SESSION_MS = 7 * 24 * 60 * 60 * 1000;

/** Per-process salt: both sides are stretched the same way, so equal passwords give equal keys. */
const SALT = randomBytes(16);

/**
 * Constant-time comparison that does not leak the password length. Both sides go through scrypt
 * (a slow password hash) rather than a fast digest, so the comparison never handles a cheaply
 * reversible hash of the admin password.
 */
export function passwordMatches(given: string, expected: string): boolean {
  const a = scryptSync(given, SALT, 32);
  const b = scryptSync(expected, SALT, 32);
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
