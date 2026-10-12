import { type BotCtx, playWithBots } from '@vt/game-sdk';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { nightfall } from './game.ts';
import { SCENARIOS, scenarioRoles } from './presets.ts';
import type { RoleId } from './roles.ts';
import type { NightfallAction, NightfallView } from './types.ts';

const seats = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}` }));

/** The human host: sets the roles (if given), then starts. */
const host =
  (roles?: RoleId[]) =>
  (v: NightfallView): NightfallAction | null => {
    if (v.phase !== 'lobby') return null;
    if (roles && JSON.stringify(v.settings.roles) !== JSON.stringify(roles))
      return { type: 'update-settings', roles };
    return { type: 'start' };
  };

describe('Nightfall bots', () => {
  it('see only their own seat’s view', () => {
    expectTypeOf<Parameters<NonNullable<typeof nightfall.bot>>>().toEqualTypeOf<
      [NightfallView, BotCtx]
    >();
  });

  it('play the recommended table at every size with no refused move', () => {
    for (let n = 3; n <= 10; n++) {
      for (const seed of [1, 2, 3]) {
        const r = playWithBots(nightfall, seats(n), { seed, host: host(), maxSteps: 3000 });
        expect(r.refused).toEqual([]);
        expect(r.over).toBe(true);
      }
    }
  });

  it('play every scenario through', () => {
    for (const preset of SCENARIOS) {
      const n = Math.max(preset.minPlayers, 6);
      const roles = scenarioRoles(preset, n);
      if (!roles) continue;
      for (const seed of [1, 2]) {
        const r = playWithBots(nightfall, seats(n), { seed, host: host(roles), maxSteps: 3000 });
        expect(r.refused, preset.id).toEqual([]);
        expect(r.over, preset.id).toBe(true);
      }
    }
  });
});
