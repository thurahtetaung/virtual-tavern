import { createRng } from '@vt/game-sdk';
import { describe, expect, it } from 'vitest';
import { sketchy } from './definition.ts';
import { lieProblem, liePoints, sameTitle, streakBonus } from './game.ts';
import {
  HOST,
  SQUIGGLE,
  drawAll,
  game,
  harness,
  lieAll,
  lieIndex,
  packContent,
  started,
  truthIndex,
  turn,
  writing,
} from './test-utils.ts';
import { ARTIST_POINTS, FOOL_POINTS, TRUTH_POINTS, roundsFor } from './types.ts';

/** Every voter picks: `truth` find it, the rest pick the first lie that isn't theirs. */
function voteAll(h: ReturnType<typeof harness>, truth: string[]) {
  for (const id of turn(h).voters) {
    const t = turn(h);
    const pick = truth.includes(id)
      ? truthIndex(h)
      : t.options.findIndex((o) => !o.truth && !o.authors.includes(id));
    h.act(id, { type: 'vote', option: pick });
  }
}

describe('setup', () => {
  it('needs 3 players and prompts', () => {
    const h = harness(2);
    expect(h.refuse(HOST, { type: 'start' }).code).toBe('too-few-players');
    const empty = harness(3, 7, packContent([{ prompt: 'only one' }]));
    expect(empty.refuse(HOST, { type: 'start' }).code).toBe('not-enough-prompts');
  });

  it('deals two drawings each, one at a table of 8', () => {
    expect([3, 4, 5, 6, 7, 8].map(roundsFor)).toEqual([2, 2, 2, 2, 2, 1]);
    expect(started(4).state.game!.rounds).toBe(2);
    expect(started(8).state.game!.rounds).toBe(1);
  });

  it('lowercases prompts and leaves adult ones out unless switched on', () => {
    const h = started(4);
    const prompts = Object.values(game(h).sketches).map((s) => s.prompt.text);
    for (const p of [...prompts, ...game(h).pool.map((p) => p.text)]) {
      expect(p).toBe(p.toLowerCase());
      expect(p).not.toContain('grown-up');
    }
    const a = harness(4);
    a.act(HOST, { type: 'update-settings', adult: true });
    a.act(HOST, { type: 'start' });
    const all = [...Object.values(game(a).sketches).map((s) => s.prompt), ...game(a).pool];
    expect(all.some((p) => p.adult)).toBe(true);
  });

  it('fills a player slot with another player’s name', () => {
    const h = harness(4);
    h.act(HOST, { type: 'start' });
    const sketches = Object.entries(game(h).sketches);
    for (const [, s] of sketches) expect(s.prompt.text).not.toContain('{player}');
  });

  it('starts with reminder timers at the original lengths', () => {
    const h = harness(4);
    h.state = sketchy.create(
      { now: h.now, rng: createRng(1), content: packContent() },
      Object.entries(h.state.seats).map(([id, s]) => ({ id, name: s.name })),
    );
    expect(h.state.settings).toMatchObject({
      timerMode: 'soft',
      drawSeconds: 130,
      writeSeconds: 40,
      voteSeconds: 30,
    });
    h.act(HOST, { type: 'start' });
    expect(game(h).deadline).toBe(h.now + 130_000);
    expect(sketchy.nextDeadline!(h.state)).toBeNull();
  });
});

describe('drawing', () => {
  it('moves on once everyone has drawn', () => {
    const h = started(4);
    drawAll(h, ['p4']);
    expect(game(h).stage).toBe('draw');
    h.act('p4', { type: 'draw', drawing: SQUIGGLE });
    expect(game(h).stage).toBe('write');
    expect(game(h).order).toHaveLength(4);
    expect(turn(h).writers).not.toContain(turn(h).artist);
  });

  it('refuses a blank page and a second drawing', () => {
    const h = started(4);
    expect(h.refuse('p1', { type: 'draw', drawing: [] }).code).toBe('drawing-empty');
    h.act('p1', { type: 'draw', drawing: SQUIGGLE });
    expect(h.refuse('p1', { type: 'draw', drawing: SQUIGGLE }).code).toBe('already-drawn');
  });

  it('skips players who sent nothing when the strict clock ends', () => {
    const h = started(4);
    drawAll(h, ['p2']);
    h.tick();
    expect(game(h).stage).toBe('write');
    expect(game(h).order).toHaveLength(3);
    expect(game(h).order).not.toContain('p2');
  });

  it('allows one reroll per player per game', () => {
    const h = started(4);
    const before = game(h).sketches.p2!.prompt.id;
    h.act('p2', { type: 'reroll' });
    expect(game(h).sketches.p2!.prompt.id).not.toBe(before);
    expect(h.refuse('p2', { type: 'reroll' }).code).toBe('rerolled');
    h.act('p2', { type: 'draw', drawing: SQUIGGLE });
    expect(h.refuse('p3', { type: 'draw', drawing: [] }).code).toBe('drawing-empty');
    h.act('p3', { type: 'draw', drawing: SQUIGGLE });
    expect(h.refuse('p3', { type: 'reroll' }).code).toBe('already-drawn');
  });

  it('ends a round with no drawings at all', () => {
    const h = started(4);
    h.tick();
    expect(game(h).round).toBe(2);
    expect(game(h).stage).toBe('draw');
  });
});

