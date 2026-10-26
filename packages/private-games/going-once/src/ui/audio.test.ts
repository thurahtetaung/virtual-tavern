import { describe, expect, it } from 'vitest';
import { goingOnce } from '../logic/definition.ts';
import {
  HOST,
  SQUIGGLE,
  auctioning,
  bid,
  game,
  hammer,
  nextLot,
  packContent,
  started,
} from '../logic/test-utils.ts';
import { halfAt } from '../logic/setup.ts';
import {
  type AudioManifest,
  type Cue,
  DUCK_RATIO,
  MUSIC_SHARE,
  RING,
  SOLD_BEAT_MS,
  STALE_MS,
  cuePlays,
  deviceSounds,
  dueCues,
  effectCues,
  musicFor,
  musicLevel,
  ownCues,
  voiceClip,
  voiceCues,
  voiceKeyFor,
  wordsKey,
} from './audio.ts';

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
    expect(musicFor(goingOnce.view(h.state, null))).toEqual({ key: 'scores', pick: 0 });
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

  it('stages the Sold card: the bell, the value spin, profit or loss, commission, the artist', () => {
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
      profit > 0 ? 'value-under' : profit < 0 ? 'value-over' : 'value-even',
      profit > 0 ? 'profit-out' : profit < 0 ? 'loss-out' : 'even-out',
      ...(item.artist ? ['cha-ching', 'paddle-flip'] : []),
    ]);
    expect(cues.map((c) => c.at - since).slice(0, 3)).toEqual([
      0,
      SOLD_BEAT_MS * 2,
      SOLD_BEAT_MS * 3,
    ]);
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
  });
});

describe('the auctioneer’s voice', () => {
  const hostPack = {
    'opening-first': ['First up.'],
    'bid-400': ['We have $400.'],
    congrats: ['Well done, {player}!'],
    sold: ['Sold!'],
    'going-once': ['Going once...'],
  };

  it('says only lines that name nobody, for moments it has, from when they were said', () => {
    const h = started(3, 3, packContent(undefined, {}, hostPack));
    const g = game(h);
    for (const id of g.order)
      for (const item of g.prompts[id]!) h.act(id, { type: 'draw', item, drawing: SQUIGGLE });
    h.tick();
    bid(h, 'p2', 400);
    const v = goingOnce.view(h.state, 'p1');
    const cues = voiceCues(v, () => 1500);
    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({ key: 'bid-400', text: 'We have $400.', at: h.now });
    // A reaction must finish before the quiet ends.
    expect(cues[0]!.until).toBe(v.game!.auction!.closeAt - 1500);
    hammer(h);
    const sold = voiceCues(goingOnce.view(h.state, 'p1'), () => 1000);
    // "Well done, P2!" names a player: the voice says the Sold card's "Sold!" instead.
    expect(game(h).host!.lines[0]).toBe('Well done, P2!');
    expect(sold.map((c) => [c.key, c.text])).toEqual([['sold', 'Sold!']]);
  });

  it('maps moments to the clips’ keys and leaves out the ones never voiced', () => {
    expect(voiceKeyFor('bid-1200')).toBe('bid-1200');
    expect(voiceKeyFor('bid-high')).toBe('bid-high');
    expect(voiceKeyFor('opening-first')).toBe('opening');
    expect(voiceKeyFor('draw-seconds')).toBe('seconds-left');
    expect(voiceKeyFor('congrats')).toBeNull();
    expect(voiceKeyFor('bank-first')).toBeNull();
    expect(voiceKeyFor('quiet')).toBeNull();
  });

  it('plays the clip saying the words on screen, else one of the moment’s, the same everywhere', () => {
    const audio: AudioManifest = {
      voice: { 'bid-900': ['a.ogg', 'b.ogg', 'c.ogg'] },
      text: { 'a.ogg': 'REDO 900, I see 900', 'b.ogg': 'We have 900', 'c.ogg': '900' },
    };
    const cue = (text: string, pick: number): Cue => ({
      id: 'x',
      at: 0,
      kind: 'voice',
      key: 'bid-900',
      text,
      pick,
    });
    expect(wordsKey('$900, I see $900.')).toBe(wordsKey('REDO 900, I see 900'));
    expect(voiceClip(audio, cue('We have $900.', 5))).toBe('b.ogg');
    expect(voiceClip(audio, cue('$900!', 2))).toBe('c.ogg');
    expect(voiceClip(audio, cue('Nine hundred, sir.', 4))).toBe('b.ogg');
    expect(voiceClip(audio, { ...cue('x', 0), key: 'nothing' })).toBeNull();
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
});
