import type { AbandonGame } from '@vt/game-sdk';
import { useEffect, useRef } from 'react';

/**
 * Puts the host's "Abandon game" in the room's Players drawer while `offered` (the host, a game
 * under way), and takes it away again otherwise. `run` sends the game's own back-to-lobby action;
 * the shell asks the host to confirm first.
 */
export function useAbandonGame(
  setAbandon: ((abandon: AbandonGame | null) => void) | undefined,
  offered: boolean,
  run: () => unknown,
) {
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  useEffect(() => {
    if (!setAbandon || !offered) return;
    setAbandon({ run: () => void latest.current() });
    return () => {
      setAbandon(null);
    };
  }, [setAbandon, offered]);
}
