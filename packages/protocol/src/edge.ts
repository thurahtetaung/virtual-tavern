/**
 * What the server and the edge Worker in front of it agree on, kept free of imports so the
 * Worker can bundle it alone.
 */

/** How long a back-room unlock (and the edge pass that goes with it) lasts. */
export const BACKROOM_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The edge pass: `<version>.<issuedAt>.<mac>`, the unlock's own version and issue time, signed
 * with HMAC-SHA256 under `EDGE_SECRET` (base64url). Not httpOnly-signed by Fastify: the Worker
 * checks it with the shared secret alone.
 */
export const EDGE_COOKIE = 'vt_edge';

/** The back room's current password version, for the Worker: `{ version, open }`. */
export const EDGE_VERSION_PATH = '/api/edge/backroom-version';

export interface EdgeVersion {
  version: number;
  open: boolean;
}
