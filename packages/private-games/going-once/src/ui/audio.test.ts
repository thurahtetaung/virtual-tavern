import { describe, expect, it } from 'vitest';
import { goingOnce } from '../logic/definition.ts';
import {
  HOST,
  SQUIGGLE,
  auctioning,
  bid,
  game,
  hammer,
  harness,
  nextLot,
  packContent,
  started,
} from '../logic/test-utils.ts';
import { halfAt } from '../logic/setup.ts';
import { BID_SETTLE_MS, SCREW_NUDGE_MS } from '../logic/types.ts';
import {
  type Cue,
  DUCK_RATIO,
  MUSIC_SHARE,
  RING,
  SOLD_BEAT_MS,
  STALE_MS,
  cuePlays,
  deviceSounds,
  soundModeIn,
  dueCues,
  effectCues,
  endTimes,
  musicFor,
  clipNow,
  clipTimes,
  musicLevel,
  prime,
  ownCues,
  voiceCues,
  type VoiceClip,
  cutsOff,
  enqueueLine,
  nextVoice,
  shiftLine,
  clipSkip,
  keepsTime,
  voiceBusy,
  voiceClipOf,
  voiceLate,
  voiceLine,
  type AudioManifest,
  LOAD_WAIT_MS,
  loadedTooLate,
  chantClips,
  musicClips,
  ringClips,
  startupClips,
} from './audio.ts';
import { CHANT_GAP_MS, CLIP_GAP_MS } from '../logic/voice.ts';
import { VOICE_MS } from '../logic/voice-lengths.ts';

const keys = (cues: Cue[]) => cues.map((c) => c.key);

describe('who plays what', () => {
  it('plays the room’s sound where the host chose, and a hint’s ring on its own device', () => {
    expect(deviceSounds('all', false)).toBe(true);
    expect(deviceSounds('host', true)).toBe(true);
    expect(deviceSounds('host', false)).toBe(false);
    expect(deviceSounds('off', true)).toBe(false);
    const ring: Cue = { id: 'r', at: 0, kind: 'sfx', key: 'message', local: true };
    const bell: Cue = { id: 'b', at: 0, kind: 'sfx', key: 'sold' };
    const said: Cue = { id: 'v', at: 0, kind: 'voice', key: 'sold' };
    const guest = { mode: 'host' as const, isHost: false, effects: true, voice: true };
    expect(cuePlays(ring, guest)).toBe(true);
    expect(cuePlays(bell, guest)).toBe(false);
    expect(cuePlays(said, guest)).toBe(false);
    const host = { ...guest, isHost: true };
    expect(cuePlays(bell, host)).toBe(true);
    expect(cuePlays(said, { ...host, voice: false })).toBe(false);
    expect(cuePlays(bell, { ...host, effects: false })).toBe(false);
    expect(cuePlays(ring, { ...guest, mode: 'off' })).toBe(false);
  });

  it('gives a paired table screen the sound until the host picks one, phones keeping their rings', () => {
    const fresh = { sound: 'all' as const };
    expect(soundModeIn(fresh, false)).toBe('all');
    expect(soundModeIn(fresh, true)).toBe('stage');
    // The host's own pick stands, and "Table screen" without one plays on every device.
    expect(soundModeIn({ sound: 'host', soundChosen: true }, true)).toBe('host');
    expect(soundModeIn({ sound: 'stage', soundChosen: true }, false)).toBe('all');
    expect(deviceSounds('stage', true)).toBe(false);
    expect(deviceSounds('stage', false, true)).toBe(true);
    expect(deviceSounds('all', false, true)).toBe(true);
    expect(deviceSounds('host', true, true)).toBe(false);
    const ring: Cue = { id: 'r', at: 0, kind: 'sfx', key: 'message', local: true };
    const yelp: Cue = { id: 'y', at: 0, kind: 'sfx', key: 'bidder-voice' };
    const phone = { mode: 'stage' as const, isHost: true, effects: true, voice: true };
    expect(cuePlays(ring, phone)).toBe(true);
    expect(cuePlays(yelp, phone)).toBe(false);
    expect(cuePlays(yelp, { ...phone, isStage: true })).toBe(true);
  });

  it('ducks the music under the voice', () => {
    expect(musicLevel(1, false)).toBeCloseTo(MUSIC_SHARE);
    expect(musicLevel(1, true)).toBeCloseTo(MUSIC_SHARE * DUCK_RATIO);
    expect(musicLevel(2, false)).toBeCloseTo(MUSIC_SHARE);
  });
});

