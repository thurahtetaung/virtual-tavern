import type { GameDefinition } from '@vt/game-sdk';
import { missionControlAwards } from './awards.ts';
import { missionControlBot } from './bot.ts';
import { PACK_KINDS } from './content.ts';
import {
  carry,
  create,
  nextDeadline,
  onDeadline,
  playerJoined,
  playerLeft,
  reduce,
} from './game.ts';
import { guide } from './guide.ts';
import { insights } from './insights.ts';
import {
  MAX_SEATED,
  MIN_PLAYERS,
  type MissionControlAction,
  type MissionControlState,
  type MissionControlView,
  ROOM_CAPACITY,
  actionSchema,
} from './types.ts';
import { view } from './view.ts';

export const missionControl: GameDefinition<
  MissionControlState,
  MissionControlAction,
  MissionControlView
> = {
  id: 'mission-control',
  name: 'Mission Control',
  description:
    'A cooperative trick-taking campaign: win the right tricks together, in near silence.',
  minPlayers: MIN_PLAYERS,
  maxPlayers: ROOM_CAPACITY,
  maxSeated: MAX_SEATED,
  access: 'private',
  contentPacks: { kinds: PACK_KINDS },
  guide,
  actionSchema,
  create,
  carry,
  reduce,
  playerJoined,
  playerLeft,
  view,
  nextDeadline,
  onDeadline,
  insights,
  awards: missionControlAwards,
  bot: missionControlBot,
};