describe('lies', () => {
  it('refuses the real title, its alternates and near spellings', () => {
    const truth = { text: 'robot birthday party', alternates: ['robo birthday'] };
    expect(lieProblem('Robot Birthday Party', truth)?.code).toBe('is-the-truth');
    expect(lieProblem('robot birthday parties', truth)?.code).toBe('is-the-truth');
    expect(lieProblem('robo-birthday', truth)?.code).toBe('is-the-truth');
    expect(lieProblem('robot party', truth)).toBeNull();
    expect(lieProblem('x'.repeat(46))?.code).toBe('lie-too-long');
    expect(sameTitle("a wizard's laundry", 'wizards laundry')).toBe(true);
  });

  it('refuses the truth privately, without recording anything', () => {
    const h = writing(4);
    const writer = turn(h).writers[0]!;
    const truth = game(h).sketches[turn(h).artist]!.prompt.text;
    expect(h.refuse(writer, { type: 'lie', text: truth.toUpperCase() }).code).toBe('is-the-truth');
    expect(turn(h).lies[writer]).toBeUndefined();
  });

  it('lowercases lies and merges identical ones', () => {
    const h = writing(4);
    const [a, b, c] = turn(h).writers;
    h.act(a!, { type: 'lie', text: 'A Big DOG' });
    h.act(b!, { type: 'lie', text: 'a big dog' });
    h.act(c!, { type: 'lie', text: 'something else' });
    expect(game(h).stage).toBe('vote');
    const merged = turn(h).options.find((o) => o.text === 'a big dog')!;
    expect(merged.authors.sort()).toEqual([a, b].sort());
    expect(turn(h).options.every((o) => o.text === o.text.toLowerCase())).toBe(true);
  });

  it('pads a small board with house titles up to four', () => {
    const h = writing(3);
    lieAll(h);
    expect(turn(h).options).toHaveLength(4);
    expect(turn(h).options.filter((o) => o.house)).toHaveLength(1);
  });

  it('offers two ready-made titles worth half', () => {
    const h = writing(4);
    const w = turn(h).writers[0]!;
    h.act(w, { type: 'lie-for-me' });
    const offer = turn(h).fakeChoices[w]!;
    expect(offer).toHaveLength(2);
    h.act(w, { type: 'lie-for-me', choice: 1, fake: offer[1] });
    expect(turn(h).lies[w]).toBe(offer[1]);
    expect(turn(h).autoLies).toContain(w);
    expect(liePoints(2, 1, true)).toBe(500);
  });
});

describe('scoring', () => {
  it('pays the truth, the artist and the liars', () => {
    const h = writing(4);
    lieAll(h);
    const artist = turn(h).artist;
    const [a, b, c] = turn(h).voters;
    // a and b find the truth; c falls for a's lie.
    h.act(a!, { type: 'vote', option: truthIndex(h) });
    h.act(b!, { type: 'vote', option: truthIndex(h) });
    h.act(c!, { type: 'vote', option: lieIndex(h, a!) });
    expect(game(h).stage).toBe('reveal');
    const points = turn(h).points;
    expect(points[a!]).toBe(TRUTH_POINTS + FOOL_POINTS);
    expect(points[b!]).toBe(TRUTH_POINTS);
    expect(points[c!]).toBe(0);
    expect(points[artist]).toBe(2 * ARTIST_POINTS);
    expect(h.state.scores[artist]!.hits).toBe(2);
  });

  it('refuses a vote for your own lie, and the artist’s vote', () => {
    const h = writing(4);
    lieAll(h);
    const w = turn(h).voters[0]!;
    expect(h.refuse(w, { type: 'vote', option: lieIndex(h, w) }).code).toBe('own-lie');
    expect(h.refuse(turn(h).artist, { type: 'vote', option: 0 }).code).toBe('your-drawing');
  });

  it('adds the streak bonus and keeps it across your own drawing', () => {
    expect([1, 2, 3, 4].map(streakBonus)).toEqual([0, 100, 200, 300]);
    const h = writing(4);
    const finder = 'p2';
    let seenOwn = false;
    const expected: number[] = [];
    let streak = 0;
    while (h.state.phase === 'playing' && game(h).round === 1) {
      const t = turn(h);
      lieAll(h);
      if (t.artist === finder) seenOwn = true;
      else {
        streak += 1;
        expected.push(TRUTH_POINTS + streakBonus(streak));
      }
      voteAll(h, [finder]);
      if (t.artist !== finder) expect(turn(h).streakBonus[finder]).toBe(streakBonus(streak));
      h.act(HOST, { type: 'next' });
    }
    expect(seenOwn).toBe(true);
    expect(game(h).streaks[finder]).toBe(3);
  });

  it('breaks a streak on a wrong pick or no pick', () => {
    const h = writing(4);
    lieAll(h);
    voteAll(h, turn(h).voters);
    const voter = turn(h).voters[0]!;
    expect(game(h).streaks[voter]).toBe(1);
    h.act(HOST, { type: 'next' });
    lieAll(h);
    if (turn(h).voters.includes(voter)) {
      for (const id of turn(h).voters.filter((v) => v !== voter)) {
        h.act(id, { type: 'vote', option: truthIndex(h) });
      }
      h.tick();
      expect(game(h).streaks[voter]).toBe(0);
      expect(turn(h).voteTimedOut).toBe(true);
    }
  });

  it('shares a merged lie’s points', () => {
    expect(liePoints(1, 2)).toBe(250);
    expect(liePoints(3, 2)).toBe(750);
  });
});

