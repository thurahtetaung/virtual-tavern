import type { Colour } from './types.ts';

/** How each colour is named in text. */
export const COLOUR_NAME: Record<Colour, string> = {
  blue: 'blue',
  yellow: 'yellow',
  red: 'red',
  black: 'black',
  aqua: 'light blue',
};

/** A symbol per colour, on every tile and wall space, so no colour is told by its hue alone. */
export const SYMBOL: Record<Colour, string> = {
  blue: '◆',
  yellow: '▲',
  red: '●',
  black: '■',
  aqua: '✚',
};

/** An emoji per colour, for the guide and the log. */
export const COLOUR_EMOJI: Record<Colour, string> = {
  blue: '🟦',
  yellow: '🟨',
  red: '🟥',
  black: '⬛',
  aqua: '🩵',
};

/** "3 red", "1 light blue". */
export const tilesLine = (n: number, c: Colour) => `${n} ${COLOUR_NAME[c]}`;

/** "line 3", "the floor". */
export const targetLine = (t: number | 'floor') => (t === 'floor' ? 'the floor' : `line ${t + 1}`);
