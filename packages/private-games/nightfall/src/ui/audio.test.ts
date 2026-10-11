import { describe, expect, it } from 'vitest';
import { nightfall } from '../logic/game.ts';
import { table } from '../logic/test-utils.ts';
import {
  CLOSE_LEAD_MS,
  DUCK_RATIO,
  clipsFor,
  cuesFor,
  devicePlaysMusic,
  deviceSpeaks,
  dueCues,
  musicChange,
  musicPhaseFor,
  musicTarget,
  ramp,
  trackFor,
} from './audio.ts';

const MUSIC = {
  night: ['music/horror.ogg', 'music/wolves.ogg'],
  day: ['music/upbeat.ogg'],
  lobby: ['music/cards.ogg'],
};

describe('music', () => {
  it('maps game phases to music phases', () => {
    expect(musicPhaseFor('lobby')).toBe('lobby');
    expect(musicPhaseFor('ready')).toBe('lobby');
    expect(musicPhaseFor('night')).toBe('night');
    expect(musicPhaseFor('vote')).toBe('vote');
    expect(musicPhaseFor('reveal')).toBe('reveal');
  });

  it('picks the first track first, the next one next game, and nothing when a phase has none', () => {
    expect(trackFor(MUSIC, 'night', 1)).toBe('music/horror.ogg');
    expect(trackFor(MUSIC, 'night', 2)).toBe('music/wolves.ogg');
    expect(trackFor(MUSIC, 'night', 3)).toBe('music/horror.ogg');
    expect(trackFor(MUSIC, 'day', 0)).toBe('music/upbeat.ogg');
    expect(trackFor(MUSIC, 'vote', 1)).toBeNull();
    expect(trackFor(undefined, 'night', 1)).toBeNull();
  });

  it('plays on the devices the narration mode names, when both switches are on', () => {
    expect(deviceSpeaks('off', true)).toBe(false);
    expect(deviceSpeaks('host', true)).toBe(true);
    expect(deviceSpeaks('host', false)).toBe(false);
    expect(deviceSpeaks('all', false)).toBe(true);
    const base = { mode: 'all' as const, isHost: false, gameMusic: true, deviceMusic: true };
    expect(devicePlaysMusic(base)).toBe(true);
    expect(devicePlaysMusic({ ...base, gameMusic: false })).toBe(false);
    expect(devicePlaysMusic({ ...base, deviceMusic: false })).toBe(false);
    expect(devicePlaysMusic({ ...base, mode: 'host' })).toBe(false);
  });

  it('ducks under narration and comes back after', () => {
    expect(musicTarget(0.35, false)).toBeCloseTo(0.35);
    expect(musicTarget(0.35, true)).toBeCloseTo(0.35 * DUCK_RATIO);
    expect(musicTarget(2, false)).toBe(1);
    expect(musicTarget(-1, true)).toBe(0);
  });

  it('crossfades only when the track changes', () => {
    expect(musicChange('a', 'a')).toEqual({ fadeOut: null, fadeIn: null });
    expect(musicChange('a', 'b')).toEqual({ fadeOut: 'a', fadeIn: 'b' });
    expect(musicChange(null, 'b')).toEqual({ fadeOut: null, fadeIn: 'b' });
    expect(musicChange('a', null)).toEqual({ fadeOut: 'a', fadeIn: null });
    expect(ramp(0, 1, 750, 1500)).toBeCloseTo(0.5);
    expect(ramp(1, 0, 2000, 1500)).toBe(0);
    expect(ramp(0.2, 0.8, -5, 1500)).toBe(0.2);
  });
});

describe('narration cues', () => {
  it('opens and closes each step on the shared clock', () => {
    const h = table({ players: ['werewolf', 'seer', 'villager'], settings: { stepSeconds: 10 } });
    const intro = cuesFor(nightfall.view(h.state, 'A'));
    expect(intro.map((c) => c.lines)).toEqual([
      ['night:start'],
      ['werewolf:wake', 'werewolf:lone-wolf'],
    ]);
    h.tick();
    const v = nightfall.view(h.state, 'C');
    const [open, close] = cuesFor(v);
    expect(open).toMatchObject({ lines: ['werewolf:wake', 'werewolf:lone-wolf'], at: h.now });
    expect(close).toMatchObject({
      lines: ['werewolf:close'],
      at: v.night!.deadline - CLOSE_LEAD_MS,
    });
    // Everyone gets the same cues, acting or not.
    expect(cuesFor(nightfall.view(h.state, 'A'))).toEqual(cuesFor(v));
    h.tick();
    expect(cuesFor(nightfall.view(h.state, 'C'))[0]).toMatchObject({
      lines: ['seer:wake'],
      at: h.now,
    });
  });

  it('announces the day, its last minute and the vote', () => {
    const h = table({ players: ['werewolf', 'seer', 'villager'], settings: { daySeconds: 300 } });
    h.dawn();
    const day = cuesFor(nightfall.view(h.state, 'A'));
    expect(day.map((c) => c.lines)).toEqual([
      ['night:end', 'day:start'],
      ['day:1-minute-left'],
      ['day:30-seconds-left'],
    ]);
    expect(day[0]!.at).toBe(h.now);
    h.tick();
    expect(cuesFor(nightfall.view(h.state, 'A'))).toEqual([
      { id: '1:vote', at: h.now, lines: ['vote:start'] },
    ]);
  });

  it('plays due cues once, and never replays old ones', () => {
    const cues = [
      { id: 'a', at: 1000, lines: ['x'] },
      { id: 'b', at: 5000, lines: ['y'] },
    ];
    expect(dueCues(cues, 1500, new Set()).map((c) => c.id)).toEqual(['a']);
    expect(dueCues(cues, 1500, new Set(['a']))).toEqual([]);
    expect(dueCues(cues, 9000, new Set()).map((c) => c.id)).toEqual([]);
    expect(clipsFor({ x: ['audio/x1.ogg', 'audio/x2.ogg'] }, ['x', 'missing'])).toEqual([
      'audio/x1.ogg',
      'audio/x2.ogg',
    ]);
  });
});
