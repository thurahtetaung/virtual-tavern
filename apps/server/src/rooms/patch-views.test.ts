import { type GameDefinition, type PlayerInfo, playWithBots } from '@vt/game-sdk';
import { jeweller } from '@vt/private-jeweller/logic';
import { nightfall } from '@vt/private-nightfall/logic';
import { shortFuse } from '@vt/private-short-fuse/logic';
import { tavernBrawl } from '@vt/private-tavern-brawl/logic';
import { type Patch, applyPatch, diff } from '@vt/protocol';
import { describe, expect, it } from 'vitest';

const seats = (n: number): PlayerInfo[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` }));

type Def = GameDefinition<unknown, unknown, unknown>;
type Host = (view: never) => unknown;

/**
 * Plays a whole seeded game with bots and, after every change, sends each viewer (every seat and
 * the table screen) what changed in their own view, as the server does: each viewer's copy,
 * rebuilt from nothing but its own patches, must equal its `view()` exactly every time. Returns
 * the patched and whole sizes, so the test can check patches actually save something.
 */
function rebuildEveryView(def: Def, n: number, seed: number, host: Host) {
  const viewers = [...seats(n).map((s) => s.id), null];
  const sent = new Map<string | null, unknown>();
  const copies = new Map<string | null, unknown>();
  let changes = 0;
  let whole = 0;
  let patched = 0;
  const r = playWithBots(def, seats(n), {
    seed,
    maxSteps: 6000,
    host: host as (view: unknown) => unknown,
    onChange(state) {
      changes += 1;
      for (const viewer of viewers) {
        const json = JSON.stringify(def.view(state, viewer));
        const now = JSON.parse(json) as unknown;
        if (!sent.has(viewer)) copies.set(viewer, JSON.parse(json));
        else {
          const wire = JSON.stringify(diff(sent.get(viewer), now));
          whole += json.length;
          patched += Math.min(wire.length, json.length);
          copies.set(viewer, applyPatch(copies.get(viewer), JSON.parse(wire) as Patch));
        }
        sent.set(viewer, now);
        expect(copies.get(viewer)).toEqual(def.view(state, viewer));
      }
    },
  });
  expect(r.over).toBe(true);
  expect(changes).toBeGreaterThan(10);
  return { whole, patched };
}

const start = (v: { phase: string }) => (v.phase === 'lobby' ? { type: 'start' } : null);

describe('room updates as patches', () => {
  it('rebuild every Nightfall view, from the deal to the reveal', () => {
    for (const n of [3, 6, 10]) rebuildEveryView(nightfall, n, n, start);
  });

  it('rebuild every Short Fuse view with every expansion on', () => {
    const chaos = { core: 'classic', art: 'classic', x1: true, x2: true, x3: true, x4: true };
    const host = (v: { phase: string; settings: Record<string, unknown> }) => {
      if (v.phase !== 'lobby') return null;
      const ready = Object.entries(chaos).every(([k, x]) => v.settings[k] === x);
      return ready ? { type: 'start' } : { type: 'update-settings', ...chaos };
    };
    for (const n of [2, 5, 8]) {
      const { whole, patched } = rebuildEveryView(shortFuse, n, n, host);
      expect(patched).toBeLessThan(whole / 3);
    }
  });

  it('rebuild every Tavern Brawl and Jeweller view', () => {
    const brawlHost = (v: { phase: string; seats: { playing: boolean; hero?: string }[] }) => {
      if (v.phase !== 'lobby') return null;
      const seated = v.seats.filter((s) => s.playing);
      return seated.length >= 2 && seated.every((s) => s.hero) ? { type: 'start' } : null;
    };
    for (const n of [2, 4, 6]) rebuildEveryView(tavernBrawl, n, n, brawlHost);
    for (const n of [2, 4]) rebuildEveryView(jeweller, n, n, start);
  });
});
