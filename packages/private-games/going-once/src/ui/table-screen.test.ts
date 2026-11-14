import { type PlayerColor, clone } from '@vt/game-sdk';
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
} from '../logic/test-utils.ts';
import { SLIDE_ONE_MS, TUTORIAL_END_MS } from '../logic/types.ts';
import { clipTimes } from '../logic/voice.ts';
import {
  CREDITS_MS,
  END_PLAYER_IN_MS,
  END_PLAYER_OUT_MS,
  LOBBY,
  LOGO_SHRINK_MS,
  WINNER_OUT_MS,
  effectCues,
  endBeats,
  endGroups,
  endTimes,
  lobbyCues,
  musicFor,
  openingTimes,
  tutorialTimes,
} from './audio.ts';
import { DONE_WORDS, moments } from './show.ts';

// The table screen's waves 2 and 3: the opening, the done paddles, the tutorial's projector and
// the end's pace, as the original's flowchart and video time them.

const COLORS: PlayerColor[] = ['red', 'yellow', 'blue', 'green'];

function voicedGame(n = 3) {
  const h = harness(n, 5);
  for (let i = 0; i < n; i++)
    h.state = goingOnce.playerJoined(h.state, {
      id: `p${i + 1}`,
      name: `P${i + 1}`,
      color: COLORS[i]!,
    });
  h.act(HOST, { type: 'update-settings', pace: 'normal', voice: true });
  h.act(HOST, { type: 'start' });
  h.tick(); // the 3-2-1
  return h;
}

function drawEverything(h: ReturnType<typeof harness>, skip: string[] = []) {
  const g = game(h);
  h.now = Math.max(h.now, g.drawStart);
  for (const id of g.order.filter((id) => !skip.includes(id)))
    for (const item of g.prompts[id]!) h.act(id, { type: 'draw', item, drawing: SQUIGGLE });
}

const keys = (cues: { key: string }[]) => cues.map((c) => c.key);
const clipAt = (h: ReturnType<typeof harness>, key: string) => {
  const host = game(h).host!;
  return clipTimes(host)[
    host.clips!.findIndex((c) => c.key === key || c.key.startsWith(`${key}-`))
  ]!;
};
const stage = (v: ReturnType<typeof goingOnce.view>) => moments(v, { you: null, profile: 'stage' });

describe('the opening', () => {
  it('keys the logo, the cascade, the sign, the line and the hourglass to the auctioneer', () => {
    const h = voicedGame();
    const v = goingOnce.view(h.state, null);
    const o = openingTimes(v)!;
    expect(o.redraw).toBe(false);
    expect(o.cascade).toBe(clipAt(h, 'guest-tease'));
    expect(o.signIn).toBe(clipAt(h, 'need-art'));
    expect(o.prompt).toBe(clipAt(h, 'draw-instructions'));
    expect(o.timerIn).toBe(clipAt(h, 'two-drawings'));
    expect(o.signOut).toBeLessThan(o.timerIn);
    const cues = effectCues(v, null);
    expect(keys(cues).slice(0, 2)).toEqual(['start', 'chairs']);
    expect(cues.find((c) => c.key === 'sign')!.at).toBe(o.signIn);
    expect(cues.find((c) => c.key === 'timer-in')!.at).toBe(o.timerIn);
  });

  it('springs each player’s paddle up with a word once their drawings are all in', () => {
    const h = voicedGame();
    const g = game(h);
    h.now = Math.max(h.now, g.drawStart);
    for (const item of g.prompts.p1!) h.act('p1', { type: 'draw', item, drawing: SQUIGGLE });
    const v = goingOnce.view(h.state, null);
    const p1 = v.game!.players.find((p) => p.id === 'p1')!;
    expect(p1.doneAt).toBe(h.now);
    expect(v.game!.players.filter((p) => p.doneAt)).toHaveLength(1);
    // A moment of its own (the drawing's has long started), at the moment the drawings are in.
    const done = stage(v).find((m) => m.id === `draw:${v.game!.since}:done:p1`)!;
    expect(done.at).toBe(p1.doneAt);
    const word = done.steps.find((s) => 'target' in s && s.target === 'pad:p1.word');
    expect(DONE_WORDS).toContain(word && 'text' in word ? word.text : '');
    expect(effectCues(v, null).filter((c) => c.key === 'drawing-done')).toHaveLength(1);
    // The paddles go down and the hourglass rises as the drawing ends.
    drawEverything(h, ['p1']);
    const intro = goingOnce.view(h.state, null);
    expect(intro.game!.stage).toBe('intro');
    expect(intro.game!.drawEnded).toBe(h.now);
    expect(keys(effectCues(intro, null).filter((c) => c.id.startsWith('drawEnd:')))).toEqual([
      'paddles-down',
      'timer-out',
    ]);
  });
});

