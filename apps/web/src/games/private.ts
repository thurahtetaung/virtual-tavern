import { peek } from '@vt/private-demo/logic';
import { lazy } from 'react';
import type { ClientGame } from './registry.ts';

/**
 * Back-room games. This module and the game UIs it imports are built into /backroom-assets/,
 * which the server only serves to players who have unlocked the back room, so private game
 * names and code never reach anyone else. Add new private games here.
 */
export const privateGames: ClientGame[] = [
  {
    id: peek.id,
    name: peek.name,
    guide: peek.guide,
    icon: '🃏',
    Component: lazy(() => import('@vt/private-demo/ui').then((m) => ({ default: m.PeekGame }))),
  },
];
