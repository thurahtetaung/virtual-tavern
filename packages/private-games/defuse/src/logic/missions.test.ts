import { describe, expect, it } from 'vitest';
import { LIGHTS, createBomb, generatorOf, runTo } from './bomb.ts';
import { DEFAULT_SETTINGS, defuse } from './game.ts';
import { ANY, ANY_NEEDY, MISSIONS, missionById, moduleCount } from './missions.ts';
import { ANA, BEN, bomb, must, table, wait } from './test-utils.ts';
import { type NeedyModule, type Settings, isNeedy } from './types.ts';

const S = (o: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...o });

describe('the bomb binder', () => {
  it('holds every mission in the binder’s order, each fitting the casing', () => {
    expect(MISSIONS).toHaveLength(32);
    expect(MISSIONS.map((m) => m.section)).toEqual([...MISSIONS.map((m) => m.section)].sort());
    for (const m of MISSIONS) {
      expect(moduleCount(m)).toBeGreaterThanOrEqual(3);
      expect(moduleCount(m)).toBeLessThanOrEqual(m.front ? 5 : 11);
    }
    expect(missionById('s1-1')).toMatchObject({ time: 300, strikes: 3, front: true });
    expect(missionById('s4-4')).toMatchObject({ needyAfter: 0, strikes: 1, pacing: true });
  });

  it.each(MISSIONS.map((m) => [m.id, m] as const))('%s builds its bomb', (_id, m) => {
    for (let seed = 1; seed <= 25; seed++) {
      const b = createBomb(1, seed, S({ mission: m.id, modules: 3, time: 30 }), 0);
      expect(b.mission).toBe(m.id);
      expect(b.total).toBe(m.time * 1000);
      expect(b.strikeLimit).toBe(m.strikes);
      expect(b.modules).toHaveLength(moduleCount(m));
      expect(b.needyAfter).toBe((m.needyAfter ?? 90) * 1000);
      if (m.front) {
        expect(b.timer.face).toBe(0);
        expect(b.modules.every((x) => x.face === 0)).toBe(true);
      }
      if (!m.pacing) expect(b.pace).toBeNull();
      // Every module comes from one of its pools, in the pools' counts.
      const left = m.pools.map((p) => ({
        count: p.count,
        kinds: p.kinds,
      }));
      for (const x of b.modules) {
        const pool = left.find((p) => p.count > 0 && p.kinds.includes(x.kind));
        expect(pool, `${x.kind} in ${m.id}`).toBeTruthy();
        pool!.count--;
      }
      // The Button sits by the timer when its face has room.
      for (const x of b.modules)
        if (x.kind === 'button' && b.modules.filter((y) => y.face === b.timer.face).length < 5)
          expect(x.face).toBe(b.timer.face);
    }
  });

  it('the special pools are every solvable and every needy kind', () => {
    expect(new Set(ANY).size).toBe(11);
    expect(new Set(ANY_NEEDY).size).toBe(3);
    const hardcore = missionById('s6-4')!;
    const b = createBomb(1, 3, S({ mission: hardcore.id }), 0);
    expect(b.modules.filter((x) => isNeedy(x.kind))).toHaveLength(1);
  });

  it('a mission with needy modules at once wakes them as the clock starts', () => {
    const b = createBomb(1, 1, S({ mission: 's4-4' }), 0);
    runTo(b, LIGHTS.clock + 1);
    const needy = b.modules.filter((x) => isNeedy(x.kind)) as NeedyModule[];
    expect(needy.length).toBeGreaterThan(0);
    for (const n of needy) expect(n.state).toBe('running');
  });

  it('Free Play is unchanged: its own settings and pools', () => {
    const g = generatorOf(S({ modules: 5, time: 120, hardcore: true }));
    expect(g).toMatchObject({ mission: null, time: 120, strikes: 1, front: false, pacing: true });
  });

  it('the host picks any mission from the start, the result names it, and back to Free Play', () => {
    const t = table([ANA, BEN], 3, { mission: 's7-6' });
    must(t, ANA, { type: 'start' });
    expect(bomb(t).mission).toBe('s7-6');
    wait(t, 10 * 60_000);
    expect(t.state.stage).toBe('result');
    expect(t.state.history.at(-1)!.mission).toBe('s7-6');
    expect(JSON.stringify(defuse.view(t.state, BEN).history)).toContain('s7-6');
    must(t, ANA, { type: 'settings', settings: { mission: null } });
    must(t, ANA, { type: 'next' });
    expect(bomb(t).mission).toBeNull();
  });

  it('refuses a mission that is not in the binder', () => {
    expect(
      defuse.actionSchema.safeParse({ type: 'settings', settings: { mission: 's9-9' } }).success,
    ).toBe(false);
  });
});
