import { type Moment, type Rig, schedule } from '@vt/game-sdk/show';
import { describe, expect, it } from 'vitest';
import { sketchy } from '../logic/definition.ts';
import type { harness } from '../logic/test-utils.ts';
import {
  HOST,
  SQUIGGLE,
  drawAll,
  game,
  lieAll,
  started,
  turn,
  truthIndex,
  writing,
} from '../logic/test-utils.ts';
import type { SketchyView, TurnView } from '../logic/types.ts';
import {
  type ShowCtx,
  answersOf,
  moments,
  reactionOf,
  phaseOf,
  revealEndOf,
  seenKeys,
  slotOf,
} from './show.ts';

// The show's moments are pure: built from real views (the game's own harness), the same for
// every device, and they never say more than the view they come from.

const PARTS = {
  card: ['card-bubble', 'card-ramp'],
  chooser: ['chooser-playerName', 'chooser-points'],
  author: ['author-tf'],
};
const ctx = (over: Partial<ShowCtx> = {}): ShowCtx => ({
  you: null,
  profile: 'stage',
  seen: {},
  parts: PARTS,
  ...over,
});
const tracks: Rig['tracks'] = {};
const ids = (list: Moment[]) => list.map((m) => m.id);
const clips = (list: Moment[]) =>
  list.flatMap((m) => m.steps.flatMap((s) => (s.kind === 'sfx' ? [s.clip] : [])));
const viewOf = (h: ReturnType<typeof harness>, who: string | null): SketchyView =>
  sketchy.view(h.state, who);

/** Plays the first drawing through: every lie in, every vote cast (the truth by p2). */
function revealed() {
  const h = writing();
  lieAll(h);
  const t = turn(h);
  for (const id of t.voters) {
    const truth = truthIndex(h);
    const other = t.options.findIndex((o) => !o.truth && !o.authors.includes(id));
    h.act(id, { type: 'vote', option: id === t.voters[0] ? truth : other });
  }
  return h;
}

