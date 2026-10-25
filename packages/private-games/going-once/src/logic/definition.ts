import type { GameDefinition } from '@vt/game-sdk';
import { goingOnceAwards } from './awards.ts';
import { goingOnceBot, goingOnceBotInfo } from './bot.ts';
import { PACK_KINDS } from './content.ts';
import { create, nextDeadline, onDeadline, playerJoined, playerLeft, reduce } from './game.ts';
import { guide } from './guide.ts';
import { insights } from './insights.ts';
import {
  type GoingOnceAction,
  type GoingOnceState,
  type GoingOnceView,
  MAX_PLAYERS,
  MIN_PLAYERS,
  actionSchema,
} from './types.ts';
import { view } from './view.ts';

export const goingOnce: GameDefinition<GoingOnceState, GoingOnceAction, GoingOnceView> = {
  id: 'going-once',
  name: 'Going Once',
  description: 'Draw two quick pictures, then bid on everyone’s art in live auctions.',
  minPlayers: MIN_PLAYERS,
  maxPlayers: 30,
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
  awards: goingOnceAwards,
  bot: goingOnceBot,
  botInfo: goingOnceBotInfo,
};