describe('music', () => {
  it('follows the game: lobby, drawing, the auction (alternating per lot), screws, the bank, scores', () => {
    const h = started(3, 4);
    expect(musicFor(goingOnce.view(h.state, 'p1'))).toEqual({
      key: 'draw',
      pick: Math.floor(h.now / 1000),
    });
    const g = game(h);
    for (const id of g.order)
      for (const item of g.prompts[id]!) h.act(id, { type: 'draw', item, drawing: SQUIGGLE });
    expect(musicFor(goingOnce.view(h.state, 'p1'))).toEqual({ key: 'auction', pick: 0 });
    hammer(h);
    nextLot(h);
    expect(musicFor(goingOnce.view(h.state, 'p1'))).toEqual({ key: 'auction', pick: 1 });
    while (h.state.phase !== 'over') {
      if (game(h).stage === 'bank')
        expect(musicFor(goingOnce.view(h.state, null))!.key).toBe('bank');
      hammer(h);
      nextLot(h);
    }
    // The end: the scores' loop through each buyer's art, the drumroll while everyone's totals
    // rack up, then the credits once the winner is shown.
    const end = goingOnce.view(h.state, null);
    const times = endTimes(end)!;
    expect(musicFor(end, times.sum)).toEqual({ key: 'drumroll', pick: 0 });
    expect(musicFor(end, times.winner - 1)).toEqual({ key: 'drumroll', pick: 0 });
    expect(musicFor(end, times.winner)).toEqual({ key: 'credits', pick: 0 });
    expect(times.winner).toBeGreaterThan(times.sum);
    // The winner's sound comes at the same moment.
    expect(effectCues(end, null).find((c) => c.key === 'winner-centre')!.at).toBe(times.winner);
    h.act(HOST, { type: 'back-to-lobby' });
    expect(musicFor(goingOnce.view(h.state, null))).toEqual({ key: 'lobby', pick: 0 });
  });

  it('plays the heartbeat while a screw is aimed', () => {
    const h = auctioning(3, 5);
    while (!game(h).auction || game(h).auction!.lot < halfAt(game(h).lots.length)) {
      hammer(h);
      nextLot(h);
    }
    bid(h, 'p2', 400);
    h.act('p1', { type: 'screw' });
    expect(musicFor(goingOnce.view(h.state, 'p3'))).toEqual({ key: 'screw', pick: 0 });
    // A text game: no throat-clearing.
    expect(effectCues(goingOnce.view(h.state, 'p3'), 'p3').some((c) => c.key === 'nudge')).toBe(
      false,
    );
  });

  it('has the auctioneer clear his throat 5 s before a voiced screw pick runs out', () => {
    const h = harness(3, 5);
    h.act(HOST, { type: 'update-settings', pace: 'normal', practice: false, voice: true });
    h.act(HOST, { type: 'start' });
    const g = game(h);
    for (const id of g.order)
      for (const item of g.prompts[id]!) h.act(id, { type: 'draw', item, drawing: SQUIGGLE });
    h.act(HOST, { type: 'skip-intro' });
    while (!game(h).auction || game(h).auction!.lot < halfAt(game(h).lots.length)) {
      hammer(h);
      nextLot(h);
    }
    bid(h, 'p2', 400);
    h.act('p1', { type: 'screw' });
    const v = goingOnce.view(h.state, 'p3');
    const nudge = effectCues(v, 'p3').find((c) => c.key === 'nudge')!;
    expect(nudge.kind).toBe('voice');
    expect(nudge.at).toBe(v.game!.auction!.screw!.until - 5000);
    expect(nudge.at).toBe(h.now + SCREW_NUDGE_MS);
    // Played where the voice plays, like the rest of what he says.
    expect(cuePlays(nudge, { mode: 'all', isHost: false, effects: true, voice: false })).toBe(
      false,
    );
    expect(cuePlays(nudge, { mode: 'all', isHost: false, effects: false, voice: true })).toBe(true);
  });
});

/** The view of `p1` at the lot intro of a fresh 3-player game. */
function atIntro() {
  const h = started(3, 6);
  const g = game(h);
  for (const id of g.order)
    for (const item of g.prompts[id]!) h.act(id, { type: 'draw', item, drawing: SQUIGGLE });
  return h;
}

