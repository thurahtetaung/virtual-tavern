import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingHttpHeaders } from 'node:http';

/** The header automated checks send, with the server's `STATS_IGNORE_TOKEN` as its value. */
export const TEST_TRAFFIC_HEADER = 'x-vt-test';

const digest = (value: string) => createHash('sha256').update(value).digest();

/**
 * Whether a request (HTTP or a Socket.IO handshake) is test traffic, whose rooms record no stats.
 * Without a token nothing is. Both sides are hashed first, so the comparison takes the same time
 * whatever the header holds.
 */
export function testTrafficCheck(token: string | null | undefined) {
  if (!token) return (_headers: IncomingHttpHeaders) => false;
  const expected = digest(token);
  return (headers: IncomingHttpHeaders) => {
    const value = headers[TEST_TRAFFIC_HEADER];
    if (typeof value !== 'string' || !value) return false;
    return timingSafeEqual(digest(value), expected);
  };
}
