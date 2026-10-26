import { useState } from 'react';
import type { SketchyView } from '../logic/types.ts';
import { seenKeys } from './show.ts';

/**
 * When this device first saw each of the view's `seenKeys`, on the server clock: what was already
 * there when it arrived counts as long past (0), so a late device never replays old beats.
 */
export function useSeen(view: SketchyView, clockOffset: number): Readonly<Record<string, number>> {
  const keys = seenKeys(view).join('|');
  const [seen, setSeen] = useState<{ keys: string; at: Record<string, number> } | null>(null);
  if (!seen) {
    setSeen({ keys, at: Object.fromEntries(keys ? keys.split('|').map((k) => [k, 0]) : []) });
  } else if (seen.keys !== keys) {
    const at = { ...seen.at };
    // The moment a key first shows up is the point.
    const now = Date.now() + clockOffset;
    for (const k of keys ? keys.split('|') : []) at[k] ??= now;
    setSeen({ keys, at });
  }
  return seen?.at ?? {};
}
