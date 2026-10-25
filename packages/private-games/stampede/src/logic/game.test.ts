import { describe, expect, it } from 'vitest';
import { stampede } from './game.ts';
import { HOST, answerAll, cows, deck, harness, next, playRound, started } from './test-utils.ts';
import { PICK_MS } from './types.ts';

const herdOf = (h: ReturnType<typeof started>) => {
  const r = h.state.round!;
  return r.groups.find((g) => g.id === r.result?.herd)?.members ?? null;
};

describe('Stampede setup', () => {
  it('needs 3 players and a deck to start', () => {
    expect(harness(2).refuse(HOST, { type: 'start' })).toBe('too-few-players');
    const h = harness(3, { decks: [] });
    expect(h.refuse(HOST, { type: 'start' })).toBe('no-decks');
    expect(harness(3).refuse('p2', { type: 'start' })).toBe('not-host');
  });

  it('starts with the target, no Pink Cow and a question from the decks', () => {
    const h = started(4, { settings: { target: 5 } });
    expect(h.state.phase).toBe('playing');
    expect(h.state.target).toBe(5);
    expect(h.state.pinkCow).toBeNull();
    expect(h.state.round).toMatchObject({ number: 1, stage: 'answer' });
    expect(h.state.round!.question.id).toMatch(/^d1:/);
  });

  it('leaves adults-only decks out of the defaults and drops decks that went away', () => {
    const h = harness(3, { decks: [deck('kids', 5), deck('late', 5, true)] });
    expect(h.state.settings.deckIds).toEqual(['kids']);
    expect(h.refuse(HOST, { type: 'update-settings', deckIds: ['nope'] })).toBe('unknown-deck');
    h.act(HOST, { type: 'update-settings', deckIds: ['late'], target: 10, sharedWin: true });
    expect(h.state.settings).toMatchObject({ deckIds: ['late'], target: 10, sharedWin: true });
    expect(h.state.target).toBe(10);
  });
});

describe('answering', () => {
  it('keeps answers until the last one is in, then groups them', () => {
    const h = started(3);
    h.act('p1', { type: 'answer', text: '  Pizza  ' });
    h.act('p1', { type: 'answer', text: 'pasta' });
    expect(h.state.round!.answers.p1).toBe('pasta');
    h.act('p2', { type: 'answer', text: 'Pasta!' });
    expect(h.state.round!.stage).toBe('answer');
    h.act('p3', { type: 'answer', text: 'the pastas' });
    // Straight to the reveal: the answers group themselves.
    expect(h.state.round!.stage).toBe('reveal');
    expect(h.state.round!.groups).toEqual([{ id: 'g1', members: ['p1', 'p2', 'p3'] }]);
  });

  it('refuses empty, long and multi-line answers', () => {
    const h = started(3);
    expect(h.refuse('p1', { type: 'answer', text: '   ' })).toBe('empty-answer');
    expect(h.refuse('p1', { type: 'answer', text: 'x'.repeat(31) })).toBe('answer-too-long');
    expect(h.refuse('p1', { type: 'answer', text: 'a\nb' })).toBe('answer-lines');
  });

  it('lets the host continue without slow players, whose answers are blank', () => {
    const h = started(4);
    answerAll(h, ['Cat', 'Cat', 'Dog']);
    expect(h.refuse('p2', { type: 'continue-without' })).toBe('not-host');
    h.act(HOST, { type: 'continue-without' });
    expect(h.state.round).toMatchObject({ stage: 'reveal', late: ['p4'] });
    expect(h.state.round!.result).toMatchObject({ scorers: ['p1', 'p2'], blanks: ['p4'] });
    // The blank never counts as alone: "Dog" is the only answer alone.
    expect(h.state.pinkCow).toBe('p3');
  });

  it('locks the answers when a strict timer runs out, and only nudges with a soft one', () => {
    const soft = started(3, { settings: { answerSeconds: 30 } });
    expect(stampede.nextDeadline!(soft.state)).toBeNull();
    expect(soft.state.round!.deadline).toBe(soft.now + 30_000);
    const h = started(3, { settings: { answerSeconds: 30, timerMode: 'strict' } });
    h.act('p1', { type: 'answer', text: 'Tea' });
    h.tick();
    expect(h.state.round).toMatchObject({ stage: 'reveal', late: ['p2', 'p3'] });
    expect(stampede.nextDeadline!(h.state)).toBeNull();
  });
});

