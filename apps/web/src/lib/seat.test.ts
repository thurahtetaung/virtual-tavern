import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playerToken } from './identity.ts';
import { adoptSeat, clearSeat, confirmSeat, seatFor, seatLink } from './seat.ts';

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

const ROOM = 'amber-otter-lantern-7k3q';
const OTHER = 'brave-fox-tower-1a2b';
const TOKEN = 'A'.repeat(43);

describe('playtest seats', () => {
  let href = '';
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', storage());
    vi.stubGlobal('localStorage', storage());
    const location = {
      get hash() {
        const i = href.indexOf('#');
        return i < 0 ? '' : href.slice(i);
      },
      get pathname() {
        return href.split('#')[0]!;
      },
      search: '',
    };
    vi.stubGlobal('window', {
      location,
      history: {
        state: null,
        replaceState: (_s: unknown, _t: string, url: string) => (href = url),
      },
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('adopts a seat link, strips the secret from the address bar and scopes it to its room', () => {
    href = seatLink(ROOM, { token: TOKEN, name: 'Ana' });
    expect(href).toBe(`/r/${ROOM}#seat=${TOKEN}&as=Ana`);
    adoptSeat(ROOM);
    expect(href).toBe(`/r/${ROOM}`);
    expect(seatFor(ROOM)).toEqual({ token: TOKEN, name: 'Ana' });
    expect(seatFor(OTHER)).toBeNull();
    // Only a playtest honours it.
    expect(confirmSeat(ROOM, true)).toEqual({ token: TOKEN, name: 'Ana' });
    clearSeat(ROOM);
    expect(seatFor(ROOM)).toBeNull();
  });

  it('wipes a seat a normal room is opened with, so a crafted link changes nobody', () => {
    const mine = playerToken();
    href = `/r/${ROOM}#seat=${TOKEN}&as=Mallory`;
    adoptSeat(ROOM);
    expect(href).toBe(`/r/${ROOM}`);
    expect(confirmSeat(ROOM, false)).toBeNull();
    expect(seatFor(ROOM)).toBeNull();
    // The room plays as the browser's own player, exactly as before.
    expect(playerToken()).toBe(mine);
    expect(localStorage.getItem('vt.playerToken')).toBe(mine);
  });

  it('ignores fragments that are not seats, and malformed secrets', () => {
    href = `/r/${ROOM}#rules`;
    adoptSeat(ROOM);
    expect(href).toBe(`/r/${ROOM}#rules`);
    expect(seatFor(ROOM)).toBeNull();
    href = `/r/${ROOM}#seat=short&as=Ana`;
    adoptSeat(ROOM);
    expect(href).toBe(`/r/${ROOM}`);
    expect(seatFor(ROOM)).toBeNull();
  });

  it('a normal visitor with no seat keeps one identity across tabs', () => {
    href = `/r/${ROOM}`;
    adoptSeat(ROOM);
    expect(confirmSeat(ROOM, false)).toBeNull();
    expect(seatFor(ROOM)).toBeNull();
    const token = playerToken();
    expect(playerToken()).toBe(token);
  });
});
