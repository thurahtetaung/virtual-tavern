import type { GameDefinition } from '@vt/game-sdk';
import { sketchyAwards } from './awards.ts';
import { sketchyBot } from './bot.ts';
import { PACK_KINDS } from './content.ts';
import { create, nextDeadline, onDeadline, playerJoined, playerLeft, reduce } from './game.ts';
import { guide } from './guide.ts';
import { insights } from './insights.ts';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  ROOM_CAPACITY,
  type SketchyAction,
  type SketchyState,
  type SketchyView,
  actionSchema,
} from './types.ts';
import { view } from './view.ts';

export const sketchy: GameDefinition<SketchyState, SketchyAction, SketchyView> = {
  id: 'sketchy',
  name: 'Sketchy',
  description:
    'Draw a secret prompt, write fake titles for everyone’s drawings, and spot the real one.',
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
  awards: sketchyAwards,
  bot: sketchyBot,
};
