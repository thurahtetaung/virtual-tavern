import { z } from 'zod';

/**
 * The colours a player can have in a room, each with its name for screen readers. Reverie's eight
 * seat colours come first. Colours are unique in a room up to 16 people; past that the least
 * used ones repeat.
 */
export const PLAYER_COLORS = [
  'red',
  'blue',
  'green',
  'yellow',
  'purple',
  'orange',
  'pink',
  'teal',
  'lime',
  'sky',
  'brown',
  'grey',
  'black',
  'white',
  'magenta',
  'mint',
] as const;
export type PlayerColor = (typeof PLAYER_COLORS)[number];
export const playerColor = z.enum(PLAYER_COLORS);

export const PLAYER_COLOR_NAMES: Record<PlayerColor, string> = {
  red: 'red',
  blue: 'blue',
  green: 'green',
  yellow: 'yellow',
  purple: 'purple',
  orange: 'orange',
  pink: 'pink',
  teal: 'teal',
  lime: 'lime',
  sky: 'sky blue',
  brown: 'brown',
  grey: 'grey',
  black: 'black',
  white: 'white',
  magenta: 'magenta',
  mint: 'mint',
};
