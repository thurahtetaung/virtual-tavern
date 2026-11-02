import type { RedHerringView } from '../logic/types.ts';

export type Cue = 'newWord' | 'winner';

/**
 * The cue moments a view holds, each with a key that stays the same for as long as the moment
 * lasts: the word from the moment it is written to the round's end, the winner while the game
 * is over. A cue plays when its key appears (see `cueStep`).
 */
export function cuesOf(view: RedHerringView): { key: string; cue: Cue }[] {
  const g = view.game;
  if (!g) return [];
  const out: { key: string; cue: Cue }[] = [];
  const r = g.round;
  const written = r.stage !== 'card' && r.stage !== 'word';
  if (written && view.phase === 'playing')
    out.push({ key: `word:${r.no}:${r.picker}`, cue: 'newWord' });
  if (view.phase === 'over') out.push({ key: 'over', cue: 'winner' });
  return out;
}

/**
 * The cues to play for a new view, given the keys the last view held (`null` before the first
 * view: a page opened mid-game doesn't replay what already happened). Only the current keys are
 * kept, so the same moment in a later game plays again.
 */
export function cueStep(
  seen: ReadonlySet<string> | null,
  view: RedHerringView,
): { play: Cue[]; seen: Set<string> } {
  const cues = cuesOf(view);
  return {
    play: seen === null ? [] : cues.filter((c) => !seen.has(c.key)).map((c) => c.cue),
    seen: new Set(cues.map((c) => c.key)),
  };
}
