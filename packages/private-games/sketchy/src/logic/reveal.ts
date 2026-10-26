import { REVEAL_FLIP_MS, REVEAL_STEP_MS, type OptionView } from './types.ts';

/**
 * The order the reveal turns the answers over, as board indexes: every fake somebody picked, least
 * picked first (board order breaks ties), then the real title last. Answers nobody picked only
 * show on the full board afterwards.
 */
export function revealOrder(
  options: readonly Pick<OptionView, 'index' | 'truth' | 'voters'>[],
): number[] {
  const picked = options
    .filter((o) => !o.truth && (o.voters?.length ?? 0) > 0)
    .sort((a, b) => a.voters!.length - b.voters!.length || a.index - b.index)
    .map((o) => o.index);
  const truth = options.find((o) => o.truth);
  return truth ? [...picked, truth.index] : picked;
}

/**
 * Where the reveal is, `elapsed` ms after it began: the answer in the spotlight (`step`, an index
 * into the order), whether it has flipped yet, and whether the whole board is out (`done`).
 */
export function revealProgress(count: number, elapsed: number) {
  const step = Math.max(0, Math.floor(elapsed / REVEAL_STEP_MS));
  if (step >= count) return { step: count, flipped: true, done: true };
  return { step, flipped: elapsed - step * REVEAL_STEP_MS >= REVEAL_FLIP_MS, done: false };
}
