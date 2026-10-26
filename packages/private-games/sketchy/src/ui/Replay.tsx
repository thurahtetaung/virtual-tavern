import type { Drawing } from '@vt/game-sdk';
import { DrawingView } from '@vt/ui';
import { type ReactNode, useState } from 'react';
import { REPLAY_MS } from '../logic/types.ts';

const replayed = new Set<string>();

/**
 * A drawing that draws itself in about a second and a half when it first comes up (every phone
 * gets it in the same broadcast, so the table watches it appear together), then stays. The replay
 * is a CSS animation, so a phone that was in the background shows it finished.
 */
export function Replay({
  replayKey,
  drawing,
  label,
  className,
  children,
}: {
  /** Names this drawing's appearance (round and drawing), so it replays once, not per screen. */
  replayKey: string;
  drawing: Drawing | null;
  label: string;
  className?: string;
  children?: ReactNode;
}) {
  // Only the first time this drawing comes up: moving on to the vote or the reveal shows it whole.
  const [animate] = useState(() => {
    if (replayed.has(replayKey)) return false;
    replayed.add(replayKey);
    return true;
  });
  return (
    <DrawingView
      drawing={drawing}
      label={label}
      className={className}
      drawInMs={animate ? REPLAY_MS : undefined}
    >
      {children}
    </DrawingView>
  );
}
