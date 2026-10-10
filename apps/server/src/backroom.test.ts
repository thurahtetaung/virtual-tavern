import { describe, expect, it } from 'vitest';
import { BACKROOM_SESSION_MS, Backroom } from './backroom.ts';
import { openDb } from './db/index.ts';
import { assetKey } from './r2.ts';
import { MIGRATIONS } from './test/helpers.ts';

function backroom() {
  let now = 1_000_000;
  const b = new Backroom(openDb(':memory:', MIGRATIONS), () => now);
  return { b, tick: (ms: number) => (now += ms) };
}

describe('Backroom', () => {
  it('is closed until a password is set, and checks passwords exactly', async () => {
    const { b } = backroom();
    expect(b.isOpen()).toBe(false);
    expect(await b.verify('anything')).toBe(false);
    b.setPassword('open sesame');
    expect(b.isOpen()).toBe(true);
    expect(await b.verify('open sesame')).toBe(true);
    expect(await b.verify('Open sesame')).toBe(false);
    expect(await b.verify('')).toBe(false);
  });

  it('accepts its own unlocks for 30 days', () => {
    const { b, tick } = backroom();
    b.setPassword('pw');
    const cookie = b.issue();
    expect(b.isUnlocked(cookie)).toBe(true);
    tick(BACKROOM_SESSION_MS - 1);
    expect(b.isUnlocked(cookie)).toBe(true);
    tick(1);
    expect(b.isUnlocked(cookie)).toBe(false);
  });

  it('signs everyone out when the password changes or on demand', () => {
    const { b } = backroom();
    b.setPassword('pw');
    const first = b.issue();
    b.setPassword('pw2');
    expect(b.isUnlocked(first)).toBe(false);
    const second = b.issue();
    expect(b.isUnlocked(second)).toBe(true);
    b.signOutEveryone();
    expect(b.isUnlocked(second)).toBe(false);
  });

  it('rejects garbage cookies', () => {
    const { b } = backroom();
    b.setPassword('pw');
    for (const v of [undefined, '', 'x', '1', 'NaN.NaN', `${b.version()}.abc`])
      expect(b.isUnlocked(v)).toBe(false);
  });
});

describe('assetKey', () => {
  it('keeps keys inside the game folder', () => {
    expect(assetKey('reverie', 'cards/001.jpg')).toBe('reverie/cards/001.jpg');
    for (const bad of [
      '../other/x.png',
      'cards/../../x',
      '/etc/passwd',
      'a//b',
      'a\\b',
      '',
      'x'.repeat(301),
    ]) {
      expect(assetKey('reverie', bad)).toBeNull();
    }
    expect(assetKey('../x', 'a.png')).toBeNull();
  });
});