describe('scoring', () => {
  it('gives a cow to the biggest group, not only a majority', () => {
    const h = started(6);
    playRound(h, ['dime', 'dime', 'nickel', 'dime', 'nickel', 'quarter']);
    expect(herdOf(h)).toEqual(['p1', 'p2', 'p4']);
    expect(cows(h)).toMatchObject({ p1: 1, p2: 1, p4: 1, p3: 0, p5: 0, p6: 0 });
    expect(h.state.pinkCow).toBe('p6');
  });

  it('scores nobody on a tie for biggest, but a lone answer still takes the Pink Cow (A2)', () => {
    const h = started(5);
    playRound(h, ['soup', 'yogurt', 'soup', 'yogurt', 'toast']);
    expect(h.state.round!.result).toMatchObject({ tie: true, herd: null, scorers: [] });
    expect(Object.values(cows(h))).toEqual([0, 0, 0, 0, 0]);
    expect(h.state.pinkCow).toBe('p5');
  });

  it('gives everyone a cow when everyone matches (A3)', () => {
    const h = started(4);
    playRound(h, ['Moon', 'moon', 'the moon', 'MOON']);
    expect(Object.values(cows(h))).toEqual([1, 1, 1, 1]);
    expect(h.state.pinkCow).toBeNull();
  });

  it('scores nobody when every answer differs, and the Pink Cow stays put', () => {
    const h = started(4);
    playRound(h, ['a', 'b', 'c', 'd']);
    // Not a tie between groups: just no herd.
    expect(h.state.round!.result).toMatchObject({
      herd: null,
      tie: false,
      loners: ['p1', 'p2', 'p3', 'p4'],
    });
    expect(Object.values(cows(h))).toEqual([0, 0, 0, 0]);
    expect(h.state.pinkCow).toBeNull();
  });

  it('gives a single answer no herd but the Pink Cow (Q1)', () => {
    const h = started(3);
    playRound(h, ['Lonely']);
    expect(h.state.round!.result).toMatchObject({ herd: null, tie: false, scorers: [] });
    expect(h.state.pinkCow).toBe('p1');
  });

  it('moves the Pink Cow only to a new single odd one out', () => {
    const h = started(5);
    playRound(h, ['x', 'x', 'x', 'y', 'z']);
    expect(h.state.pinkCow).toBeNull();
    next(h);
    playRound(h, ['x', 'x', 'x', 'x', 'z']);
    expect(h.state.pinkCow).toBe('p5');
    next(h);
    // The holder alone again keeps it.
    playRound(h, ['x', 'x', 'x', 'x', 'q']);
    expect(h.state.pinkCow).toBe('p5');
    expect(h.state.round!.result).toMatchObject({ pinkFrom: 'p5', pinkTo: 'p5' });
    next(h);
    playRound(h, ['w', 'x', 'x', 'x', 'x']);
    expect(h.state.pinkCow).toBe('p1');
    expect(h.state.scores.p5!.pinks).toBe(1);
  });
});

describe('automatic grouping', () => {
  it('groups typos and spellings by itself, with no host step, and shows each spelling', () => {
    const h = started(5);
    answerAll(h, ['Coca-Cola', 'coca cola', 'Cocacola', 'Pizzaa', 'pizza']);
    const r = h.state.round!;
    expect(r.stage).toBe('reveal');
    expect(r.groups.map((g) => g.members)).toEqual([
      ['p1', 'p2', 'p3'],
      ['p4', 'p5'],
    ]);
    const view = stampede.view(h.state, 'p2').round!;
    expect(view.groups![0]).toMatchObject({ label: 'Coca-Cola', answers: { p3: 'Cocacola' } });
    // No host decides anything: a refused old-style reveal changes nothing.
    expect(h.refuse(HOST, { type: 'reveal' })).toBe('wrong-stage');
  });

  it('reveals a round saved mid-check by the older version at the next action', () => {
    const h = started(3);
    answerAll(h, ['a', 'a']);
    // What an older version saved: the writing over, the host still checking.
    const old = structuredClone(h.state);
    old.round = {
      ...old.round!,
      stage: 'merge',
      answers: { p1: 'a', p2: 'a', p3: 'b' },
      groups: [
        { id: 'g1', members: ['p1', 'p2'] },
        { id: 'g2', members: ['p3'] },
      ],
    };
    h.state = old;
    expect(stampede.view(h.state, 'p2').round!.groups).toBeNull();
    h.act(HOST, { type: 'reveal' });
    expect(h.state.round!.stage).toBe('reveal');
    expect(h.state.round!.result).toMatchObject({ scorers: ['p1', 'p2'] });
    expect(h.state.pinkCow).toBe('p3');
  });
});

