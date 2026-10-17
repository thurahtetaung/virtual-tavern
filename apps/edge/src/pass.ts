import { BACKROOM_SESSION_MS, EDGE_COOKIE, type EdgeVersion } from '@vt/protocol/edge';

const encoder = new TextEncoder();
const keys = new Map<string, Promise<CryptoKey>>();
/**
 * Passes whose signature this isolate has already checked, per secret. A signature never stops
 * being valid, so a browser's later requests skip the HMAC; version and lifetime are still
 * checked every time. Only good signatures go in, so forgeries can't fill it.
 */
const signed = new Map<string, Set<string>>();
const SIGNED_MAX = 1024;

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
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Forgets the checked signatures (tests). */
export function resetSigned() {
  signed.clear();
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
  let seen = signed.get(secret);
  if (seen?.has(pass)) return true;
  const mac = fromBase64url(parts[2]!);
  if (!mac) return false;
  const good = await crypto.subtle.verify(
    'HMAC',
    await hmacKey(secret),
    mac,
    encoder.encode(`${parts[0]}.${parts[1]}`),
  );
  if (good) {
    if (!seen) signed.set(secret, (seen = new Set()));
    if (seen.size >= SIGNED_MAX) seen.clear();
    seen.add(pass);
  }
  return good;
}
