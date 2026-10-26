import type { PlayerColor } from '@vt/game-sdk';
import type { SketchyView } from '../logic/types.ts';

const INK = '#1c1917';

/** Each player colour as a paint on paper. */
export const PAINT: Record<PlayerColor, string> = {
  red: '#dc2626', // vt-palette
  blue: '#1d4ed8', // vt-palette
  green: '#15803d', // vt-palette
  yellow: '#facc15', // vt-palette
  purple: '#9333ea', // vt-palette
  orange: '#f97316', // vt-palette
  pink: '#f472b6', // vt-palette
  teal: '#0d9488', // vt-palette
  lime: '#84cc16', // vt-palette
  sky: '#38bdf8', // vt-palette
  brown: '#92400e', // vt-palette
  grey: '#78716c',
  black: '#0c0a09',
  white: '#f5f5f4',
  magenta: '#a21caf', // vt-palette
  mint: '#6ee7b7', // vt-palette
};

/** Each player's dot colour for the chips the moments fill (by `data-player`). */
export function ChipColours({
  view,
  colours,
}: {
  view: SketchyView;
  colours: ReadonlyMap<string, string>;
}) {
  const css = view.seats
    .map((s) => {
      const c = colours.get(s.id);
      return c ? `[data-player="${s.id}"] .vt-chip-dot{background:${c}}` : '';
    })
    .join('');
  return (
    <style>{`.vt-chip-dot{display:inline-block;width:18px;height:18px;border-radius:999px;background:#888;box-shadow:0 0 0 2px ${INK}}${css}`}</style>
  );
}

/** The room's players' paints by id. */
export const paintsOf = (players: readonly { id: string; color?: PlayerColor }[]) =>
  new Map(players.flatMap((p) => (p.color ? [[p.id, PAINT[p.color]] as [string, string]] : [])));
