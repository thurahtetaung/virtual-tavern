import type { GameGuide } from '@vt/game-sdk';
import { makeGuide } from '@vt/game-masquerade/guide';

const base = makeGuide(
  'The host picks the first edition (30 locations), the second (20 locations) or both; the lobby shows each edition’s name.',
);

export const guide: GameGuide = {
  ...base,
  quickStart: [
    'The host picks the first edition, the second or both; every location in play is on the Locations board.',
    'Everyone gets a card: the locals see the same location, the spy sees only “You’re the spy”.',
    'Take turns asking each other questions about the location, out loud, starting with the player the app names.',
    'When the clock runs out or everyone is Ready to vote, vote in secret for the spy.',
    'A caught spy gets one guess at the location from the board: right, and the spy steals the round.',
    'Points go to the spy or the locals each round; the most points after the last round wins.',
  ],
};
