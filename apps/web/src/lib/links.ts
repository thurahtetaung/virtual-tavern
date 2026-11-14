import { LINK_CODE_LENGTH } from '@vt/protocol';
import { useSyncExternalStore } from 'react';

/**
 * The address a PC's QR code opens: the code rides in the fragment, which browsers never send,
 * so it stays out of every server log and Referer.
 */
export const linkUrl = (origin: string, code: string) => `${origin}/link#${code}`;

/** The code in a `/link#KXRT` fragment, cleaned to the letters a code can have. */
export const codeFromHash = (hash: string) =>
  hash
    .replace(/^#/, '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, LINK_CODE_LENGTH);

/**
 * A linked phone's keys: one per room it was linked in (`vt.link.<roomId>`). A key is a second
 * identity for the PC's player in that room and the night's next tables; the phone's own player
 * token is never replaced, so it stays itself in every other room.
 */
const PREFIX = 'vt.link.';

/** Every stored name (read before any removal). */
function names(s: Storage): string[] {
  return Array.from({ length: s.length }, (_, i) => s.key(i) ?? '');
}

function storage(): Storage | null {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

/** This browser's linked-phone key for the room, or null. */
export function linkKeyFor(roomId: string): string | null {
  try {
    return storage()?.getItem(PREFIX + roomId) ?? null;
  } catch {
    return null;
  }
}

export function saveLinkKey(roomId: string, key: string): void {
  try {
    storage()?.setItem(PREFIX + roomId, key);
  } catch {
    // Private mode: the link lasts for this page only (the next join can't find it).
  }
}

/** Forgets the key for the room, and every other room that held the same key. */
export function forgetLinkKey(roomId: string): void {
  const key = linkKeyFor(roomId);
  const s = storage();
  if (!s) return;
  try {
    for (const k of names(s))
      if (k.startsWith(PREFIX) && (k === PREFIX + roomId || (key && s.getItem(k) === key)))
        s.removeItem(k);
  } catch {
    // Nothing stored anyway.
  }
}

/** Every linked-phone key this browser holds (sent when it links again, to spot a second seat). */
export function allLinkKeys(): string[] {
  const s = storage();
  if (!s) return [];
  try {
    return [
      ...new Set(
        names(s)
          .filter((k) => k.startsWith(PREFIX))
          .map((k) => s.getItem(k) ?? ''),
      ),
    ]
      .filter(Boolean)
      .slice(0, 50);
  } catch {
    return [];
  }
}

// ---- The PC's nudge to link a phone (hidden for good on this browser once dismissed) ----

const NUDGE_KEY = 'vt.linkNudge.hidden';
const nudgeListeners = new Set<() => void>();

const nudgeHidden = () => {
  try {
    return storage()?.getItem(NUDGE_KEY) === '1';
  } catch {
    return false;
  }
};

export function hideLinkNudge(): void {
  try {
    storage()?.setItem(NUDGE_KEY, '1');
  } catch {
    // Hidden for this page only.
  }
  nudgeListeners.forEach((l) => l());
}

export const useLinkNudgeHidden = () =>
  useSyncExternalStore(
    (l) => {
      nudgeListeners.add(l);
      return () => nudgeListeners.delete(l);
    },
    nudgeHidden,
    () => true,
  );

// ---- Whether this screen is a desktop (the table-screen option shows only there) ----

const DESKTOP = '(min-width: 1024px) and (hover: hover) and (pointer: fine)';

export const useDesktop = () =>
  useSyncExternalStore(
    (change) => {
      const q = window.matchMedia(DESKTOP);
      q.addEventListener('change', change);
      return () => q.removeEventListener('change', change);
    },
    () => window.matchMedia(DESKTOP).matches,
    () => false,
  );
