import type { PlayerColor } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { goingOnce } from './definition.ts';
import { HOST, SQUIGGLE, bid, game, hammer, harness, nextLot, pastIntro } from './test-utils.ts';
import type { GoingOnceState } from './types.ts';
import { CHANT_GAP_MS, CLIP_GAP_MS, clipsMs } from './voice.ts';
import { VOICE_MS } from './voice-lengths.ts';

const COLORS: PlayerColor[] = ['red', 'yellow', 'blue', 'green'];

/** A table with room colours, the voice on (unless `voice` is false), started. */
function voicedGame(n = 3, seed = 5, voice = true) {
  const h = harness(n, seed);
  for (let i = 0; i < n; i++)
    h.state = goingOnce.playerJoined(h.state, {
      id: `p${i + 1}`,
      name: `P${i + 1}`,
      color: COLORS[i]!,
    });
  h.act(HOST, { type: 'update-settings', pace: 'normal', practice: false, voice });
  h.act(HOST, { type: 'start' });
  return h;
}

const keys = (s: GoingOnceState) => s.game!.host?.clips?.map((c) => c.key) ?? [];

function drawEverything(h: ReturnType<typeof harness>) {
  const g = game(h);
  for (const id of g.order)
    for (const item of g.prompts[id]!) h.act(id, { type: 'draw', item, drawing: SQUIGGLE });
}

describe('the spoken introduction', () => {
  it('opens a voiced room’s first game, lasting as long as it is said', () => {
    const h = voicedGame(3);
    const g = game(h);
    expect(g.stage).toBe('intro');
    expect(keys(h.state).slice(0, 4)).toEqual([
      'greeting',
      'welcome',
      'guest-error',
      'guest-count-3',
    ]);
    expect(keys(h.state)).toContain('auction-count-3');
    expect(keys(h.state)).not.toContain('charade');
    expect(g.until).toBe(h.now + clipsMs(g.host!.clips!) + 500);
    expect(g.host!.ms).toBe(clipsMs(g.host!.clips!));
    h.tick();
    expect(game(h).stage).toBe('draw');
    expect(keys(h.state)[0]).toBe('titles-sent');
  });

  it('can be skipped by the host only, for everyone', () => {
    const h = voicedGame(4);
    expect(keys(h.state)).toContain('guest-count-4');
    expect(h.refuse('p2', { type: 'skip-intro' }).code).toBe('not-host');
    h.act(HOST, { type: 'skip-intro' });
    const v = goingOnce.view(h.state, 'p3').game!;
    expect(v.stage).toBe('draw');
    expect(v.introSkipped).toBe(true);
    expect(keys(h.state)[0]).toBe('skipped');
    expect(h.refuse(HOST, { type: 'skip-intro' }).code).toBe('no-intro');
  });

  it('is left out with the voice off, and in a room’s later games', () => {
    const quiet = voicedGame(3, 5, false);
    expect(game(quiet).stage).toBe('draw');
    expect(game(quiet).voiced).toBe(false);
    expect(game(quiet).host).toBeNull();
    const h = voicedGame(3);
    h.act(HOST, { type: 'skip-intro' });
    h.act(HOST, { type: 'back-to-lobby' });
    h.act(HOST, { type: 'start' });
    expect(game(h).stage).toBe('draw');
    expect(keys(h.state)[0]).toBe('later-game');
  });

  it('isn’t voiced when sound is off, whatever the voice switch says', () => {
    const h = harness(3);
    h.act(HOST, { type: 'update-settings', voice: true, sound: 'off', practice: false });
    h.act(HOST, { type: 'start' });
    expect(game(h).voiced).toBe(false);
    expect(game(h).stage).toBe('draw');
  });
});

/** A voiced game at lot 1's opening (the intro skipped, everything drawn). */
function voicedAuction(n = 3, seed = 5) {
  const h = voicedGame(n, seed);
  h.act(HOST, { type: 'skip-intro' });
  drawEverything(h);
  pastIntro(h);
  return h;
}

