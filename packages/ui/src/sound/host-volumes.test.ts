import { type HostVolumes, hostVolumeChange, hostVolumeMode, withHostVolume } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VOLUMES,
  type Volumes,
  gainOf,
  hostChanges,
  hostLine,
  takeHostChanges,
} from './volumes.ts';

// The host's volumes for everyone: the host chooses "Just me" (the default) or "Everyone"; with
// "Everyone" each device takes the host's latest change of a slider once, a player's own change
// after it sticks, and the host's next change of that slider wins again.

/** The room's host volumes with "Everyone" and the given changes, in order. */
const everyone = (...changes: [keyof Volumes, number, number][]) =>
  changes.reduce<HostVolumes>((h, [which, level, now]) => withHostVolume(h, which, level, now), {
    mode: 'all',
  });

describe('the host’s choice', () => {
  it('reads a room saved without it as “Just me”', () => {
    expect(hostVolumeMode(undefined)).toBe('me');
    expect(hostVolumeMode({ music: { level: 0.4, v: 1 } })).toBe('me');
    expect(hostVolumeMode({ mode: 'all' })).toBe('all');
  });

  it('keeps a slider’s level only with “Everyone”, and a switch keeps no level', () => {
    const act = (stored: HostVolumes | undefined, a: object) =>
      hostVolumeChange({ hostVolumes: stored }, { type: 'host-volume', ...a }, 5_000);
    expect(act(undefined, { which: 'music', level: 0.4 })?.hostVolumes).toEqual({});
    expect(act(undefined, { which: 'music', level: 0.4 })?.tableVolumes).toEqual({});
    const all = act(undefined, { mode: 'all' })!.hostVolumes;
    expect(all).toEqual({ mode: 'all' });
    const moved = act(all, { which: 'music', level: 0.4 })!;
    expect(moved.hostVolumes).toEqual({ mode: 'all', music: { level: 0.4, v: 5_000 } });
    expect(moved.tableVolumes).toEqual({ music: 0.4 });
    expect(act(moved.hostVolumes, { mode: 'me' })!.hostVolumes).toEqual({ mode: 'me' });
    expect(act(all, {})).toBeNull();
  });

  it('says under the host’s sliders which is on', () => {
    expect(hostLine('me', true)).toMatch(/only your own volume/);
    expect(hostLine('all', false)).toMatch(/set everyone’s volume; players/);
    expect(hostLine('all', true)).toMatch(/\(and the table screen’s\)/);
  });
});

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
    let volumes: Volumes = { ...DEFAULT_VOLUMES };
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
    expect(d.volumes).toEqual(DEFAULT_VOLUMES);
  });

  it('with “Just me”, records the room’s levels without moving a slider', () => {
    // A room saved by the release before kept levels with no choice: they read as "Just me".
    const d = device();
    const saved: HostVolumes = { music: { level: 0.3, v: 1_000 } };
    expect(d.see(saved)).toEqual([]);
    expect(d.volumes).toEqual(DEFAULT_VOLUMES);
    // Switching to "Everyone" pushes nothing by itself: only the host's next move does.
    expect(d.see({ ...saved, mode: 'all' })).toEqual([]);
    expect(d.see(withHostVolume({ ...saved, mode: 'all' }, 'music', 0.7, 2_000))).toEqual([
      { which: 'music', level: 0.7 },
    ]);
  });

  it('sets the slider once, lets the player change it, then follows the host again', () => {
    const d = device();
    let room = everyone(['music', 0.3, 1_000]);
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
    // Sound plays at the device's own master (50 %) × type, now the host's.
    expect(gainOf(d.volumes, 'music')).toBeCloseTo(0.3);
  });

  it('a late joiner takes the host’s latest level of each slider', () => {
    const room = everyone(['master', 0.8, 1], ['master', 0.4, 2], ['voice', 0, 3]);
    const d = device();
    d.see(room);
    expect(d.volumes).toEqual({ ...DEFAULT_VOLUMES, master: 0.4, voice: 0 });
  });

  it('records the host’s own changes without moving their sliders', () => {
    const h = device(true);
    h.own('music', 0.25);
    const room = everyone(['music', 0.3, 1]);
    expect(h.see(room)).toEqual([]);
    expect(h.volumes.music).toBe(0.25);
  });

  it('ignores broken entries', () => {
    const broken = { music: { level: 'loud', v: 1 }, voice: { level: 0.5 } } as never;
    expect(hostChanges(broken, {})).toEqual([]);
  });
});
