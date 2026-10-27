import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setStorageSeat } from '@vt/game-sdk';
import { volumeSummary } from './panel.tsx';
import {
  FULL_VOLUMES,
  audible,
  gainOf,
  legacyDevice,
  parseVolumes,
  resetVolumeCache,
  soundPlan,
  tableVolumes,
  volumesKey,
  whereLine,
  writeVolume,
} from './volumes.ts';

const DEFAULTS = { ...FULL_VOLUMES, master: 0.8 };

function fakeStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (k: string) => items.get(k) ?? null,
    setItem: (k: string, v: string) => void items.set(k, v),
    removeItem: (k: string) => void items.delete(k),
    items,
  };
}

describe('stored volumes', () => {
  let storage: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    storage = fakeStorage();
    vi.stubGlobal('localStorage', storage);
    resetVolumeCache();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setStorageSeat(null);
  });

  it('reads the defaults when nothing is stored', () => {
    expect(parseVolumes(null, DEFAULTS)).toEqual(DEFAULTS);
  });

  it('keeps each stored volume and fixes broken ones', () => {
    const raw = JSON.stringify({ master: 0.5, music: 2, effects: -1, voice: 'loud' });
    expect(parseVolumes(raw, DEFAULTS)).toEqual({ master: 0.5, music: 1, effects: 0, voice: 1 });
    expect(parseVolumes('{not json', DEFAULTS)).toEqual(DEFAULTS);
  });

  it('takes an older switch only when nothing is stored', () => {
    expect(parseVolumes(null, DEFAULTS, { master: 0 })).toEqual({ ...DEFAULTS, master: 0 });
    expect(parseVolumes('{"master":0.3}', DEFAULTS, { master: 0 }).master).toBe(0.3);
  });

  it('reads an older { muted, volume } switch as the master', () => {
    storage.setItem('old', JSON.stringify({ muted: true, volume: 0.6 }));
    expect(legacyDevice('old')).toEqual({ master: 0 });
    storage.setItem('old', JSON.stringify({ muted: false, volume: 0.6 }));
    expect(legacyDevice('old')).toEqual({ master: 0.6 });
    expect(legacyDevice('missing')).toBeNull();
  });

  it('writes one volume at a time, clamped, and keeps the rest', () => {
    const key = volumesKey('going-once');
    writeVolume(key, DEFAULTS, 'music', 0.25);
    writeVolume(key, DEFAULTS, 'voice', 3);
    expect(JSON.parse(storage.items.get(key)!)).toEqual({ ...DEFAULTS, music: 0.25, voice: 1 });
  });

  it('is kept per game', () => {
    expect(volumesKey('sketchy')).toBe('vt.sketchy.volumes');
    expect(volumesKey('defuse')).not.toBe(volumesKey('sketchy'));
  });
});

describe('gain mapping', () => {
  it('plays each type at master × its own volume', () => {
    const v = { master: 0.5, music: 0.4, effects: 1, voice: 0 };
    expect(gainOf(v, 'music')).toBeCloseTo(0.2);
    expect(gainOf(v, 'effects')).toBe(0.5);
    expect(gainOf(v, 'voice')).toBe(0);
    expect(audible(v, 'voice')).toBe(false);
    expect(audible(v, 'effects')).toBe(true);
  });

  it('a master at 0 silences every type', () => {
    const v = { ...FULL_VOLUMES, master: 0 };
    for (const k of ['music', 'effects', 'voice'] as const) expect(gainOf(v, k)).toBe(0);
  });

  it('never leaves 0 to 1', () => {
    expect(gainOf({ master: 3, music: 2, effects: -1, voice: 1 }, 'music')).toBe(1);
    expect(gainOf({ master: 1, music: 1, effects: -1, voice: 1 }, 'effects')).toBe(0);
  });

  it('the table screen plays at full volume until the host moves a slider', () => {
    expect(tableVolumes(undefined)).toEqual(FULL_VOLUMES);
    expect(tableVolumes({ music: 0.3 })).toEqual({ ...FULL_VOLUMES, music: 0.3 });
    expect(tableVolumes({ voice: 9 }, { ...FULL_VOLUMES, voice: 0 }).voice).toBe(1);
    expect(tableVolumes({}, { ...FULL_VOLUMES, voice: 0 }).voice).toBe(0);
  });
});

describe('which sliders a device gets', () => {
  const room = ['music', 'effects', 'voice'] as const;

  it('off: none, for anyone', () => {
    expect(soundPlan('off', true, room, ['effects'])).toEqual({ mine: [], table: [] });
    expect(soundPlan('off', false, room)).toEqual({ mine: [], table: [] });
  });

  it("host's device: the host gets them all, the others only their own cues", () => {
    expect(soundPlan('host', true, room, ['effects'])).toEqual({ mine: [...room], table: [] });
    expect(soundPlan('host', false, room, ['effects'])).toEqual({ mine: ['effects'], table: [] });
    expect(soundPlan('host', false, room)).toEqual({ mine: [], table: [] });
  });

  it('every device: everyone gets them all', () => {
    expect(soundPlan('all', false, room).mine).toEqual([...room]);
  });

  it("table screen: the host sets the table's, each phone keeps its own cues", () => {
    expect(soundPlan('stage', true, room, ['effects'])).toEqual({
      mine: ['effects'],
      table: [...room],
    });
    expect(soundPlan('stage', false, room, ['effects'])).toEqual({ mine: ['effects'], table: [] });
  });

  it('says where the sound plays', () => {
    expect(whereLine('host', 'Ana', false)).toBe('Sound plays on Ana’s phone.');
    expect(whereLine('off', 'Ana', false)).toMatch(/off/);
    expect(whereLine('all', 'Ana', true)).toMatch(/every phone/);
    expect(whereLine('stage', 'Ana', false)).toMatch(/Ana \(the host\) sets its volume/);
  });

  it('sums the volumes up in a few words', () => {
    expect(volumeSummary({ ...FULL_VOLUMES, master: 0.8 }, ['music', 'effects'])).toBe('80 %');
    expect(volumeSummary({ ...FULL_VOLUMES, music: 0 }, ['music', 'effects'])).toBe(
      '100 %, music off',
    );
    expect(volumeSummary({ ...FULL_VOLUMES, master: 0 }, ['effects'])).toBe('off');
  });
});
