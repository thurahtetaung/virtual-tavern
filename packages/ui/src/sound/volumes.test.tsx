import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setStorageSeat } from '@vt/game-sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { type SoundChannel, SoundSliders, channelGain, volumeSummary } from './panel.tsx';
import {
  DEFAULT_VOLUMES,
  FULL_VOLUMES,
  VOLUMES_RESET,
  audible,
  gainOf,
  heardVolumes,
  legacyDevice,
  masterShown,
  parseVolumes,
  resetVolumeCache,
  soundPlan,
  tableVolumes,
  readVolumes,
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
    const raw = JSON.stringify({ master: 0.5, music: 2, effects: -1, voice: 'loud', reset: 1 });
    expect(parseVolumes(raw, DEFAULTS)).toEqual({ master: 0.5, music: 1, effects: 0, voice: 1 });
    expect(parseVolumes('{not json', DEFAULTS)).toEqual(DEFAULTS);
  });

  it('takes an older switch only when nothing is stored', () => {
    expect(parseVolumes(null, DEFAULTS, { master: 0 })).toEqual({ ...DEFAULTS, master: 0 });
    expect(parseVolumes('{"master":0.3,"reset":1}', DEFAULTS, { master: 0 }).master).toBe(0.3);
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
    expect(JSON.parse(storage.items.get(key)!)).toEqual({
      ...DEFAULTS,
      music: 0.25,
      voice: 1,
      reset: VOLUMES_RESET,
    });
  });

  it('starts every slider at 50 %', () => {
    expect(DEFAULT_VOLUMES).toEqual({ master: 0.5, music: 0.5, effects: 0.5, voice: 0.5 });
    expect(readVolumes(volumesKey('nightfall'), DEFAULT_VOLUMES)).toEqual(DEFAULT_VOLUMES);
  });

  it('resets volumes stored before the 50 % defaults once, then keeps the player’s', () => {
    const key = volumesKey('sketchy');
    storage.setItem(key, JSON.stringify({ master: 1, music: 0.2, effects: 1, voice: 0 }));
    expect(parseVolumes(storage.getItem(key), DEFAULT_VOLUMES)).toEqual(DEFAULT_VOLUMES);
    expect(readVolumes(key, DEFAULT_VOLUMES)).toEqual(DEFAULT_VOLUMES);
    // The reset is stored at once, marked, so it happens only once.
    expect(JSON.parse(storage.items.get(key)!)).toEqual({
      ...DEFAULT_VOLUMES,
      reset: VOLUMES_RESET,
    });
    writeVolume(key, DEFAULT_VOLUMES, 'music', 0.9);
    resetVolumeCache();
    expect(readVolumes(key, DEFAULT_VOLUMES)).toEqual({ ...DEFAULT_VOLUMES, music: 0.9 });
  });

  it('is kept per game', () => {
    expect(volumesKey('sketchy')).toBe('vt.sketchy.volumes');
    expect(volumesKey('defuse')).not.toBe(volumesKey('sketchy'));
  });
});

