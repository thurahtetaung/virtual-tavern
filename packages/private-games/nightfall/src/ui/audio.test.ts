import { describe, expect, it } from 'vitest';
import { nightfall } from '../logic/game.ts';
import { table } from '../logic/test-utils.ts';
import {
  CLOSE_GAP_MS,
  CLOSE_LEAD_MS,
  type Cue,
  DUCK_RATIO,
  clipsFor,
  cuesFor,
  devicePlaysMusic,
  deviceSpeaks,
  dueCues,
  enqueueClips,
  fitCues,
  musicChange,
  musicPhaseFor,
  musicTarget,
  nextClip,
  OVERRUN_MS,
  type QueuedClip,
  STALE_CLIP_MS,
  afterClip,
  CLIP_SLACK_MS,
  MIN_SHOW_MS,
  SHOW_MS,
  type Shown,
  endShown,
  pendingShown,
  ramp,
  scheduleShown,
  shownAt,
  speaksTo,
  startShown,
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
  const step = (id: string, at: number, until: number, close = false) => ({
    id,
    at,
    until,
    ...(close ? { close: true } : {}),
  });

  it('queues a new cue behind the clips still waiting', () => {
    const queue = enqueueClips(['a.ogg', 'b.ogg'], { id: 'one', at: 1000 });
    expect(queue).toEqual([
      { src: 'a.ogg', cue: 'one', n: 0, at: 1000 },
      { src: 'b.ogg', cue: 'one', n: 1 },
    ]);
    expect(enqueueClips(['c.ogg'], step('two', 9000, 12_000, true), queue)).toEqual([
      ...queue,
      { src: 'c.ogg', cue: 'two', n: 0, at: 9000, until: 12_000, waits: true },
    ]);
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

  type Timed = Pick<Cue, 'id' | 'at' | 'lines' | 'until' | 'close'>;
  /**
   * Plays cues as they fall due on a device that knows every clip's length (one clip per line),
   * as `useSound` does: closes timed by `fitCues`, each due cue queued, each clip after the last.
   */
  function night(cues: Timed[], lengths: Record<string, number>, overrunMs = OVERRUN_MS) {
    const known = new Map(Object.entries(lengths));
    const narration = Object.fromEntries(Object.keys(lengths).map((k) => [k, [k]]));
    const timed = fitCues(
      cues.map((c) => ({ ...c, parts: [] })),
      narration,
      known,
    ).sort((x, y) => x.at - y.at);
    let queue: QueuedClip[] = [];
    type Playing = { clip: QueuedClip; end: number };
    let playing = null as Playing | null;
    const heard: { src: string; start: number }[] = [];
    const next = (now: number) => {
      const { clip, rest } = nextClip(queue, now, { overrunMs, lengths: known });
      queue = rest;
      playing = clip ? { clip, end: now + lengths[clip.src]! } : null;
      if (clip) heard.push({ src: clip.src, start: now });
    };
    for (;;) {
      const due = timed[0];
      if (!due && !playing) return { heard, timed };
      if (due && (!playing || due.at <= playing.end)) {
        timed.shift();
        queue = enqueueClips(clipsFor(narration, due.lines), due, queue);
        if (!playing) next(due.at);
      } else if (playing) {
        const { clip, end } = playing;
        queue = afterClip(queue, clip, lengths[clip.src]!);
        next(end);
      }
    }
  }

  it('ends a long close just before its step does, instead of on the next wake', () => {
    // Thumbs away, then close your eyes: 5 s, longer than the 2.5 s lead.
    const lengths = { wake: 4000, thumbs: 2600, close: 2400, next: 3000 };
    const cues: Timed[] = [
      { ...step('open', 0, 12_000), lines: ['wake'] },
      { ...step('close', 12_000 - CLOSE_LEAD_MS, 12_000, true), lines: ['thumbs', 'close'] },
      { ...step('next', 12_000, 24_000), lines: ['next'] },
    ];
    const { heard } = night(cues, lengths);
    expect(heard).toEqual([
      { src: 'wake', start: 0 },
      { src: 'thumbs', start: 12_000 - 5000 - CLOSE_GAP_MS },
      { src: 'close', start: 12_000 - 2400 - CLOSE_GAP_MS },
      { src: 'next', start: 12_000 },
    ]);
  });

  it('times closes only from known lengths, never before a second into the step', () => {
    const cues = [
      { ...step('open', 0, 8000), lines: ['wake'], parts: [] },
      { ...step('close', 5500, 8000, true), lines: ['thumbs', 'close'], parts: [] },
    ];
    const narration = { wake: ['w.ogg'], thumbs: ['t.ogg'], close: ['c.ogg'] };
    // Lengths not known yet: the usual lead.
    expect(fitCues(cues, narration, new Map([['t.ogg', 3000]]))[1]!.at).toBe(5500);
    // A short close keeps the lead; a long one starts earlier, but a second in at the earliest.
    const short = new Map([
      ['t.ogg', 500],
      ['c.ogg', 1000],
    ]);
    expect(fitCues(cues, narration, short)[1]!.at).toBe(5500);
    const long = new Map([
      ['t.ogg', 4000],
      ['c.ogg', 4000],
    ]);
    expect(fitCues(cues, narration, long)[1]!.at).toBe(1000);
    expect(fitCues(cues, narration, long)[0]).toBe(cues[0]);
  });

  it('lets a step’s instruction finish before its close, and the close before the next wake', () => {
    // The Rascal at 12 s: wake, a long instruction and its end (10.4 s), then a 2 s close. The
    // close waits for the instruction; the next wake waits for the close.
    const lengths = { wake: 2000, action: 3400, any: 1500, end: 3500, close: 2000, next: 2000 };
    const cues: Timed[] = [
      { ...step('open', 0, 12_000), lines: ['wake', 'action', 'any', 'end'] },
      { ...step('close', 9500, 12_000, true), lines: ['close'] },
      { ...step('next', 12_000, 24_000), lines: ['next'] },
    ];
    const strict = night(cues, lengths, 0).heard;
    // Strictly within the step: the whole instruction, and the close dropped (it doesn't fit).
    expect(strict.map((h) => h.src)).toEqual(['wake', 'action', 'any', 'end', 'next']);
    expect(strict.at(-1)!.start).toBe(12_000);
    // With room to run over, the close is said too and the next wake follows it.
    const loose = night(cues, lengths, 1000).heard;
    expect(loose.map((h) => h.src)).toEqual(['wake', 'action', 'any', 'end', 'close', 'next']);
    expect(loose.at(-1)!.start).toBe(12_400);
  });

  it('always says a step’s wake line, even one longer than the step', () => {
    const lengths = { wake: 9000, tail: 2000, close: 2000, next: 1000 };
    const { heard } = night(
      [
        { ...step('open', 0, 8000), lines: ['wake', 'tail'] },
        { ...step('close', 5500, 8000, true), lines: ['close'] },
        { ...step('next', 8000, 16_000), lines: ['next'] },
      ],
      lengths,
      0,
    );
    expect(heard).toEqual([
      { src: 'wake', start: 0 },
      { src: 'next', start: 9000 },
    ]);
  });

  it('stops an older cue once a later wake has waited too long behind it, lengths unknown', () => {
    const queue = [
      ...enqueueClips(['close-1.ogg', 'close-2.ogg'], step('close', 5500, 8000, true)),
      ...enqueueClips(['wake.ogg'], step('next', 8000, 16_000)),
    ];
    const first = nextClip(queue, 5500, { overrunMs: 1000 });
    expect(first.clip?.src).toBe('close-1.ogg');
    const after = afterClip(first.rest, first.clip!, 3000);
    // 8.5 s: the wake has waited half a second, within the 1 s allowed.
    expect(nextClip(after, 8500, { overrunMs: 1000 }).clip?.src).toBe('close-2.ogg');
    // 9.2 s: past it, so the close's rest goes and the wake starts.
    expect(nextClip(after, 9200, { overrunMs: 1000 }).clip?.src).toBe('wake.ogg');
  });

  it('says every clip of a long cue, in order, one after the other', () => {
    // The aliens' wake (4 s), then the instruction and the players it names: 9 s in all.
    const lengths = {
      'wake.ogg': 4000,
      'view.ogg': 2500,
      'p1.ogg': 700,
      'or.ogg': 300,
      'p3.ogg': 700,
    };
    const queue = enqueueClips(Object.keys(lengths), { id: 'aliens', at: 10_000 });
    const heard = play(queue, 10_130, lengths);
    expect(heard.map((h) => h.src)).toEqual(Object.keys(lengths));
    expect(heard.at(-1)!.start).toBeGreaterThan(10_000 + STALE_CLIP_MS);
  });

  it('says the whole of a cue that started late, as long as its clips follow on', () => {
    // The 5.8 s epic-battle intro overran the night's 4 s opening: the Oracle's wake starts 2 s
    // late, and her question still follows it.
    const lengths = { 'wake.ogg': 3800, 'question.ogg': 4200 };
    const queue = enqueueClips(Object.keys(lengths), { id: 'oracle', at: 4000 });
    expect(play(queue, 6000, lengths).map((h) => h.src)).toEqual(Object.keys(lengths));
  });

  it('skips a cue a device wakes up too late for, with the rest of it', () => {
    const queue = enqueueClips(
      ['new.ogg', 'next.ogg'],
      { id: 'new', at: 8000 },
      enqueueClips(['old.ogg', 'old-2.ogg'], { id: 'old', at: 0 }),
    );
    const { clip, rest } = nextClip(queue, 9000);
    expect(clip).toEqual({ src: 'new.ogg', cue: 'new', n: 0, at: 8000 });
    expect(rest).toEqual([{ src: 'next.ogg', cue: 'new', n: 1 }]);
    expect(nextClip(queue, 20_000)).toEqual({ clip: null, rest: [] });
  });

  it('drops the rest of a cue when the device was away in the middle of it', () => {
    // The wake played, then the tab was in the background: its end came 20 s late.
    const queue = enqueueClips(['wake.ogg', 'view.ogg', 'p1.ogg'], { id: 'aliens', at: 0 });
    const first = nextClip(queue, 100);
    const later = afterClip(first.rest, first.clip!, 4000);
    expect(later[0]).toEqual({ src: 'view.ogg', cue: 'aliens', n: 1, at: 4000 });
    expect(nextClip(later, 24_000)).toEqual({ clip: null, rest: [] });
    // Back in time, it goes on.
    expect(nextClip(later, 4200).clip?.src).toBe('view.ogg');
  });

  it('times only the clip that follows in the same cue', () => {
    const played = { src: 'old.ogg', cue: 'old', n: 0, at: 0 };
    const queue = enqueueClips(['new.ogg', 'next.ogg'], { id: 'new', at: 5000 });
    expect(afterClip(queue, played, 9000)).toEqual(queue);
  });
});

describe('the narration text', () => {
  const NARRATION = { 'seer:close': ['a.ogg', 'b.ogg'], 'seer:wake': ['w.ogg'] };
  const opts = (lengths: Record<string, number>, narrated = true) => ({
    narrated,
    narration: NARRATION,
    lengths: new Map(Object.entries(lengths)),
  });
  const close = {
    id: '1:0:close',
    at: 10_000,
    until: 12_500,
    step: 0,
    lines: ['seer:close'],
    parts: [{ kind: 'line' as const, key: 'seer:close' }],
  };

  it('stays up while its clips play past the step’s end', () => {
    // Two clips of 2 s each from a close cued 2.5 s before the step ends: said until past 14 s.
    const s = scheduleShown(close, [], opts({ 'a.ogg': 2000, 'b.ogg': 2000 }));
    const said = 14_000 + 2 * CLIP_SLACK_MS;
    expect(s).toMatchObject({ start: 10_000, end: said, spoken: said });
    expect(shownAt([s], said - 1)?.cue).toBe('1:0:close');
    expect(shownAt([s], said)).toBeNull();
    // On a device that plays it, the words follow the clips however late they run.
    let played = pendingShown(s);
    expect(shownAt([played], 10_000)).toBeNull();
    played = startShown(played, 10_400);
    expect(shownAt([played], 15_000)?.cue).toBe('1:0:close');
    played = endShown(played, 15_200);
    expect(shownAt([played], 15_100)?.cue).toBe('1:0:close');
    expect(shownAt([played], 15_200)).toBeNull();
  });

  it('waits for the narration before it, as its clips do', () => {
    const before = scheduleShown(close, [], opts({ 'a.ogg': 2000, 'b.ogg': 2000 }));
    const wake = {
      id: '1:1:open',
      at: 12_500,
      until: 30_000,
      step: 1,
      lines: ['seer:wake'],
      parts: [{ kind: 'line' as const, key: 'seer:wake' }],
    };
    const next = scheduleShown(
      wake,
      [before],
      opts({ 'a.ogg': 2000, 'b.ogg': 2000, 'w.ogg': 3000 }),
    );
    expect(next).toMatchObject({
      start: before.spoken,
      spoken: before.spoken + 3000 + CLIP_SLACK_MS,
    });
    // The close's words stay until the wake is said, then the wake's.
    expect(shownAt([before, next], 14_000)?.cue).toBe('1:0:close');
    expect(shownAt([before, next], before.spoken)?.cue).toBe('1:1:open');
  });

  it('shows short lines long enough to read', () => {
    const s = scheduleShown(close, [], opts({ 'a.ogg': 300, 'b.ogg': 300 }));
    expect(s).toMatchObject({ end: 10_000 + MIN_SHOW_MS, spoken: 10_600 + 2 * CLIP_SLACK_MS });
    expect(endShown(startShown(pendingShown(s), 10_000), 10_600).end).toBe(10_000 + MIN_SHOW_MS);
  });

  it('shows for its scheduled time when its length isn’t known', () => {
    // Narration off: never past its step's end.
    expect(scheduleShown(close, [], opts({}, false))).toMatchObject({ start: 10_000, end: 12_500 });
    const open = { ...close, id: '1:0:open', at: 0, until: 60_000 };
    expect(scheduleShown(open, [], opts({}, false)).end).toBe(SHOW_MS);
    // A clip with no known length: its scheduled time.
    expect(scheduleShown(close, [], opts({ 'a.ogg': 2000 })).end).toBe(10_000 + SHOW_MS);
  });

  it('isn’t held back by words still waiting for their first clip', () => {
    const waiting = pendingShown(scheduleShown(close, [], opts({ 'a.ogg': 2000, 'b.ogg': 2000 })));
    const next = { ...close, id: '1:1:open', at: 12_500, step: 1 };
    expect(scheduleShown(next, [waiting], opts({ 'a.ogg': 2000, 'b.ogg': 2000 })).start).toBe(
      12_500,
    );
  });

  it('still shows words whose clips were all dropped, for the planned window', () => {
    // The phone was asleep: every clip of the close was too late to play.
    const planned = scheduleShown(close, [], opts({ 'a.ogg': 2000, 'b.ogg': 2000 }));
    const s = endShown(pendingShown(planned), 10_500);
    expect(s).toEqual(planned);
    expect(shownAt([s], 10_500)?.cue).toBe('1:0:close');
    expect(shownAt([s], planned.end - 1)?.cue).toBe('1:0:close');
    expect(shownAt([s], planned.end)).toBeNull();
    // Lengths unknown: the scheduled time, as on a device that doesn't speak.
    const unknown = scheduleShown(close, [], opts({}));
    expect(endShown(pendingShown(unknown), 11_000)).toEqual(unknown);
  });

  it('speaks to a step’s players only in that step, and to nobody after the night', () => {
    const s: Pick<Shown, 'step'> = { step: 0 };
    expect(speaksTo(s, true, 0)).toBe(true);
    // The next step's player, and everyone at dawn, read it in the third person.
    expect(speaksTo(s, true, 1)).toBe(false);
    expect(speaksTo(s, true, undefined)).toBe(false);
    expect(speaksTo(s, false, 0)).toBe(false);
    expect(speaksTo({}, true, undefined)).toBe(true);
  });

  it('keeps a real close up while it runs into the next step', () => {
    const h = table({ players: ['werewolf', 'seer', 'villager'], settings: { stepSeconds: 10 } });
    h.tick();
    h.tick();
    const v = nightfall.view(h.state, 'A');
    const end = v.night!.deadline;
    const c = cuesFor(v).find((x) => x.close)!;
    const lengths = Object.fromEntries(
      c.lines.map((_, i) => [`clip-${i}.ogg`, 4000] as [string, number]),
    );
    const s = scheduleShown(c, [], {
      narrated: true,
      narration: Object.fromEntries(c.lines.map((l, i) => [l, [`clip-${i}.ogg`]])),
      lengths: new Map(Object.entries(lengths)),
    });
    expect(c.at + 4000 * c.lines.length).toBeGreaterThan(end);
    expect(shownAt([s], end + 1)?.cue).toBe(c.id);
    expect(s.step).toBe(v.night!.index);
  });
});
