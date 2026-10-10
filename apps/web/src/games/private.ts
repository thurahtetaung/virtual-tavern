import { guide as hoodwinkGuide } from '@vt/private-hoodwink/guide';
import { guide as reverieGuide } from '@vt/private-reverie/guide';
import { guide as royalPostGuide } from '@vt/private-royal-post/guide';
import { lazy } from 'react';
import type { ClientGame } from './registry.ts';

/**
 * Back-room games. This module and the game UIs it imports are built into /backroom-assets/,
 * which the server only serves to players who have unlocked the back room, so private game
 * names and code never reach anyone else. Add new private games here.
 */
export const privateGames: ClientGame[] = [
  {
    // Hard-coded like the public games: importing the engine for its id would bundle it here.
    id: 'reverie',
    name: 'Reverie',
    guide: reverieGuide,
    icon: '🐇',
    Component: lazy(() =>
      import('@vt/private-reverie/ui').then((m) => ({ default: m.ReverieGame })),
    ),
  },
  {
    id: 'hoodwink',
    name: 'Hoodwink',
    guide: hoodwinkGuide,
    icon: '🎭',
    Component: lazy(() =>
      import('@vt/private-hoodwink/ui').then((m) => ({ default: m.HoodwinkGame })),
    ),
  },
  {
    id: 'royal-post',
    name: 'Royal Post',
    guide: royalPostGuide,
    icon: '✉️',
    Component: lazy(() =>
      import('@vt/private-royal-post/ui').then((m) => ({ default: m.RoyalPostGame })),
    ),
  },
];