describe('the tutorial on the projector', () => {
  it('brings the 13 slides up with their lines, slide 10 with lot 1’s tips', () => {
    const h = voicedGame();
    drawEverything(h);
    const v = goingOnce.view(h.state, 'p1');
    const t = tutorialTimes(v)!;
    expect(t.dark).toBe(clipAt(h, 'tutorial-start'));
    expect(t.projector).toBe(clipAt(h, 'auction-count') - SLIDE_ONE_MS);
    expect(t.slides).toHaveLength(13);
    for (let i = 1; i < 13; i++) expect(t.slides[i]!).toBeGreaterThan(t.slides[i - 1]!);
    expect(t.slides[9]).toBe(clipAt(h, 'first-message'));
    expect(t.buzz).toBe(v.game!.firstAt);
    expect(t.off).toBe(game(h).until - TUTORIAL_END_MS);
    expect(t.light).toBe(t.off + 400);
    // Its sounds: the projector on, a slide sound each, the buzz, the projector off.
    const cues = effectCues(v, 'p1');
    expect(cues.find((c) => c.key === 'projector-start')!.at).toBe(t.projector);
    expect(cues.filter((c) => c.key === 'slide').map((c) => c.pick)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(cues.find((c) => c.key === 'vibrate')!.at).toBe(t.buzz);
    expect(cues.find((c) => c.key === 'projector-stop')!.at).toBe(t.off);
    // The projector's loop plays only while it is on.
    expect(musicFor(v, t.projector)).toBeNull();
    expect(musicFor(v, t.projector + 500)).toEqual({ key: 'tutorial', pick: 0 });
    expect(musicFor(v, t.off)).toBeNull();
    // At slide 10 the tip arrives, with its ring on the player's own phone.
    h.tick();
    const after = goingOnce.view(h.state, 'p1');
    const ring = effectCues(after, 'p1').find((c) => c.key === 'message')!;
    expect(ring).toMatchObject({ at: after.game!.firstAt, local: true });
    // The projector goes off at once when someone skips.
    h.act('p2', { type: 'skip-intro' });
    expect(keys(effectCues(goingOnce.view(h.state, null), null))).toContain('projector-stop');
    // Lot 1 then opens without the phone's ring: the tips came at slide 10.
    const lot1 = goingOnce.view(h.state, 'p1');
    expect(lot1.game!.tipsEarly).toBe(true);
    expect(keys(effectCues(lot1, 'p1'))).not.toContain('message');
    const opening = stage(lot1).find((m) => m.id.endsWith(':in'))!;
    expect(opening.steps.some((s) => 'target' in s && s.target === 'phone')).toBe(false);
  });

  it('rings lot 1’s tips with lot 1 when the tutorial was skipped before slide 10', () => {
    const h = voicedGame();
    drawEverything(h);
    h.act('p2', { type: 'skip-intro' });
    const lot1 = goingOnce.view(h.state, 'p1');
    expect(lot1.game!.tipsEarly).toBe(false);
    expect(keys(effectCues(lot1, 'p1'))).toContain('message');
    const opening = stage(lot1).find((m) => m.id.endsWith(':in'))!;
    expect(opening.steps.some((s) => 'target' in s && s.target === 'phone')).toBe(true);
  });

  it('dims the room, runs the projector, and buzzes every phone at slide 10', () => {
    const h = voicedGame();
    drawEverything(h);
    const v = goingOnce.view(h.state, null);
    const t = tutorialTimes(v)!;
    const m = stage(v).find((x) => x.id.startsWith('tutorial:'))!;
    const targets = new Set(m.steps.map((s) => ('target' in s ? s.target : '')));
    for (const part of ['walldim', 'projector.glow', 'projector.dust', 'projector.slides', 'skip'])
      expect(targets).toContain(part);
    const phones = moments(v, { you: 'p1', profile: 'phone-quiet' }).find((x) =>
      x.id.startsWith('tutorial:'),
    );
    expect(phones?.steps.find((s) => s.kind === 'haptic')).toMatchObject({ t: t.buzz - m.at });
  });
});

describe('the lobby', () => {
  it('springs the paddles up only once the logo has settled at the top', () => {
    const h = harness(3);
    const v = goingOnce.view(h.state, null);
    const [first, second, late] = v.seats.filter((s) => s.playing).map((s) => s.id) as [
      string,
      string,
      string,
    ];
    const opened = 1000;
    // Two seated before the screen opened, one 300 ms in (during the logo), one long after.
    const joined = { [first]: 0, [second]: opened + 300, [late]: opened + 5000 };
    const list = moments(v, { you: null, profile: 'stage', openedAt: opened, joined });
    const intro = list.find((m) => m.id === `lobby:${opened}`)!;
    const shrink = intro.steps.find((s) => 'track' in s && s.track === 'logo.Shrink')!;
    const settledAt = opened + shrink.t + LOGO_SHRINK_MS;
    const at = (id: string) => list.find((m) => m.id === `login:${id}`)!.at;
    expect(at(first)).toBeGreaterThanOrEqual(settledAt);
    expect(at(second)).toBeGreaterThanOrEqual(settledAt);
    expect(at(late)).toBe(opened + 5000);
    // The yelps come with the paddles.
    const yelps = lobbyCues(v, opened, joined).filter((c) => c.key === 'bidder-voice');
    expect(yelps.map((c) => c.at)).toEqual([at(second) + 100, at(late) + 100]);
  });

  it('drops the logo back and the sign as it opens, and yelps for each newcomer', () => {
    const h = harness(3);
    const v = goingOnce.view(h.state, null);
    const ids = v.seats.filter((s) => s.playing).map((s) => s.id);
    const cues = lobbyCues(v, 1000, { [ids[0]!]: 0, [ids[1]!]: 0, [ids[2]!]: 5000 });
    expect(cues.map((c) => [c.key, c.at])).toEqual([
      ['logo-back', 1000 + LOBBY.logoBack],
      ['sign-drop', 1000 + LOBBY.sign],
      ['bidder-voice', 5100],
    ]);
    // Each paddle's own yelp, as in the game: the shape the player was handed as they joined.
    expect(cues[2]!.pick).toBe(v.seats.find((s) => s.id === ids[2])!.paddle);
    expect(cues[2]!.pick).toBe(h.state.shapes![2]);
    h.act(HOST, { type: 'start' });
    expect(lobbyCues(goingOnce.view(h.state, null), 1000, {})).toEqual([]);
  });
});

describe('the end, at the original’s pace', () => {
  it('times each group’s names, values, fly and slide-away', () => {
    expect(endBeats(3)).toEqual({
      names: [1300, 1750, 2200],
      values: 3200,
      fly: 4700,
      thump: 5200,
      out: 6200,
      len: 7000,
    });
  });

  function ended() {
    const h = auctioning(3, 9);
    while (h.state.phase !== 'over') {
      const a = game(h).auction;
      if (game(h).stage === 'auction' && a && !a.bid) bid(h, game(h).order[a.lot % 3]!, 400);
      hammer(h);
      nextLot(h);
    }
    return goingOnce.view(h.state, null);
  }

  it('brings each buyer in, racks up their groups, then sends them out before the next', () => {
    const v = ended();
    const t = endTimes(v)!;
    const buyers = v.game!.final!.filter((f) => f.bought.length > 0);
    expect(t.players).toHaveLength(buyers.length);
    expect(t.players[0]!.in).toBe(t.start);
    for (const [i, p] of t.players.entries()) {
      const groups = t.groups.filter((g) => g.buyer === i);
      expect(groups[0]!.at).toBe(p.in + END_PLAYER_IN_MS);
      expect(groups.map((g) => g.items)).toEqual(endGroups(buyers[i]!.bought));
      const last = groups.at(-1)!;
      expect(p.out).toBe(last.at + endBeats(last.items.length).len);
      if (t.players[i + 1]) expect(t.players[i + 1]!.in).toBe(p.out + END_PLAYER_OUT_MS);
    }
    expect(t.sum).toBe(t.players.at(-1)!.out + END_PLAYER_OUT_MS);
  });

  it('times the finale: the shark ¾ s into the loan sign on a debt game, then the winner', () => {
    const v = ended();
    const quiet = clone(v);
    for (const f of quiet.game!.final!) f.debt = 0;
    const q = endTimes(quiet)!;
    const last = q.sum + (q.finale.length - 1) * 1000;
    expect(q.debt).toBe(false);
    expect(q.dismiss).toBe(last + 2000);
    expect(keys(effectCues(quiet, null))).not.toContain('debt-shark');
    const debt = clone(v);
    debt.game!.final![0]!.debt = 500;
    const d = endTimes(debt)!;
    expect(d.bankIn).toBe(last + 2000);
    expect(d.debtAt).toBe(d.bankIn + 750);
    expect(d.bankOut).toBe(d.bankIn + 2500);
    expect(d.dismiss).toBe(d.bankIn + 3000);
    expect(d.winner).toBe(d.dismiss + 1500);
    expect(d.winnerOut).toBe(d.winner + WINNER_OUT_MS);
    expect(d.credits).toBe(d.winner + CREDITS_MS);
    expect(effectCues(debt, null).find((c) => c.key === 'debt-shark')!.at).toBe(d.debtAt);
    // The credits come on the projector after the winner leaves.
    const credits = stage(debt).find((m) => m.id.endsWith(':credits'))!;
    const card = credits.steps.find((s) => 'target' in s && s.target === 'credits.card')!;
    expect(credits.at + card.t).toBe(d.credits);
  });
});