describe('moments', () => {
  it('opens drawing time on the server clock, with stable ids, and a 3-2-1 only in round 1', () => {
    const h = started();
    const v = viewOf(h, null);
    const list = moments(v, ctx());
    const draw = list.find((m) => m.id.startsWith('draw:'))!;
    expect(draw.at).toBe(v.game!.since);
    expect(
      draw.steps.some((s) => s.kind === 'anim' && s.track === 'count-d3.GameStartAppear'),
    ).toBe(true);
    expect(moments(viewOf(h, null), ctx())).toEqual(list);
    expect(phaseOf(v)).toBe('draw');
  });

  it('finishes a pencil with that player’s own yelp when their drawing arrives', () => {
    const h = started();
    h.act('p2', { type: 'draw', drawing: SQUIGGLE });
    const v = viewOf(h, null);
    expect(seenKeys(v)).toContain('drawn:1:p2');
    const at = 5_000_000;
    const list = moments(v, ctx({ seen: { 'drawn:1:p2': at } }));
    const sent = list.find((m) => m.id === 'drawn:1:p2')!;
    expect(sent.at).toBe(at);
    expect(clips([sent])).toContain(`yelp#${slotOf(v, 'p2')}`);
    // Their own phone gets its own cue too, never the table screen.
    const steps = schedule(sent, at, {
      profile: 'stage',
      you: null,
      reduced: false,
      low: false,
      tracks,
    });
    expect(steps.some((s) => s.step.kind === 'sfx' && s.step.clip.startsWith('me:'))).toBe(false);
  });

  it('gives the last drawer and the last writer their own cues after the table moved on', () => {
    const h = started();
    const last = game(h).players.at(-1)!;
    drawAll(h);
    // Writing already: the last drawer's "sent" still sounds on their phone, first seen now.
    const v = viewOf(h, last);
    expect(v.game!.stage).toBe('write');
    expect(seenKeys(v)).toContain('sent:1');
    const at = 7_000_000;
    const phone: Parameters<typeof schedule>[2] = {
      profile: 'phone-quiet',
      you: last,
      reduced: false,
      low: true,
      tracks,
    };
    const sent = moments(
      v,
      ctx({ you: last, profile: 'phone-quiet', seen: { 'sent:1': at } }),
    ).find((m) => m.id === 'sent:1')!;
    expect(sent.at).toBe(at);
    expect(schedule(sent, at, phone).map((s) => s.step.kind === 'sfx' && s.step.clip)).toContain(
      'me:sent',
    );
    // Nobody else's view says they sent one.
    expect(viewOf(h, null).game!.sentDrawing).toBe(false);
    // The last title in starts the picking: the writer's break and yelp still sound there.
    const writer = turn(h).writers.at(-1)!;
    lieAll(h);
    const w = viewOf(h, writer);
    expect(w.game!.stage).toBe('vote');
    const key = seenKeys(w).find((k) => k.startsWith('mylie:'))!;
    const lie = moments(w, ctx({ you: writer, profile: 'phone-quiet', seen: { [key]: at } })).find(
      (m) => m.id === key,
    )!;
    expect(clips([lie])).toEqual(['me:break', `me:yelp#${slotOf(w, writer)}`]);
    // Both play on the battery saver too.
    expect(
      schedule(lie, at, { ...phone, you: writer }).filter((s) => s.step.kind === 'sfx'),
    ).toHaveLength(2);
  });

  it('finishes the last pencil, breaks the last title’s pencil and ticks the last pick on the table screen after the table moved on', () => {
    const at = 9_000_000;
    const stage: Parameters<typeof schedule>[2] = {
      profile: 'stage',
      you: null,
      reduced: false,
      low: false,
      tracks,
    };
    const sounds = (v: SketchyView, key: string, id = key) => {
      const m = moments(v, ctx({ seen: { [key]: at } })).find((x) => x.id === id);
      expect(m?.at).toBe(at);
      return schedule(m!, at, stage).flatMap((s) => (s.step.kind === 'sfx' ? [s.step.clip] : []));
    };
    const h = started();
    const last = game(h).players.at(-1)!;
    drawAll(h);
    // Writing already, and the table screen first hears of the last drawing now.
    const w = viewOf(h, null);
    expect(w.game!.stage).toBe('write');
    expect(seenKeys(w)).toContain(`drawn:1:${last}`);
    expect(sounds(w, `drawn:1:${last}`)).toEqual(['draw.break', `yelp#${slotOf(w, last)}`]);
    // Picking already: the last title's pencil still breaks.
    lieAll(h);
    const v = viewOf(h, null);
    expect(v.game!.stage).toBe('vote');
    const titles = v.game!.turn!.titles;
    expect(titles).toBe(turn(h).writers.length);
    const key = seenKeys(v).find((k) => k.startsWith('write:') && k.endsWith(`:${titles - 1}`))!;
    expect(sounds(v, key)).toEqual(['write.break']);
    // The reveal already: the last pick still ticks.
    const r = viewOf(revealed(), null);
    expect(r.game!.stage).toBe('reveal');
    const picks = seenKeys(r).filter((k) => k.startsWith('vote:'));
    expect(picks).toHaveLength(turn(h).voters.length);
    const lastPick = picks.at(-1)!;
    expect(sounds(r, lastPick, lastPick.replace('vote:', 'voted:'))).toEqual(['vote.tick']);
  });

  it('names the game’s last drawing and a single missing one, with an announcer that can', () => {
    const v = viewOf(writing(), null);
    const g = v.game!;
    const t = g.turn!;
    const at = (game: typeof g, c: ShowCtx) =>
      clips(moments({ ...v, game }, c)).filter((k) => k.startsWith('voice:turn.'));
    // The last drawing of the last round.
    const last = { ...g, round: g.rounds, turn: { ...t, number: t.of, of: t.of } };
    if (t.of > 1) {
      expect(at(last, ctx({ hasLine: () => true }))[0]).toMatch(/^voice:turn\.last#/);
      expect(at(last, ctx({ hasLine: () => false }))[0]).toMatch(/^voice:turn\.next#/);
    }
    // One drawing short at the start of a round.
    const short = { ...g, turn: { ...t, number: 1, of: g.players.length - 1 } };
    expect(at(short, ctx({ hasLine: () => true }))[0]).toMatch(/^voice:turn\.missedOne#/);
    expect(at(short, ctx({ hasLine: () => false }))[0]).toMatch(/^voice:turn\.missed#/);
  });

  it('never tells the table screen what only the artist knows before the reveal', () => {
    const h = writing();
    const t = turn(h);
    const prompt = game(h).sketches[t.artist]!.prompt.text;
    for (const who of [null, ...Object.keys(h.state.seats)]) {
      const v = viewOf(h, who);
      const json = JSON.stringify(
        moments(v, ctx({ you: who, profile: who ? 'phone-quiet' : 'stage' })),
      );
      if (who !== t.artist) expect(json).not.toContain(prompt);
      expect(json).not.toContain(`{p:${t.artist}}`);
    }
  });

  it('breaks a pencil per lie in, and only the writer’s own phone hears theirs', () => {
    const h = writing();
    const writer = turn(h).writers[0]!;
    h.act(writer, { type: 'lie', text: 'a fake one' });
    const v = viewOf(h, writer);
    const keys = seenKeys(v);
    expect(keys).toEqual(
      expect.arrayContaining([expect.stringMatching(/^write:1:1:0$/), 'mylie:1:1']),
    );
    const list = moments(v, ctx({ you: writer, profile: 'phone-quiet' }));
    expect(ids(list)).toEqual(expect.arrayContaining(['write:1:1:0', 'mylie:1:1']));
    const stageList = moments(viewOf(h, null), ctx());
    expect(ids(stageList)).not.toContain('mylie:1:1');
  });

  it('turns the answers over one per step from the reveal’s start, the truth last with its artist', () => {
    const h = revealed();
    const v = viewOf(h, null);
    const t = v.game!.turn!;
    expect(t.revealAt).not.toBeNull();
    const list = moments(v, ctx());
    const steps = list.filter((m) => m.id.startsWith('rv:'));
    expect(steps[0]!.at).toBe(t.revealAt);
    const last = steps.at(-1)!;
    expect(last.steps).toContainEqual(
      expect.objectContaining({ target: 'artist.name', text: `{p:${t.artist}}` }),
    );
    expect(last.steps).toContainEqual(
      expect.objectContaining({ target: 'card', attr: 'data-face', value: 'truth' }),
    );
    const board = list.find((m) => m.id.startsWith('board:'))!;
    expect(board.at).toBe(revealEndOf(t));
  });

  it('gives each answer its points: the truth to its finders, a lie to its authors', () => {
    const h = revealed();
    const t = viewOf(h, null).game!.turn!;
    const answers = answersOf(t);
    const truth = answers.find((a) => a.truth)!;
    for (const id of truth.voters) expect(truth.points[id]).toBeGreaterThanOrEqual(1000);
    for (const a of answers.filter((a) => !a.truth && !a.house && a.voters.length))
      for (const id of a.authors) expect(a.points[id]).toBeGreaterThan(0);
  });

  it('says the joke for the prompt once it is out, only when the voice has one', () => {
    const h = revealed();
    const v = viewOf(h, null);
    const prompt = v.game!.turn!.prompt!;
    const withJoke = moments(
      v,
      ctx({ jokeFor: (p) => (p === prompt ? { file: 'audio/jokes/x.ogg', ms: 3000 } : null) }),
    );
    expect(clips(withJoke)).toContain('joke:audio/jokes/x.ogg');
    expect(clips(moments(v, ctx())).some((c) => c.startsWith('joke:'))).toBe(false);
  });

  it('has the announcer react to how the picks went, with a line it has', () => {
    // Options as the reveal sees them: the truth, two players' titles and a house title.
    const turnOf = (truth: string[], a: string[], b: string[], house: string[] = []) =>
      ({
        options: [
          { index: 0, truth: true, voters: truth },
          { index: 1, voters: a, authors: ['p8'] },
          { index: 2, voters: b, authors: ['p9'] },
          { index: 3, house: true, voters: house },
        ],
      }) as unknown as TurnView;
    const all = () => true;
    expect(reactionOf(turnOf([], ['p1', 'p2', 'p3'], []), all)).toBe('reveal.sameWay');
    expect(reactionOf(turnOf([], [], [], ['p1', 'p2']), all)).toBe('reveal.allDecoy');
    expect(reactionOf(turnOf(['p1', 'p2', 'p3'], [], []), all)).toBe('reveal.allRight');
    expect(reactionOf(turnOf([], ['p1'], ['p2', 'p3']), all)).toBe('reveal.allWrong');
    expect(reactionOf(turnOf(['p1'], ['p2'], ['p3']), all)).toBe('reveal.oneRight');
    expect(reactionOf(turnOf(['p1', 'p2', 'p3'], ['p4'], []), all)).toBe('reveal.oneWrong');
    expect(reactionOf(turnOf(['p1', 'p2'], ['p3', 'p4'], []), all)).toBe('reveal.fooled');
    expect(reactionOf(turnOf(['p1', 'p2'], [], [], ['p3', 'p4']), all)).toBe('reveal.done');
    // One picker is no crowd.
    expect(reactionOf(turnOf([], ['p1'], []), all)).toBeNull();
    // An announcer without the most telling line says the next one it has, or nothing.
    const only =
      (...keys: string[]) =>
      (k: string) =>
        keys.includes(k);
    expect(reactionOf(turnOf([], ['p1', 'p2', 'p3'], []), only('reveal.allWrong'))).toBe(
      'reveal.allWrong',
    );
    expect(reactionOf(turnOf(['p1', 'p2', 'p3'], [], []), only('reveal.sameWay'))).toBeNull();
  });

  it('waits on a reaction only when the announcer will say one', () => {
    const h = revealed();
    const v = viewOf(h, null);
    const boardAt = (c: ShowCtx) => {
      const board = moments(v, c).find((m) => m.id.startsWith('board:'))!;
      return board.steps.find((s) => s.kind === 'sfx' && s.clip === 'board.on')!.t;
    };
    const quiet = boardAt(ctx({ hasLine: () => false }));
    const talking = boardAt(ctx({ hasLine: () => true }));
    expect(talking).toBeGreaterThan(quiet);
    const reaction = (c: ShowCtx) =>
      clips(moments(v, c)).filter((k) =>
        /^voice:reveal\.(sameWay|allDecoy|allRight|allWrong|oneRight|oneWrong|fooled|done)#/.test(
          k,
        ),
      );
    expect(reaction(ctx({ hasLine: () => true }))).toHaveLength(1);
    expect(reaction(ctx({ hasLine: () => false }))).toHaveLength(0);
  });

  it('lets a device arriving after the reveal land on the board, not replay the steps', () => {
    const h = revealed();
    const v = viewOf(h, null);
    const list = moments(v, ctx());
    const late = revealEndOf(v.game!.turn!)! + 60_000;
    for (const m of list.filter((m) => m.id.startsWith('rv:'))) {
      const played = schedule(m, late, {
        profile: 'stage',
        you: null,
        reduced: false,
        low: false,
        tracks,
      });
      expect(played.every((s) => s.mode === 'end')).toBe(true);
      expect(played.some((s) => s.step.kind === 'sfx')).toBe(false);
    }
  });

  it('keeps a quiet phone to its own cues: no art moves there', () => {
    const h = revealed();
    const voter = turn(h).voters[1]!;
    const v = viewOf(h, voter);
    for (const m of moments(v, ctx({ you: voter, profile: 'phone-quiet' }))) {
      const played = schedule(m, m.at + 1400, {
        profile: 'phone-quiet',
        you: voter,
        reduced: false,
        low: false,
        tracks,
      });
      expect(played.some((s) => s.step.kind === 'anim')).toBe(false);
    }
  });

  it('runs the clock as the original: drawing time only says hurry, writing stings every 5 s', () => {
    const h = started();
    const v = viewOf(h, null);
    const left = (view: SketchyView) =>
      moments(view, ctx())
        .filter((m) => m.id.startsWith('clock:'))
        .map((m) => view.game!.deadline! - m.at);
    expect(left(v)).toEqual([35_000]);
    const w = writing();
    expect(left(viewOf(w, null)).sort((a, b) => a - b)).toEqual([
      0, 5_000, 10_000, 10_000, 15_000, 20_000, 25_000, 30_000, 35_000,
    ]);
    h.act(HOST, { type: 'back-to-lobby' });
    h.act(HOST, { type: 'update-settings', drawSeconds: null });
    h.act(HOST, { type: 'start' });
    expect(moments(viewOf(h, null), ctx()).filter((m) => m.id.startsWith('clock:'))).toEqual([]);
  });

  it('crowns the most liked at the end and bursts for the winner', () => {
    const h = revealed();
    const t = turn(h);
    const liker = t.voters[1]!;
    const liked = t.options.findIndex(
      (o) => !o.truth && !o.house && !o.authors.includes(liker) && o.authors.length,
    );
    h.act(liker, { type: 'like', option: liked, on: true });
    // Finish quickly: the host ends the game.
    while (h.state.phase === 'playing') {
      const g = game(h);
      if (g.stage === 'reveal') h.act(HOST, { type: 'next' });
      else if (g.stage === 'draw') drawAll(h);
      else if (g.stage === 'write') lieAll(h);
      else for (const id of turn(h).voters) h.act(id, { type: 'vote', option: truthIndex(h) });
    }
    const v = viewOf(h, null);
    const [end] = moments(v, ctx({ seen: { [seenKeys(v)[0]!]: 9_000_000 } }));
    expect(end!.at).toBe(9_000_000);
    expect(end!.steps.some((s) => s.kind === 'anim' && s.target === 'crown')).toBe(true);
    expect(clips([end!])).toContain('end.tada');
  });
});
