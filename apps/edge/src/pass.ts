import { BACKROOM_SESSION_MS, EDGE_COOKIE, type EdgeVersion } from '@vt/protocol/edge';

const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();

function hmacKey(secret: string) {
  let key = keys.get(secret);
  if (!key) {
    key = crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    keys.set(secret, key);
  }
  return key;
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[\w-]+$/.test(text)) return null;
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/** The edge pass from a `Cookie` header, if there is one. */
export function readPass(cookieHeader: string | null): string | null {
  for (const part of cookieHeader?.split(';') ?? []) {
    const [name, ...value] = part.trim().split('=');
    if (name === EDGE_COOKIE) return value.join('=') || null;
  }
  return null;
}

/**
 * Whether a pass `<version>.<issuedAt>.<mac>` proves a current unlock: signed with the edge
 * secret, unexpired by the server's own rule, and from the back room's current password version.
 */
export async function verifyPass(
  pass: string | null,
  secret: string,
  current: EdgeVersion,
  now: number,
): Promise<boolean> {
  if (!pass || !secret || !current.open) return false;
  const parts = pass.split('.');
  if (parts.length !== 3) return false;
  const [version, issuedAt] = parts.slice(0, 2).map(Number) as [number, number];
  if (!Number.isInteger(version) || version !== current.version) return false;
  if (!Number.isFinite(issuedAt) || now - issuedAt < 0 || now - issuedAt >= BACKROOM_SESSION_MS)
    return false;
  const mac = fromBase64url(parts[2]!);
  if (!mac) return false;
  return crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    mac,
    encoder.encode(`${parts[0]}.${parts[1]}`),
  );
}
