import { withHostVolume } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { FULL_VOLUMES, type Volumes, gainOf, hostChanges, takeHostChanges } from './volumes.ts';

// The host's volumes for everyone: each device takes the host's latest change of a slider once,
// a player's own change after it sticks, and the host's next change of that slider wins again.

describe('withHostVolume', () => {
  it('keeps the level with a version that never repeats', () => {
    const one = withHostVolume(undefined, 'music', 0.4, 1_000);
    expect(one).toEqual({ music: { level: 0.4, v: 1_000 } });
    const two = withHostVolume(one, 'music', 0.2, 1_000);
    expect(two.music).toEqual({ level: 0.2, v: 1_001 });
    const three = withHostVolume(two, 'master', 2, 900);
    expect(three.master).toEqual({ level: 1, v: 900 });
    expect(three.music).toEqual(two.music);
    expect(withHostVolume(three, 'effects', -1, 5_000).effects).toEqual({ level: 0, v: 5_000 });
  });
});

describe('a device takes the host’s volumes', () => {
  /** A device: its own volumes and the versions it has taken in. */
  function device(isHost = false) {
    let volumes: Volumes = { ...FULL_VOLUMES };
    let applied = {};
    return {
      get volumes() {
        return volumes;
      },
      own(which: keyof Volumes, level: number) {
        volumes = { ...volumes, [which]: level };
      },
      see(host: Parameters<typeof takeHostChanges>[0]) {
        const out = takeHostChanges(host, applied, isHost);
        applied = out.applied;
        for (const c of out.set) volumes = { ...volumes, [c.which]: c.level };
        return out.set;
      },
    };
  }

  it('applies a room saved without host volumes as nothing', () => {
    const d = device();
    expect(d.see(undefined)).toEqual([]);
    expect(d.see({})).toEqual([]);
    expect(d.volumes).toEqual(FULL_VOLUMES);
  });

  it('sets the slider once, lets the player change it, then follows the host again', () => {
    const d = device();
    let room = withHostVolume(undefined, 'music', 0.3, 1_000);
    expect(d.see(room)).toEqual([{ which: 'music', level: 0.3 }]);
    expect(d.volumes.music).toBe(0.3);
    // The player turns it back up: the same host change is not applied again.
    d.own('music', 0.9);
    expect(d.see(room)).toEqual([]);
    expect(d.volumes.music).toBe(0.9);
    // Another slider of the host's leaves music alone.
    room = withHostVolume(room, 'effects', 0.5, 2_000);
    expect(d.see(room)).toEqual([{ which: 'effects', level: 0.5 }]);
    expect(d.volumes.music).toBe(0.9);
    // The host moves music again: last change wins.
    room = withHostVolume(room, 'music', 0.6, 3_000);
    d.see(room);
    expect(d.volumes.music).toBe(0.6);
    // Sound plays at the device's own master × type, now the host's.
    expect(gainOf(d.volumes, 'music')).toBeCloseTo(0.6);
  });

  it('a late joiner takes the host’s latest level of each slider', () => {
    const room = withHostVolume(
      withHostVolume(withHostVolume(undefined, 'master', 0.8, 1), 'master', 0.5, 2),
      'voice',
      0,
      3,
    );
    const d = device();
    d.see(room);
    expect(d.volumes).toEqual({ ...FULL_VOLUMES, master: 0.5, voice: 0 });
  });

  it('records the host’s own changes without moving their sliders', () => {
    const h = device(true);
    h.own('music', 0.25);
    const room = withHostVolume(undefined, 'music', 0.3, 1);
    expect(h.see(room)).toEqual([]);
    expect(h.volumes.music).toBe(0.25);
  });

  it('ignores broken entries', () => {
    const broken = { music: { level: 'loud', v: 1 }, voice: { level: 0.5 } } as never;
    expect(hostChanges(broken, {})).toEqual([]);
  });
});
