import type { StatsGameName } from '@vt/protocol';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useToast } from '../lib/toast.tsx';
import type { ChartTokens } from './palette.ts';
import { slotColor, slotFor } from './palette.ts';
import type { StatsParams } from './range.ts';

export interface GameInfo {
  id: string;
  name: string;
  icon: string;
}

export interface StatsContextValue {
  params: StatsParams;
  setParams: (change: Partial<StatsParams>) => void;
  /** Query string for the historical endpoints. */
  query: string;
  /** Bumped after a reset so every card reloads. */
  epoch: number;
  /** Every game the page knows about (from /api/games and from the data). */
  games: GameInfo[];
  gameInfo: (id: string) => GameInfo;
  /** Adds game names a stats response carried (private games included). */
  learnGames: (games: readonly StatsGameName[]) => void;
  /** Fixed categorical slot per game id. */
  slots: Map<string, number>;
}

export const StatsContext = createContext<StatsContextValue | null>(null);

export function useStats(): StatsContextValue {
  const value = useContext(StatsContext);
  if (!value) throw new Error('useStats outside the stats page');
  return value;
}

/** A game's series colour; it depends on the id alone. (`_ctx` keeps call sites uniform.) */
export function gameColor(_ctx: unknown, tokens: ChartTokens, id: string) {
  return slotColor(tokens, slotFor(id));
}

export interface Loaded<T> {
  data: T | undefined;
  /** True while a request is in flight; `data` still holds the previous answer, if any. */
  loading: boolean;
  failed: boolean;
}

/**
 * Loads data for a key, keeping the previous answer on screen (dimmed by the caller) while a new
 * one loads, so changing the range never flashes. Errors go to the toast once per failed load.
 * `key: null` skips loading.
 */
export function useLoad<T>(key: string | null, load: () => Promise<T>): Loaded<T> {
  const toast = useToast();
  const loader = useRef(load);
  useEffect(() => {
    loader.current = load;
  });
  // The key the current answer belongs to: loading is "the answer is for another key".
  const [state, setState] = useState<{ key: string | null; data?: T; failed: boolean }>({
    key: null,
    failed: false,
  });

  useEffect(() => {
    if (key === null) return;
    let live = true;
    loader
      .current()
      .then((data) => {
        if (live) setState({ key, data, failed: false });
      })
      .catch((err: Error) => {
        if (!live) return;
        setState((s) => ({ key, data: s.data, failed: true }));
        toast(err.message);
      });
    return () => {
      live = false;
    };
  }, [key, toast]);

  return { data: state.data, loading: key !== null && state.key !== key, failed: state.failed };
}

/**
 * Calls `tick` right away, then every `ms` while the tab is visible, and once more as soon as a
 * hidden tab comes back.
 */
export function useInterval(tick: () => void, ms: number) {
  const ref = useRef(tick);
  useEffect(() => {
    ref.current = tick;
  });
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (timer === undefined) timer = setInterval(() => ref.current(), ms);
    };
    const stop = () => {
      clearInterval(timer);
      timer = undefined;
    };
    const onVisibility = () => {
      if (document.hidden) stop();
      else {
        ref.current();
        start();
      }
    };
    ref.current();
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ms]);
}
