import { describe, expect, it } from 'vitest';
import { LIGHTS, LIGHTS_OUT, createBomb } from '../../logic/bomb.ts';
import { DEFAULT_SETTINGS } from '../../logic/game.ts';
import { bombView } from '../../logic/view.ts';
import { ALARM_BEEP_MS, EMERGENCY, roomCues, roomLook } from './room.ts';

const view = (o: Partial<ReturnType<typeof createBomb>> = {}) =>
  bombView({ ...createBomb(1, 3, { ...DEFAULT_SETTINGS, surprises: false }, 0), ...o }, false);

describe('the room’s lights', () => {
  it('is dark until the modules wake, then the lamp is on', () => {
    const b = view();
    expect(roomLook(b, LIGHTS.timer).config).toBe('LightsOff');
    expect(roomLook(b, LIGHTS.active - 1).config).toBe('LightsOff');
    expect(roomLook(b, LIGHTS.active).config).toBe('Normal');
  });

  it('goes out: buzz, dark for 10 s, buzz, lights', () => {
    const at = 30_000;
    const b = view({ lightsAt: at });
    expect(roomLook(b, at + 100).config).toBe('LightsOnBuzz');
    expect(roomLook(b, at + LIGHTS_OUT.buzz + 100).config).toBe('LightsOff');
    expect(roomLook(b, at + LIGHTS_OUT.buzz + LIGHTS_OUT.dark + 100).config).toBe('LightsOnBuzz');
    expect(
      roomLook(b, at + LIGHTS_OUT.buzz + LIGHTS_OUT.dark + LIGHTS_OUT.buzzBack + 1).config,
    ).toBe('Normal');
  });

  it('flashes the emergency light from the last minute: 1 s on, 1.5 s off', () => {
    const b = view();
    const since = b.anchorAt + (b.leftAtAnchor - 60_000);
    expect(roomLook(b, since - 1).config).toBe('Normal');
    expect(roomLook(b, since + 500).config).toBe('EmergencyRed');
    expect(roomLook(b, since + EMERGENCY.on + 100).config).toBe('Normal');
    expect(roomLook(b, since + EMERGENCY.on + EMERGENCY.off + 100).config).toBe('EmergencyRed');
  });

  it('blinks the clock while it rings', () => {
    const b = view({ alarm: { at: 10_000, until: 30_000 } });
    expect(roomLook(b, 10_100)).toMatchObject({ ringing: true, lit: false });
    expect(roomLook(b, 10_300)).toMatchObject({ ringing: true, lit: true });
    expect(roomLook(b, 30_000)).toMatchObject({ ringing: false, lit: true });
  });
});

describe('the room’s sounds', () => {
  it('clunks the lamp on, buzzes lights out, beeps the clock and snoozes it', () => {
    const b = view({ lightsAt: 30_000, alarm: { at: 50_000, until: 55_000 } });
    expect(roomCues(b, 0, LIGHTS.active)).toEqual(['switch']);
    expect(roomCues(b, 29_000, 31_000)).toEqual(['light-buzz']);
    expect(roomCues(b, 31_000, 42_000)).toEqual(['light-buzz-short']);
    const ring = roomCues(b, 49_000, 56_000);
    expect(ring.filter((x) => x === 'alarm-clock-beep')).toHaveLength(
      Math.ceil(5000 / ALARM_BEEP_MS),
    );
    expect(ring.at(-1)).toBe('alarm-clock-snooze');
  });
});