describe('effects', () => {
  it('opens a lot with its number, and rings each player’s own tip in their buyer’s ring', () => {
    const h = atIntro();
    const a = game(h).auction!;
    const view = goingOnce.view(h.state, 'p1');
    const cues = effectCues(view, 'p1');
    expect(cues[0]).toMatchObject({ key: 'lot-in', at: a.since });
    const ring = cues.find((c) => c.key === 'message')!;
    expect(ring.local).toBe(true);
    expect(ring.pick).toBe(RING[view.mine!.messages.at(-1)!.from]);
    expect(ring.at).toBeGreaterThan(a.since!);
    // Someone watching gets no ring.
    expect(keys(effectCues(goingOnce.view(h.state, null), null))).toEqual(['lot-in']);
    h.tick();
    expect(keys(effectCues(goingOnce.view(h.state, 'p1'), 'p1'))).toEqual(['painting-in']);
  });

  it('plays each bid with the paddle and that bidder’s own yelp, then the calls', () => {
    const h = auctioning(3, 7);
    bid(h, 'p2', 400);
    const v = goingOnce.view(h.state, 'p1');
    const cues = effectCues(v, 'p1');
    expect(keys(cues)).toEqual(['bid', 'bidder-voice']);
    expect(cues[1]!.pick).toBe(v.game!.paddles.p2);
    expect(cues[0]!.at).toBe(game(h).auction!.since);
    // The same moment has the same ids on every device, and a new bid new ones.
    expect(effectCues(goingOnce.view(h.state, 'p3'), 'p3').map((c) => c.id)).toEqual(
      cues.map((c) => c.id),
    );
    bid(h, 'p3', 500);
    const next = effectCues(goingOnce.view(h.state, 'p1'), 'p1');
    expect(next[1]!.pick).toBe(v.game!.paddles.p3);
    expect(next[0]!.id).not.toBe(cues[0]!.id);
    h.tick();
    expect(keys(effectCues(goingOnce.view(h.state, 'p1'), 'p1'))).toEqual(['going-once']);
    h.tick();
    expect(keys(effectCues(goingOnce.view(h.state, 'p1'), 'p1'))).toEqual(['going-twice']);
  });

  it('stages the Sold card as the original: the bell, the artist and commission, the value, profit or loss', () => {
    const h = auctioning(3, 3);
    const item = game(h).items[game(h).lots[0]!]!;
    const buyer = ['p1', 'p2', 'p3'].find((p) => p !== item.artist)!;
    bid(h, buyer, 400);
    hammer(h);
    const since = game(h).since!;
    const cues = effectCues(goingOnce.view(h.state, 'p1'), 'p1');
    const profit = item.value - 400;
    expect(keys(cues)).toEqual([
      'sold',
      ...(item.artist ? ['paddle-flip', 'cha-ching'] : []),
      profit > 0 ? 'value-under' : profit < 0 ? 'value-over' : 'value-even',
      profit > 0 ? 'profit-out' : profit < 0 ? 'loss-out' : 'even-out',
    ]);
    const beats = item.artist ? [0, 2, 2, 3, 4] : [0, 2, 3];
    expect(cues.map((c) => c.at - since)).toEqual(
      beats.map((b, i) => b * SOLD_BEAT_MS + (item.artist && i === 2 ? 500 : 0)),
    );
    // Unsold: the painting goes off.
    nextLot(h);
    hammer(h);
    expect(keys(effectCues(goingOnce.view(h.state, 'p1'), 'p1'))).toEqual(['unsold-out']);
  });

  it('ticks only the drawing clock’s last ten seconds', () => {
    const h = started(3, 8);
    const v = goingOnce.view(h.state, 'p1');
    const ticks = effectCues(v, 'p1').filter((c) => c.key === 'tick');
    expect(ticks).toHaveLength(10);
    expect(ticks[0]!.at).toBe(v.game!.until - 10_000);
    expect(ticks.at(-1)!.at).toBe(v.game!.until - 1000);
  });

  it('racks up the end: a beat per buyer, the sum, the shark only after a loan, the winner', () => {
    const h = auctioning(3, 9);
    while (h.state.phase !== 'over') {
      const a = game(h).auction;
      if (game(h).stage === 'auction' && a && !a.bid) bid(h, game(h).order[a.lot % 3]!, 400);
      hammer(h);
      nextLot(h);
    }
    const v = goingOnce.view(h.state, null);
    const ks = keys(effectCues(v, null));
    expect(ks[0]).toBe('player-in');
    expect(ks.at(-1)).toBe('winner-centre');
    expect(ks.includes('debt-shark')).toBe(v.game!.final!.some((f) => f.debt > 0));
    // Each buyer's art racks up to the scores' loop, before the drumroll.
    const times = endTimes(v)!;
    expect(times.buyers).toBeGreaterThan(0);
    expect(musicFor(v, v.game!.since)).toEqual({ key: 'scores', pick: 0 });
    expect(musicFor(v, times.sum)).toEqual({ key: 'drumroll', pick: 0 });
  });
});

