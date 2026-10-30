import type { GameDefinition } from '@vt/game-sdk';
import { cliffhangerAwards } from './awards.ts';
import { cliffhangerBot } from './bot.ts';
import { PACK_KINDS } from './content.ts';
import { create, nextDeadline, onDeadline, playerJoined, playerLeft, reduce } from './game.ts';
import { guide } from './guide.ts';
import { insights } from './insights.ts';
import {
  type CliffhangerAction,
  type CliffhangerState,
  type CliffhangerView,
  MAX_PLAYERS,
  MIN_PLAYERS,
  ROOM_CAPACITY,
  actionSchema,
} from './types.ts';
import { view } from './view.ts';

export const cliffhanger: GameDefinition<CliffhangerState, CliffhangerAction, CliffhangerView> = {
  id: 'cliffhanger',
  name: 'Cliffhanger',
  description:
    'Two teams trade films in face-offs, then describe them in one word, a quote or a mime to collect every genre.',
  minPlayers: MIN_PLAYERS,
  /** Room capacity: up to `MAX_PLAYERS` play, the rest watch. */
  maxPlayers: ROOM_CAPACITY,
  maxSeated: MAX_PLAYERS,
  access: 'private',
  contentPacks: { kinds: PACK_KINDS },
  guide,
  actionSchema,
  create,
  reduce,
  playerJoined,
  playerLeft,
  view,
  nextDeadline,
  onDeadline,
  insights,
  awards: cliffhangerAwards,
  bot: cliffhangerBot,
  botInfo: {
    note: 'Bots answer face-offs, describe by tapping Got it now and then, and steal.',
  },
};
