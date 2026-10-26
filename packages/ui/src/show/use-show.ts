import type { Moment } from '@vt/game-sdk/show';
import { useEffect, useRef } from 'react';
import { type Playing, type ShowEnv, play } from './player.ts';
import { sampleFrames } from './profile.ts';

/**
 * Plays a game's moments on this device: a moment starts once (its id is never replayed, whatever
 * re-renders), and one that leaves the list is cancelled (the state moved on). A hidden page
 * pauses what is playing; coming back, it jumps to the end states and the next moment starts on
 * time. `moments` is the game's pure `moments(view, …)` for the current view.
 */
export function useShow(moments: readonly Moment[], env: ShowEnv): void {
  const playing = useRef(new Map<string, Playing>());
  const envRef = useRef(env);
  useEffect(() => {
    envRef.current = env;
  });

  useEffect(() => {
    const map = playing.current;
    const ids = new Set(moments.map((m) => m.id));
    for (const [id, p] of map) {
      if (!ids.has(id)) {
        p.cancel();
        map.delete(id);
      }
    }
    for (const m of moments) {
      if (map.has(m.id)) continue;
      sampleFrames();
      map.set(m.id, play(m, envRef.current));
    }
  }, [moments]);

  useEffect(() => {
    const map = playing.current;
    const onVisibility = () => {
      for (const p of map.values()) {
        if (document.hidden) p.pause();
        else p.finish();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      for (const p of map.values()) p.cancel();
      map.clear();
    };
  }, []);
}
