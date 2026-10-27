import { describe, expect, it } from 'vitest';
import { sketchy } from '../logic/definition.ts';
import { HOST, harness, lieAll, started, turn, truthIndex, writing } from '../logic/test-utils.ts';
import {
  type AudioManifest,
  type Device,
  deviceSounds,
  fileOf,
  jokeFor,
  jokeKey,
  musicFor,
  plays,
  soundModeIn,
} from './audio.ts';
import { revealEndOf } from './show.ts';

const device = (over: Partial<Device> = {}): Device => ({
  mode: 'host',
  isHost: false,
  isStage: false,
  music: true,
  effects: true,
  voice: false,
  ...over,
});

describe('where the sound plays', () => {
  it('defaults to the host’s device, and to the table screen while one is paired', () => {
    const s = { sound: 'host' as const, soundChosen: false };
    expect(soundModeIn(s, false)).toBe('host');
    expect(soundModeIn(s, true)).toBe('stage');
    // The host's own pick wins over the table screen.
    expect(soundModeIn({ sound: 'all', soundChosen: true }, true)).toBe('all');
    // "Table screen" with none paired falls back to the host's device.
    expect(soundModeIn({ sound: 'stage', soundChosen: true }, false)).toBe('host');
  });

  it('plays the room’s sound on one device per choice', () => {
    expect(deviceSounds('host', true, false)).toBe(true);
    expect(deviceSounds('host', false, false)).toBe(false);
    expect(deviceSounds('host', true, true)).toBe(false);
    expect(deviceSounds('all', false, false)).toBe(true);
    expect(deviceSounds('stage', true, false)).toBe(false);
    expect(deviceSounds('stage', false, true)).toBe(true);
    expect(deviceSounds('off', true, true)).toBe(false);
  });

  it('keeps personal cues on each player’s own phone, never the table screen', () => {
    expect(plays('me:break', device({ mode: 'stage' }))).toBe(true);
    expect(plays('me:break', device({ mode: 'stage', isStage: true }))).toBe(false);
    expect(plays('me:break', device({ mode: 'off' }))).toBe(false);
    expect(plays('me:break', device({ effects: false }))).toBe(false);
    // Room effects only where the room's sound is.
    expect(plays('reveal.hit', device({ mode: 'stage' }))).toBe(false);
    expect(plays('reveal.hit', device({ mode: 'stage', isStage: true }))).toBe(true);
    expect(plays('reveal.hit', device({ isHost: true }))).toBe(true);
  });

  it('speaks only with the narrator switched on', () => {
    expect(plays('voice:turn.next#2', device({ isHost: true }))).toBe(false);
    expect(plays('voice:turn.next#2', device({ isHost: true, voice: true }))).toBe(true);
    expect(plays('joke:audio/jokes/a.ogg', device({ isHost: true, voice: true }))).toBe(true);
    expect(plays('joke:audio/jokes/a.ogg', device({ isHost: true }))).toBe(false);
  });
});

describe('clip files', () => {
  const audio: AudioManifest = {
    sfx: { yelp: ['y1.ogg', 'y2.ogg'], 'me.break': ['b.ogg'] },
    voice: { 'turn.next': ['n1.ogg', 'n2.ogg', 'n3.ogg'] },
  };
  it('picks the same file on every device, wrapping the list', () => {
    expect(fileOf(audio, 'yelp#3')).toBe('y2.ogg');
    expect(fileOf(audio, 'yelp')).toBe('y1.ogg');
    expect(fileOf(audio, 'voice:turn.next#4')).toBe('n2.ogg');
    expect(fileOf(audio, 'me:break')).toBe('b.ogg');
    expect(fileOf(audio, 'joke:audio/jokes/a.ogg')).toBe('audio/jokes/a.ogg');
    expect(fileOf(audio, 'nothing')).toBeNull();
    expect(fileOf(undefined, 'yelp')).toBeNull();
  });
});

describe('jokes', () => {
  it('finds a prompt’s joke however it is written, names put back as the player slot', () => {
    const jokes = { [jokeKey('ghost cruise')]: 'g.ogg', [jokeKey('{player} dancing')]: 'd.ogg' };
    const audio = { durations: { 'g.ogg': 2700 } };
    expect(jokeFor(audio, jokes, 'Ghost Cruise!', [])).toEqual({ file: 'g.ogg', ms: 2700 });
    expect(jokeFor(audio, jokes, 'kim dancing', ['Kim', 'Leo'])?.file).toBe('d.ogg');
    expect(jokeFor(audio, jokes, 'leo dancing', ['Kim'])).toBeNull();
    expect(jokeFor(audio, undefined, 'ghost cruise', [])).toBeNull();
  });
});

describe('music', () => {
  it('follows the game: lobby, drawing, writing, picking, the reveal, then the board', () => {
    const h = harness();
    expect(musicFor(sketchy.view(h.state, null), 0, null)).toBe('lobby');
    h.act(HOST, { type: 'start' });
    expect(musicFor(sketchy.view(h.state, null), 0, null)).toMatch(/^draw/);
    const w = writing();
    expect(musicFor(sketchy.view(w.state, null), 0, null)).toMatch(/^write/);
    lieAll(w);
    expect(musicFor(sketchy.view(w.state, null), 0, null)).toBe('vote');
    for (const id of turn(w).voters) w.act(id, { type: 'vote', option: truthIndex(w) });
    const v = sketchy.view(w.state, null);
    const end = revealEndOf(v.game!.turn!)!;
    expect(musicFor(v, end - 1, end)).toBe('reveal');
    expect(musicFor(v, end + 1, end)).toBe('board');
    expect(started()).toBeTruthy();
  });
});

describe('sound settings', () => {
  it('start as the owner chose: host’s device, music and effects on, no narrator', () => {
    const v = sketchy.view(harness().state, null);
    expect(v.settings).toMatchObject({
      sound: 'host',
      soundChosen: false,
      music: true,
      effects: true,
      voice: false,
    });
  });

  it('remember that the host picked, so a paired table screen no longer takes over', () => {
    const h = harness();
    h.act(HOST, { type: 'update-settings', sound: 'all', voice: true });
    expect(sketchy.view(h.state, null).settings).toMatchObject({
      sound: 'all',
      soundChosen: true,
      voice: true,
    });
    expect(h.refuse('p2', { type: 'update-settings', sound: 'off' }).code).toBe('not-host');
  });

  it('fill in for rooms saved before they existed', () => {
    const h = harness();
    const old = { ...h.state, settings: { ...h.state.settings } };
    for (const k of ['sound', 'soundChosen', 'music', 'effects', 'voice'] as const)
      delete old.settings[k];
    expect(sketchy.view(old, null).settings).toMatchObject({ sound: 'host', voice: false });
  });
});
