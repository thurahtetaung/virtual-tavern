import { describe, expect, it } from 'vitest';
import { LIGHTS, LIGHTS_OUT, createBomb } from '../../logic/bomb.ts';
import { DEFAULT_SETTINGS } from '../../logic/game.ts';
import { bombView } from '../../logic/view.ts';
import { fitLines } from './rig.ts';
import {
  ALARM_BEEP_MS,
  BINDER_OPEN,
  EMERGENCY,
  binderCover,
  binderTexts,
  roomCues,
  roomLook,
} from './room.ts';

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

describe('the bomb binder at a mission’s page', () => {
  it('fills the page as MissionDetailPage does', () => {
    const t = binderTexts({
      name: 'The First Bomb',
      description: 'Easy.',
      time: 300,
      modules: 3,
      strikes: 1,
    });
    expect(t['MissionIdentifier/txtSingleLine']).toBe('The First Bomb');
    expect(t.txtTimeLimit).toBe('5:00');
    expect(t.txtModuleCount).toBe('3 Modules');
    expect(t.txtStrikeCount).toBe('1 Strike');
    expect(t['HorizontalGroup/StartButton/txtStart']).toBe('START');
    expect(
      binderTexts({ name: '', description: '', time: 90, modules: 1, strikes: 3 }),
    ).toMatchObject({
      txtTimeLimit: '1:30',
      txtModuleCount: '1 Module',
      txtStrikeCount: '3 Strikes',
    });
  });

  it('opens its cover with the original’s clips: linear, 0.5 s', () => {
    expect(BINDER_OPEN.ms).toBe(500);
    expect(binderCover(BINDER_OPEN, 0)).toEqual({ spine: -90.8, front: -93.9 });
    expect(binderCover(BINDER_OPEN, 1).spine).toBeCloseTo(-3.5, 9);
    expect(binderCover(BINDER_OPEN, 1).front).toBeCloseTo(-4.68, 9);
    expect(binderCover(BINDER_OPEN, 0.5).spine).toBeCloseTo(-47.15, 5);
  });

  it('wraps and sizes text down like TextMeshPro', () => {
    // A monospace measure: 0.6 em a character.
    const mono = (text: string, em: number) => text.length * em * 0.6;
    expect(fitLines('5:00', 4, 1.9, 12.5, 6.25, false, mono)).toEqual({
      size: 12.5,
      lines: ['5:00'],
    });
    const long = 'When did seeing a familiar bomb become comforting?';
    const r = fitLines(long, 18, 10.5, 12.5, 8, true, mono);
    expect(r.size).toBe(12.5);
    expect(r.lines.length).toBeGreaterThan(1);
    expect(r.lines.every((l) => mono(l, r.size / 10) <= 18)).toBe(true);
    // Too long for one line unwrapped: sized down until it fits, never below the floor.
    const one = fitLines('3 Bomb Configuration words', 8, 1.5, 9.5, 8, false, mono);
    expect(one.size).toBe(8);
    expect(fitLines('x '.repeat(400), 18, 10.5, 12.5, 8, true, mono).size).toBe(8);
  });
});
