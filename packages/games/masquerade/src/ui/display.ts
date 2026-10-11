import { locationById } from '../content/locations.ts';

/**
 * How locations look on screen. The public game reads its own pack; the back-room edition reads
 * names, art and coaching from its private manifest, with numbered placeholders without it.
 */
export interface LocationDisplay {
  name(id: string): string;
  emoji(id: string): string | null;
  /** URL of the location's picture, if any. */
  art(id: string): string | null;
  /** Coaching for the locals: how to hint without giving the place away. */
  tip(id: string): string | null;
  /** Pointed question ideas for this location. */
  questions(id: string): string[];
  /** URL of the card back's art, shown on the spy's card, if any. */
  back: string | null;
  /** A label for an edition, falling back to the pack's own. */
  editionLabel(id: string, fallback: string): string;
}

export const publicDisplay: LocationDisplay = {
  name: (id) => locationById(id)?.name ?? id,
  emoji: (id) => locationById(id)?.emoji ?? null,
  art: () => null,
  back: null,
  tip: (id) => locationById(id)?.tip ?? null,
  questions: (id) => locationById(id)?.questions ?? [],
  editionLabel: (_id, fallback) => fallback,
};
