import { type PlayerColor, createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { goingOnce } from './definition.ts';
import { HOST, SQUIGGLE, bid, game, hammer, harness, nextLot, pastIntro } from './test-utils.ts';
import type { GoingOnceState } from './types.ts';
import { CHANT_GAP_MS, CLIP_GAP_MS, chantKey, clipTimes, clipsMs } from './voice.ts';
import { BID_SETTLE_MS } from './types.ts';
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

describe('the spoken introduction, in the original’s order', () => {
  it('opens every voiced game with the welcome over an open drawing; the clock starts after it', () => {
    const h = voicedGame(3);
    const g = game(h);
    expect(g.stage).toBe('draw');
    expect(keys(h.state)).toEqual([
      'greeting',
      'welcome',
      'guest-error',
      'guest-count-3',
      'guest-tease',
      'need-art',
      'titles-sent',
      'draw-instructions',
      'draw-craft',
      'artist-cut',
      'draw-hurry',
      'two-drawings',
    ]);
    // The instructions never eat the drawing time: its clock starts once they are said.
    const said = clipsMs(g.host!.clips!);
    expect(g.drawStart).toBe(h.now + said);
    expect(g.until).toBe(h.now + said + 90_000 + 2500);
    // Drawing is open from the start.
    h.act('p1', { type: 'draw', item: g.prompts.p1![0]!, drawing: SQUIGGLE });
  });

  it('gives the tutorial after the drawing, which anyone at the table can skip', () => {
    const h = voicedGame(4);
    drawEverything(h);
    const g = game(h);
    expect(g.stage).toBe('intro');
    expect(keys(h.state)).toEqual(
      expect.arrayContaining(['tutorial-start', 'auction-count-4', 'first-message', 'how-to-win']),
    );
    // Lot 1's tips go out with it ("you should have your first message now").
    for (const id of g.order) expect(g.players[id]!.messages).toHaveLength(1);
    h.act('p3', { type: 'skip-intro' });
    const v = goingOnce.view(h.state, 'p2').game!;
    expect(v.stage).toBe('auction');
    expect(v.introSkipped).toBe(true);
    expect(keys(h.state)[0]).toBe('skipped');
    // Lot 1 doesn't send them again.
    for (const id of game(h).order) expect(game(h).players[id]!.messages).toHaveLength(1);
    expect(h.refuse(HOST, { type: 'skip-intro' }).code).toBe('no-intro');
  });

  it('spares regulars the instructions and the tutorial; nothing at all with the voice off', () => {
    const quiet = voicedGame(3, 5, false);
    expect(game(quiet).stage).toBe('draw');
    expect(game(quiet).voiced).toBe(false);
    expect(game(quiet).host).toBeNull();
    const h = voicedGame(3);
    h.act(HOST, { type: 'back-to-lobby' });
    h.act(HOST, { type: 'start' });
    expect(game(h).stage).toBe('draw');
    expect(keys(h.state).slice(0, 1)).toEqual(['greeting']);
    expect(keys(h.state).at(-1)).toBe('later-game');
    expect(keys(h.state)).not.toContain('draw-hurry');
    drawEverything(h);
    expect(game(h).stage).toBe('auction');
  });

  it('starts a redraw’s clock once he has asked again, and to hurry', () => {
    const h = voicedGame(3);
    for (let i = 0; i < 3; i++) h.tick();
    const g = game(h);
    expect(g.redraws).toBe(1);
    expect(keys(h.state)).toEqual([
      'time-up',
      'no-art',
      'no-art-worry',
      'new-titles',
      'draw-hurry',
    ]);
    expect(g.drawStart).toBe(h.now + clipsMs(g.host!.clips!));
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
  drawEverything(h);
  h.act(HOST, { type: 'skip-intro' });
  pastIntro(h);
  return h;
}

describe('the voiced auction', () => {
  it('opens with the opening line and a chant, then the original’s pause', () => {
    const h = voicedAuction();
    const a = game(h).auction!;
    expect(a.close).toBe('open');
    const ks = keys(h.state);
    // Lot 1's "The first item up for bid" came with its number, before the picture.
    expect(ks[0]).toBe('opening');
    expect(ks[1]).toMatch(/^chant(-long)?-400$/);
    expect(a.closeAt).toBe(h.now + clipsMs(game(h).host!.clips!) + CHANT_GAP_MS);
  });

  it('runs a bid’s quiet stretch as the paddle going up, the chant asking for the next and 1 s', () => {
    const h = voicedAuction();
    bid(h, 'p2', 600);
    const clips = game(h).host!.clips!;
    // No "We have $600" (the original says the amount only after a forced bid): a second for
    // the paddle, then the chant tagged nextBidTag (the bid + $100).
    expect(clips).toHaveLength(1);
    expect(clips[0]!.key).toMatch(/^chant(-long)?-700$/);
    expect(clips[0]!.wait).toBe(BID_SETTLE_MS);
    expect(clips[0]!.ms).toBe(VOICE_MS[clips[0]!.key]![clips[0]!.i]);
    expect(game(h).auction!.closeAt).toBe(h.now + BID_SETTLE_MS + clips[0]!.ms + CHANT_GAP_MS);
  });

  it('chants for the next ask by its amount, and the high chant above the recordings', () => {
    const rng = createRng(3);
    for (let i = 0; i < 20; i++) {
      expect(chantKey(4000, rng)).toMatch(/^chant(-long)?-4000$/);
      expect(chantKey(4100, rng)).toMatch(/^chant(-long)?-high$/);
    }
  });

  it('restarts from the new amount when a bid comes mid-chant', () => {
    const h = voicedAuction();
    bid(h, 'p2', 400);
    const first = game(h).host!.id;
    h.wait(3000);
    bid(h, 'p3', 700);
    const host = game(h).host!;
    expect(host.id).not.toBe(first);
    expect(host.clips![0]!.key).toMatch(/^chant(-long)?-800$/);
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
    // The forced bid's chant asks for the next one too.
    expect(clips[2]!.key).toMatch(/^chant(-long)?-600$/);
  });
});

describe('the voiced clock around a screw', () => {
  it('holds the bidding through the failure line, then a fresh chant for the bid on the table', () => {
    const h = voicedAuction(4, 6);
    while (game(h).auction!.lot < game(h).lots.length / 2) {
      hammer(h);
      nextLot(h);
    }
    const s = structuredClone(h.state);
    s.game!.players.p3!.cash = 300;
    h.state = s;
    bid(h, 'p1', 600);
    h.act('p1', { type: 'screw' });
    h.wait(3000);
    const at = h.now;
    h.act('p1', { type: 'screw-pick', target: 'p3' });
    const a = game(h).auction!;
    const clips = game(h).host!.clips!;
    expect(clips[0]!.key).toBe('screw-fail');
    expect(clips[1]!.key).toMatch(/^chant(-long)?-700$/);
    expect(a.pausedUntil).toBe(at + clips[0]!.ms + CLIP_GAP_MS);
    expect(a.closeAt).toBe(at + clipsMs(clips) + CHANT_GAP_MS);
    expect(a.close).toBe('quiet');
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
    // The beats follow the lines, in the original's order: the artist as they are named, the
    // value once "Let's see how much … can sell this for" is said, PROFIT/LOSS a spin and a
    // second later, and the remark only after it (a silence while it lands).
    const clips = g.host!.clips!;
    const times = clipTimes({ at: 0, clips });
    const beats = g.soldBeats!;
    if (item.artist) {
      const named = clips.findIndex((c) => c.key.startsWith('artist-call-'));
      expect(beats.artist).toBe(times[named]);
    }
    const resell = clips.findIndex((c) => c.key.startsWith('resell-'));
    expect(beats.value).toBe(times[resell]! + clips[resell]!.ms + 300);
    expect(beats.profit).toBe(beats.value + 1200 + 1000);
    expect(times[resell + 1]).toBe(beats.profit + 300);
  });

  it('keeps lot 1’s explanations to lot 1, and later remarks to the original’s $200 line', () => {
    const h = voicedAuction(3, 7);
    // Lot 1 to someone not its artist, then lot 2 likewise.
    for (const lot of [0, 1]) {
      const g = game(h);
      const item = g.items[g.lots[lot]!]!;
      const buyer = ['p1', 'p2', 'p3'].find((p) => p !== item.artist)!;
      // A $300 profit: lot 1 says nothing about it, later lots call it a windfall.
      const s = structuredClone(h.state);
      s.game!.items[s.game!.lots[lot]!]!.value = 700;
      h.state = s;
      bid(h, buyer, 400);
      hammer(h);
      const ks = keys(h.state);
      if (lot === 0) {
        expect(ks).toContain('segue-resell');
        expect(ks).not.toContain('windfall');
        expect(ks).toContain('tally');
      } else {
        for (const k of ['reveal-artist', 'commission-explain', 'segue-resell', 'tally'])
          expect(ks).not.toContain(k);
        expect(ks.some((k) => /^(artist-call|resell|buyer-keeps)-/.test(k))).toBe(false);
        expect(ks).toContain('windfall');
        expect(ks.at(-1)).toBe('moving-on');
        // Lots 2+: the artist's paddle turns right after the congratulations, the commission is
        // paid, then the value.
        const g2 = game(h);
        if (item.artist) expect(g2.soldBeats!.value).toBe(g2.soldBeats!.artist! + 750 + 1000);
      }
      nextLot(h);
    }
  });

  it('says only the quip for an unsold lot, and both no-bid lines on lot 1', () => {
    const h = voicedAuction(3, 7);
    h.tick();
    expect(keys(h.state).slice(0, 2)).toEqual(['no-bids-1', 'no-bids-first']);
    hammer(h);
    expect(keys(h.state)).toEqual(['unsold']);
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
        // The remarks come the first time only; later the paddle just turns.
        if (ks.includes('own-art-explain')) {
          told++;
          expect(ks.some((k) => /^own-art-(red|yellow|blue)$/.test(k))).toBe(true);
        } else expect(ks.some((k) => k.startsWith('own-art'))).toBe(false);
      } else hammer(h);
      nextLot(h);
    }
    expect(told).toBe(1);
  });

  it('calls out each kind at most once a game, the only player without art first', () => {
    const h = voicedAuction(3, 9);
    const said: string[] = [];
    while (h.state.phase === 'playing') {
      if (game(h).stage === 'auction' && game(h).auction!.close === 'open')
        said.push(...keys(h.state).filter((k) => k === 'quiet' || k === 'no-art-yet'));
      if (
        game(h).stage === 'auction' &&
        game(h).auction!.close !== 'intro' &&
        !game(h).auction!.bid &&
        game(h).players.p1!.cash >= 400
      )
        bid(h, 'p1', 400);
      else if (game(h).stage === 'bank')
        for (const id of game(h).order)
          if (!game(h).bankDone.includes(id)) h.act(id, { type: 'loan', take: false });
      if (h.state.phase === 'playing') h.tick();
    }
    // p1 buys everything: p2 and p3 have no art (so no "only player without"), and one of them
    // is called quiet once at most.
    expect(said.filter((k) => k === 'quiet').length).toBeLessThanOrEqual(1);
    expect(said.filter((k) => k === 'no-art-yet').length).toBeLessThanOrEqual(1);
  });

  it('lets the bank’s phone ring before the line', () => {
    const h = voicedAuction(3, 7);
    const s = structuredClone(h.state);
    // Low enough to stay under $1,000 with a commission.
    for (const id of ['p2', 'p3']) s.game!.players[id]!.cash = 500;
    h.state = s;
    bid(h, 'p1', 400);
    for (let i = 0; i < 20 && game(h).stage !== 'bank'; i++) h.tick();
    expect(game(h).stage).toBe('bank');
    const first = game(h).host!.clips![0]!;
    expect(first.key).toBe('bank-first');
    expect(first.wait).toBe(2200);
  });

  it('calls out a quiet bidder with their colour first', () => {
    const h = voicedAuction(3, 9);
    for (let i = 0; i < 3; i++) {
      pastIntro(h);
      bid(h, 'p1', 400);
      hammer(h);
      // On to the next lot's opening, where call-outs are said (as the picture goes up).
      while (!(game(h).stage === 'auction' && game(h).auction!.close === 'open')) h.tick();
    }
    const remarks = keys(h.state);
    // p2 and p3 haven't bid for four lots: one of them is called out, before the opening.
    expect(remarks.some((k) => /^lead-(yellow|blue)$/.test(k))).toBe(true);
    expect(remarks).toContain('quiet');
  });
});
