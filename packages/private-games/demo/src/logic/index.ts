import { type GameDefinition, GameError, type PlayerId } from '@vt/game-sdk';
import { z } from 'zod';

/**
 * "Peek": a deliberately tiny private game used to test the back room end to end, and the
 * starting template for real private games. Everyone looks at the same protected card; anyone can
 * flip to the next one. Card images come from the private asset store's manifest.
 */
export interface PeekState {
  phase: 'lobby' | 'playing';
  card: number;
  players: Record<PlayerId, string>;
}

export interface PeekView {
  phase: PeekState['phase'];
  card: number;
  players: string[];
}

const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start') }),
  z.object({ type: z.literal('next') }),
]);
export type PeekAction = z.infer<typeof actionSchema>;

export const peek: GameDefinition<PeekState, PeekAction, PeekView> = {
  id: 'backroom-demo',
  name: 'Peek',
  description: 'A tiny demo of the back room: everyone peeks at the same secret card.',
  minPlayers: 1,
  maxPlayers: 12,
  access: 'private',
  guide: {
    tagline: 'Everyone peeks at the same secret card. A demo of private games.',
    players: '1 or more',
    duration: '1 minute',
    goal: 'Check that private games and their protected pictures work.',
    setup: [
      'Unlock the back room.',
      'Create a Peek room and share the link with friends who also know the word.',
    ],
    sections: [
      {
        title: 'Playing',
        bullets: ['The host presses Start.', 'Anyone presses Next card to flip.'],
      },
    ],
    tips: ['Only people who know the password can open this room, even with the link.'],
  },
  actionSchema,
  create: (_ctx, players) => ({
    phase: 'lobby',
    card: 0,
    players: Object.fromEntries(players.map((p) => [p.id, p.name])),
  }),
  reduce(state, action, ctx) {
    if (action.type === 'start') {
      return ctx.isHost
        ? { ...state, phase: 'playing', card: 0 }
        : new GameError('not-host', 'Only the host can start.');
    }
    if (state.phase !== 'playing') return new GameError('not-playing', 'Start the game first.');
    return { ...state, card: state.card + 1 };
  },
  playerJoined: (state, p) => ({ ...state, players: { ...state.players, [p.id]: p.name } }),
  playerLeft(state, id) {
    const players = { ...state.players };
    delete players[id];
    return { ...state, players };
  },
  view: (state) => ({
    phase: state.phase,
    card: state.card,
    players: Object.values(state.players),
  }),
};