describe('the auctioneer’s voice', () => {
  /** A voiced game at its first lot (the intro skipped, everything drawn). */
  function voiced() {
    const h = harness(3, 5);
    h.act(HOST, { type: 'update-settings', pace: 'normal', practice: false, voice: true });
    h.act(HOST, { type: 'start' });
    const g = game(h);
    for (const id of g.order)
      for (const item of g.prompts[id]!) h.act(id, { type: 'draw', item, drawing: SQUIGGLE });
    h.act(HOST, { type: 'skip-intro' });
    h.tick();
    return h;
  }

  it('plays each clip the server picked, one after the other, from when it was said', () => {
    // Lot 1's opening as the picture goes up: the line, then the chant.
    const h = voiced();
    let v = goingOnce.view(h.state, 'p1');
    const host = v.game!.host!;
    const cues = voiceCues(v);
    expect(cues.map((c) => [c.key, c.pick])).toEqual(host.clips!.map((c) => [c.key, c.i]));
    expect(cues[0]!.at).toBe(h.now);
    expect(cues[1]!.at).toBe(h.now + host.clips![0]!.ms + CLIP_GAP_MS);
    expect(clipTimes(host)).toEqual(cues.map((c) => c.at));
    // A bid's chant waits for the paddle (a silence before it).
    bid(h, 'p2', 400);
    v = goingOnce.view(h.state, 'p1');
    expect(voiceCues(v)[0]!.at).toBe(h.now + BID_SETTLE_MS);
    // A text game has no voice.
    const quiet = started(3, 3, packContent(undefined, {}, { 'draw-start': ['Draw!'] }));
    expect(voiceCues(goingOnce.view(quiet.state, 'p1'))).toEqual([]);
  });

  it('shows the words of the clip being said; a chant keeps the line before it on screen', () => {
    const h = voiced();
    const host = goingOnce.view(h.state, 'p1').game!.host!;
    const words = (c: { key: string }) => !c.key.startsWith('chant');
    const [line, chant] = host.clips!;
    expect(clipNow(host, h.now - 1, words)).toBeNull();
    expect(clipNow(host, h.now, words)).toEqual(line);
    // During the chant the opening line stays.
    expect(clipNow(host, h.now + line!.ms + CLIP_GAP_MS + 100, words)).toEqual(line);
    expect(clipNow(host, h.now + line!.ms + chant!.ms + 60_000, words)).toBeNull();
  });

  it('plays the tutorial’s music while it runs, after the drawing', () => {
    const h = harness(3, 5);
    h.act(HOST, { type: 'update-settings', practice: false, voice: true });
    h.act(HOST, { type: 'start' });
    expect(musicFor(goingOnce.view(h.state, 'p1'))!.key).toBe('draw');
    const g = game(h);
    for (const id of g.order)
      for (const item of g.prompts[id]!) h.act(id, { type: 'draw', item, drawing: SQUIGGLE });
    expect(musicFor(goingOnce.view(h.state, 'p1'))).toEqual({ key: 'tutorial', pick: 0 });
  });
});