describe('gain mapping', () => {
  const ALL = ['music', 'effects', 'voice'] as const;

  it('plays each type at master × its own volume where the master shows', () => {
    const v = { master: 0.5, music: 0.4, effects: 1, voice: 0 };
    expect(gainOf(v, 'music', ALL)).toBeCloseTo(0.2);
    expect(gainOf(v, 'effects', ALL)).toBe(0.5);
    expect(gainOf(v, 'voice', ALL)).toBe(0);
    expect(audible(v, 'voice', ALL)).toBe(false);
    expect(audible(v, 'effects', ALL)).toBe(true);
  });

  it('a master at 0 silences every type where it shows', () => {
    const v = { ...FULL_VOLUMES, master: 0 };
    for (const k of ALL) expect(gainOf(v, k, ALL)).toBe(0);
  });

  it('shows the master only with more than one type', () => {
    expect(masterShown(['effects'])).toBe(false);
    expect(masterShown([])).toBe(false);
    expect(masterShown(['music', 'voice'])).toBe(true);
  });

  it('counts a hidden master as 100 %, whatever was stored for it', () => {
    // A one-slider game out of the box: the slider says 50 % and plays at 50 %, not 25 %.
    expect(gainOf(DEFAULT_VOLUMES, 'effects', ['effects'])).toBe(0.5);
    expect(gainOf({ ...DEFAULT_VOLUMES, effects: 0.8 }, 'effects', ['effects'])).toBe(0.8);
    // An older mute, or the host's master, that this device can't see doesn't quieten it.
    expect(gainOf({ ...DEFAULT_VOLUMES, master: 0 }, 'effects', ['effects'])).toBe(0.5);
    expect(heardVolumes({ ...DEFAULT_VOLUMES, master: 0.2 }, ['voice']).master).toBe(1);
    expect(heardVolumes({ ...DEFAULT_VOLUMES, master: 0.2 }, ALL).master).toBe(0.2);
    // The only slider at 0 is off.
    expect(gainOf({ ...DEFAULT_VOLUMES, effects: 0 }, 'effects', ['effects'])).toBe(0);
  });

  it('never leaves 0 to 1', () => {
    expect(gainOf({ master: 3, music: 2, effects: -1, voice: 1 }, 'music', ALL)).toBe(1);
    expect(gainOf({ master: 1, music: 1, effects: -1, voice: 1 }, 'effects', ALL)).toBe(0);
    expect(gainOf({ master: 0.5, music: 2, effects: 1, voice: 1 }, 'music', ['music'])).toBe(1);
  });

  it('the table screen plays at 50 % until the host moves a slider', () => {
    expect(tableVolumes(undefined)).toEqual(DEFAULT_VOLUMES);
    // A one-type table screen (its only slider at 50 %) plays at 50 %; with several, master × type.
    expect(gainOf(tableVolumes(undefined), 'effects', ['effects'])).toBe(0.5);
    expect(gainOf(tableVolumes({ effects: 0.7, master: 0.1 }), 'effects', ['effects'])).toBe(0.7);
    expect(gainOf(tableVolumes(undefined), 'music', ALL)).toBe(0.25);
    expect(gainOf(tableVolumes({ master: 1, music: 0.6 }), 'music', ALL)).toBeCloseTo(0.6);
    expect(tableVolumes({ music: 0.3 })).toEqual({ ...DEFAULT_VOLUMES, music: 0.3 });
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
    expect(volumeSummary({ ...FULL_VOLUMES, effects: 0 }, ['effects'])).toBe('off');
    expect(volumeSummary({ ...FULL_VOLUMES, effects: 0.4 }, ['effects'])).toBe('40 %');
  });

  it('a one-slider summary is that slider, the hidden master counted as 100 %', () => {
    expect(volumeSummary(DEFAULT_VOLUMES, ['effects'])).toBe('50 %');
    expect(volumeSummary({ ...DEFAULT_VOLUMES, master: 0 }, ['voice'])).toBe('50 %');
    expect(volumeSummary({ ...DEFAULT_VOLUMES, master: 0.3, effects: 0.8 }, ['effects'])).toBe(
      '80 %',
    );
    // With the master shown, it is the master's level.
    expect(volumeSummary(DEFAULT_VOLUMES, ['music', 'voice'])).toBe('50 %');
    expect(volumeSummary({ ...DEFAULT_VOLUMES, master: 0 }, ['music', 'voice'])).toBe('off');
  });
});

describe('the panel against what it plays', () => {
  const channel = (kind: SoundChannel['kind']): SoundChannel => ({
    kind,
    label: kind,
    preview: () => null,
  });
  const html = (volumes: typeof DEFAULT_VOLUMES, channels: SoundChannel[]) =>
    renderToStaticMarkup(
      <SoundSliders volumes={volumes} setVolume={() => {}} channels={channels} testId="t" />,
    );

  it('one slider: no master row, the slider says 50 %, the ▶ and the sound play at 0.5', () => {
    const one = [channel('effects')];
    const page = html(DEFAULT_VOLUMES, one);
    expect(page).not.toContain('sound-row-master');
    expect(page).toContain('sound-slider-effects');
    expect(page).toContain('aria-valuetext="50 %"');
    expect(channelGain(DEFAULT_VOLUMES, one, 'effects')).toBe(0.5);
    expect(gainOf(DEFAULT_VOLUMES, 'effects', ['effects'])).toBe(0.5);
    expect(volumeSummary(DEFAULT_VOLUMES, ['effects'])).toBe('50 %');
  });

  it('several sliders: the master row shows, and everything plays at master × type', () => {
    const two = [channel('music'), channel('voice')];
    const page = html(DEFAULT_VOLUMES, two);
    expect(page).toContain('sound-row-master');
    expect(channelGain(DEFAULT_VOLUMES, two, 'music')).toBe(0.25);
    expect(gainOf(DEFAULT_VOLUMES, 'voice', ['music', 'voice'])).toBe(0.25);
    expect(volumeSummary(DEFAULT_VOLUMES, ['music', 'voice'])).toBe('50 %');
  });
});