describe('likes', () => {
  it('opens likes after your pick, never on your own lie, and counts them at the next drawing', () => {
    const h = writing(4);
    lieAll(h);
    const [a, b] = turn(h).voters;
    expect(h.refuse(a!, { type: 'like', option: 0, on: true }).code).toBe('no-likes');
    h.act(a!, { type: 'vote', option: truthIndex(h) });
    expect(h.refuse(a!, { type: 'like', option: lieIndex(h, a!), on: true }).code).toBe('own-lie');
    h.act(a!, { type: 'like', option: lieIndex(h, b!), on: true });
    h.act(turn(h).artist, { type: 'like', option: lieIndex(h, b!), on: true });
    voteAll(h, turn(h).voters);
    h.act(HOST, { type: 'next' });
    expect(h.state.scores[b!]!.likes).toBe(2);
    expect(h.state.scores[b!]!.score).toBe(TRUTH_POINTS);
  });

  it('closes likes when the reveal ends', () => {
    const h = writing(4);
    lieAll(h);
    voteAll(h, []);
    const liker = turn(h).voters[0]!;
    const other = turn(h).options.findIndex((o) => !o.authors.includes(liker));
    h.act(liker, { type: 'like', option: other, on: true });
    h.wait(60_000);
    expect(h.refuse(liker, { type: 'like', option: other, on: false }).code).toBe('no-likes');
  });
});

describe('flow', () => {
  it('plays a whole game to the end', () => {
    const h = started(3);
    for (let round = 1; round <= 2; round++) {
      drawAll(h);
      while (game(h).stage !== 'draw' && h.state.phase === 'playing') {
        lieAll(h);
        voteAll(h, [turn(h).voters[0]!]);
        h.act(HOST, { type: 'next' });
      }
    }
    expect(h.state.phase).toBe('over');
    expect(game(h).history).toHaveLength(6);
    expect(h.state.endReason).toBe('finished');
  });

  it('strict clocks fill missing lies and move on', () => {
    const h = writing(4);
    const w = turn(h).writers[0]!;
    h.act(w, { type: 'lie', text: 'mine' });
    h.tick();
    expect(game(h).stage).toBe('vote');
    expect(turn(h).filled).toHaveLength(2);
  });

  it('soft timers wait, and the host can continue without', () => {
    const h = harness(4);
    h.act(HOST, { type: 'update-settings', timerMode: 'soft' });
    h.act(HOST, { type: 'start' });
    expect(sketchy.nextDeadline!(h.state)).toBeNull();
    drawAll(h, ['p3']);
    h.act(HOST, { type: 'continue-without' });
    expect(game(h).stage).toBe('write');
  });

  it('keeps a leaver’s drawing and drops their unsent lie', () => {
    const h = writing(4);
    const t = turn(h);
    const leaver = t.writers[0]!;
    h.state = sketchy.playerLeft(h.state, leaver, h.now);
    expect(turn(h).writers).not.toContain(leaver);
    expect(game(h).order).toContain(leaver);
  });

  it('ends below three players', () => {
    const h = writing(3);
    h.state = sketchy.playerLeft(h.state, 'p3', h.now);
    expect(h.state.phase).toBe('over');
    expect(h.state.endReason).toBe('too-few');
  });

  it('lets the host hide the drawing on the table', () => {
    const h = writing(4);
    expect(h.refuse('p2', { type: 'hide', hidden: true }).code).toBe('not-host');
    h.act(HOST, { type: 'hide', hidden: true });
    expect(game(h).hidden).toEqual([turn(h).artist]);
  });

  it('newcomers watch until the next round', () => {
    const h = writing(4);
    h.state = sketchy.playerJoined(h.state, { id: 'p9', name: 'P9' });
    expect(h.state.seats.p9!.playing).toBe(true);
    expect(game(h).players).not.toContain('p9');
  });
});