describe('the voice queue', () => {
  /** A voiced game at its first lot (the intro skipped, everything drawn). */
  function voiced() {
    const h = harness(3, 5);
    h.act(HOST, { type: 'update-settings', pace: 'normal', practice: false, voice: true });
    h.act(HOST, { type: 'start' });
    const g = game(h);
    for (const id of g.order)
      for (const item of g.prompts[id]!) h.act(id, { type: 'draw', item, drawing: SQUIGGLE });
    h.act(HOST, { type: 'skip-intro' });
    h.tick();
    return h;
  }
  const clip = (id: string, at: number, more: Partial<VoiceClip> = {}): VoiceClip => ({
    id,
    line: id.split(':')[0]!,
    key: 'k',
    pick: 0,
    at,
    stage: 'auction',
    lineEnd: at + 1000,
    ...more,
  });

  it('takes a host line whole, with its stage and when the server timed it to end', () => {
    const h = voiced();
    bid(h, 'p2', 400);
    const v = goingOnce.view(h.state, 'p1');
    const line = voiceLine(v);
    const cues = voiceCues(v);
    expect(line.map((c) => [c.id, c.key, c.pick, c.at])).toEqual(
      cues.map((c) => [c.id, c.key, c.pick, c.at]),
    );
    const host = v.game!.host!;
    expect(new Set(line.map((c) => c.line))).toEqual(new Set([`host${host.id}`]));
    expect(line[0]!.stage).toBe('auction');
    expect(line[0]!.lineEnd).toBe(clipTimes(host).at(-1)! + host.clips!.at(-1)!.ms);
    const nudge = voiceClipOf({ id: 'lot1:nudge5', at: 9, kind: 'voice', key: 'nudge' }, 'auction');
    expect(nudge.line).toBe('lot1:nudge5');
  });

  it('lets a new bid wait for the line being said, but cuts off a chant', () => {
    const h = voiced();
    // Lot 1's opening: its line, then the chant for $400.
    const [amount, chant] = voiceLine(goingOnce.view(h.state, 'p1'));
    expect(chant!.key).toMatch(/^chant/);
    bid(h, 'p3', 500);
    const next = voiceLine(goingOnce.view(h.state, 'p1'))[0]!;
    expect(next.line).not.toBe(amount!.line);
    expect(cutsOff(amount!, next)).toBe(false);
    expect(cutsOff(chant!, next)).toBe(true);
    // Its own line never cuts itself.
    expect(cutsOff(chant!, { ...chant!, id: 'x' })).toBe(false);
  });

  it('cuts off a line a Skip ended, never one whose time was up', () => {
    const h = harness(3, 5);
    h.act(HOST, { type: 'update-settings', practice: false, voice: true });
    h.act(HOST, { type: 'start' });
    const g = game(h);
    for (const id of g.order)
      for (const item of g.prompts[id]!) h.act(id, { type: 'draw', item, drawing: SQUIGGLE });
    const tutorial = voiceLine(goingOnce.view(h.state, 'p1'));
    expect(tutorial[0]!.stage).toBe('intro');
    h.act('p2', { type: 'skip-intro' });
    const skipped = voiceLine(goingOnce.view(h.state, 'p1'))[0]!;
    expect(skipped.stage).toBe('auction');
    expect(cutsOff(tutorial[0]!, skipped)).toBe(true);
    // The host skipping the Sold card cuts its wrap-up.
    const wrapUp = clip('host3:2', 0, { stage: 'sold', lineEnd: 9000 });
    expect(cutsOff(wrapUp, clip('host4:0', 4000, { stage: 'auction' }))).toBe(true);
    // The game moving on when the line is over (Sold after going twice) waits for its last words.
    const twice = clip('host1:0', 0, { lineEnd: 1000 });
    const sold = clip('host2:0', 1000, { stage: 'sold' });
    expect(cutsOff(twice, sold)).toBe(false);
    // So does a stage ending early by itself: everyone's drawings in, everyone done at the bank.
    const drawing = clip('host5:1', 0, { stage: 'draw', lineEnd: 9000 });
    expect(cutsOff(drawing, clip('host6:0', 3000, { stage: 'auction' }))).toBe(false);
    const bank = clip('host7:1', 0, { stage: 'bank', lineEnd: 9000 });
    expect(cutsOff(bank, clip('host8:0', 3000, { stage: 'auction' }))).toBe(false);
  });

  it('drops what is left of older lines when a new one comes, keeping the new one in order', () => {
    const queue = [clip('host1:1', 100), clip('host1:2', 200)];
    const line = [clip('host2:0', 150), clip('host2:1', 300)];
    expect(enqueueLine(queue, line).map((c) => c.id)).toEqual(['host2:0', 'host2:1']);
    // A line seen again adds nothing.
    expect(enqueueLine(line, line).map((c) => c.id)).toEqual(['host2:0', 'host2:1']);
    expect(enqueueLine(queue, [])).toEqual(queue);
  });

  it('says a clip that waited behind another, and drops only clips whose moment is long gone', () => {
    const queue = [clip('host1:0', 1000)];
    // The voice was busy until 4000 (a long clip): 3 s after its moment, it still plays.
    expect(nextVoice(queue, 4000, 4000).clip?.id).toBe('host1:0');
    // Free all along and seen 3 s late (the phone was asleep): dropped.
    expect(nextVoice(queue, 4000, 0)).toEqual({ clip: null, rest: [] });
    expect(voiceLate(queue[0]!, 1000 + STALE_MS + 1, 0)).toBe(true);
    // Not due yet: it waits, unless it is due within the lead.
    expect(nextVoice(queue, 900, 0)).toEqual({ clip: null, rest: queue });
    expect(nextVoice(queue, 900, 0, 250).clip?.id).toBe('host1:0');
  });

  it('never drops a clip for its own loading, unless the file stalls', () => {
    // Its turn came on time; the file took 2 s (a busy phone): it is said, 2 s late.
    expect(loadedTooLate(1000, 3000)).toBe(false);
    expect(loadedTooLate(1000, 1000 + LOAD_WAIT_MS + 1)).toBe(true);
  });

  it('says every clip of a long line even when each one starts a little late', () => {
    // A Sold wrap-up of ten clips, each starting 300 ms late (loading on a slow phone).
    const ms = 1000;
    let queue = Array.from({ length: 10 }, (_, i) =>
      clip(`host1:${i}`, i * (ms + CLIP_GAP_MS), { lineEnd: 10 * (ms + CLIP_GAP_MS) }),
    );
    let now = 0;
    let free = 0;
    const said: string[] = [];
    for (let guard = 0; guard < 100 && queue.length; guard++) {
      const next = nextVoice(queue, now, free);
      queue = next.rest;
      if (!next.clip) {
        now += 50;
        continue;
      }
      const start = Math.max(now, next.clip.at) + 300;
      expect(voiceLate(next.clip, start, free)).toBe(false);
      queue = shiftLine(queue, next.clip.line, start - next.clip.at);
      said.push(next.clip.id);
      now = free = start + ms;
    }
    expect(said).toHaveLength(10);
    // Only its own line moves.
    expect(
      shiftLine([clip('host1:0', 0), clip('host2:0', 0)], 'host1', 500).map((c) => c.at),
    ).toEqual([500, 0]);
    expect(shiftLine([clip('host1:0', 0)], 'host1', -5)[0]!.at).toBe(0);
  });

  it('ducks the music while a clip is said or one is due within a second', () => {
    expect(voiceBusy(true, [], 0)).toBe(true);
    expect(voiceBusy(false, [clip('host1:0', 900)], 0)).toBe(true);
    expect(voiceBusy(false, [clip('host1:0', 1500)], 0)).toBe(false);
    expect(voiceBusy(false, [], 0)).toBe(false);
  });

  /**
   * The voice queue as `useSound` runs it, on a 10 ms clock: lines arrive, a clip waits for the
   * voice or cuts it off (`cutsOff`), a late start moves the rest of its line back (a chant keeps
   * its time and skips its head) and each clip lasts its real length (`VOICE_MS`). `load` delays
   * a clip's start (its file is slow). Returns what was said, from when to when, and if it was cut.
   */
  function run(arrivals: { at: number; clips: VoiceClip[] }[], load: Record<string, number> = {}) {
    const said: { id: string; key: string; start: number; end: number; cut: boolean }[] = [];
    let queue: VoiceClip[] = [];
    let saying: (typeof said)[number] | null = null;
    let sayingClip: VoiceClip | null = null;
    let free = 0;
    const from = arrivals[0]!.at;
    const to = arrivals.at(-1)!.at + 30_000;
    for (let t = from; t <= to; t += 10) {
      for (const a of arrivals.filter((x) => x.at === t)) {
        queue = enqueueLine(queue, a.clips);
        if (saying && sayingClip && cutsOff(sayingClip, a.clips[0]!)) {
          saying.end = t;
          saying.cut = true;
          saying = null;
          free = t;
        }
      }
      if (saying && t >= saying.end) {
        free = saying.end;
        saying = null;
      }
      if (saying) continue;
      const next = nextVoice(queue, t, free);
      queue = next.rest;
      if (!next.clip) continue;
      const clip = next.clip;
      const length = VOICE_MS[clip.key]![clip.pick]!;
      const start = Math.max(t + (load[clip.key] ?? 0), clip.at);
      const skip = clipSkip(clip, start, length);
      if (skip === null) continue;
      queue = shiftLine(queue, clip.line, start - clip.at);
      saying = { id: clip.id, key: clip.key, start, end: start + length - skip, cut: false };
      sayingClip = clip;
      said.push(saying);
    }
    return said;
  }
  const lineAt = (h: ReturnType<typeof voiced>) => {
    const clips = voiceLine(goingOnce.view(h.state, 'p1'));
    return { at: clips[0]!.at, clips };
  };

  it('times every clip by its real length, and keeps a chant on its time', () => {
    const h = voiced();
    bid(h, 'p2', 400);
    const host = game(h).host!;
    for (const c of host.clips!) expect(c.ms).toBe(VOICE_MS[c.key]![c.i]);
    expect(keepsTime({ key: 'chant-400' })).toBe(true);
    expect(keepsTime({ key: 'chant-long-1200' })).toBe(true);
    expect(keepsTime({ key: 'bid-400' })).toBe(false);
    const chant = voiceLine(goingOnce.view(h.state, 'p1')).at(-1)!;
    // On time it is said whole; late, it skips what it missed; nearly over, it is left out.
    expect(clipSkip(chant, chant.at, 9000)).toBe(0);
    expect(clipSkip(chant, chant.at + 2500, 9000)).toBe(2500);
    expect(clipSkip(chant, chant.at + 8800, 9000)).toBeNull();
    expect(clipSkip({ ...chant, key: 'bid-400' }, chant.at + 2500, 9000)).toBe(0);
    // A chant never moves with a late amount before it.
    expect(shiftLine([chant], chant.line, 2000)[0]!.at).toBe(chant.at);
  });

  it('ends a chant a second before going once, even when what comes before it runs late', () => {
    const h = voiced();
    // Lot 1's opening line is being said when the first bid comes: its chant waits for it.
    const first = lineAt(h);
    h.wait(200);
    h.act('p3', { type: 'bid', amount: 400, seq: game(h).auction!.seq });
    const second = lineAt(h);
    const closeAt = game(h).auction!.closeAt;
    h.tick();
    expect(game(h).auction!.close).toBe('once');
    const once = lineAt(h);
    expect(once.at).toBe(closeAt);
    // The second chant's file is slow too (1.5 s): it still ends on time, never cut.
    const said = run([first, second, once], { [second.clips.at(-1)!.key]: 1500 });
    const chant = said.find((c) => c.id === second.clips.at(-1)!.id)!;
    expect(chant.key).toMatch(/^chant/);
    expect(chant.cut).toBe(false);
    expect(chant.end).toBe(closeAt - CHANT_GAP_MS);
    expect(said.find((c) => c.id === once.clips[0]!.id)!.start).toBe(closeAt);
  });

  it('chants after a screw too, ending a second before going once', () => {
    const h = voiced();
    // Lines said to a player need their colour.
    h.state.seats.p1!.color = 'red';
    h.state.seats.p3!.color = 'blue';
    while (game(h).auction!.lot < halfAt(game(h).lots.length)) {
      hammer(h);
      nextLot(h);
    }
    bid(h, 'p2', 400);
    h.act('p1', { type: 'screw' });
    const ask = lineAt(h);
    // Picked at once, while the screwer is still being asked to pick.
    h.wait(500);
    h.act('p1', { type: 'screw-pick', target: 'p3' });
    const forced = lineAt(h);
    expect(forced.clips.at(-1)!.key).toMatch(/^chant/);
    const closeAt = game(h).auction!.closeAt;
    h.tick();
    const once = lineAt(h);
    const said = run([ask, forced, once]);
    // The ask gives way to the pick; the forced bid's line runs whole, on time.
    expect(said.find((c) => c.id === ask.clips[0]!.id)!.cut).toBe(true);
    const chant = said.find((c) => c.id === forced.clips.at(-1)!.id)!;
    expect(chant.cut).toBe(false);
    expect(chant.end).toBe(closeAt - CHANT_GAP_MS);
  });
});

