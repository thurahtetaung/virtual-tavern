import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  allLinkKeys,
  codeFromHash,
  forgetLinkKey,
  linkKeyFor,
  linkUrl,
  saveLinkKey,
} from './links.ts';

/** A tiny Storage stand-in. */
function storage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

describe('phone links', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', storage());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('puts the code in the fragment, which never reaches a server log', () => {
    const url = new URL(linkUrl('https://tavern.test', 'KXRT'));
    expect(url.pathname).toBe('/link');
    expect(url.search).toBe('');
    expect(url.hash).toBe('#KXRT');
  });

  it('reads a code from the fragment as letters only', () => {
    expect(codeFromHash('#kxrt')).toBe('KXRT');
    expect(codeFromHash('#K-X R T9Q')).toBe('KXRT');
    expect(codeFromHash('')).toBe('');
  });

  it('keeps a key per room and forgets it in every table it opened', () => {
    saveLinkKey('room-a', 'key-1');
    saveLinkKey('room-b', 'key-1');
    saveLinkKey('room-c', 'key-2');
    expect(linkKeyFor('room-b')).toBe('key-1');
    expect(allLinkKeys().sort()).toEqual(['key-1', 'key-2']);
    forgetLinkKey('room-a');
    expect(linkKeyFor('room-a')).toBeNull();
    expect(linkKeyFor('room-b')).toBeNull();
    expect(linkKeyFor('room-c')).toBe('key-2');
  });
});
