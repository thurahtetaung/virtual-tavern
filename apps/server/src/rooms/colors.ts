import { PLAYER_COLORS, type PlayerColor } from '@vt/protocol';

/**
 * A colour for someone joining: a random one nobody here has. Rooms hold up to 30 people and there
 * are 16 colours, so once every colour is taken a joiner gets one of the least used, and an invite
 * never bounces.
 */
export function freeColor(taken: readonly PlayerColor[], pick: (n: number) => number): PlayerColor {
  const uses = (c: PlayerColor) => taken.filter((t) => t === c).length;
  const least = Math.min(...PLAYER_COLORS.map(uses));
  const options = PLAYER_COLORS.filter((c) => uses(c) === least);
  return options[pick(options.length)]!;
}

/**
 * Gives a colour to players saved before rooms had them, in join order and without randomness,
 * so a room loaded twice (after a restart) colours them the same way until the next change
 * saves it.
 */
export function withColors<P extends { color?: PlayerColor }>(
  players: readonly P[],
): (P & { color: PlayerColor })[] {
  const taken = players.flatMap((p) => (p.color ? [p.color] : []));
  return players.map((p) => {
    if (p.color) return p as P & { color: PlayerColor };
    const color = freeColor(taken, () => 0);
    taken.push(color);
    return { ...p, color };
  });
}
