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
  enqueueClips,
  musicChange,
  musicPhaseFor,
  musicTarget,
  nextClip,
  type QueuedClip,
  STALE_CLIP_MS,
  afterClip,
  ramp,
  stillSaid,
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
      {
        id: '1:vote',
        at: h.now,
        lines: ['vote:start'],
        parts: [{ kind: 'line', key: 'vote:start' }],
      },
    ]);
  });

  it('warns of an epic battle, and has everyone touch their Mark at the end of the night', () => {
    const h = table({
      players: ['werewolf', 'vampire', 'cupid', 'villager'],
      settings: { stepSeconds: 10 },
    });
    expect(cuesFor(nightfall.view(h.state, 'A'))[0]!.lines).toEqual([
      'night:epic-battle',
      'night:start',
    ]);
    h.tick();
    // Every device hears the dusk's group steps, acting or not.
    expect(cuesFor(nightfall.view(h.state, 'D'))[0]!.lines).toEqual(['vampire:wake']);
    h.dawn();
    expect(cuesFor(nightfall.view(h.state, 'A'))[0]!.lines).toEqual([
      'night:end:marks',
      'day:start',
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

describe('the narration queue', () => {
  it('drops the clips still waiting when a new cue comes', () => {
    const queue = enqueueClips(['a.ogg', 'b.ogg'], 1000, 'one');
    expect(queue).toEqual([
      { src: 'a.ogg', cue: 'one', at: 1000 },
      { src: 'b.ogg', cue: 'one' },
    ]);
    // A new cue replaces the old queue outright.
    expect(enqueueClips(['c.ogg'], 9000, 'two')).toEqual([{ src: 'c.ogg', cue: 'two', at: 9000 }]);
  });

  /** Plays a queue through on one device: each clip starts `delay` ms after it may. */
  function play(queue: QueuedClip[], from: number, lengths: Record<string, number>, delay = 150) {
    const heard: { src: string; start: number }[] = [];
    let now = from;
    for (;;) {
      const { clip, rest } = nextClip(queue, now);
      if (!clip) return heard;
      heard.push({ src: clip.src, start: now });
      now += lengths[clip.src]!;
      queue = afterClip(rest, clip, lengths[clip.src]!);
      now += delay;
    }
  }

  it('says every clip of a long cue, in order, one after the other', () => {
    // The aliens' wake (4 s), then the instruction and the players it names: 9 s in all.
    const lengths = {
      'wake.ogg': 4000,
      'view.ogg': 2500,
      'p1.ogg': 700,
      'or.ogg': 300,
      'p3.ogg': 700,
    };
    const queue = enqueueClips(Object.keys(lengths), 10_000, 'aliens');
    const heard = play(queue, 10_130, lengths);
    expect(heard.map((h) => h.src)).toEqual(Object.keys(lengths));
    expect(heard.at(-1)!.start).toBeGreaterThan(10_000 + STALE_CLIP_MS);
  });

  it('says the whole of a cue that started late, as long as its clips follow on', () => {
    // The 5.8 s epic-battle intro overran the night's 4 s opening: the Oracle's wake starts 2 s
    // late, and her question still follows it.
    const lengths = { 'wake.ogg': 3800, 'question.ogg': 4200 };
    const queue = enqueueClips(Object.keys(lengths), 4000, 'oracle');
    expect(play(queue, 6000, lengths).map((h) => h.src)).toEqual(Object.keys(lengths));
  });

  it('skips a cue a device wakes up too late for, with the rest of it', () => {
    const queue = [
      ...enqueueClips(['old.ogg', 'old-2.ogg'], 0, 'old'),
      ...enqueueClips(['new.ogg', 'next.ogg'], 8000, 'new'),
    ];
    const { clip, rest } = nextClip(queue, 9000);
    expect(clip).toEqual({ src: 'new.ogg', cue: 'new', at: 8000 });
    expect(rest).toEqual([{ src: 'next.ogg', cue: 'new' }]);
    expect(nextClip(queue, 20_000)).toEqual({ clip: null, rest: [] });
  });

  it('drops the rest of a cue when the device was away in the middle of it', () => {
    // The wake played, then the tab was in the background: its end came 20 s late.
    const queue = enqueueClips(['wake.ogg', 'view.ogg', 'p1.ogg'], 0, 'aliens');
    const first = nextClip(queue, 100);
    const later = afterClip(first.rest, first.clip!, 4000);
    expect(later[0]).toEqual({ src: 'view.ogg', cue: 'aliens', at: 4000 });
    expect(nextClip(later, 24_000)).toEqual({ clip: null, rest: [] });
    // Back in time, it goes on.
    expect(nextClip(later, 4200).clip?.src).toBe('view.ogg');
  });

  it('times only the clip that follows in the same cue', () => {
    const played = { src: 'old.ogg', cue: 'old', at: 0 };
    const queue = enqueueClips(['new.ogg', 'next.ogg'], 5000, 'new');
    expect(afterClip(queue, played, 9000)).toEqual(queue);
  });
});

describe('the narration text', () => {
  const parts = [{ kind: 'line' as const, key: 'oracle:close' }];

  it('shows what was said while its step lasts', () => {
    const said = { cue: '1:0:close', parts };
    expect(stillSaid(said, [{ id: '1:0:open' }, { id: '1:0:close' }])).toBe(parts);
  });

  it('says nothing once its step has ended, before the next cue is due', () => {
    const said = { cue: '1:0:close', parts };
    expect(stillSaid(said, [{ id: '1:1:open' }, { id: '1:1:close' }])).toEqual([]);
    expect(stillSaid(said, [{ id: '1:dawn' }])).toEqual([]);
    expect(stillSaid(null, [{ id: '1:dawn' }])).toEqual([]);
  });
});
