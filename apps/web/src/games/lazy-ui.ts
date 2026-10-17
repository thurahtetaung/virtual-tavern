import type { GameUiProps } from '@vt/game-sdk';
import { type ComponentType, createElement, lazy, useState } from 'react';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GameComponent = ComponentType<GameUiProps<any, any>>;

/** A game's UI, loaded on first render, or ahead of it with `preload`. */
export type GameUi = GameComponent & { preload: () => Promise<unknown> };

/**
 * Wraps a game's UI import like `lazy`, plus `preload`: a room starts fetching the code as soon as
 * it knows the game, alongside joining, instead of when the first state renders it. Code that has
 * arrived renders at once: `lazy` would still suspend for a moment, and React then holds the
 * finished room back behind its loading step for up to 300 ms.
 */
export function lazyUi(load: () => Promise<{ default: GameComponent }>): GameUi {
  let loading: Promise<{ default: GameComponent }> | null = null;
  let loaded: GameComponent | null = null;
  const once = () =>
    (loading ??= load().then((m) => {
      loaded = m.default;
      return m;
    }));
  const Lazy = lazy(once);
  // Chosen once per mount, so the game never remounts when its code arrives.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function GameUi(props: GameUiProps<any, any>) {
    const [Ui] = useState<GameComponent>(() => loaded ?? Lazy);
    return createElement(Ui, props);
  }
  return Object.assign(GameUi, { preload: once });
}