describe('fetching ahead', () => {
  const audio: AudioManifest = {
    sfx: { bid: ['s/bid.ogg'], message: ['s/ring-1.ogg', 's/ring-2.ogg'] },
    voice: {
      'bid-400': ['v/bid-400.ogg'],
      'going-once': ['v/once.ogg', 'v/once-2.ogg'],
      'congrats-red': ['v/congrats-red.ogg'],
      'congrats-blue': ['v/congrats-blue.ogg'],
      'chant-400': ['v/c400.ogg', 'v/c400-2.ogg'],
      'chant-500': ['v/c500.ogg'],
      'chant-600': ['v/c600.ogg'],
      'chant-1300': ['v/c1300.ogg'],
      'chant-1400': ['v/c1400.ogg'],
      'chant-1500': ['v/c1500.ogg'],
      'chant-long-500': ['v/cl500.ogg'],
      'chant-high': ['v/chigh.ogg'],
    },
    music: { lobby: ['m/lobby.ogg'], tutorial: ['m/tut.ogg'], auction: ['m/a1.ogg', 'm/a2.ogg'] },
  };
  const all = { effects: true, voice: true };

  it('fetches every effect and every line but the chants, lines to a player only for colours seated', () => {
    expect(startupClips(audio, ['red', 'green'], all)).toEqual([
      's/bid.ogg',
      's/ring-1.ogg',
      's/ring-2.ogg',
      'v/bid-400.ogg',
      'v/once.ogg',
      'v/once-2.ogg',
      'v/congrats-red.ogg',
    ]);
    expect(startupClips(audio, ['red'], { effects: false, voice: true })).not.toContain(
      's/bid.ogg',
    );
    expect(startupClips(audio, ['red'], { effects: true, voice: false })).toEqual([
      's/bid.ogg',
      's/ring-1.ogg',
      's/ring-2.ogg',
    ]);
    expect(startupClips(undefined, ['red'], all)).toEqual([]);
    // A device that only rings fetches its own art buyer's ring ahead.
    expect(ringClips(audio, 'buyer1')).toEqual(['s/ring-2.ogg']);
    expect(ringClips(audio, 'buyer2')).toEqual(['s/ring-1.ogg']);
    expect(ringClips(audio, undefined)).toEqual([]);
  });

  /** A voiced game at its first lot (the intro skipped, everything drawn). */
  function voiced() {
    const h = harness(3, 5);
    h.act(HOST, { type: 'update-settings', pace: 'normal', practice: false, voice: true });
    h.act(HOST, { type: 'start' });
    const g = game(h);
    for (const id of g.order)
      for (const item of g.prompts[id]!) h.act(id, { type: 'draw', item, drawing: SQUIGGLE });
    h.act(HOST, { type: 'skip-intro' });
    h.tick();
    return h;
  }

  it('fetches the chants for the next few amounts a bid could bring', () => {
    const h = voiced();
    while (game(h).auction?.close === 'intro') h.tick();
    // Before the first bid: the opening amounts.
    expect(chantClips(audio, goingOnce.view(h.state, 'p1'))).toEqual([
      'v/c400.ogg',
      'v/c400-2.ogg',
      'v/c500.ogg',
      'v/c600.ogg',
    ]);
    bid(h, 'p2', 400);
    expect(chantClips(audio, goingOnce.view(h.state, 'p1'))).toEqual(['v/c500.ogg', 'v/c600.ogg']);
    const later = goingOnce.view(h.state, 'p1');
    const at = (amount: number) => ({
      ...later,
      game: { ...later.game!, auction: { ...later.game!.auction!, bid: { by: 'p2', amount } } },
    });
    expect(chantClips(audio, at(1200))).toEqual(['v/c1300.ogg', 'v/c1400.ogg', 'v/c1500.ogg']);
    // Above $4,000 every amount shares one chant.
    expect(chantClips(audio, at(4500))).toEqual(['v/chigh.ogg']);
    // A game without the voice fetches no chants.
    const quiet = auctioning(3, 5);
    expect(chantClips(audio, goingOnce.view(quiet.state, 'p1'))).toEqual([]);
  });

  it('fetches only the track playing and the next', () => {
    const lobby = harness(3, 5);
    expect(musicClips(audio, goingOnce.view(lobby.state, 'p1'))).toEqual([
      'm/lobby.ogg',
      'm/tut.ogg',
    ]);
    const h = voiced();
    const v = goingOnce.view(h.state, 'p1');
    const lot = v.game!.auction!.lot;
    expect(musicClips(audio, v)).toEqual(
      lot % 2 === 0 ? ['m/a1.ogg', 'm/a2.ogg'] : ['m/a2.ogg', 'm/a1.ogg'],
    );
  });
});

