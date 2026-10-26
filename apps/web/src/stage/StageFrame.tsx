import { Scene } from '@vt/ui/show';
import { type ReactNode, useEffect, useRef, useState } from 'react';

/**
 * The table screen's frame: the whole screen, black around the stage, with the pointer hidden
 * once it rests (a TV has nobody at a mouse). A game's `Stage` puts its own `Scene` (from
 * `@vt/ui/show`) inside it, so the scene's camera and dim layers answer to the game's show.
 */
export function StageFrame({ children }: { children: ReactNode }) {
  const [pointer, setPointer] = useState(false);
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(
    () => () => {
      clearTimeout(idle.current);
    },
    [],
  );
  const moved = () => {
    setPointer(true);
    clearTimeout(idle.current);
    idle.current = setTimeout(() => setPointer(false), 2500);
  };
  return (
    <div
      className="fixed inset-0 overflow-hidden bg-black"
      style={{ cursor: pointer ? 'auto' : 'none' }}
      onPointerMove={moved}
      data-testid="scene"
    >
      {children}
    </div>
  );
}

/** The shell's own table-screen pages (the generic stage, notices): a plain 1280 × 720 scene. */
export function ShellScene({ children }: { children: ReactNode }) {
  return (
    <StageFrame>
      <Scene>
        <div className="h-full w-full bg-page text-ink dark:bg-stone-950 dark:text-stone-100">
          {children}
        </div>
      </Scene>
    </StageFrame>
  );
}

/** Keeps the screen awake while the table screen shows, where the browser can. */
export function useWakeLock(): void {
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    let gone = false;
    const request = () => {
      if (document.visibilityState !== 'visible' || !('wakeLock' in navigator)) return;
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          if (gone) void l.release();
          else lock = l;
        })
        .catch(() => {});
    };
    request();
    // The browser lets go of the lock whenever the page is hidden; take it again on return.
    document.addEventListener('visibilitychange', request);
    return () => {
      gone = true;
      document.removeEventListener('visibilitychange', request);
      void lock?.release();
    };
  }, []);
}
