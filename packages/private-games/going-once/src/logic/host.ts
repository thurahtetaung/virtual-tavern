import type { Rng } from '@vt/game-sdk';
import type { GoingOnceState } from './types.ts';

/**
 * The host's moments, the keys of the private host pack. A moment with no lines says nothing.
 * `bid-<amount>` reacts to a bid of exactly that amount ($400–$4,000), `bid-high` to more.
 */
export const HOST_MOMENTS = [
  'opening',
  'opening-first',
  'going-once',
  'going-once-fast',
  'going-twice',
  'going-twice-fast',
  'sold',
  'congrats',
  'no-bids-first',
  'no-bids-1',
  'no-bids-2',
  'unsold',
  'windfall',
  'ouch',
  'even',
  'commission-high',
  'commission-low',
  'own-art',
  'own-art-screwed',
  'screw-fail',
  'screw-lost',
  'quiet',
  'no-art',
  'halftime',
  'bank-first',
  'bank-called',
  'draw-start',
  'draw-halfway',
  'draw-seconds',
  'draw-all-in',
  'draw-missing',
  'redraw',
  'no-drawings',
  'end-intro',
] as const;

export const bidMoment = (amount: number) => (amount <= 4000 ? `bid-${amount}` : 'bid-high');

/** One line for a moment, with `{player}` filled, or null when the pack has none. */
function lineFor(s: GoingOnceState, rng: Rng, moment: string, player?: string): string | null {
  const lines = s.game?.hostLines[moment];
  if (!lines?.length) return null;
  const line = lines[rng.int(lines.length)]!;
  if (line.includes('{player}') && !player) return null;
  const text = line.replaceAll('{player}', player ?? '');
  // Lines are shown one after another, so each must end like a sentence.
  return /[.!?…"”'’]$/.test(text) ? text : `${text}.`;
}

/**
 * The host says the first available line of each part, in order: a part is a moment, or a list
 * of moments to try in turn. Says nothing (keeping the last line) when no part has a line, unless
 * `clear` is set.
 */
type Named = { moment: string; player: string };
/** One part of what the host says: a moment, or moments to try in turn (the first with a line). */
export type HostPart = string | Named | readonly (string | Named)[];

export function say(
  s: GoingOnceState,
  rng: Rng,
  now: number,
  parts: readonly HostPart[],
  clear = false,
): void {
  const g = s.game!;
  const lines: string[] = [];
  const moments: string[] = [];
  const named: boolean[] = [];
  for (const part of parts) {
    const options: readonly (string | Named)[] = Array.isArray(part)
      ? part
      : [part as string | Named];
    for (const o of options) {
      const text = typeof o === 'string' ? lineFor(s, rng, o) : lineFor(s, rng, o.moment, o.player);
      if (text) {
        lines.push(text);
        moments.push(typeof o === 'string' ? o : o.moment);
        // A line for a named moment only names someone if it has the placeholder; a bare line
        // from a named moment's pool still names nobody, but it is said to someone: keep it quiet.
        named.push(typeof o !== 'string');
        break;
      }
    }
  }
  if (!lines.length) {
    if (clear) g.host = null;
    return;
  }
  s.seq += 1;
  g.host = {
    id: s.seq,
    lines: lines.slice(0, 3),
    moments: moments.slice(0, 3),
    named: named.slice(0, 3),
    at: now,
  };
}
