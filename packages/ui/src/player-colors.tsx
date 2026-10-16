import { PLAYER_COLOR_NAMES, PLAYER_COLORS, type PlayerColor } from '@vt/game-sdk';
import { createContext, useContext } from 'react';
import { cn } from './cn.ts';

/**
 * Each player colour's dot. These are the players' own colours, not decoration, so they keep their
 * hue in light mode too (the light palette calms it); the ring keeps the pale ones visible on
 * light panels and the dark ones on dark panels.
 */
export const PLAYER_DOT: Record<PlayerColor, string> = {
  // vt-palette: player colours
  red: 'bg-red-600 dark:bg-red-500',
  blue: 'bg-blue-700 dark:bg-blue-500', // vt-palette
  green: 'bg-green-700 dark:bg-green-500', // vt-palette
  yellow: 'bg-yellow-400 dark:bg-yellow-300', // vt-palette
  purple: 'bg-purple-600 dark:bg-purple-400', // vt-palette
  orange: 'bg-orange-500 dark:bg-orange-400', // vt-palette
  pink: 'bg-pink-400 dark:bg-pink-300', // vt-palette
  teal: 'bg-teal-600 dark:bg-teal-400', // vt-palette
  lime: 'bg-lime-500 dark:bg-lime-400', // vt-palette
  sky: 'bg-sky-400 dark:bg-sky-300', // vt-palette
  brown: 'bg-amber-800 dark:bg-amber-700', // vt-palette
  grey: 'bg-stone-500 dark:bg-stone-400',
  black: 'bg-stone-950 dark:bg-black',
  white: 'bg-white dark:bg-white',
  magenta: 'bg-fuchsia-700 dark:bg-fuchsia-500', // vt-palette
  mint: 'bg-emerald-300 dark:bg-emerald-300', // vt-palette
};

const RING = 'ring-1 ring-black/30 dark:ring-white/40';

/**
 * The colours of the room's players by name, from the room shell (names are unique in a room),
 * so every `PlayerTag` shows its player's dot without any game knowing about colours.
 */
export const PlayerColors = createContext<ReadonlyMap<string, PlayerColor>>(new Map());

/** The colour of the player called `name` in this room, if the shell knows it. */
export const usePlayerColor = (name: string) => useContext(PlayerColors).get(name);

/**
 * A player's colour as a plain dot. It reads its colour name to screen readers; pass `label={false}`
 * where the colour is already said next to it.
 */
export function PlayerDot({
  color,
  label = true,
  className,
}: {
  color: PlayerColor;
  label?: boolean;
  className?: string;
}) {
  return (
    <span
      data-color={color}
      {...(label
        ? { role: 'img', 'aria-label': PLAYER_COLOR_NAMES[color] }
        : { 'aria-hidden': true })}
      className={cn(
        'inline-block size-2.5 shrink-0 rounded-full',
        RING,
        PLAYER_DOT[color],
        className,
      )}
    />
  );
}

/**
 * The colour swatches: the viewer's own is ticked, and the ones other players have are faded and
 * say whose they are (picking one is still sent, so the room explains the refusal).
 */
export function ColorPicker({
  value,
  taken,
  onPick,
  disabled = false,
}: {
  value: PlayerColor | undefined;
  /** Colours other players have, with their names. */
  taken: ReadonlyMap<PlayerColor, string>;
  onPick: (color: PlayerColor) => void;
  disabled?: boolean;
}) {
  return (
    // Six to a row on a 360 px phone, eight from `sm` up.
    <div
      role="radiogroup"
      aria-label="Your colour"
      className="grid w-fit grid-cols-6 gap-1 sm:grid-cols-8"
    >
      {PLAYER_COLORS.map((c) => {
        const holder = taken.get(c);
        const mine = c === value;
        const name = PLAYER_COLOR_NAMES[c];
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={mine}
            aria-label={holder ? `${name}, taken by ${holder}` : name}
            title={holder ? `${name}: ${holder}` : name}
            disabled={disabled}
            onClick={() => onPick(c)}
            className="grid size-11 place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-50"
          >
            <span
              className={cn(
                'grid size-8 place-items-center rounded-full',
                RING,
                PLAYER_DOT[c],
                mine && 'ring-2 ring-ink ring-offset-2 ring-offset-card dark:ring-white',
                holder && !mine && 'opacity-40',
              )}
            >
              {mine && (
                <span aria-hidden className="text-sm font-black text-white mix-blend-difference">
                  ✓
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
