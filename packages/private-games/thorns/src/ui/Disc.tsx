import type { PlayerColor } from '@vt/game-sdk';
import { PLAYER_DOT, ProtectedImage, cn } from '@vt/ui';
import { memo } from 'react';
import { DISC_EMOJI, discName } from '../logic/names.ts';
import type { Disc as DiscKind } from '../logic/types.ts';
import type { Art } from './assets.ts';

/** A face-up disc, a face-down one (`back`), or an empty slot. */
export type Face = DiscKind | 'back';

/**
 * One disc: the set's art when the manifest has it, else the disc's emoji on a disc in the
 * player's room colour (the back is the plain colour).
 */
export const DiscView = memo(function DiscView({
  face,
  seat,
  color,
  art,
  size = 44,
  className,
  flip,
  marked,
}: {
  face: Face;
  /** The seat's place in the game (picks the set's art). */
  seat: number;
  color: PlayerColor | undefined;
  art: Art;
  size?: number;
  className?: string;
  /** Turned over just now: plays the flip. */
  flip?: boolean;
  /** A face-down Last Chance disc everyone knows about. */
  marked?: boolean;
}) {
  const set = art.set(seat);
  // The art is 240 px: small discs use the 120 px copies.
  const small = size <= 60;
  const pics = small ? set.thumbs : set;
  const chanceFace = small ? art.chance.faceThumb : art.chance.face;
  const src =
    face === 'chance'
      ? chanceFace
      : face === 'back'
        ? marked
          ? (art.chance.back ?? chanceFace)
          : pics.back
        : pics[face];
  const label =
    face === 'back'
      ? marked
        ? `face-down ${art.names.chance}`
        : 'face-down disc'
      : discName(art.names, face);
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full shadow-sm ring-2 ring-black/20 dark:ring-white/25',
        !src && (color ? PLAYER_DOT[color] : 'bg-stone-500 dark:bg-stone-400'),
        flip && 'th-flip',
        className,
      )}
    >
      {src ? (
        <ProtectedImage src={src} alt="" className="absolute inset-0 size-full object-cover" />
      ) : face === 'back' ? (
        marked ? (
          <span aria-hidden style={{ fontSize: size * 0.42 }}>
            {DISC_EMOJI.chance}
          </span>
        ) : (
          <span aria-hidden className="size-1/3 rounded-full bg-white/25 dark:bg-black/20" />
        )
      ) : (
        <span
          aria-hidden
          style={{ width: size * 0.72, height: size * 0.72, fontSize: size * 0.4 }}
          className="flex items-center justify-center rounded-full bg-white dark:bg-stone-100"
        >
          {DISC_EMOJI[face]}
        </span>
      )}
    </span>
  );
});

const CSS = `
@keyframes th-flip { from { opacity: 0; transform: rotateY(90deg) scale(.8) } to { opacity: 1; transform: none } }
@keyframes th-rise { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
@keyframes th-shake { 0%,100% { transform: none } 20% { transform: translateX(-5px) } 40% { transform: translateX(5px) } 60% { transform: translateX(-3px) } 80% { transform: translateX(2px) } }
.th-flip { animation: th-flip .45s ease-out both }
.th-rise { animation: th-rise .3s ease-out both }
.th-shake { animation: th-shake .6s ease-in-out both }
@media (prefers-reduced-motion: reduce) {
  .th-flip, .th-rise { animation: th-rise .01s both }
  .th-shake { animation: none }
}
`;

export function ThornsStyles() {
  return <style>{CSS}</style>;
}
