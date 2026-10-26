import { MAX_CHIPS, revealParts } from '@vt/game-sdk/show';
import type { CSSProperties, ReactNode } from 'react';
import { Label, Layer, RigArt } from './blocks.tsx';
import type { LoadedRig } from './rig.ts';

// The shared reveal's blocks (`revealMoments` in @vt/game-sdk/show): the card that turns an answer
// over and the chooser chips on it. They draw a rig's own parts (whatever the game's original
// has: a balloon, a glow, marks) and register the targets the moments move; every word is live.
// Hidden until a moment brings them on, so a device with no moment shows nothing stale.

const HIDDEN: CSSProperties = { opacity: 0 };

/**
 * The reveal card: a layer per rig part (`card/<part>`), the part's own art where the rig has it,
 * and the game's live content in the parts it names (`live`: the balloon with the answer, the
 * row of choosers, the author).
 */
export function RevealCard({
  rig,
  live = {},
  name = 'card',
  className,
  style,
}: {
  rig: LoadedRig;
  /** Content per part (`card-bubble`: the answer's balloon…); other parts draw their art. */
  live?: Record<string, ReactNode>;
  name?: string;
  className?: string;
  style?: CSSProperties;
}) {
  const { card } = revealParts(rig.tracks);
  return (
    <Layer name={name} className={className} style={style}>
      {card.map((part) => (
        <Layer key={part} name={`${name}/${part}`} moving style={HIDDEN}>
          {live[part] ?? (rig.symbols[part] ? <RigArt rig={rig} symbol={part} /> : null)}
        </Layer>
      ))}
    </Layer>
  );
}

/** Chip `k` of the card: its name (with the player's dot) and the points it turns into. */
export function Chooser({
  rig,
  k,
  nameStyle,
  pointsStyle,
}: {
  rig: LoadedRig;
  k: number;
  nameStyle?: CSSProperties;
  pointsStyle?: CSSProperties;
}) {
  const { chooser } = revealParts(rig.tracks);
  const name = `chip:${k}`;
  return (
    <Layer name={name} className="vt-chip">
      {chooser.map((part) => (
        <Layer key={part} name={`${name}/${part}`} moving style={HIDDEN}>
          {part.endsWith('points') ? (
            <Label name={`${name}.points`} style={pointsStyle} />
          ) : (
            <span
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                transform: 'translate(-50%, -50%)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                whiteSpace: 'nowrap',
                ...nameStyle,
              }}
            >
              <span className="vt-chip-dot" aria-hidden />
              <ChipName name={`${name}.name`} />
            </span>
          )}
        </Layer>
      ))}
    </Layer>
  );
}

function ChipName({ name }: { name: string }) {
  return <Label name={name} style={{ position: 'static', transform: 'none' }} />;
}

/**
 * Every chip a card can hold: at the rig's own spots (`chips.initial`, the original's locators)
 * when it has them, else in two rows `gap` apart centred on the layer's origin.
 */
export function Choosers({
  rig,
  gap = 150,
  y = 0,
  nameStyle,
  pointsStyle,
}: {
  rig: LoadedRig;
  gap?: number;
  y?: number;
  nameStyle?: CSSProperties;
  pointsStyle?: CSSProperties;
}) {
  const spots = rig.places['chips.initial'] as number[][] | undefined;
  return (
    <>
      {Array.from({ length: MAX_CHIPS }, (_, k) => {
        const m = spots?.[k] ?? [1, 0, 0, 1, ((k % 4) - 1.5) * gap, y + (k < 4 ? 0 : 46)];
        return (
          <Layer key={k} m={m}>
            <Chooser rig={rig} k={k} nameStyle={nameStyle} pointsStyle={pointsStyle} />
          </Layer>
        );
      })}
    </>
  );
}
