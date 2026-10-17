import { useCallback, useEffect, useState } from 'react';
import { api } from './api.ts';
import type { ListVersions } from '@vt/protocol';
import { noteVersions } from './games.ts';

export interface BackroomStatus {
  open: boolean;
  /** A current unlock, or an admin session (the admin always has the back room). */
  unlocked: boolean;
  /** Signed in as the admin, so no password is needed and there is no door to lock. */
  admin?: boolean;
  versions?: ListVersions;
}

/** What the back room's door shows: still asking, shut, the password form, or the lobby. */
export type Door = 'waiting' | 'closed' | 'knock' | 'member' | 'admin';

/** The admin always walks in, with or without the password (or one being set at all). */
export function doorOf(status: BackroomStatus | null): Door {
  if (!status) return 'waiting';
  if (status.admin) return 'admin';
  if (status.unlocked) return 'member';
  return status.open ? 'knock' : 'closed';
}

/** Whether the back room exists and whether this browser has unlocked it. */
/**
 * The door's line for a player a room just turned away (`?locked=<reason>`, or the older
 * `?changed=1`), or null for anyone who simply came to knock.
 */
export function lockedLine(params: URLSearchParams): string | null {
  const reason = params.get('locked') ?? (params.has('changed') ? 'changed' : null);
  switch (reason) {
    case null:
      return null;
    case 'changed':
      return 'The word has changed — ask for the new one.';
    case 'signed-out':
      return "You signed out of the tavern keeper's room. Enter the word to come back in.";
    default:
      return 'Your way in has run out. Enter the word to come back in.';
  }
}

export function useBackroom() {
  const [status, setStatus] = useState<BackroomStatus | null>(null);
  const refresh = useCallback(
    () =>
      api<BackroomStatus>('/api/backroom/status')
        .then((s) => {
          noteVersions(s.versions);
          setStatus(s);
        })
        .catch(() => setStatus({ open: false, unlocked: false })),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { status, refresh };
}
