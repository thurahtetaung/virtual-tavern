import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { root, uiFiles } from './ui-sources.ts';

/*
 * Guard for one dot per name: a player's only dot is their room colour (`PlayerTag`, `NameDot`,
 * `PlayerDot`), and being away shows only as the "offline" tag. A class picked by whether a player
 * is online or connected (a green or grey presence dot, a tinted chip) fails this test, as does a
 * game's own per-player colour list.
 */

const PRESENCE_TEST = String.raw`\b(?:online|connected)\b(?:\.\w+)?(?:\([^)]*\))?\s*`;
// `online ? 'bg-…'`, `online.has(id) ? 'bg-…'`, `connected && 'bg-…'`: a fill chosen by presence.
const PRESENCE = new RegExp(PRESENCE_TEST + String.raw`(?:\?|&&)\s*['"\`][^'"\`]*?\bbg-`, 'g');
// `!online(id) && <span className="… rounded-full …" />`: an empty dot shown by presence.
const PRESENCE_DOT = new RegExp(
  PRESENCE_TEST + String.raw`&&\s*\(?\s*<span[^>]*?rounded-full[^>]*/>`,
  'g',
);
// A per-player palette of its own, like the old avatar tones.
const OWN_PALETTE = /\b(?:AVATAR|SEAT|PLAYER)_(?:TONES|COLOU?RS)\s*=\s*\[/g;

/** Every presence-coloured class and per-player palette in `source`, as `line: match`. */
export function extraDots(source: string): string[] {
  const at = (i: number) => source.slice(0, i).split('\n').length;
  return [PRESENCE, PRESENCE_DOT, OWN_PALETTE]
    .flatMap((re) => [...source.matchAll(re)])
    .map((m) => `${at(m.index)}: ${m[0]}`);
}

describe('one dot per name', () => {
  it('flags presence fills and own palettes but not the offline tag', () => {
    expect(
      extraDots(
        [
          `online ? 'bg-success dark:bg-emerald-500' : 'bg-stone-400',`,
          `p.connected\n  ? 'bg-stone-100 dark:bg-stone-800'`,
          `const AVATAR_TONES = [`,
          `{!online(id) && (\n  <span aria-label="offline" className="size-2 rounded-full" />`,
          `online.has(seat.playerId) ? 'bg-success' : 'bg-stone-400'`,
          `{!online(p.id) && <span className="text-ink-muted">offline</span>}`,
          `{!online && <span className="rounded-full px-1.5">offline</span>}`,
          `<PlayerTag name={name} offline={!online} />`,
        ].join('\n'),
      ),
    ).toEqual([
      "1: online ? 'bg-",
      "2: connected\n  ? 'bg-",
      "7: online.has(seat.playerId) ? 'bg-",
      '5: online(id) && (\n  <span aria-label="offline" className="size-2 rounded-full" />',
      '4: AVATAR_TONES = [',
    ]);
  });

  it('finds no presence dots or own player colours in UI code', () => {
    const found = uiFiles()
      // The admin stats pages are not a room: they mark offline players without colours.
      .filter(({ file }) => !file.includes('apps/web/src/stats/'))
      .flatMap(({ file }) =>
        extraDots(readFileSync(file, 'utf8')).map((hit) => `${relative(root, file)}:${hit}`),
      );
    expect(found, 'show players with PlayerTag or NameDot, and away as "offline"').toEqual([]);
  });
});
