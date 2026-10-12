import { randomBytes, scrypt as scryptCb, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';

export const ADMIN_COOKIE = 'vt_admin';
export const ADMIN_SESSION_MS = 7 * 24 * 60 * 60 * 1000;

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Checks admin logins and issues admin sessions.
 *
 * The configured password is stretched with scrypt once, when the server starts; each login
 * then costs one scrypt of the submitted password (off the event loop) and a constant-time
 * comparison, which does not leak the password length. Sessions carry a fingerprint of the
 * password, so changing `ADMIN_PASSWORD` signs every admin out.
 */
export class AdminAuth {
  private readonly salt = randomBytes(16);
  private readonly expected: Promise<Buffer>;
  /** Short stretched hash of the password: identifies which password a session was issued under. */
  private readonly fingerprint: string;
  /**
   * Sessions signed out on this server, until they would have expired anyway. A browser drops
   * its cookie on sign-out, but a socket keeps the handshake's copy: this is what locks it out.
   */
  private readonly revoked = new Map<string, number>();

  constructor(password: string, sessionSecret: string) {
    this.expected = scrypt(password, this.salt, 32);
    // Stretched once at startup, salted with the session secret so it is stable across restarts
    // but the cookie still never carries a plain digest of the password.
    this.fingerprint = scryptSync(password, `fingerprint:${sessionSecret}`, 16)
      .toString('hex')
      .slice(0, 8);
  }

  async verify(given: string): Promise<boolean> {
    const [expected, actual] = await Promise.all([this.expected, scrypt(given, this.salt, 32)]);
    return timingSafeEqual(expected, actual);
  }

  setSession(reply: FastifyReply, now: number) {
    void reply.setCookie(ADMIN_COOKIE, `${now}.${this.fingerprint}`, {
      signed: true,
      httpOnly: true,
      sameSite: 'strict',
      secure: 'auto',
      path: '/',
      maxAge: ADMIN_SESSION_MS / 1000,
    });
  }

  isAdmin(request: FastifyRequest, now: number): boolean {
    const raw = request.cookies[ADMIN_COOKIE];
    if (!raw) return false;
    const { valid, value } = request.unsignCookie(raw);
    return valid && this.isAdminValue(value, now);
  }

  /** Signs out the request's session for good, here (open sockets included). */
  revoke(request: FastifyRequest, now: number) {
    for (const [value, until] of this.revoked) if (until <= now) this.revoked.delete(value);
    const raw = request.cookies[ADMIN_COOKIE];
    if (!raw) return;
    const { valid, value } = request.unsignCookie(raw);
    if (valid && value) this.revoked.set(value, Number(value.split('.')[0]) + ADMIN_SESSION_MS);
  }

  /** Whether an unsigned `vt_admin` cookie value is a current session (for sockets). */
  isAdminValue(value: string | null | undefined, now: number): boolean {
    if (!value || this.revoked.has(value)) return false;
    const [issued, fingerprint] = value.split('.');
    const issuedAt = Number(issued);
    return (
      fingerprint === this.fingerprint &&
      Number.isFinite(issuedAt) &&
      now - issuedAt >= 0 &&
      now - issuedAt < ADMIN_SESSION_MS
    );
  }
}

export function clearAdminSession(reply: FastifyReply) {
  void reply.clearCookie(ADMIN_COOKIE, { path: '/' });
}
