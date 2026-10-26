import type { Tile } from './types.ts';

/** How each colour is named in text. */
export const COLOUR_NAME: Record<Tile, string> = {
  blue: 'blue',
  yellow: 'yellow',
  red: 'red',
  black: 'black',
  aqua: 'light blue',
  joker: 'joker',
};

/** A symbol per colour, on every tile and wall space, so no colour is told by its hue alone. */
export const SYMBOL: Record<Tile, string> = {
  blue: '◆',
  yellow: '▲',
  red: '●',
  black: '■',
  aqua: '✚',
  joker: '★',
};

/** An emoji per colour, for the guide and the log. */
export const COLOUR_EMOJI: Record<Tile, string> = {
  blue: '🟦',
  yellow: '🟨',
  red: '🟥',
  black: '⬛',
  aqua: '🩵',
  joker: '🃏',
};

/** "3 red", "1 light blue", "2 jokers". */
export const tilesLine = (n: number, c: Tile) =>
  `${n} ${COLOUR_NAME[c]}${c === 'joker' && n !== 1 ? 's' : ''}`;

/** "line 3", "the floor". */
export const targetLine = (t: number | 'floor') => (t === 'floor' ? 'the floor' : `line ${t + 1}`);
