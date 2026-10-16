import { randomBytes, scrypt as scryptCb, scryptSync, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import type { Db } from './db/index.ts';
import { appSettings } from './db/schema.ts';

export const BACKROOM_COOKIE = 'vt_backroom';
export const BACKROOM_SESSION_MS = 30 * 24 * 60 * 60 * 1000;

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const HASH_KEY = 'backroom.hash';
const VERSION_KEY = 'backroom.version';

/**
 * The shared password that unlocks private games. Unlocks are cookies carrying the password
 * *version*: changing the password (or signing everyone out) bumps the version, which instantly
 * invalidates every existing unlock.
 */
export class Backroom {
  private readonly db: Db;
  private readonly now: () => number;
  private readonly listeners = new Set<() => void>();

  constructor(db: Db, now: () => number = Date.now) {
    this.db = db;
    this.now = now;
  }

  private read(key: string): string | null {
    return this.db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value ?? null;
  }

  private write(key: string, value: string) {
    this.db
      .insert(appSettings)
      .values({ key, value })
      .onConflictDoUpdate({ target: appSettings.key, set: { value } })
      .run();
  }

  /** True once an admin has set a password. */
  isOpen(): boolean {
    return this.read(HASH_KEY) !== null;
  }

  version(): number {
    return Number(this.read(VERSION_KEY) ?? 0);
  }

  setPassword(password: string): void {
    const salt = randomBytes(16);
    const hash = scryptSync(password, salt, 32);
    this.write(HASH_KEY, `${salt.toString('hex')}:${hash.toString('hex')}`);
    this.signOutEveryone();
  }

  signOutEveryone(): void {
    this.write(VERSION_KEY, String(this.version() + 1));
    for (const listener of this.listeners) listener();
  }

  /** Runs `listener` whenever every unlock is revalidated (a new password, or a sign-out). */
  onVersionChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Checks a password against the stored hash; the stretching runs off the event loop. */
  async verify(password: string): Promise<boolean> {
    const stored = this.read(HASH_KEY);
    if (!stored) return false;
    const [saltHex, hashHex] = stored.split(':');
    const expected = Buffer.from(hashHex ?? '', 'hex');
    const actual = await scrypt(password, Buffer.from(saltHex ?? '', 'hex'), expected.length || 32);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  /** Value to store (signed) in the unlock cookie. */
  issue(): string {
    return `${this.version()}.${this.now()}`;
  }

  /** Whether an (already unsigned) cookie value is an unlock from before the word last changed. */
  isStale(value: string | null | undefined): boolean {
    const version = Number(value?.split('.')[0]);
    return Number.isInteger(version) && version < this.version();
  }

  /** Whether an (already unsigned) cookie value is a current, unexpired unlock. */
  isUnlocked(value: string | null | undefined): boolean {
    if (!value || !this.isOpen()) return false;
    const [version, issuedAt] = value.split('.').map(Number);
    return (
      version === this.version() &&
      Number.isFinite(issuedAt) &&
      this.now() - issuedAt! >= 0 &&
      this.now() - issuedAt! < BACKROOM_SESSION_MS
    );
  }
}
