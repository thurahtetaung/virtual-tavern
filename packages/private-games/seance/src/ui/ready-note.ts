import { createContext, useContext, useState } from 'react';
import type { SeanceView } from '../logic/types.ts';
import { myPsychic } from './status.ts';

/**
 * Changing your guess or a clairvoyance token takes back your Ready (the rules want a fresh Ready
 * for the final answer). The game says nothing about it, so the viewer's own screen explains it.
 */
export type ReadyDrop = 'guess' | 'token';

/** What matters about the viewer's own seat, to tell why Ready went away. */
export interface ReadySnap {
  /** The game, stage and hour: a note never outlives its hour. */
  key: string;
  ready: boolean;
  intuition: number | null;
  /** The viewer's own tokens, as a stable string. */
  marks: string;
}

export function readySnap(view: SeanceView): ReadySnap | null {
  const g = view.game;
  const me = g && myPsychic(view);
  if (!g || !me || g.stage !== 'visions') return null;
  return {
    key: `${view.gameNo}-${g.stage}-${g.hour}`,
    ready: me.ready,
    intuition: me.intuition,
    marks: g.marks
      .filter((m) => m.by === me.color)
      .map((m) => `${m.target}:${m.kind}`)
      .sort()
      .join(','),
  };
}

/** Why Ready went from on to off between two snapshots of the same hour, if the viewer's own change did it. */
export function readyDrop(prev: ReadySnap | null, next: ReadySnap | null): ReadyDrop | null {
  if (!prev || !next || prev.key !== next.key || !prev.ready || next.ready) return null;
  if (prev.intuition !== next.intuition) return 'guess';
  if (prev.marks !== next.marks) return 'token';
  return null;
}

export interface ReadyNote {
  reason: ReadyDrop;
  key: string;
}

/** The note after a new snapshot: a fresh drop sets it, Ready or a new hour clears it. */
export function nextReadyNote(
  note: ReadyNote | null,
  prev: ReadySnap | null,
  next: ReadySnap | null,
): ReadyNote | null {
  if (!next || next.ready) return null;
  const drop = readyDrop(prev, next);
  if (drop) return { reason: drop, key: next.key };
  return note?.key === next.key ? note : null;
}

export const READY_NOTE: Record<ReadyDrop, string> = {
  guess: 'You changed your guess: tap Ready again when you’re set.',
  token: 'You moved a token: tap Ready again when you’re set.',
};

const same = (a: ReadySnap | null, b: ReadySnap | null) =>
  a === b || (!!a && !!b && JSON.stringify(a) === JSON.stringify(b));

/** Follows the viewer's seat across snapshots and returns the note to show, if any. */
export function useReadyNote(view: SeanceView): ReadyDrop | null {
  const snap = readySnap(view);
  const [s, setS] = useState<{ prev: ReadySnap | null; note: ReadyNote | null }>({
    prev: snap,
    note: null,
  });
  let { note } = s;
  if (!same(s.prev, snap)) {
    note = nextReadyNote(s.note, s.prev, snap);
    setS({ prev: snap, note });
  }
  return note?.reason ?? null;
}

export const ReadyNoteContext = createContext<ReadyDrop | null>(null);
export const useReadyNoteText = () => {
  const r = useContext(ReadyNoteContext);
  return r ? READY_NOTE[r] : null;
};
