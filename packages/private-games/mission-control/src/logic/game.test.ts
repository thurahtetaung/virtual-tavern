import { createRng } from '@vt/game-sdk';
import { afterEach, describe, expect, it } from 'vitest';
import { DECK, legalCards, signalPositions, winningIndex } from './cards.ts';
import { type Check, type Table, evaluate } from './checks.ts';
import { clash, mustRedraw } from './conflicts.ts';
import { taskCards } from './content.ts';
import { missionControl } from './definition.ts';
import { drawTasks, legalFor } from './game.ts';
import {
  HOST,
  NOW,
  TASKS,
  VOYAGE,
  att,
  dive,
  draftAll,
  harness,
  packContent,
  playOut,
  readyAll,
  rig,
  toDraft,
} from './test-utils.ts';
import { DUMMY, type MissionPlay } from './types.ts';

afterEach(() => rig(null));

/** Three hands: p1 holds every pink, the trumps and the blue 1; p2 blues and greens; p3 the rest. */
const SPLIT = [
  ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8', 'p9', 't1', 't2', 't3', 't4', 'b1'],
  ['b2', 'b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'g1', 'g2', 'g3', 'g4', 'g5'],
  ['g6', 'g7', 'g8', 'g9', 'y1', 'y2', 'y3', 'y4', 'y5', 'y6', 'y7', 'y8', 'y9'],
];

describe('cards', () => {
  it('follows suit and lets trumps win', () => {
    expect(legalCards(['p1', 'b2', 't1'], 'p')).toEqual(['p1']);
    expect(legalCards(['b2', 't1'], 'p')).toEqual(['b2', 't1']);
    expect(winningIndex(['p3', 'p9', 'b9'])).toBe(1);
    expect(winningIndex(['p3', 't1', 'p9'])).toBe(1);
    expect(winningIndex(['p3', 't1', 't2'])).toBe(2);
    expect(winningIndex(['t1', 'p9', 'b9'])).toBe(0);
  });

  it('signals only true positions on colour cards', () => {
    const hand = ['p2', 'p5', 'p9', 'b3', 't4'];
    expect(signalPositions(hand, 'p9')).toEqual(['top']);
    expect(signalPositions(hand, 'p2')).toEqual(['bottom']);
    expect(signalPositions(hand, 'p5')).toEqual([]);
    expect(signalPositions(hand, 'b3')).toEqual(['top', 'only', 'bottom']);
    expect(signalPositions(hand, 't4')).toEqual([]);
  });
});

const tbl = (over: Partial<Table>): Table => ({
  tricks: [],
  current: [],
  total: 13,
  crew: ['a', 'b', 'c'],
  captain: 'a',
  hands: { a: [], b: [], c: [] },
  size: 3,
  final: false,
  ...over,
});
const trick = (winner: string, ...cards: [string, string][]) => ({
  winner,
  plays: cards.map(([by, card]) => ({ by, card })),
});

describe('checks', () => {
  it('win-cards fails when someone else wins the card', () => {
    const t = tbl({ tricks: [trick('b', ['a', 'p3'], ['b', 'p5'], ['c', 'p1'])] });
    expect(evaluate({ kind: 'win-cards', cards: ['p3'] }, 'a', t)).toMatchObject({
      state: 'failed',
      why: '{p:b} won {c:p3}.',
    });
    expect(evaluate({ kind: 'win-cards', cards: ['p3'] }, 'b', t).state).toBe('done');
  });

  it('a card left over at the end fails its task', () => {
    const t = tbl({ final: true, hands: { a: ['p3'], b: [], c: [] } });
    expect(evaluate({ kind: 'win-cards', cards: ['p3'] }, 'a', t).state).toBe('failed');
  });

  it('win-with fails once the holder has no such card left', () => {
    const t = tbl({ hands: { a: ['p2'], b: ['p5'], c: [] } });
    expect(
      evaluate({ kind: 'win-with', match: { values: [5], suits: ['p', 'b', 'g', 'y'] } }, 'a', t)
        .state,
    ).toBe('failed');
    expect(evaluate({ kind: 'win-with', match: { values: [5] } }, 'b', t).state).toBe('open');
  });

  it('a 6 with another 6 needs the target in someone else’s hand', () => {
    const t = tbl({ hands: { a: ['p6', 'b6'], b: [], c: ['y1'] } });
    expect(
      evaluate({ kind: 'win-with-card', target: { values: [6] }, using: { values: [6] } }, 'a', t)
        .state,
    ).toBe('failed');
  });

  it('trick counts and runs', () => {
    const t = tbl({ total: 4, tricks: [trick('a'), trick('a'), trick('b')] });
    expect(evaluate({ kind: 'run', n: 2 }, 'a', t).state).toBe('done');
    expect(evaluate({ kind: 'run', n: 3, exact: true }, 'a', t).state).toBe('failed');
    expect(evaluate({ kind: 'no-run' }, 'a', t).state).toBe('failed');
    expect(evaluate({ kind: 'trick-count', n: 1 }, 'a', t).state).toBe('failed');
    expect(evaluate({ kind: 'trick-count', n: 1 }, 'b', t).state).toBe('open');
    expect(evaluate({ kind: 'trick-count', n: 3 }, 'c', t).state).toBe('failed');
  });

  it('comparisons settle as soon as the tricks left can’t change them', () => {
    const t = tbl({ total: 4, tricks: [trick('b'), trick('b'), trick('b')] });
    expect(evaluate({ kind: 'compare', with: 'each', op: 'more' }, 'b', t).state).toBe('done');
    expect(evaluate({ kind: 'compare', with: 'captain', op: 'more' }, 'c', t).state).toBe('open');
    expect(evaluate({ kind: 'compare', with: 'each', op: 'more' }, 'c', t).state).toBe('failed');
  });

  it('crew conditions: the 9s stay level and the lead never forbidden', () => {
    const t = tbl({ tricks: [trick('a', ['a', 'p9'], ['b', 'b9'], ['c', 'p1'])] });
    expect(evaluate({ kind: 'balance', value: 9, gap: 2 }, null, t)).toMatchObject({
      state: 'failed',
    });
    const lead = tbl({ current: [{ by: 'c', card: 'p2' }], hands: { a: [], b: [], c: [] } });
    expect(evaluate({ kind: 'no-lead', suits: ['p', 't'] }, null, lead).state).toBe('failed');
  });

  it('the last card must close the last trick', () => {
    const early = tbl({ total: 2, tricks: [trick('a', ['a', 'y5'], ['b', 'y1'], ['c', 'y2'])] });
    expect(evaluate({ kind: 'last-card', card: 'y5' }, null, early).state).toBe('failed');
    const last = tbl({
      total: 1,
      final: true,
      tricks: [trick('a', ['a', 'y4'], ['b', 'y1'], ['c', 'y5'])],
    });
    expect(evaluate({ kind: 'last-card', card: 'y5' }, null, last).state).toBe('done');
  });

  it('more of one colour than another, none of the other allowed', () => {
    const t = tbl({ final: true, tricks: [trick('a', ['a', 'y4'], ['b', 'p1'], ['c', 'p2'])] });
    expect(evaluate({ kind: 'more', more: 'y', than: 'b' }, 'a', t).state).toBe('done');
  });
});

describe('impossible pairs', () => {
  it('two first-trick tasks can’t go to different players; one player can hold both', () => {
    const c = clash({ kind: 'tricks', win: [1] }, { kind: 'tricks', win: [1, 2] }, 13);
    expect(c).toEqual({ apart: true, together: false });
    expect(
      mustRedraw([{ kind: 'tricks', win: [1] }], { kind: 'tricks', win: [1, 2] }, 13, false),
    ).toBe(true);
    expect(
      mustRedraw([{ kind: 'tricks', win: [1] }], { kind: 'tricks', win: [1, 2] }, 13, true),
    ).toBe(false);
  });

  it('“all four 9s” and “no 9s” never go together', () => {
    const all9: Check = { kind: 'win-count', match: { values: [9] }, op: 'atLeast', n: 4 };
    const no9: Check = { kind: 'win-count', match: { values: [9] }, op: 'exactly', n: 0 };
    expect(clash(all9, no9, 13)).toEqual({ apart: false, together: true });
    expect(clash(all9, { kind: 'win-cards', cards: ['y9'] }, 13).apart).toBe(true);
  });
});

describe('drawing tasks', () => {
  it('adds up to the difficulty exactly', () => {
    const pool = taskCards(packContent());
    const m = { selection: 'normal' } as MissionPlay;
    for (let seed = 1; seed < 30; seed++) {
      const { cards } = drawTasks(pool, [], 5, 3, m, 3, createRng(seed));
      expect(cards.reduce((s, c) => s + c.difficulty[3], 0)).toBe(5);
    }
  });

  it('never leaves a pair only one player could meet when nobody holds two', () => {
    const pool = taskCards(
      packContent(TASKS.filter((t) => t.id === 3 || t.id === 14 || t.id === 1 || t.id === 2)),
    );
    const m = { selection: 'normal' } as MissionPlay;
    for (let seed = 1; seed < 40; seed++) {
      const { cards } = drawTasks(pool, [], 2, 3, m, 3, createRng(seed));
      const keys = cards.map((c) => c.key);
      expect(keys.includes('tp:3') && keys.includes('tp:14')).toBe(false);
    }
  });
});

describe('a mission, start to end', () => {
  it('briefing, draft, dive, and a success logged in the campaign', () => {
    rig({ hands: SPLIT, tasks: ['1'] });
    const h = harness(3);
    h.act(HOST, { type: 'start' });
    expect(h.state.phase).toBe('playing');
    expect(att(h).stage).toBe('briefing');
    expect(att(h).captain).toBe('p1');
    readyAll(h);
    expect(att(h).stage).toBe('draft');
    draftAll(h);
    expect(att(h).tasks[0]!.owner).toBe('p1');
    dive(h);
    expect(att(h).stage).toBe('play');
    h.act('p1', { type: 'play', card: 'p3' });
    h.act('p2', { type: 'play', card: 'b2' });
    h.act('p3', { type: 'play', card: 'g6' });
    expect(att(h).stage).toBe('done');
    expect(att(h).result).toMatchObject({ success: true, tricks: 1 });
    expect(att(h).tasks[0]).toMatchObject({ state: 'done', at: 1 });
    expect(h.state.phase).toBe('over');
    const log = h.state.campaigns['test-voyage']!.log['1']!;
    expect(log).toMatchObject({ attempts: 1, distress: false, crew: ['P1', 'P2', 'P3'] });
    expect(log.done).toBe(NOW);
    // On to the next mission, with a fresh briefing.
    h.act('p2', { type: 'next' });
    expect(att(h).mission.n).toBe(2);
    expect(att(h).stage).toBe('briefing');
  });

  it('fails the moment a task can no longer be met, with the reason; retry keeps the tasks', () => {
    rig({ hands: SPLIT, tasks: ['1', '3'] });
    const h = harness(3);
    toDraft(h);
    draftAll(h);
    expect(att(h).tasks.map((t) => t.owner)).toEqual(['p1', 'p2']);
    dive(h);
    h.act('p1', { type: 'play', card: 'p3' });
    h.act('p2', { type: 'play', card: 'b2' });
    h.act('p3', { type: 'play', card: 'g6' });
    expect(att(h).result).toMatchObject({ success: false, task: 1, why: '{p:p1} won trick 1.' });
    expect(h.state.campaigns['test-voyage']!.log['1']!.attempts).toBe(1);
    h.refuse('p1', { type: 'next' });
    h.act('p3', { type: 'retry', same: true });
    expect(att(h).stage).toBe('draft');
    expect(att(h).number).toBe(2);
    expect(att(h).tasks.map((t) => [t.key, t.owner])).toEqual([
      ['tp:1', null],
      ['tp:3', null],
    ]);
  });

  it('enforces turn order and following suit', () => {
    rig({ hands: SPLIT, tasks: ['2'] });
    const h = harness(3);
    toDraft(h);
    draftAll(h);
    dive(h);
    expect(h.refuse('p2', { type: 'play', card: 'b2' }).code).toBe('not-your-turn');
    h.act('p1', { type: 'play', card: 'b1' });
    expect(h.refuse('p2', { type: 'play', card: 'g1' }).code).toBe('follow-suit');
    expect(legalFor(att(h), 'p2')).toEqual(SPLIT[1]!.filter((c) => c.startsWith('b')));
  });

  it('a leaver stops the attempt without counting it', () => {
    rig({ hands: SPLIT, tasks: ['1'] });
    const h = harness(4);
    h.act('p4', { type: 'sit', playing: false });
    toDraft(h);
    h.state = missionControl.playerLeft(h.state, 'p2', NOW);
    expect(h.state.phase).toBe('lobby');
    expect(h.state.attempt).toBeNull();
    expect(h.state.notice).toMatch(/P2 left/);
    expect(h.state.campaigns['test-voyage']!.log['1']).toBeUndefined();
  });

  it('missions out of order are practice and don’t touch the attempt count', () => {
    rig({ hands: SPLIT, tasks: ['1'] });
    const h = harness(3);
    toDraft(h, 4);
    expect(att(h).mission.practice).toBe(true);
    for (const i of [0]) h.act('p1', { type: 'claim', task: i, on: true });
    for (const id of ['p1', 'p2', 'p3']) h.act(id, { type: 'ready' });
    dive(h);
    h.act('p1', { type: 'play', card: 'p3' });
    h.act('p2', { type: 'play', card: 'b2' });
    h.act('p3', { type: 'play', card: 'g6' });
    const log = h.state.campaigns['test-voyage']!.log['4']!;
    expect(log).toMatchObject({ attempts: 0, practice: 1, practised: true, done: null });
  });
});

describe('the draft', () => {
  it('lets a player pass only while everyone left can still take one', () => {
    rig({ hands: SPLIT, tasks: ['1'] });
    const h = harness(3);
    toDraft(h);
    const a = att(h);
    expect(a.draft.order).toEqual(['p1', 'p2', 'p3']);
    h.act('p1', { type: 'pass' });
    h.act('p2', { type: 'pass' });
    expect(h.refuse('p3', { type: 'pass' }).code).toBe('no-pass');
    h.act('p3', { type: 'take', task: 0 });
    expect(att(h).stage).toBe('distress');
  });

  it('the captain never holds a comparison with the captain', () => {
    rig({ hands: SPLIT, tasks: ['11', '1'] });
    const h = harness(3);
    toDraft(h);
    expect(h.refuse('p1', { type: 'take', task: 0 }).code).toBe('captain-cannot');
  });

  it('crew wanted: the last asked must say yes', () => {
    rig({ hands: SPLIT, tasks: ['1', '2'] });
    const h = harness(3);
    toDraft(h, 5);
    expect(att(h).draft.order).toEqual(['p2', 'p3', 'p1']);
    h.act('p2', { type: 'answer', yes: false });
    h.act('p3', { type: 'answer', yes: false });
    expect(h.refuse('p1', { type: 'answer', yes: false }).code).toBe('must-yes');
    h.act('p1', { type: 'answer', yes: true });
    expect(att(h).tasks.every((t) => t.owner === 'p1')).toBe(true);
    expect(att(h).stage).toBe('distress');
  });

  it('two crew members wanted share the tasks, one each at least', () => {
    rig({ hands: SPLIT, tasks: ['1', '2', '5'] });
    const h = harness(3);
    toDraft(h, 12);
    h.act('p2', { type: 'answer', yes: true });
    h.act('p3', { type: 'answer', yes: true });
    expect(att(h).draft.chosen).toEqual(['p2', 'p3']);
    expect(h.refuse('p1', { type: 'claim', task: 0, on: true }).code).toBe('not-chosen');
    h.act('p2', { type: 'claim', task: 0, on: true });
    h.act('p2', { type: 'claim', task: 1, on: true });
    h.act('p2', { type: 'claim', task: 2, on: true });
    expect(h.refuse('p2', { type: 'ready' }).code).toBe('not-assigned');
    h.act('p2', { type: 'claim', task: 2, on: false });
    h.act('p3', { type: 'claim', task: 2, on: true });
    for (const id of ['p1', 'p2', 'p3']) h.act(id, { type: 'ready' });
    expect(att(h).stage).toBe('distress');
  });

  it('the captain offers: only to a yes, and then signals only before the first trick', () => {
    rig({ hands: SPLIT, tasks: ['2'] });
    const h = harness(3);
    toDraft(h, 6);
    h.act('p2', { type: 'answer', yes: false });
    h.act('p3', { type: 'answer', yes: true });
    expect(h.refuse('p1', { type: 'give', to: 'p2' }).code).toBe('not-willing');
    h.act('p1', { type: 'give', to: 'p3' });
    expect(att(h).tasks[0]!.owner).toBe('p3');
    dive(h);
    expect(att(h).draft.given).toBe(true);
    h.act('p1', { type: 'play', card: 'b1' });
    h.act('p2', { type: 'play', card: 'b2' });
    h.act('p3', { type: 'play', card: 'g6' });
    h.refuse('p2', { type: 'signal', card: 'g5', pos: 'top' });
  });

  it('hardest first: the captain takes the hardest task on show', () => {
    rig({ hands: SPLIT, tasks: ['1', '6'] });
    const h = harness(3);
    toDraft(h, 9);
    expect(h.refuse('p1', { type: 'take', task: 0 }).code).toBe('hardest-first');
    h.act('p1', { type: 'take', task: 1 });
  });

  it('the captain skips', () => {
    rig({ hands: SPLIT, tasks: ['1', '2'] });
    const h = harness(3);
    toDraft(h, 10);
    expect(att(h).draft.order).toEqual(['p2', 'p3']);
  });

  it('all to one: one volunteer, then everyone ready', () => {
    rig({ hands: SPLIT, tasks: ['1', '2'] });
    const h = harness(3);
    toDraft(h, 11);
    h.act('p2', { type: 'take-all' });
    h.act('p3', { type: 'take-all' });
    for (const id of ['p1', 'p2', 'p3']) h.act(id, { type: 'ready' });
    expect(att(h).tasks.every((t) => t.owner === 'p3')).toBe(true);
  });
});

describe('signals', () => {
  function playing(mission: number | null = null, tasks = ['2']) {
    rig({ hands: SPLIT, tasks });
    const h = harness(3);
    toDraft(h, mission);
    if (att(h).mission.selection === 'free') {
      h.act('p3', { type: 'claim', task: 0, on: true });
      for (const id of ['p1', 'p2', 'p3']) h.act(id, { type: 'ready' });
    } else {
      draftAll(h);
    }
    dive(h);
    return h;
  }

  it('one per attempt, a true position, never mid-trick', () => {
    const h = playing();
    expect(h.refuse('p2', { type: 'signal', card: 'b5', pos: 'top' }).code).toBe('bad-card');
    expect(h.refuse('p2', { type: 'signal', card: 'b9', pos: 'bottom' }).code).toBe('bad-position');
    h.act('p2', { type: 'signal', card: 'b9', pos: 'top' });
    expect(att(h).signals).toMatchObject([{ by: 'p2', card: 'b9', pos: 'top', before: 1 }]);
    expect(h.refuse('p2', { type: 'signal', card: 'g1', pos: 'bottom' }).code).toBe('no-signal');
    h.act('p1', { type: 'play', card: 'b1' });
    expect(h.refuse('p3', { type: 'signal', card: 'y9', pos: 'top' }).message).toMatch(
      /Not during a trick/,
    );
  });

  it('a hold keeps the leader waiting until the signal', () => {
    const h = playing();
    h.act('p3', { type: 'hold', on: true });
    expect(h.refuse('p1', { type: 'play', card: 'b1' }).code).toBe('hold');
    h.act('p3', { type: 'signal', card: 'y1', pos: 'bottom' });
    h.act('p1', { type: 'play', card: 'b1' });
  });

  it('currents hide the position; shared tokens run out', () => {
    const h = playing(2, ['1']);
    h.act('p2', { type: 'signal', card: 'b9', pos: null });
    expect(att(h).signals[0]!.pos).toBeNull();
    const r = playing(4, ['2']);
    expect(att(r).pool).toBe(1);
    r.act('p2', { type: 'signal', card: 'b9', pos: 'top' });
    expect(r.refuse('p3', { type: 'signal', card: 'y9', pos: 'top' }).message).toMatch(
      /shared tokens/,
    );
  });
});

describe('distress', () => {
  it('everyone agrees, everyone passes one colour card, and it costs one attempt once', () => {
    rig({ hands: SPLIT, tasks: ['2'] });
    const h = harness(3);
    toDraft(h);
    draftAll(h);
    h.act('p2', { type: 'distress', dir: 'left' });
    h.act('p1', { type: 'distress-answer', yes: true });
    h.act('p3', { type: 'distress-answer', yes: true });
    expect(att(h).stage).toBe('pass');
    expect(h.refuse('p1', { type: 'pass-card', card: 't1' }).code).toBe('trump');
    h.act('p1', { type: 'pass-card', card: 'p9' });
    h.act('p2', { type: 'pass-card', card: 'b9' });
    h.act('p3', { type: 'pass-card', card: 'y9' });
    expect(att(h).hands.p2).toContain('p9');
    expect(att(h).hands.p3).toContain('b9');
    expect(att(h).hands.p1).toContain('y9');
    expect(att(h).stage).toBe('play');
    // Lose it on purpose: p2 wins the yellow 1? No: let p3 lead it away.
    playOut(h);
    const log = h.state.campaigns['test-voyage']!.log['1']!;
    expect(log.distress).toBe(true);
    expect(log.attempts).toBe(2);
  });

  it('a no cancels the proposal', () => {
    rig({ hands: SPLIT, tasks: ['2'] });
    const h = harness(3);
    toDraft(h);
    draftAll(h);
    h.act('p2', { type: 'distress', dir: 'right' });
    h.act('p1', { type: 'distress-answer', yes: false });
    expect(att(h).distress.proposal).toBeNull();
  });
});

describe('two players and the dummy', () => {
  it('the dummy is dealt 7 down and 7 up, never the top trump, and the captain plays it', () => {
    for (let seed = 1; seed < 6; seed++) {
      const h = harness(2, seed);
      toDraft(h);
      const a = att(h);
      expect(a.crew).toEqual(['p1', 'p2', DUMMY]);
      expect(a.hands[DUMMY]).toHaveLength(14);
      expect(a.hands[DUMMY]).not.toContain('t4');
      expect(a.dummy!.up.filter(Boolean)).toHaveLength(7);
      expect(a.total).toBe(13);
    }
  });

  it('a face-down card turns up after the trick in which the card on it was played', () => {
    const h = harness(2, 3);
    toDraft(h);
    draftAll(h);
    dive(h);
    const before = att(h).dummy!;
    for (let i = 0; i < 3; i++) {
      const a = att(h);
      h.act(a.turn === DUMMY ? a.captain : a.turn, { type: 'play', card: legalFor(a, a.turn)[0]! });
      if (att(h).stage !== 'play') return;
    }
    const after = att(h).dummy!;
    const slot = before.up.findIndex((c, i) => c !== after.up[i]);
    expect(after.up[slot]).toBe(before.down[slot]);
    expect(after.down[slot]).toBeNull();
  });
});

describe('mission rules', () => {
  it('a real-time mission fails when the clock runs out; untimed, it plays its alternative', () => {
    rig({ hands: SPLIT, tasks: ['2'] });
    const h = harness(3);
    toDraft(h, 5);
    for (const id of ['p2', 'p3']) h.act(id, { type: 'answer', yes: false });
    h.act('p1', { type: 'answer', yes: true });
    dive(h);
    expect(att(h).deadline).toBe(NOW + 60_000);
    h.tick();
    expect(att(h).result).toMatchObject({ success: false, timedOut: true });
    const u = harness(3);
    u.act(HOST, { type: 'update-settings', realTime: false });
    toDraft(u, 5);
    expect(att(u).mission.seconds).toBeNull();
    expect(att(u).comms).toBe('currents');
  });

  it('unfamiliar terrain sets the signals from a random colour card', () => {
    for (let seed = 1; seed < 12; seed++) {
      const h = harness(3, seed);
      toDraft(h, 7);
      const a = att(h);
      const v = Number(a.terrain!.slice(1));
      expect(a.terrain![0]).not.toBe('t');
      expect(a.comms).toBe(v <= 3 ? 'normal' : v <= 6 ? 'currents' : 'rapture');
    }
  });

  it('crew conditions need no draft', () => {
    const h = harness(3);
    toDraft(h, 3);
    expect(att(h).stage).toBe('distress');
    expect(att(h).tasks).toMatchObject([{ crew: true, owner: null }]);
  });

  it('a printed re-deal rule deals again until no hand holds the set', () => {
    rig({ tasks: ['13'] });
    for (let seed = 1; seed < 25; seed++) {
      const h = harness(3, seed);
      toDraft(h);
      const hands = Object.values(att(h).hands);
      expect(hands.some((hand) => ['t1', 't2', 't3', 't4'].every((c) => hand.includes(c)))).toBe(
        false,
      );
    }
  });

  it('secret predictions are made before the first trick', () => {
    rig({ hands: SPLIT, tasks: ['9'] });
    const h = harness(3);
    toDraft(h);
    draftAll(h);
    for (const id of ['p1', 'p2', 'p3']) h.act(id, { type: 'dive' });
    expect(att(h).stage).toBe('predict');
    expect(h.refuse('p2', { type: 'predict', task: 0, n: 2 }).code).toBe('not-yours');
    h.act('p1', { type: 'predict', task: 0, n: 13 });
    expect(att(h).stage).toBe('play');
  });

  it('the epilogue starts at its difficulty and rises with each success', () => {
    const h = harness(3);
    toDraft(h, 0);
    expect(att(h).mission).toMatchObject({ n: 0, difficulty: 5, selection: 'free' });
  });
});

describe('the campaign across rooms', () => {
  it('a linked room takes over the campaign', () => {
    rig({ hands: SPLIT, tasks: ['1'] });
    const h = harness(3);
    toDraft(h);
    draftAll(h);
    dive(h);
    h.act('p1', { type: 'play', card: 'p3' });
    h.act('p2', { type: 'play', card: 'b2' });
    h.act('p3', { type: 'play', card: 'g6' });
    const carried = missionControl.carry!(h.state);
    const next = missionControl.create(
      {
        now: NOW,
        rng: createRng(1),
        content: packContent(),
        carried: JSON.parse(JSON.stringify(carried)),
      },
      [],
    );
    expect(next.campaigns['test-voyage']!.log['1']!.done).toBe(NOW);
    const junk = missionControl.create(
      { now: NOW, rng: createRng(1), content: packContent(), carried: { campaigns: 5 } },
      [],
    );
    expect(junk.campaigns).toEqual({});
  });
});

it('the deck has 40 cards', () => {
  expect(new Set(DECK).size).toBe(40);
  expect(VOYAGE.missions.length).toBeGreaterThan(0);
});