describe('winning', () => {
  it('ends at the reveal where one player without the Pink Cow leads at the target', () => {
    const h = started(3, { settings: { target: 5 } });
    for (let i = 0; i < 4; i++) {
      playRound(h, ['x', 'x', 'y']);
      next(h);
    }
    expect(cows(h)).toMatchObject({ p1: 4, p2: 4, p3: 0 });
    playRound(h, ['x', 'y', 'x']);
    expect(h.state.phase).toBe('over');
    expect(h.state.winners).toEqual(['p1']);
    expect(h.state.endReason).toBe('won');
    expect(stampede.view(h.state, 'p2').round!.stage).toBe('reveal');
  });

  it('raises the target to one above a tie at the top (Q3), or shares the win', () => {
    const h = started(4, { settings: { target: 5 } });
    for (let i = 0; i < 5; i++) {
      playRound(h, ['x', 'x', 'y', 'z']);
      if (i < 4) next(h);
    }
    expect(h.state.phase).toBe('playing');
    expect(h.state.round!.result!.raisedTo).toBe(6);
    expect(h.state.target).toBe(6);
    next(h);
    playRound(h, ['x', 'y', 'x', 'z']);
    expect(h.state.winners).toEqual(['p1']);

    const shared = started(4, { settings: { target: 5, sharedWin: true } });
    for (let i = 0; i < 5; i++) {
      playRound(shared, ['x', 'x', 'y', 'z']);
      if (i < 4) next(shared);
    }
    expect(shared.state.winners).toEqual(['p1', 'p2']);
  });

  it('ignores the Pink Cow holder when two reach the target together (A4)', () => {
    const h = started(5, { settings: { target: 5 } });
    // A tie at the top scores nobody; "z" alone takes the cow.
    playRound(h, ['x', 'z', 'x', 'y', 'y']);
    expect(h.state.pinkCow).toBe('p2');
    for (let i = 0; i < 5; i++) {
      next(h);
      playRound(h, ['x', 'x', 'a', 'b', 'c']); // three alone: the cow stays with p2
    }
    expect(cows(h)).toMatchObject({ p1: 5, p2: 5 });
    expect(h.state.winners).toEqual(['p1']);
  });

  it('lets a holder at the target win once someone else is the odd one out (A5)', () => {
    const h = started(5, { settings: { target: 5 } });
    playRound(h, ['x', 'z', 'x', 'y', 'y']);
    const partners = [
      ['a', 'x', 'x', 'b', 'c'],
      ['a', 'x', 'b', 'x', 'c'],
      ['a', 'x', 'b', 'c', 'x'],
      ['a', 'x', 'x', 'b', 'c'],
      ['a', 'x', 'b', 'x', 'c'],
    ];
    for (const answers of partners) {
      next(h);
      playRound(h, answers);
    }
    expect(h.state.scores.p2!.cows).toBe(5);
    expect(h.state.pinkCow).toBe('p2');
    expect(h.state.phase).toBe('playing');
    next(h);
    playRound(h, ['x', 'x', 'x', 'x', 'q']);
    expect(h.state.pinkCow).toBe('p5');
    expect(h.state.winners).toEqual(['p2']);
  });
});

