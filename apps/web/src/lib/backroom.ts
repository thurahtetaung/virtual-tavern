import { useCallback, useEffect, useState } from 'react';
import { api } from './api.ts';

export interface BackroomStatus {
  open: boolean;
  /** A current unlock, or an admin session (the admin always has the back room). */
  unlocked: boolean;
  /** Signed in as the admin, so no password is needed and there is no door to lock. */
  admin?: boolean;
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
export function useBackroom() {
  const [status, setStatus] = useState<BackroomStatus | null>(null);
  const refresh = useCallback(
    () =>
      api<BackroomStatus>('/api/backroom/status')
        .then(setStatus)
        .catch(() => setStatus({ open: false, unlocked: false })),
    [],
  );
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { status, refresh };
}
