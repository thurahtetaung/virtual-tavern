import { useEffect } from 'react';

// Waking a player at night: a buzz on every wake (even for roles that only learn something),
// and a screen that stays on from the deal to the reveal. No sound: in a room of friends, a
// chime would tell everyone whose phone woke. All of it comes from the viewer's own view, so
// nothing about it reaches anyone else.

/** Buzzes once each time `wake` changes to a new non-null key. */
export function useWakeAlert(wake: string | null) {
  useEffect(() => {
    if (wake === null) return;
    if ('vibrate' in navigator) navigator.vibrate([200, 100, 200]);
  }, [wake]);
}

/** Keeps the screen on while `active`, re-taking the lock when the page comes back into view. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const request = () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          if (stopped) void l.release().catch(() => {});
          else lock = l;
        })
        .catch(() => {
          // Not allowed (battery saver, an unfocused tab): the phone may sleep as usual.
        });
    };
    request();
    document.addEventListener('visibilitychange', request);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', request);
      void lock?.release().catch(() => {});
    };
  }, [active]);
}
