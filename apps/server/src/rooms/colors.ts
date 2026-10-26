import { PLAYER_COLORS, type PlayerColor } from '@vt/protocol';

/**
 * A colour for someone joining: a random one of the game's colours (`palette`, all 16 by default)
 * nobody here has. Rooms hold up to 30 people, so once every colour is taken a joiner gets one of
 * the least used, and an invite never bounces.
 */
export function freeColor(
  taken: readonly PlayerColor[],
  pick: (n: number) => number,
  palette: readonly PlayerColor[] = PLAYER_COLORS,
): PlayerColor {
  const uses = (c: PlayerColor) => taken.filter((t) => t === c).length;
  const least = Math.min(...palette.map(uses));
  const options = palette.filter((c) => uses(c) === least);
  return options[pick(options.length)]!;
}

/**
 * Gives a colour to players saved before rooms had them, or whose colour the game doesn't use, in
 * join order and without randomness, so a room loaded twice (after a restart) colours them the
 * same way until the next change saves it.
 */
export function withColors<P extends { color?: PlayerColor }>(
  players: readonly P[],
  palette: readonly PlayerColor[] = PLAYER_COLORS,
): (P & { color: PlayerColor })[] {
  const fits = (c: PlayerColor | undefined): c is PlayerColor => !!c && palette.includes(c);
  const taken = players.flatMap((p) => (fits(p.color) ? [p.color] : []));
  return players.map((p) => {
    if (fits(p.color)) return p as P & { color: PlayerColor };
    const color = freeColor(taken, () => 0, palette);
    taken.push(color);
    return { ...p, color };
  });
}
