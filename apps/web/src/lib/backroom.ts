import { useCallback, useEffect, useState } from 'react';
import { api } from './api.ts';

export interface BackroomStatus {
  open: boolean;
  unlocked: boolean;
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
