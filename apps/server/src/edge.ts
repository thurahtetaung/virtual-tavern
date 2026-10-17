import { createHmac, timingSafeEqual } from 'node:crypto';
import { BACKROOM_SESSION_MS, EDGE_COOKIE } from '@vt/protocol/edge';
import type { FastifyReply } from 'fastify';

/**
 * Signs the edge pass that lets the Worker in front of the site serve back-room files from
 * Cloudflare's cache. It carries the unlock's own `<version>.<issuedAt>`, so it lapses with the
 * unlock and with every password change. Its secret is its own: the session secret also signs
 * admin logins, and the Worker must never hold that.
 */
export class EdgePass {
  private readonly secret: string;

  constructor(secret: string) {
    this.secret = secret;
  }

  private mac(unlock: string) {
    return createHmac('sha256', this.secret).update(unlock).digest('base64url');
  }

  /** The pass for an (already unsigned) unlock value `<version>.<issuedAt>`. */
  issue(unlock: string): string {
    return `${unlock}.${this.mac(unlock)}`;
  }

  /** Whether `value` is the pass for exactly this unlock. */
  matches(value: string | null | undefined, unlock: string): boolean {
    if (!value) return false;
    const expected = Buffer.from(this.issue(unlock));
    const actual = Buffer.from(value);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  /** Sets the pass for `unlock` on the reply, for as long as the unlock has left. */
  set(reply: FastifyReply, unlock: string, now: number) {
    const issuedAt = Number(unlock.split('.')[1]);
    const left = Math.floor((issuedAt + BACKROOM_SESSION_MS - now) / 1000);
    if (!Number.isFinite(left) || left <= 0) return;
    void reply.setCookie(EDGE_COOKIE, this.issue(unlock), {
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto',
      path: '/',
      maxAge: left,
    });
  }

  static clear(reply: FastifyReply) {
    void reply.clearCookie(EDGE_COOKIE, { path: '/' });
  }
}
