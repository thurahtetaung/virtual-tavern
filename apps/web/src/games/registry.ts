import type { GameGuide, GameUiProps } from '@vt/game-sdk';
import { guide as codenamesGuide } from '@vt/game-codenames/logic';
import { type ComponentType, lazy } from 'react';

export interface ClientGame {
  id: string;
  name: string;
  guide: GameGuide;
  /** Emoji shown on cards and headers. */
  icon: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component: ComponentType<GameUiProps<any, any>>;
}

/** Every playable game's UI. Add new games here (and in the server registry). */
export const clientGames: ClientGame[] = [
  {
    id: 'codenames',
    name: 'Codenames',
    guide: codenamesGuide,
    icon: '🕵️',
    Component: lazy(() =>
      import('@vt/game-codenames/ui').then((m) => ({ default: m.CodenamesGame })),
    ),
  },
];

export const findGame = (id: string | undefined) => clientGames.find((g) => g.id === id);