describe('the voiced auction', () => {
  it('opens with the opening line and a chant, then the original’s pause', () => {
    const h = voicedAuction();
    const a = game(h).auction!;
    expect(a.close).toBe('open');
    const ks = keys(h.state);
    expect(ks.slice(0, 2)).toEqual(['opening-first', 'opening']);
    expect(ks[2]).toMatch(/^chant(-long)?-400$/);
    expect(a.closeAt).toBe(h.now + clipsMs(game(h).host!.clips!) + CHANT_GAP_MS);
  });

  it('runs a bid’s quiet stretch as its amount line, a chant for it and 1 s', () => {
    const h = voicedAuction();
    bid(h, 'p2', 600);
    const clips = game(h).host!.clips!;
    expect(clips[0]!.key).toBe('bid-600');
    expect(clips[1]!.key).toMatch(/^chant(-long)?-600$/);
    expect(clips[0]!.ms).toBe(VOICE_MS['bid-600']![clips[0]!.i]);
    expect(game(h).auction!.closeAt).toBe(
      h.now + clips[0]!.ms + CLIP_GAP_MS + clips[1]!.ms + CHANT_GAP_MS,
    );
  });

  it('restarts from the new amount when a bid comes mid-chant', () => {
    const h = voicedAuction();
    bid(h, 'p2', 400);
    const first = game(h).host!.id;
    h.wait(3000);
    bid(h, 'p3', 700);
    const host = game(h).host!;
    expect(host.id).not.toBe(first);
    expect(host.clips![0]!.key).toBe('bid-700');
    expect(game(h).auction!.closeAt).toBe(h.now + clipsMs(host.clips!) + CHANT_GAP_MS);
  });

  it('calls going once and twice for as long as they are said, faster above $1,000', () => {
    const h = voicedAuction();
    bid(h, 'p2', 600);
    h.tick();
    let a = game(h).auction!;
    expect(a.close).toBe('once');
    expect(keys(h.state)).toEqual(['going-once']);
    expect(a.closeAt).toBe(h.now + game(h).host!.clips![0]!.ms + CHANT_GAP_MS);
    h.tick();
    a = game(h).auction!;
    expect(a.close).toBe('twice');
    expect(keys(h.state)).toEqual(['going-twice']);
    nextLot(h);
    bid(h, 'p1', 600);
    bid(h, 'p2', 900);
    bid(h, 'p1', 1100);
    h.tick();
    expect(keys(h.state)).toEqual(['going-once-fast']);
  });

  it('leaves the pace’s timing alone with the voice off', () => {
    const h = voicedGame(3, 5, false);
    drawEverything(h);
    pastIntro(h);
    expect(game(h).auction!.closeAt).toBe(h.now + 8000);
    bid(h, 'p2', 600);
    expect(game(h).auction!.closeAt).toBe(h.now + 4000);
    expect(game(h).host).toBeNull();
  });

  it('says a forced bid to the screwed player by their colour', () => {
    const h = voicedAuction(4, 6);
    while (game(h).auction!.lot < game(h).lots.length / 2) {
      hammer(h);
      nextLot(h);
    }
    bid(h, 'p2', 400);
    h.act('p1', { type: 'screw' });
    expect(game(h).host!.clips![0]).toMatchObject({ key: 'screw-pick-red', player: 'p1' });
    h.act('p1', { type: 'screw-pick', target: 'p3' });
    const clips = game(h).host!.clips!;
    expect(clips[0]).toMatchObject({ key: 'screwed-blue', player: 'p3' });
    expect(clips[1]!.key).toBe('bid-500');
  });
});

describe('the voiced wrap-up of a lot', () => {
  it('congratulates the buyer by colour, reveals the artist, and lasts as long as it takes', () => {
    const h = voicedAuction(3, 7);
    const item = game(h).items[game(h).lots[0]!]!;
    const buyer = ['p1', 'p2', 'p3'].find((p) => p !== item.artist)!;
    bid(h, buyer, 400);
    hammer(h);
    const g = game(h);
    const ks = keys(h.state);
    const color = { p1: 'red', p2: 'yellow', p3: 'blue' }[buyer];
    expect(ks[0]).toBe('sold');
    expect(ks[1]).toBe(`congrats-first-${color}`);
    if (item.artist) {
      expect(ks).toContain('reveal-artist');
      expect(ks.some((k) => k.startsWith('artist-call-'))).toBe(true);
    }
    expect(ks).toContain(`buyer-keeps-${color}`);
    expect(ks.at(-1)).toBe('moving-on');
    expect(g.until).toBe(h.now + Math.max(5000, clipsMs(g.host!.clips!) + 500));
  });

  it('teases a player who bought their own drawing, once explaining the money', () => {
    const h = voicedAuction(3, 8);
    let told = 0;
    while (h.state.phase === 'playing') {
      const g = game(h);
      const item = g.items[g.lots[g.auction!.lot]!]!;
      if (item.artist && g.auction!.close !== 'intro') {
        bid(h, item.artist, 400);
        hammer(h);
        const ks = keys(h.state);
        expect(ks.some((k) => k.startsWith('own-art-'))).toBe(true);
        if (ks.includes('own-art-explain')) told++;
      } else hammer(h);
      nextLot(h);
    }
    expect(told).toBe(1);
  });

  it('calls out a quiet bidder with their colour first', () => {
    const h = voicedAuction(3, 9);
    for (let i = 0; i < 3; i++) {
      pastIntro(h);
      bid(h, 'p1', 400);
      hammer(h);
      // On to the next lot's intro, where call-outs are said (before its opening line).
      while (!(game(h).stage === 'auction' && game(h).auction!.close === 'intro')) h.tick();
    }
    const remarks = keys(h.state);
    // p2 and p3 haven't bid for four lots: one of them is called out.
    expect(remarks.some((k) => /^lead-(yellow|blue)$/.test(k))).toBe(true);
    expect(remarks).toContain('quiet');
  });
});