describe('house rule: the holder picks', () => {
  it('lets the holder pick among several lone answers, never themself', () => {
    const h = started(5, { settings: { holderPicks: true } });
    playRound(h, ['x', 'x', 'x', 'x', 'y']);
    expect(h.state.pinkCow).toBe('p5');
    next(h);
    playRound(h, ['x', 'x', 'a', 'b', 'c']);
    expect(h.state.round).toMatchObject({ stage: 'pick' });
    expect(h.state.round!.pick!.options).toEqual(['p3', 'p4']);
    // The groups are public while the holder decides.
    expect(stampede.view(h.state, 'p2').round!.groups).not.toBeNull();
    expect(h.refuse('p1', { type: 'pick', player: 'p3' })).toBe('not-holder');
    expect(h.refuse('p5', { type: 'pick', player: 'p1' })).toBe('bad-pick');
    h.act('p5', { type: 'pick', player: 'p4' });
    expect(h.state.pinkCow).toBe('p4');
    expect(h.state.round!.result).toMatchObject({ pinkHow: 'picked', pinkFrom: 'p5' });
  });

  it('leaves the cow in the middle with no holder, and picks at random after 30 s', () => {
    const h = started(4, { settings: { holderPicks: true } });
    playRound(h, ['x', 'x', 'a', 'b']);
    expect(h.state.round!.stage).toBe('reveal');
    expect(h.state.pinkCow).toBeNull();
    next(h);
    playRound(h, ['x', 'x', 'x', 'q']);
    next(h);
    playRound(h, ['a', 'b', 'x', 'x']);
    expect(h.state.round!.pick!.deadline).toBe(h.now + PICK_MS);
    h.tick();
    expect(['p1', 'p2']).toContain(h.state.pinkCow);
    expect(h.state.round!.result!.pinkHow).toBe('timeout');
  });

  it('keeps the cow in the middle when the holder leaves during the pick', () => {
    const h = started(5, { settings: { holderPicks: true } });
    playRound(h, ['x', 'x', 'x', 'x', 'y']);
    next(h);
    playRound(h, ['x', 'x', 'a', 'b', 'c']);
    h.state = stampede.playerLeft(h.state, 'p5', h.now);
    expect(h.state.round!.stage).toBe('reveal');
    expect(h.state.pinkCow).toBeNull();
  });
});

describe('skip, moo and leavers', () => {
  it('lets the host swap the question once a round, clearing the answers', () => {
    const h = started(3);
    const first = h.state.round!.question.id;
    h.act('p2', { type: 'answer', text: 'hm' });
    expect(h.refuse('p2', { type: 'skip' })).toBe('not-host');
    h.act(HOST, { type: 'skip' });
    expect(h.state.round!.question.id).not.toBe(first);
    expect(h.state.round!.answers).toEqual({});
    expect(h.refuse(HOST, { type: 'skip' })).toBe('skipped-already');
    const off = started(3, { settings: { skip: false } });
    expect(off.refuse(HOST, { type: 'skip' })).toBe('no-skips');
  });

  it('lets answered players moo at the slow ones, now and then', () => {
    const h = started(3);
    expect(h.refuse('p1', { type: 'moo' })).toBe('answer-first');
    h.act('p1', { type: 'answer', text: 'x' });
    h.act('p1', { type: 'moo' });
    expect(h.state.moos).toEqual([{ from: 'p1', to: ['p2', 'p3'], at: h.now }]);
    expect(h.refuse('p1', { type: 'moo' })).toBe('moo-too-soon');
    h.now += 5_000;
    h.act('p1', { type: 'moo' });
    expect(h.state.moos).toHaveLength(2);
  });

  it('takes a leaver’s answer with them, sends their Pink Cow to the middle, and ends below 3', () => {
    const h = started(5);
    playRound(h, ['x', 'x', 'x', 'y', 'y']);
    next(h);
    playRound(h, ['x', 'x', 'x', 'x', 'q']);
    expect(h.state.pinkCow).toBe('p5');
    next(h);
    answerAll(h, ['a', 'b', 'c']);
    h.state = stampede.playerLeft(h.state, 'p5', h.now);
    expect(h.state.pinkCow).toBeNull();
    expect(h.state.round!.players).not.toContain('p5');
    h.act('p4', { type: 'answer', text: 'd' });
    expect(h.state.round!.stage).toBe('reveal');
    expect(h.state.round!.groups.flatMap((g) => g.members)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(h.state.scores.p5).toBeDefined();
    expect(stampede.view(h.state, 'p1').scores.find((s) => s.id === 'p5')!.left).toBe(true);
    h.state = stampede.playerLeft(h.state, 'p4', h.now);
    h.state = stampede.playerLeft(h.state, 'p3', h.now);
    expect(h.state).toMatchObject({ phase: 'over', endReason: 'too-few' });
  });

  it('reuses the questions it had longest ago once the decks run out', () => {
    const h = started(3, { decks: [deck('tiny', 2)] });
    const seen = [h.state.round!.question.id];
    for (let i = 0; i < 3; i++) {
      playRound(h, ['x', 'x', 'y']);
      next(h);
      seen.push(h.state.round!.question.id);
    }
    expect(new Set(seen.slice(0, 2)).size).toBe(2);
    expect(seen[2]).toBe(seen[0]);
  });
});