describe('timing', () => {
  const cue = (id: string, at: number, until?: number): Cue => ({
    id,
    at,
    kind: 'sfx',
    key: 'k',
    ...(until !== undefined && { until }),
  });

  it('plays cues once when due, drops ones seen too late, and waits for future ones', () => {
    const cues = [
      cue('later', 2000),
      cue('now', 1000),
      cue('stale', 1000 - STALE_MS - 1),
      cue('b', 900),
    ];
    expect(dueCues(cues, 1000, new Set()).map((c) => c.id)).toEqual(['b', 'now']);
    expect(dueCues(cues, 1000, new Set(['now'])).map((c) => c.id)).toEqual(['b']);
    expect(dueCues([cue('v', 0, 5000)], 4000, new Set()).map((c) => c.id)).toEqual(['v']);
    expect(dueCues([cue('v', 0, 5000)], 5001, new Set())).toEqual([]);
    // Effects due within the lead start now, scheduled for their moment.
    expect(dueCues(cues, 1000, new Set(['b', 'now']), 1000).map((c) => c.id)).toEqual(['later']);
  });

  it('sounds this player’s own drawing sent and loan taken, from the change', () => {
    const h = started(3, 10);
    const before = goingOnce.view(h.state, 'p1');
    const item = game(h).prompts.p1![0]!;
    h.act('p1', { type: 'draw', item, drawing: SQUIGGLE });
    const after = goingOnce.view(h.state, 'p1');
    expect(keys(ownCues(before, after, 5))).toEqual(['drawing-done']);
    expect(ownCues(null, after, 5)).toEqual([]);
    expect(ownCues(after, after, 5)).toEqual([]);
    const v = after;
    const loaned = { ...v, mine: { ...v.mine!, loans: 1 } };
    expect(keys(ownCues(v, loaned, 5))).toEqual(['loan']);
  });

  it('primes a music player without stopping a track set on it before the primer settled', async () => {
    const player = () => {
      const pending: (() => void)[] = [];
      const el = {
        src: '',
        paused: true,
        play: () =>
          new Promise<void>((resolve) => {
            el.paused = false;
            pending.push(resolve);
          }),
        pause: () => {
          el.paused = true;
        },
      };
      return { el, settle: () => pending.splice(0).forEach((resolve) => resolve()) };
    };
    const tick = () => new Promise((r) => setTimeout(r, 0));
    // Nothing set in the meantime: the primer stops.
    const quiet = player();
    prime(quiet.el, 'data:silent');
    quiet.settle();
    await tick();
    expect(quiet.el.paused).toBe(true);
    // A cached track set and played before the primer's play settles keeps playing.
    const cached = player();
    prime(cached.el, 'data:silent');
    cached.el.src = 'blob:lobby';
    void cached.el.play();
    cached.settle();
    await tick();
    expect(cached.el.paused).toBe(false);
  });
});
