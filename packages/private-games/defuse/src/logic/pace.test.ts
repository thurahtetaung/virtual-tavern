import { describe, expect, it } from 'vitest';
import { ALARM_MS, LIGHTS, PACE, createBomb, pressAlarm, runTo, successRating } from './bomb.ts';
import { DEFAULT_SETTINGS } from './game.ts';
import { ANA, BEN, bomb, must, send, table, wait } from './test-utils.ts';
import type { Bomb, Settings } from './types.ts';

const S = (o: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, ...o });

/** Solves every module but one, so the bomb is going well (the rating is over 0.5). */
function goingWell(b: Bomb) {
  const solvable = b.modules.filter((m) => !['venting-gas', 'capacitor', 'knob'].includes(m.kind));
  for (const m of solvable.slice(1)) m.solved = true;
}

describe('the room’s surprises (PaceMaker)', () => {
  it('checks every 20–60 s of real time from when the clock starts', () => {
    for (let seed = 1; seed < 200; seed++) {
      const b = createBomb(1, seed, S(), 0);
      const first = b.pace!.next!;
      expect(first).toBeGreaterThanOrEqual(LIGHTS.clock + PACE.min);
      expect(first).toBeLessThanOrEqual(LIGHTS.clock + PACE.max);
    }
  });

  it('is off with the host’s switch, and never changes the bomb', () => {
    const on = createBomb(1, 7, S({ surprises: true }), 0);
    const off = createBomb(1, 7, S({ surprises: false }), 0);
    expect(off.pace).toBeNull();
    const { pace: _a, ...a } = on;
    const { pace: _b, ...b } = off;
    expect(a).toEqual(b);
    runTo(off, 600_000);
    expect(off.lightsAt).toBeNull();
    expect(off.alarm).toBeNull();
  });

  it('only surprises a bomb that is going well, each surprise once', () => {
    let lights = 0;
    let alarms = 0;
    for (let seed = 1; seed < 60; seed++) {
      const b = createBomb(1, seed, S({ time: 600, modules: 5 }), 0);
      goingWell(b);
      runTo(b, 500_000);
      if (b.lightsAt) lights++;
      if (b.alarm) alarms++;
      expect(b.pace!.left.length).toBe(2 - (b.lightsAt ? 1 : 0) - (b.alarm ? 1 : 0));
      // Doing well, ten minutes on the clock: both come within the first few checks.
      expect(b.pace!.left).toEqual([]);
    }
    expect(lights).toBe(59);
    expect(alarms).toBe(59);
    const idle = createBomb(1, 3, S({ time: 600, modules: 5 }), 0);
    runTo(idle, 500_000);
    expect(idle.lightsAt).toBeNull();
    expect(idle.alarm).toBeNull();
  });

  it('rates the bomb as the original does', () => {
    const b = createBomb(1, 5, S({ time: 300, modules: 3 }), 0);
    runTo(b, LIGHTS.clock);
    // Nothing solved, no strikes, all the time: 0 + 0.3 + 0.2.
    expect(successRating(b, LIGHTS.clock)).toBeCloseTo(0.5);
    b.modules.find((m) => !m.solved)!.solved = true;
    expect(successRating(b, LIGHTS.clock)).toBeCloseTo(0.75);
    b.strikes = 1;
    expect(successRating(b, LIGHTS.clock)).toBeCloseTo(0.6);
    // Hardcore: strikes count nothing.
    const h = createBomb(1, 5, S({ hardcore: true, time: 60 }), 0);
    expect(successRating(h, LIGHTS.clock)).toBeCloseTo(0);
  });

  it('rings the alarm for 20 s; the snooze stops it, and a press sets it ringing', () => {
    const b = createBomb(1, 9, S({ surprises: false }), 0);
    runTo(b, 20_000);
    pressAlarm(b, 20_000);
    expect(b.alarm).toEqual({ at: 20_000, until: 20_000 + ALARM_MS });
    pressAlarm(b, 25_000);
    expect(b.alarm).toEqual({ at: 20_000, until: 25_000 });
  });

  it('is the defuser’s alone, and the end stops the clock ringing', () => {
    const t = table([ANA, BEN]);
    must(t, ANA, { type: 'start' });
    wait(t, 10_000);
    expect(send(t, BEN, { type: 'alarm' })).toHaveProperty('code', 'not-defuser');
    must(t, ANA, { type: 'alarm' });
    expect(bomb(t).alarm!.until).toBe(t.now + ALARM_MS);
    wait(t, 400_000);
    expect(bomb(t).end).not.toBeNull();
    expect(bomb(t).alarm!.until).toBeLessThanOrEqual(bomb(t).end!.at);
  });
});

describe('the start from the briefcase', () => {
  it('lets the next defuser start, never another expert', () => {
    const t = table([ANA, BEN], 1, { defuserMode: 'rotate' });
    must(t, ANA, { type: 'set-defuser', player: BEN });
    expect(send(t, ANA, { type: 'start' })).not.toHaveProperty('code');
    const u = table([ANA, BEN, 'cho']);
    must(u, ANA, { type: 'set-defuser', player: BEN });
    expect(send(u, 'cho', { type: 'start' })).toHaveProperty('code', 'not-host');
    must(u, BEN, { type: 'start' });
    expect(u.state.defuser).toBe(BEN);
    expect(u.state.stage).toBe('bomb');
  });

  it('leaves random draws to the host', () => {
    const t = table([ANA, BEN], 1, { defuserMode: 'random' });
    expect(send(t, BEN, { type: 'start' })).toHaveProperty('code', 'not-host');
  });
});
